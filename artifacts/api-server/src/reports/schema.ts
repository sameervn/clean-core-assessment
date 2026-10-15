import { pool } from "@workspace/db";
export async function initializeReports(database: Pick<typeof pool, "query"> = pool) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS cc_report_templates (
      id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES cc_accounts(id) ON DELETE CASCADE,
      name text NOT NULL, version integer NOT NULL DEFAULT 1, status text NOT NULL,
      object_path text NOT NULL, replace_id uuid, expected_version integer,
      previewed boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS cc_report_templates_owner ON cc_report_templates(owner_id);
    CREATE UNIQUE INDEX IF NOT EXISTS cc_report_templates_active ON cc_report_templates(owner_id) WHERE active;
    CREATE TABLE IF NOT EXISTS cc_report_template_garbage (
      object_path text PRIMARY KEY, delete_after timestamptz NOT NULL
    );
  `);
}
