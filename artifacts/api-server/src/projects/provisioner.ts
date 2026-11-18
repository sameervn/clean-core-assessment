import { systemPool } from "@workspace/db";
import { logger } from "../lib/logger";
import { assertProjectAdmin, controlTransaction, projectSchemaName, provision } from "./service";

/** Only the operator process calls this; no privileged pool exists in the API. */
export async function provisionNextProject(): Promise<"idle" | "ready" | "failed"> {
  return controlTransaction(async c => {
    // Upgrades take the exclusive version of this lock.
    await c.query("SELECT pg_advisory_xact_lock_shared(614099)");
    const row = (await c.query(`SELECT * FROM public.cc_projects WHERE provisioning_status='pending'
      ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
    if (!row) return "idle";
    await c.query("SAVEPOINT project_setup");
    try {
      if (row.legacy || row.schema_name !== projectSchemaName(row.id)) throw new Error("Invalid provisioning request");
      await assertProjectAdmin(c, row.requested_by);
      // Never adopt an unknown/partial schema, even if it has the expected name.
      if ((await c.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [row.schema_name])).rowCount) {
        throw new Error("Project schema already exists");
      }
      await provision(c, row.id);
      await c.query("UPDATE public.cc_projects SET provisioning_status='ready',provisioning_error=NULL WHERE id=$1", [row.id]);
      await c.query(`INSERT INTO public.cc_project_audit(actor_id,project_id,action)
        VALUES($1,$2,'project provisioning ready')`, [row.requested_by, row.id]);
      return "ready";
    } catch (error) {
      // SQLSTATE only: database messages can include credentials or client data.
      const code = (error as { code?: unknown })?.code;
      logger.warn({ projectId: row.id, ...(typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? { sqlState: code } : {}) },
        "Project setup rolled back; check provisioner ownership, grants and request authority");
      // Includes schema, tables, ownership, grants and role/search_path changes.
      await c.query("ROLLBACK TO SAVEPOINT project_setup");
      await c.query(`UPDATE public.cc_projects SET provisioning_status='failed',
        provisioning_error='Setup failed. Ask the operator to check provisioning roles and logs, then retry.' WHERE id=$1`, [row.id]);
      await c.query(`INSERT INTO public.cc_project_audit(actor_id,project_id,action)
        VALUES($1,$2,'project provisioning failed')`, [row.requested_by, row.id]);
      return "failed";
    }
  });
}

export async function closeProvisioner() { await systemPool.end(); }
