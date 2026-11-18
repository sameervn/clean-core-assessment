import { randomUUID } from "node:crypto";
import { systemPool, type PoolClient, type ProjectDatabaseScope } from "@workspace/db";
import { AiError } from "../assessment-ai";
import { initializeKnowledge } from "../knowledge/schema";
import { initializeReports } from "../reports/schema";
import { initializeCollaboration } from "../collaboration/schema";

export const LEGACY_PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const LEGACY_CLIENT_ID = "00000000-0000-4000-8000-000000000001";
export const projectSchemaName = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid internal project ID");
  return `ccp_${id.replaceAll("-", "")}`;
};
const view = (r: any, assigned = true) => ({
  id: r.id, clientId: r.client_id, name: r.name, legacy: r.legacy, assigned,
  provisioningStatus: r.provisioning_status, provisioningError: r.provisioning_error ?? null,
});
export async function controlTransaction<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await systemPool.connect();
  try { await c.query("BEGIN"); const result = await fn(c); await c.query("COMMIT"); return result; }
  catch (error) { await c.query("ROLLBACK"); throw error; }
  finally { c.release(); }
}
export async function provision(c: PoolClient, id: string, migrateLegacy = false) {
  const schema = projectSchemaName(id); // generated UUIDs only, never a request-supplied SQL identifier
  const { owner, runtime } = provisioningRoles();
  if (owner) await c.query(`SET LOCAL ROLE "${owner}"`);
  await c.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  if (migrateLegacy) {
    if (owner) await c.query("RESET ROLE");
    const tables = (await c.query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public'
      AND (tablename LIKE 'cc_knowledge%' OR tablename LIKE 'cc_report_%'
        OR tablename LIKE 'cc_shared_%' OR tablename LIKE 'cc_assessment_%'
        OR tablename LIKE 'cc_review_%' OR tablename LIKE 'cc_github_%' OR tablename LIKE 'cc_company_%')`)).rows;
    for (const { tablename } of tables) {
      if (!/^cc_[a-z_]+$/.test(tablename)) throw new Error("Unexpected legacy table identifier");
      await c.query(`ALTER TABLE public."${tablename}" SET SCHEMA "${schema}"`);
      if (owner) await c.query(`ALTER TABLE "${schema}"."${tablename}" OWNER TO "${owner}"`);
    }
    if (owner) await c.query(`SET LOCAL ROLE "${owner}"`);
  }
  await c.query("SELECT set_config('search_path',$1,true)", [schema]);
  // Views limit all existing account/reviewer pickers and fresh authority checks
  // to this project's explicitly assigned accounts. FKs reference public identities.
  await c.query(`CREATE OR REPLACE VIEW cc_accounts AS SELECT a.* FROM public.cc_accounts a
    WHERE EXISTS (SELECT 1 FROM public.cc_project_members pm WHERE pm.project_id='${id}' AND pm.user_id=a.id);
    CREATE OR REPLACE VIEW cc_account_sessions AS SELECT s.* FROM public.cc_account_sessions s
    WHERE EXISTS (SELECT 1 FROM public.cc_project_members pm WHERE pm.project_id='${id}' AND pm.user_id=s.user_id)`);
  await initializeReports(c);
  await initializeCollaboration(c);
  await initializeKnowledge(c);
  if (runtime) {
    await c.query(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC;
      GRANT USAGE ON SCHEMA "${schema}" TO "${runtime}";
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${runtime}";
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${runtime}"`);
  }
  if (owner) await c.query("RESET ROLE");
  await c.query("SELECT set_config('search_path','public',true)");
}
export function provisioningRoles() {
  const role = (key: string) => {
    const value = process.env[key];
    if (value && !/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  const owner = role("CC_PROJECT_OWNER_ROLE"), runtime = role("CC_PROJECT_RUNTIME_ROLE");
  if (!!owner !== !!runtime) throw new Error("Set both project owner and runtime roles");
  if (owner && owner === runtime) throw new Error("Project owner and runtime roles must differ");
  return { owner, runtime };
}
export async function initializeProjects() {
  await controlTransaction(async c => {
    await c.query("SELECT pg_advisory_xact_lock(614099)");
    await c.query(`CREATE TABLE IF NOT EXISTS public.cc_clients (
      id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS public.cc_projects (
      id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES public.cc_clients(id),
      name text NOT NULL, schema_name text NOT NULL UNIQUE, legacy boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS public.cc_project_members (
      project_id uuid NOT NULL REFERENCES public.cc_projects(id), user_id text NOT NULL REFERENCES public.cc_accounts(id),
      PRIMARY KEY(project_id,user_id));
      CREATE INDEX IF NOT EXISTS cc_project_members_user ON public.cc_project_members(user_id);
      CREATE TABLE IF NOT EXISTS public.cc_project_audit (
      id bigserial PRIMARY KEY, actor_id text REFERENCES public.cc_accounts(id), project_id uuid REFERENCES public.cc_projects(id),
      action text NOT NULL, target_id text, created_at timestamptz NOT NULL DEFAULT now())`);
    await c.query(`ALTER TABLE public.cc_projects
      ADD COLUMN IF NOT EXISTS provisioning_status text NOT NULL DEFAULT 'ready'
        CHECK (provisioning_status IN ('pending','failed','ready','cancelled')),
      ADD COLUMN IF NOT EXISTS provisioning_error text,
      ADD COLUMN IF NOT EXISTS requested_by text REFERENCES public.cc_accounts(id);
      CREATE INDEX IF NOT EXISTS cc_projects_pending ON public.cc_projects(created_at,id)
        WHERE provisioning_status='pending'`);
    const { owner, runtime } = provisioningRoles();
    if (owner && runtime) {
      await c.query(`GRANT USAGE ON SCHEMA public TO "${owner}","${runtime}";
        GRANT SELECT ON public.cc_accounts,public.cc_account_sessions,public.cc_project_members TO "${owner}";
        GRANT UPDATE(id) ON public.cc_accounts TO "${owner}";
        GRANT UPDATE(token_hash) ON public.cc_account_sessions TO "${owner}";
        GRANT REFERENCES ON public.cc_accounts TO "${owner}";
        GRANT SELECT,INSERT,UPDATE,DELETE ON public.cc_accounts,public.cc_account_sessions,
          public.cc_account_throttle,public.cc_account_audit,public.cc_clients,public.cc_projects,
          public.cc_project_members,public.cc_project_audit TO "${runtime}";
        GRANT USAGE,SELECT ON SEQUENCE public.cc_project_audit_id_seq TO "${runtime}"`);
    }
    await c.query("INSERT INTO public.cc_clients(id,name) VALUES($1,'Legacy client — assign before client use') ON CONFLICT DO NOTHING", [LEGACY_CLIENT_ID]);
    const inserted = await c.query(`INSERT INTO public.cc_projects(id,client_id,name,schema_name,legacy)
      VALUES($1,$2,'Legacy workspace',$3,true) ON CONFLICT DO NOTHING RETURNING id`, [LEGACY_PROJECT_ID, LEGACY_CLIENT_ID, projectSchemaName(LEGACY_PROJECT_ID)]);
    if (inserted.rowCount) {
      // Preserve existing assessment memberships but do not grant legacy contents to all accounts.
      await c.query(`INSERT INTO public.cc_project_members(project_id,user_id)
        SELECT $1,id FROM public.cc_accounts WHERE role='Admin' AND active ON CONFLICT DO NOTHING`, [LEGACY_PROJECT_ID]);
    }
    // Idempotent migration: all existing tables/rows move atomically, never copied or deleted.
    await provision(c, LEGACY_PROJECT_ID, true);
    const others = (await c.query("SELECT id FROM public.cc_projects WHERE NOT legacy AND provisioning_status='ready' ORDER BY id")).rows;
    for (const project of others) await provision(c, project.id);
  });
}
export async function projectCatalog(userId: string, admin: boolean) {
  const projects = (await systemPool.query(`SELECT p.*, (m.user_id IS NOT NULL) AS assigned
    FROM public.cc_projects p LEFT JOIN public.cc_project_members m ON m.project_id=p.id AND m.user_id=$1
    WHERE $2::boolean OR (m.user_id IS NOT NULL AND p.provisioning_status='ready')
    ORDER BY p.legacy DESC,p.created_at,p.id`, [userId, admin])).rows;
  const clients = (await systemPool.query(`SELECT id,name FROM public.cc_clients
    WHERE $1::boolean OR id=ANY($2::uuid[]) ORDER BY name,id`, [admin, projects.map(p => p.client_id)])).rows;
  return { clients, projects: projects.map(p => view(p, p.assigned)) };
}
export async function readyProjectScopes(): Promise<ProjectDatabaseScope[]> {
  return (await systemPool.query("SELECT id,schema_name,legacy FROM public.cc_projects WHERE provisioning_status='ready' ORDER BY id")).rows
    .map(r => ({ projectId: r.id, schema: r.schema_name, legacy: r.legacy }));
}
export async function authorizedProject(userId: string, id: string): Promise<ProjectDatabaseScope> {
  const r = (await systemPool.query(`SELECT p.* FROM public.cc_projects p
    JOIN public.cc_project_members m ON m.project_id=p.id JOIN public.cc_accounts a ON a.id=m.user_id
    WHERE p.id=$1 AND p.provisioning_status='ready' AND a.id=$2 AND a.active AND NOT a.must_change_password`, [id, userId])).rows[0];
  if (!r) throw new AiError(404, "Project not found or access removed. Select an assigned project.");
  return { projectId: r.id, schema: r.schema_name, legacy: r.legacy, actorId: userId };
}
export async function createClient(actor: string, clientName: string) {
  return controlTransaction(async c => {
    const row = (await c.query("INSERT INTO public.cc_clients(id,name) VALUES($1,$2) RETURNING id,name", [randomUUID(), clientName])).rows[0];
    await c.query("INSERT INTO public.cc_project_audit(actor_id,action,target_id) VALUES($1,'client created',$2)", [actor, row.id]);
    return row;
  });
}
export async function createProject(actor: string, input: { clientId: string; name: string }) {
  return controlTransaction(async c => {
    await assertProjectAdmin(c, actor);
    if (!(await c.query("SELECT id FROM public.cc_clients WHERE id=$1 FOR SHARE", [input.clientId])).rowCount) throw new AiError(404, "Client not found.");
    const id = randomUUID();
    const row = (await c.query(`INSERT INTO public.cc_projects(id,client_id,name,schema_name,provisioning_status,requested_by)
      VALUES($1,$2,$3,$4,'pending',$5) RETURNING *`, [id, input.clientId, input.name, projectSchemaName(id), actor])).rows[0];
    await c.query("INSERT INTO public.cc_project_members(project_id,user_id) VALUES($1,$2)", [id, actor]);
    await c.query("INSERT INTO public.cc_project_audit(actor_id,project_id,action) VALUES($1,$2,'project provisioning requested')", [actor, id]);
    return view(row);
  });
}
export async function assertProjectAdmin(c: PoolClient, actor: string) {
  if (!(await c.query(`SELECT id FROM public.cc_accounts
    WHERE id=$1 AND role='Admin' AND active AND NOT must_change_password FOR SHARE`, [actor])).rowCount) {
    throw new AiError(403, "An active Admin must request project provisioning.");
  }
}
export async function changeProvisioning(actor: string, id: string, action: "retry" | "cancel") {
  return controlTransaction(async c => {
    await assertProjectAdmin(c, actor);
    const row = (await c.query("SELECT * FROM public.cc_projects WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new AiError(404, "Project not found.");
    if (row.legacy || !(action === "retry" ? ["failed"] : ["failed", "pending"]).includes(row.provisioning_status)) {
      throw new AiError(409, "Project status changed. Refresh before retrying or cancelling.");
    }
    const updated = (await c.query(`UPDATE public.cc_projects SET provisioning_status=$2,
      provisioning_error=NULL,requested_by=$3 WHERE id=$1 RETURNING *`,
    [id, action === "retry" ? "pending" : "cancelled", actor])).rows[0];
    await c.query("INSERT INTO public.cc_project_audit(actor_id,project_id,action) VALUES($1,$2,$3)",
      [actor, id, `project provisioning ${action}`]);
    const assigned = !!(await c.query("SELECT 1 FROM public.cc_project_members WHERE project_id=$1 AND user_id=$2", [id, actor])).rowCount;
    return view(updated, assigned);
  });
}
export async function updateProject(actor: string, id: string, input: { clientId: string; name: string }) {
  return controlTransaction(async c => {
    if (!(await c.query("SELECT id FROM public.cc_clients WHERE id=$1 FOR SHARE", [input.clientId])).rowCount) throw new AiError(404, "Client not found.");
    const row = (await c.query("UPDATE public.cc_projects SET client_id=$2,name=$3 WHERE id=$1 RETURNING *", [id, input.clientId, input.name])).rows[0];
    if (!row) throw new AiError(404, "Project not found.");
    await c.query("INSERT INTO public.cc_project_audit(actor_id,project_id,action,target_id) VALUES($1,$2,'project assigned/renamed',$3)", [actor, id, input.clientId]);
    const assigned = !!(await c.query("SELECT 1 FROM public.cc_project_members WHERE project_id=$1 AND user_id=$2", [id, actor])).rowCount;
    return view(row, assigned);
  });
}
export async function projectMembers(id: string, c: Pick<PoolClient, "query"> = systemPool) {
  if (!(await c.query("SELECT id FROM public.cc_projects WHERE id=$1", [id])).rowCount) throw new AiError(404, "Project not found.");
  const users = (await c.query(`SELECT a.id,a.username,a.role,a.active,(m.user_id IS NOT NULL) AS assigned
    FROM public.cc_accounts a LEFT JOIN public.cc_project_members m ON m.user_id=a.id AND m.project_id=$1
    ORDER BY a.username,a.id`, [id])).rows;
  return { users };
}
export async function updateProjectMember(actor: string, id: string, userId: string, enabled: boolean) {
  return controlTransaction(async c => {
    if (!(await c.query("SELECT id FROM public.cc_projects WHERE id=$1 FOR UPDATE", [id])).rowCount) throw new AiError(404, "Project not found.");
    const target = (await c.query("SELECT id,role,active FROM public.cc_accounts WHERE id=$1 FOR SHARE", [userId])).rows[0];
    if (!target) throw new AiError(404, "Account not found.");
    if (!enabled && target.role === "Admin" && target.active) {
      const count = await c.query(`SELECT 1 FROM public.cc_project_members m JOIN public.cc_accounts a ON a.id=m.user_id
        WHERE m.project_id=$1 AND m.user_id<>$2 AND a.role='Admin' AND a.active`, [id, userId]);
      if (!count.rowCount) throw new AiError(409, "Assign another active Admin before removing the last project Admin.");
    }
    if (enabled) await c.query("INSERT INTO public.cc_project_members(project_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, userId]);
    else await c.query("DELETE FROM public.cc_project_members WHERE project_id=$1 AND user_id=$2", [id, userId]);
    await c.query("INSERT INTO public.cc_project_audit(actor_id,project_id,action,target_id) VALUES($1,$2,$3,$4)",
      [actor, id, enabled ? "member assigned" : "member removed", userId]);
    return projectMembers(id, c);
  });
}
