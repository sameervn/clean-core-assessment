import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod/v4";
import { pool, type PoolClient } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { COOKIE, requireAdmin, requirePermission } from "../auth/middleware";
import { PERMISSIONS, ROLES } from "../auth/permissions";
import { publicUser, transaction, audit, createSession, throttle, type DbUser } from "../auth/service";
import { hashPassword, verifyPassword } from "../auth/passwords";
import { auditFilters, readAudit } from "../auth/audit-reader";

const password = z.string().min(14).max(128).refine(value => value.trim().length >= 14);
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);
const overrides = z.partialRecord(z.enum(PERMISSIONS), z.boolean()).default({});
const loginInput = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(128) }).strict();
const createInput = z.object({ username, password, role: z.enum(ROLES), overrides }).strict();
const updateInput = z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional(), overrides: z.partialRecord(z.enum(PERMISSIONS), z.boolean()).optional() }).strict();
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response, _next: NextFunction) => {
  try { await fn(req, res); }
  catch (e) {
    res.status(e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : (e as any)?.code === "23505" ? 409 : 503)
      .json({ message: e instanceof HttpError ? e.message : e instanceof z.ZodError ? "Check required fields, username format and password length (14–128 characters)." : (e as any)?.code === "23505" ? "Username already exists." : "Account operation unavailable. Please try again." });
  }
};
// Explicit opt-out supports the localhost-only production-image Compose smoke.
// TLS-terminating ingress needs no forwarded-header trust: secure is the default.
const cookieOptions = { httpOnly: true, secure: process.env.CC_COOKIE_INSECURE !== "true", sameSite: "lax" as const, path: "/api", maxAge: 8 * 60 * 60 * 1000 };
// An unknown account still performs the same expensive password derivation.
const dummyHash = hashPassword("dummy-only-not-an-account-password");
export const accountRouter = Router();

