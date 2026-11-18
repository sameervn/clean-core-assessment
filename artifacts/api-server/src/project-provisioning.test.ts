import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { systemPool } from "@workspace/db";
import { createSession } from "./auth/service";
import { authorizedProject, readyProjectScopes } from "./projects/service";

const exec = promisify(execFile);
test("DML-only API queues authorized projects; separate provisioner commits grants atomically; migrator upgrades them", {
  skip: process.env.CC_TEST_PROVISIONING !== "true", timeout: 120_000,
}, async () => {
  // The companion runner creates this disposable, passwordless loopback database.
  // Refuse to run fixture DDL against any other database.
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/cc_provisioning_test");
  assert.equal(url.username, "cc_test_app");
  const sql = async (query: string) => (await exec("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", query],
    { env: { ...process.env, PGUSER: "postgres" } })).stdout.trim();
  const runRole = async (role: string, file: string, extra: Record<string, string> = {}) => {
    const next = new URL(url); next.username = role;
    return exec("pnpm", ["exec", "tsx", file], { env: { ...process.env, DATABASE_URL: next.toString(), ...extra } });
  };
  const provision = () => runRole("cc_test_provisioner", "scripts/provision-projects.ts");
  const admin = randomUUID(), developer = randomUUID(), clientId = randomUUID();
  await sql(`INSERT INTO public.cc_accounts(id,username,password_hash,role,must_change_password)
    VALUES('${admin}','fixture-admin','unused','Admin',false),('${developer}','fixture-dev','unused','Developer',false);
    INSERT INTO public.cc_clients(id,name) VALUES('${clientId}','Fixture client')`);
  const sessions = [await createSession(systemPool, admin), await createSession(systemPool, developer)];
  const { default: app } = await import("./app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (path: string, method = "GET", body?: unknown, who = 0) => fetch(`${base}/api/client-projects${path}`, {
    method, headers: { Cookie: `cc_session=${sessions[who].token}`, Origin: base, "X-CSRF-Token": sessions[who].csrf,
      "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const create = async () => {
    const response = await request("/projects", "POST", { clientId, name: "Queued fixture" });
    assert.equal(response.status, 201, await response.clone().text());
    const row = await response.json() as any;
    assert.equal(row.provisioningStatus, "pending");
    return row.id as string;
  };
  const workspace = (id: string) => fetch(`${base}/api/shared-assessments`, {
    headers: { Cookie: `cc_session=${sessions[0].token}`, "X-CC-Project-ID": id },
  });
  try {
    await assert.rejects(systemPool.query("CREATE SCHEMA forbidden_runtime_schema"), /permission denied/);
    await assert.rejects(systemPool.query("CREATE TABLE public.forbidden_runtime_table(id int)"), /permission denied/);
    await assert.rejects(systemPool.query("SET ROLE cc_test_owner"), /permission denied/);
    assert.equal((await request("/projects", "POST", { clientId, name: "Forbidden" }, 1)).status, 403);
    const id = await create(), schema = `ccp_${id.replaceAll("-", "")}`;
    assert.equal((await workspace(id)).status, 404);
    await assert.rejects(authorizedProject(admin, id), /not found/);
    assert.ok(!(await readyProjectScopes()).some(p => p.projectId === id));
    assert.equal(await sql(`SELECT count(*) FROM pg_namespace WHERE nspname='${schema}'`), "0");
    assert.equal((await request(`/projects/${id}/provisioning`, "POST", { action: "retry" }, 1)).status, 403);
    assert.equal((await request(`/projects/${id}/provisioning`, "POST", { action: "cancel" }, 1)).status, 403);
    await sql(`INSERT INTO public.cc_project_members(project_id,user_id) VALUES('${id}','${developer}')`);
    assert.ok(!((await (await request("", "GET", undefined, 1)).json()) as any).projects.some((p: any) => p.id === id));

    // A provisioner without owner membership cannot create any workspace.
    await sql("REVOKE cc_test_owner FROM cc_test_provisioner");
    await assert.rejects(provision());
    let catalog = await (await request("")).json() as any;
    assert.equal(catalog.projects.find((p: any) => p.id === id).provisioningStatus, "failed");
    assert.equal((await workspace(id)).status, 404);
    await assert.rejects(authorizedProject(admin, id), /not found/);
    assert.equal(await sql(`SELECT count(*) FROM pg_namespace WHERE nspname='${schema}'`), "0");
    await sql("GRANT cc_test_owner TO cc_test_provisioner");
    // Missing runtime role fails at final grants, rolling back actual tables.
    await sql(`UPDATE public.cc_projects SET provisioning_status='pending' WHERE id='${id}'`);
    await assert.rejects(runRole("cc_test_provisioner", "scripts/provision-projects.ts", { CC_PROJECT_RUNTIME_ROLE: "cc_missing_role" }));
    assert.equal(await sql(`SELECT count(*) FROM pg_namespace WHERE nspname='${schema}'`), "0");
    assert.equal((await request(`/projects/${id}/provisioning`, "POST", { action: "retry" })).status, 200);
    await Promise.all([provision(), provision()]);
    catalog = await (await request("")).json() as any;
    assert.equal(catalog.projects.find((p: any) => p.id === id).provisioningStatus, "ready");
    assert.equal((await authorizedProject(admin, id)).schema, schema);
    await systemPool.query(`SELECT a.id FROM "${schema}".cc_accounts a
      JOIN "${schema}".cc_account_sessions s ON s.user_id=a.id WHERE a.id=$1 FOR SHARE OF a,s`, [admin]);
    assert.equal((await workspace(id)).status, 200);
    const members = (await systemPool.query(`SELECT id FROM "${schema}".cc_accounts`)).rows.map(r => r.id);
    assert.deepEqual(new Set(members), new Set([admin, developer]));
    const assessment = randomUUID();
    await systemPool.query(`INSERT INTO "${schema}".cc_shared_assessments(id,owner_id,import_key,name,system,target_release)
      VALUES($1,$2,'fixture','Fixture','TEST','S4HANA_2025')`, [assessment, admin]);
    const event = await systemPool.query(`INSERT INTO "${schema}".cc_assessment_events(assessment_id,actor_id,action)
      VALUES($1,$2,'fixture') RETURNING id`, [assessment, admin]);
    assert.ok(event.rows[0].id); // Project sequence grants, not just table grants.
    await systemPool.query(`INSERT INTO "${schema}".cc_knowledge_epoch(singleton,revision) VALUES(true,1)
      ON CONFLICT(singleton) DO UPDATE SET revision=1`);
    await assert.rejects(systemPool.query(`ALTER TABLE "${schema}".cc_knowledge ADD COLUMN forbidden text`), /must be owner/);
    await assert.rejects(systemPool.query(`CREATE TABLE "${schema}".forbidden(id int)`), /permission denied/);
    assert.equal((await request(`/projects/${id}/provisioning`, "POST", { action: "cancel" })).status, 409);
    // Simulate an older project missing an additive upgrade column.
    await sql(`ALTER TABLE "${schema}".cc_assessment_approvals DROP COLUMN report_path`);
    await runRole("cc_test_migrator", "scripts/migrate-client.ts");
    assert.equal(await sql(`SELECT count(*) FROM information_schema.columns
      WHERE table_schema='${schema}' AND table_name='cc_assessment_approvals' AND column_name='report_path'`), "1");
    assert.equal(await sql(`SELECT count(*) FROM public.cc_project_audit
      WHERE project_id='${id}' AND action='project provisioning ready'`), "1");
    const cancelled = await create();
    assert.equal((await request(`/projects/${cancelled}/provisioning`, "POST", { action: "cancel" })).status, 200);
    await provision();
    await assert.rejects(authorizedProject(admin, cancelled), /not found/);
    // Authority is rechecked at processing time, not only at request time.
    const revoked = await create();
    await sql(`UPDATE public.cc_accounts SET role='Developer' WHERE id='${admin}'`);
    await assert.rejects(provision());
    await sql(`UPDATE public.cc_accounts SET role='Admin' WHERE id='${admin}'`);
    assert.equal(await sql(`SELECT provisioning_status FROM public.cc_projects WHERE id='${revoked}'`), "failed");
    assert.equal((await request(`/projects/${revoked}/provisioning`, "POST", { action: "cancel" })).status, 200);
    // An existing schema is never adopted or dropped during retry/cleanup.
    const collision = await create(), collisionSchema = `ccp_${collision.replaceAll("-", "")}`;
    await sql(`CREATE SCHEMA "${collisionSchema}"`);
    await assert.rejects(provision());
    assert.equal((await request(`/projects/${collision}/provisioning`, "POST", { action: "cancel" })).status, 200);
    assert.equal(await sql(`SELECT count(*) FROM pg_namespace WHERE nspname='${collisionSchema}'`), "1");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await systemPool.end();
  }
});
