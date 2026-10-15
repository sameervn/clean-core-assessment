import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";
import { permissions } from "./permissions";
import { hashPassword } from "./passwords";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export type DbUser = { id: string; username: string; password_hash: string; role: string; active: boolean; must_change_password: boolean; overrides: Record<string, boolean> };
export function publicUser(row: DbUser) {
  return { id: row.id, username: row.username, role: row.role, active: row.active,
    mustChangePassword: row.must_change_password, overrides: row.overrides,
    permissions: permissions(row.role, row.overrides) };
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize account modifications, including bootstrap and last-admin checks.
    await client.query("SELECT pg_advisory_xact_lock(614061)");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function audit(client: Pick<PoolClient, "query">, actor: string | null, action: string, target: string | null = null) {
  await client.query("INSERT INTO cc_account_audit(id,actor_id,target_id,action) VALUES($1,$2,$3,$4)", [randomUUID(), actor, target, action]);
}
export async function bootstrapAdmin() {
  if ((await pool.query("SELECT 1 FROM cc_accounts LIMIT 1")).rowCount) return;
  const password = process.env.CC_BOOTSTRAP_PASSWORD;
  if (!password) return; // Serve setup-required login; never invent shared credentials.
  if (password.trim().length < 14 || password.length > 128) throw new Error("CC_BOOTSTRAP_PASSWORD must contain 14–128 nonblank characters.");
  const hash = await hashPassword(password);
  await transaction(async client => {
    if ((await client.query("SELECT 1 FROM cc_accounts LIMIT 1")).rowCount) return;
    const id = randomUUID();
    await client.query("INSERT INTO cc_accounts(id,username,password_hash,role) VALUES($1,'admin',$2,'Admin')", [id, hash]);
    await audit(client, null, "bootstrap", id);
  });
}
export async function createSession(client: Pick<PoolClient, "query">, userId: string) {
  const token = randomBytes(32).toString("base64url"), csrf = randomBytes(32).toString("base64url");
  await client.query("INSERT INTO cc_account_sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')", [digest(token), userId, csrf]);
  return { token, csrf };
}
export async function throttle(identity: string, limit = 10) {
  // Database-wide atomic counters across replicas, with no raw username/IP retained.
  const key = createHmac("sha256", process.env.SESSION_SECRET!).update(identity).digest("hex");
  const result = await pool.query(`INSERT INTO cc_account_throttle(key,count,expires_at) VALUES($1,1,now()+interval '15 minutes')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN cc_account_throttle.expires_at < now() THEN 1 ELSE cc_account_throttle.count+1 END,
    expires_at=CASE WHEN cc_account_throttle.expires_at < now() THEN now()+interval '15 minutes' ELSE cc_account_throttle.expires_at END RETURNING count`, [key]);
  return result.rows[0].count <= limit;
}