accountRouter.get("/auth/me", wrap(async (req, res) => {
  if (req.identity) { res.json({ user: req.identity.user, csrfToken: req.identity.csrf }); return; }
  res.json({ user: null, setupRequired: !(await pool.query("SELECT 1 FROM cc_accounts LIMIT 1")).rowCount });
}));
accountRouter.post("/auth/login", wrap(async (req, res) => {
  const input = loginInput.parse(req.body), name = input.username.trim().toLowerCase();
  // An attacker must not be able to exhaust a shared allowance for all users.
  const allowed = await throttle(`login:account:${name}`);
  if (!allowed) { res.setHeader("Retry-After", "900"); throw new HttpError(429, "Too many sign-in attempts. Try again in 15 minutes."); }
  const row = (await pool.query("SELECT * FROM cc_accounts WHERE username=$1", [name])).rows[0] as DbUser | undefined;
  const valid = await verifyPassword(input.password, row?.password_hash ?? await dummyHash);
  if (!row || !valid || !row.active) {
    await audit(pool, null, "login_failed", row?.id ?? null);
    throw new HttpError(401, "Invalid username or password.");
  }
  const session = await transaction(async client => {
    const current = (await client.query("SELECT * FROM cc_accounts WHERE id=$1", [row.id])).rows[0] as DbUser;
    if (!current?.active || current.password_hash !== row.password_hash) throw new HttpError(401, "Invalid username or password.");
    if (req.identity) await client.query("DELETE FROM cc_account_sessions WHERE token_hash=$1", [req.identity.tokenHash]);
    await audit(client, row.id, "login", row.id);
    return { ...(await createSession(client, row.id)), user: publicUser(current) };
  });
  res.cookie(COOKIE, session.token, cookieOptions);
  res.json({ user: session.user, csrfToken: session.csrf });
}));
accountRouter.post("/auth/logout", wrap(async (req, res) => {
  if (req.identity) {
    await pool.query("DELETE FROM cc_account_sessions WHERE token_hash=$1", [req.identity.tokenHash]);
    await audit(pool, req.identity.user.id, "logout");
  }
  res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined }).json({ ok: true });
}));
accountRouter.post("/auth/password", wrap(async (req, res) => {
  if (!req.identity) throw new HttpError(401, "Sign in to continue.");
  const input = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict().parse(req.body);
  if (input.currentPassword === input.newPassword) throw new HttpError(400, "Choose a different password.");
  if (!await throttle(`password:${req.identity.user.id}`)) throw new HttpError(429, "Too many attempts. Try later.");
  const hash = await hashPassword(input.newPassword);
  await transaction(async client => {
    const row = (await client.query("SELECT * FROM cc_accounts WHERE id=$1", [req.identity!.user.id])).rows[0] as DbUser;
    if (!row?.active || !await verifyPassword(input.currentPassword, row.password_hash)) throw new HttpError(400, "Current password is incorrect.");
    await client.query("UPDATE cc_accounts SET password_hash=$2,must_change_password=false WHERE id=$1", [row.id, hash]);
    await client.query("DELETE FROM cc_account_sessions WHERE user_id=$1", [row.id]);
    await audit(client, row.id, "password_changed", row.id);
  });
  res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined }).json({ ok: true });
}));
accountRouter.post("/auth/authorize", (req, res, next) => {
  const input = z.object({ permission: z.enum(PERMISSIONS) }).strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ message: "Unknown permission." }); return; }
  requirePermission(input.data.permission)(req, res, () => res.json({ ok: true }));
});
accountRouter.use("/admin", requireAdmin);
accountRouter.get("/admin/audit", wrap(async (req, res) => {
  const parsed = auditFilters.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, "Choose a valid action, page, and UTC date range (start on or before end).");
  res.setHeader("Cache-Control", "no-store");
  res.json(await readAudit(parsed.data));
}));
accountRouter.get("/admin/users", wrap(async (_req, res) => {
  const rows = await pool.query("SELECT * FROM cc_accounts ORDER BY username");
  res.json({ users: rows.rows.map(publicUser), roles: ROLES, permissions: PERMISSIONS });
}));
async function checkActor(client: PoolClient, req: Request) {
  const actor = (await client.query(`SELECT a.id FROM cc_accounts a JOIN cc_account_sessions s ON s.user_id=a.id
    WHERE a.id=$1 AND a.role='Admin' AND a.active AND NOT a.must_change_password AND s.token_hash=$2 AND s.expires_at>now()`,
    [req.identity!.user.id, req.identity!.tokenHash])).rows[0];
  if (!actor) throw new HttpError(403, "Administrator access no longer available.");
}
accountRouter.post("/admin/users", wrap(async (req, res) => {
  const input = createInput.parse(req.body), hash = await hashPassword(input.password);
  const user = await transaction(async client => {
    await checkActor(client, req);
    const result = await client.query(`INSERT INTO cc_accounts(id,username,password_hash,role,overrides) VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [randomUUID(), input.username, hash, input.role, JSON.stringify(input.role === "Admin" ? {} : input.overrides)]);
    await audit(client, req.identity!.user.id, "user_created", result.rows[0].id);
    return publicUser(result.rows[0]);
  });
  res.status(201).json({ user });
}));
accountRouter.patch("/admin/users/:id", wrap(async (req, res) => {
  const input = updateInput.parse(req.body), id = z.string().uuid().parse(req.params.id);
  const user = await transaction(async client => {
    await checkActor(client, req);
    const current = (await client.query("SELECT * FROM cc_accounts WHERE id=$1", [id])).rows[0] as DbUser;
    if (!current) throw new HttpError(404, "User not found.");
    const role = input.role ?? current.role, active = input.active ?? current.active;
    if (current.role === "Admin" && current.active && (role !== "Admin" || !active)) {
      if (Number((await client.query("SELECT count(*) FROM cc_accounts WHERE role='Admin' AND active")).rows[0].count) <= 1)
        throw new HttpError(409, "At least one active Admin must remain.");
    }
    const result = await client.query("UPDATE cc_accounts SET role=$2,active=$3,overrides=$4 WHERE id=$1 RETURNING *",
      [id, role, active, JSON.stringify(role === "Admin" ? {} : input.overrides ?? current.overrides)]);
    if (!active) await client.query("DELETE FROM cc_account_sessions WHERE user_id=$1", [id]);
    if (role !== current.role) await audit(client, req.identity!.user.id, "role_changed", id);
    const nextOverrides = result.rows[0].overrides as Record<string, boolean>;
    if (PERMISSIONS.some(p => current.overrides[p] !== nextOverrides[p]))
      await audit(client, req.identity!.user.id, "permissions_changed", id);
    if (active !== current.active)
      await audit(client, req.identity!.user.id, active ? "user_activated" : "user_deactivated", id);
    return publicUser(result.rows[0]);
  });
  res.json({ user });
}));
accountRouter.post("/admin/users/:id/reset-password", wrap(async (req, res) => {
  const { password: replacement } = z.object({ password }).strict().parse(req.body), id = z.string().uuid().parse(req.params.id);
  const hash = await hashPassword(replacement);
  await transaction(async client => {
    await checkActor(client, req);
    const result = await client.query("UPDATE cc_accounts SET password_hash=$2,must_change_password=true WHERE id=$1 RETURNING id", [id, hash]);
    if (!result.rowCount) throw new HttpError(404, "User not found.");
    await client.query("DELETE FROM cc_account_sessions WHERE user_id=$1", [id]);
    await audit(client, req.identity!.user.id, "password_reset", id);
  });
  res.json({ ok: true });
}));
