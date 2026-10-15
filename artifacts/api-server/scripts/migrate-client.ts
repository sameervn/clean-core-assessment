import "@workspace/db/runtime-env";
import { pool } from "@workspace/db";
import { initializeKnowledge } from "../src/knowledge/schema";
import { initializeReports } from "../src/reports/schema";

// Additive and idempotent; intentionally separate from the app identity.
// Acquire a session-level lock before all schema steps. No force-push.
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(822026)");
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS cc_accounts (
      id text PRIMARY KEY, username text NOT NULL UNIQUE, password_hash text NOT NULL,
      role text NOT NULL, active boolean NOT NULL DEFAULT true,
      must_change_password boolean NOT NULL DEFAULT true,
      overrides jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS cc_account_sessions (
      token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES cc_accounts(id) ON DELETE CASCADE,
      csrf text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cc_account_throttle (
      key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cc_account_audit (
      id text PRIMARY KEY, actor_id text, target_id text, action text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await initializeKnowledge(client);
  await initializeReports(client);
  await client.query("COMMIT");
  process.stdout.write("Client schema migration completed\n");
} catch {
  await client.query("ROLLBACK").catch(() => undefined);
  process.stderr.write("Client schema migration failed; check migration role and database configuration\n");
  process.exitCode = 1;
} finally {
  await client.query("SELECT pg_advisory_unlock(822026)").catch(() => undefined);
  client.release();
  await pool.end();
}
