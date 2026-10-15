import type { Request, RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { digest, publicUser, type DbUser } from "./service";
import type { Permission } from "./permissions";

export const COOKIE = "cc_session";
export type Identity = { user: ReturnType<typeof publicUser>; csrf: string; tokenHash: string };
declare global { namespace Express { interface Request { identity?: Identity } } }
export const readIdentity: RequestHandler = async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const token = req.cookies?.[COOKIE];
    if (typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      const tokenHash = digest(token);
      const result = await pool.query(`SELECT a.*,s.csrf FROM cc_account_sessions s JOIN cc_accounts a ON a.id=s.user_id
        WHERE s.token_hash=$1 AND s.expires_at>now() AND a.active=true`, [tokenHash]);
      if (result.rows[0]) req.identity = { user: publicUser(result.rows[0] as DbUser), csrf: result.rows[0].csrf, tokenHash };
    }
    next();
  } catch { res.status(503).json({ message: "Account storage unavailable. Contact your administrator." }); }
};
export const requireSession: RequestHandler = (req, res, next) => {
  if (!req.identity) { res.status(401).json({ message: "Sign in to continue." }); return; }
  if (req.identity.user.mustChangePassword) { res.status(403).json({ message: "Change your temporary password first." }); return; }
  next();
};
export function requirePermission(permission: Permission): RequestHandler {
  return (req, res, next) => requireSession(req, res, () => {
    if (!req.identity!.user.permissions.includes(permission)) { res.status(403).json({ message: `Permission required: ${permission}.` }); return; }
    next();
  });
}
export const requireAdmin: RequestHandler = (req, res, next) => requireSession(req, res, () => {
  if (req.identity!.user.role !== "Admin") { res.status(403).json({ message: "Administrator access required." }); return; }
  next();
});
export function sameOrigin(req: Request): boolean {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (process.env.NODE_ENV === "production" && process.env.CC_COOKIE_INSECURE !== "true" && parsed.protocol !== "https:") return false;
    // Host is the request's actual target, never a user-controlled forwarded identity.
    return ["https:", "http:"].includes(parsed.protocol) && parsed.host === req.headers.host;
  } catch { return false; }
}
export const mutationProtection: RequestHandler = (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  if (!sameOrigin(req)) { res.status(403).json({ message: "A same-origin request is required." }); return; }
  if (req.path === "/auth/login") { next(); return; }
  const sent = req.headers["x-csrf-token"], expected = req.identity?.csrf;
  if (typeof sent !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(sent) || !expected || sent.length !== expected.length || !timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) {
    res.status(req.identity ? 403 : 401).json({ message: "Session expired or request verification failed. Sign in again." }); return;
  }
  next();
};
