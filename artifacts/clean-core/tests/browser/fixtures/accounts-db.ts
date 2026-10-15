/**
 * Synthetic-account fixtures for browser tests.
 *
 * Creates uniquely named, throwaway accounts directly in the accounts database
 * (DATABASE_URL) with the backend's own password hasher, signs them in through
 * the real /api/auth/login route, and deletes them (plus their sessions and
 * audit rows) at teardown. It never reads, uses or resets the real `admin`
 * account or CC_BOOTSTRAP_PASSWORD.
 */
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../../../../api-server/src/auth/passwords";

type Role = "Admin" | "Developer" | "Reviewer";
export interface SyntheticAccount { id: string; username: string; password: string; role: Role }

const requireFromDb = createRequire(fileURLToPath(new URL("../../../../../lib/db/package.json", import.meta.url)));
let poolPromise: Promise<any> | null = null;
function pool() {
  if (!poolPromise) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for synthetic account fixtures.");
    const pg = requireFromDb("pg");
    poolPromise = Promise.resolve(new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, allowExitOnIdle: true }));
  }
  return poolPromise;
}

export const SYNTHETIC_PREFIX = "e2e-synth-";

export async function createSyntheticAccount(opts: { role?: Role; overrides?: Record<string, boolean>; mustChangePassword?: boolean; active?: boolean; password?: string } = {}): Promise<SyntheticAccount> {
  const role = opts.role ?? "Developer";
  const username = `${SYNTHETIC_PREFIX}${role.toLowerCase()}-${randomBytes(5).toString("hex")}`;
  if (username === "admin") throw new Error("refusing to touch the real admin");
  const password = opts.password ?? `Synth-${randomBytes(12).toString("base64url")}`;
  const id = randomUUID();
  const db = await pool();
  await db.query(
    "INSERT INTO cc_accounts(id, username, password_hash, role, active, must_change_password, overrides) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
    [id, username, await hashPassword(password), role, opts.active ?? true, opts.mustChangePassword ?? false, JSON.stringify(opts.overrides ?? {})],
  );
  return { id, username, password, role };
}

export async function deleteSyntheticAccounts(ids: string[]) {
  if (!ids.length) return;
  const db = await pool();
  // Only ever delete rows created by this fixture.
  await db.query("DELETE FROM cc_account_audit WHERE actor_id = ANY($1::text[]) OR target_id = ANY($1::text[])", [ids]);
  await db.query("DELETE FROM cc_accounts WHERE id = ANY($1::text[]) AND username LIKE $2", [ids, `${SYNTHETIC_PREFIX}%`]);
}

export async function closeFixturePool() {
  if (poolPromise) { const p = await poolPromise; poolPromise = null; await p.end(); }
}

/** Change only throwaway test users; exercise real /me refresh and expiry. */
export async function expireSyntheticSessions(account: SyntheticAccount) {
  const db = await pool();
  await db.query(`UPDATE cc_account_sessions SET expires_at=now()-interval '1 second'
    WHERE user_id IN (SELECT id FROM cc_accounts WHERE id=$1 AND username LIKE $2)`,
  [account.id, `${SYNTHETIC_PREFIX}%`]);
}

export async function setSyntheticOverrides(account: SyntheticAccount, overrides: Record<string, boolean>) {
  const db = await pool();
  const result = await db.query(
    "UPDATE cc_accounts SET overrides=$3::jsonb WHERE id=$1 AND username LIKE $2",
    [account.id, `${SYNTHETIC_PREFIX}%`, JSON.stringify(overrides)],
  );
  if (result.rowCount !== 1) throw new Error("Synthetic account not found");
}

