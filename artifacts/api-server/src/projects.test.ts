import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool, systemPool, withProjectDatabase, type ProjectDatabaseScope } from "@workspace/db";
import { createSession } from "./auth/service";
import { createClient, createProject, authorizedProject, updateProjectMember, LEGACY_PROJECT_ID } from "./projects/service";
import { privateProjectRoot } from "./projects/storage-scope";
import { objectPath, readObject } from "./knowledge/storage";
import { storePrivate } from "./collaboration/files";
import { attestEvidenceValue, verifyEvidenceAttestation } from "./evidence-attestation";
import { sealGithubToken, openGithubToken } from "./collaboration/github-credentials";
import { lockProjectMembership } from "./projects/membership";
import { provisionNextProject } from "./projects/provisioner";

test("real project schemas isolate APIs, private files, credentials, evidence and concurrent pool use", {
  skip: process.env.CC_TEST_PROJECTS !== "true", timeout: 90_000,
}, async () => {
  const env = { ...process.env };
  const local = await mkdtemp(join(tmpdir(), "clean-core-projects-"));
  process.env.CC_KNOWLEDGE_STORAGE = "local";
  process.env.CC_STORAGE_LOCAL_DIR = local;
  process.env.PRIVATE_OBJECT_DIR = "/synthetic-project-storage/private";
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const projects: string[] = [], clients: string[] = [];
  const { default: app } = await import("./app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const sessions: Array<{ token: string; csrf: string }> = [];
    for (const [i, role] of ["Admin", "Developer", "Reviewer"].entries()) {
      await systemPool.query(`INSERT INTO public.cc_accounts(id,username,password_hash,role,must_change_password)
        VALUES($1,$2,'synthetic-not-a-password',$3,false)`, [ids[i], `project-fixture-${randomUUID()}`, role]);
      sessions.push(await createSession(systemPool, ids[i]));
    }
    const request = (projectId: string | null, path: string, who = 0, method = "GET", body?: unknown) => fetch(`${base}/api${path}`, {
      method, headers: {
        Cookie: `cc_session=${sessions[who].token}`, Origin: base, "X-CSRF-Token": sessions[who].csrf,
        ...(projectId ? { "X-CC-Project-ID": projectId } : {}), ...(body ? { "Content-Type": "application/json" } : {}),
      }, body: body ? JSON.stringify(body) : undefined,
    });
    const scopes: ProjectDatabaseScope[] = [];
    for (const suffix of ["A", "B"]) {
      const client = await createClient(ids[0], `Isolation fixture ${suffix} ${randomUUID()}`); clients.push(client.id);
      const project = await createProject(ids[0], { clientId: client.id, name: `Isolation fixture ${suffix}` }); projects.push(project.id);
      assert.equal(await provisionNextProject(), "ready");
      scopes.push(await authorizedProject(ids[0], project.id));
    }
    await updateProjectMember(ids[0], projects[0], ids[1], true);
    await updateProjectMember(ids[0], projects[1], ids[2], true);
    const assessmentId = randomUUID(), entityId = randomUUID();
    const knowledgeIds = [randomUUID(), randomUUID()];
    const sourcePaths: string[] = [];
    let cipherA = "", signatureA = "";
    for (let i = 0; i < 2; i++) await withProjectDatabase(scopes[i], async () => {
      const marker = `PROJECT-${i}`;
      assert.equal((await pool.query("SHOW search_path")).rows[0].search_path, scopes[i].schema);
      const visible = (await pool.query("SELECT id FROM cc_accounts")).rows.map(r => r.id);
      assert.ok(visible.includes(ids[0])); assert.ok(!visible.includes(ids[i === 0 ? 2 : 1]));
      await pool.query(`INSERT INTO cc_shared_assessments(id,owner_id,import_key,name,system,target_release)
        VALUES($1,$2,'same-import-key',$3,'TEST','S4HANA_2025')`, [assessmentId, ids[0], marker]);
      await pool.query("INSERT INTO cc_assessment_members(assessment_id,user_id,access) VALUES($1,$2,'edit')", [assessmentId, ids[0]]);
      const bytes = Buffer.from(`REPORT z_shared_name.\n* ${marker}`);
      const path = await storePrivate("source", bytes); sourcePaths.push(path);
      const { createHash } = await import("node:crypto");
      await pool.query(`INSERT INTO cc_assessment_entities(id,assessment_id,entity_key,kind,name,evidence,content,sources)
        VALUES($1,$2,'same-object','object','Z_SHARED_NAME','{}',$3,$4)`,
      [entityId, assessmentId, JSON.stringify({ narrative: marker }), JSON.stringify([{
        repository: "owner/repo", path: "src/z_shared_name.prog.abap", commit: "a".repeat(40),
        sha256: createHash("sha256").update(bytes).digest("hex"), objectPath: path,
      }])]);
      await pool.query(`INSERT INTO cc_knowledge(id,owner_id,title,release,filename,status,size)
        VALUES($1,$2,$3,'S4HANA_2025','fixture.txt','ready',1)`, [knowledgeIds[i], ids[0], marker]);
      await pool.query("INSERT INTO cc_knowledge_chunks(document_id,ordinal,section,text) VALUES($1,0,'fixture',$2)", [knowledgeIds[i], `${marker} released table write extension`]);
      await pool.query(`INSERT INTO cc_company_templates(id,name,version,previewed,active,created_by)
        VALUES($1,$2,1,true,true,$3)`, [randomUUID(), marker, ids[0]]);
      const encrypted = sealGithubToken(`synthetic-${marker}`, ids[0], "owner/repo", "fixture");
      await pool.query(`INSERT INTO cc_github_credentials(user_id,repository,username,encrypted_token,credential_version)
        VALUES($1,'owner/repo','fixture',$2,$3)`, [ids[0], encrypted, randomUUID()]);
      const signature = attestEvidenceValue({ evidence: "same-input" });
      if (!i) { cipherA = encrypted; signatureA = signature; }
      else {
        assert.equal(verifyEvidenceAttestation({ evidence: "same-input" }, signatureA), false);
        assert.throws(() => openGithubToken(cipherA, ids[0], "owner/repo", "fixture"), /cannot be read/);
      }
      assert.ok(objectPath("fixture").startsWith(privateProjectRoot()));
    });
    // Same UUIDs and import keys in both projects must still resolve to different records.
    for (let i = 0; i < 2; i++) {
      const source = await request(projects[i], `/shared-assessments/entities/${entityId}/source/0`);
      assert.equal(source.status, 200);
      assert.match(((await source.json()) as { code: string }).code, new RegExp(`PROJECT-${i}`));
      const knowledge = await request(projects[i], "/clean-core/knowledge");
      assert.equal(knowledge.status, 200);
      const text = await knowledge.text(); assert.ok(text.includes(`PROJECT-${i}`)); assert.ok(!text.includes(`PROJECT-${1 - i}`));
      const templates = await request(projects[i], "/shared-assessments/company-templates");
      assert.equal(templates.status, 200);
      assert.ok((await templates.text()).includes(`PROJECT-${i}`));
      const missing = await request(projects[i], `/clean-core/knowledge/${knowledgeIds[1 - i]}`);
      assert.equal(missing.status, 404);
    }
    // Uploaded source is an immutable, permission/version-checked peer of GitHub snapshots.
    const uploadUrl = `/shared-assessments/entities/${entityId}/source-upload`;
    const uploadBody = { expectedVersion: 1, fileName: "fixture.txt",
      fileBase64: Buffer.from("METHOD z_fixture.\nUPDATE mara SET matkl = 'TEST'.\nENDMETHOD.").toString("base64") };
    assert.equal((await request(projects[0], uploadUrl, 1, "POST", uploadBody)).status, 404); // Not an assessment member.
    assert.equal((await request(projects[1], uploadUrl, 1, "POST", uploadBody)).status, 404); // Not a project member.
    await withProjectDatabase(scopes[1], async () => {
      await pool.query("INSERT INTO cc_assessment_members(assessment_id,user_id,access) VALUES($1,$2,'review')", [assessmentId, ids[2]]);
    });
    assert.equal((await request(projects[1], uploadUrl, 2, "POST", uploadBody)).status, 403);
    await withProjectDatabase(scopes[0], async () => {
      await pool.query("UPDATE cc_assessment_entities SET state='Approved' WHERE id=$1", [entityId]);
      await pool.query(`INSERT INTO cc_assessment_revisions(entity_id,version,content,sources,actor_id,origin)
        SELECT id,version,content,sources,$2,'synthetic approved baseline' FROM cc_assessment_entities WHERE id=$1`, [entityId, ids[0]]);
    });
    const uploaded = await request(projects[0], uploadUrl, 0, "POST", uploadBody);
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    const attached = await uploaded.json() as any;
    assert.equal(attached.entity.version, 2); assert.equal(attached.entity.state, "Draft");
    assert.equal(attached.entity.content.narrative, "PROJECT-0"); assert.equal(attached.proposal, null);
    assert.equal(attached.entity.sources.length, 2); // GitHub source was retained.
    assert.equal(attached.entity.sources[1].kind, "upload");
    assert.equal(attached.entity.sources[1].uploadedBy, ids[0]);
    assert.equal(attached.entity.sources[1].repository, undefined);
    assert.ok(attached.entity.sources[1].objectPath.includes(projects[0]));
    const readUpload = await request(projects[0], `/shared-assessments/entities/${entityId}/source/1?version=2`);
    assert.equal(readUpload.status, 200);
    assert.match(((await readUpload.json()) as any).code, /UPDATE mara/);
    assert.equal((await request(projects[1], `/shared-assessments/entities/${entityId}/source/1`)).status, 404);
    assert.equal((await request(projects[0], uploadUrl, 0, "POST", uploadBody)).status, 409);
    const evaluated = await request(projects[0], `/shared-assessments/entities/${entityId}/evaluate`, 0, "POST", { expectedVersion: 2 });
    assert.equal(evaluated.status, 200);
    assert.match(await evaluated.text(), /fixture.txt/);
    const replaced = await request(projects[0], uploadUrl, 0, "POST", { ...uploadBody, expectedVersion: 2, fileBase64: Buffer.from("REPORT z_replaced.").toString("base64") });
    assert.equal(replaced.status, 200);
    assert.equal(((await replaced.json()) as any).entity.sources.length, 2);
    assert.equal((await request(projects[0], uploadUrl, 0, "POST", { ...uploadBody, fileName: "../bad.txt" })).status, 400);
    assert.equal((await request(projects[0], uploadUrl, 0, "POST", { ...uploadBody, fileBase64: "A".repeat(361_000) })).status, 413);
    await withProjectDatabase(scopes[0], async () => {
      const prior = (await pool.query("SELECT sources FROM cc_assessment_revisions WHERE entity_id=$1 AND version=2", [entityId])).rows[0].sources;
      assert.match((await readObject(prior[1].objectPath)).toString("utf8"), /UPDATE mara/);
      const original = (await pool.query("SELECT sources FROM cc_assessment_revisions WHERE entity_id=$1 AND version=1", [entityId])).rows[0].sources;
      assert.equal(original.length, 1);
    });
    const catalog = await (await request(null, "/client-projects", 1)).json() as { projects: Array<{ id: string }> };
    assert.ok(catalog.projects.some((p: any) => p.id === projects[0]));
    assert.ok(!catalog.projects.some((p: any) => p.id === projects[1]));
    assert.equal((await request(null, "/shared-assessments")).status, 400);
    assert.equal((await request(projects[1], "/shared-assessments", 1)).status, 404);
    assert.equal((await request(LEGACY_PROJECT_ID, "/shared-assessments", 1)).status, 404);
    assert.equal((await request(null, "/client-projects/clients", 1, "POST", { name: "not-allowed" })).status, 403);
    await assert.rejects(withProjectDatabase(scopes[0], () => readObject(sourcePaths[1])), /not found in this project/);
    await assert.rejects(updateProjectMember(ids[0], projects[0], ids[0], false), /last project Admin/);
    await withProjectDatabase(scopes[0], async () => {
      const c = await pool.connect();
      let revoked = false;
      let revocation: Promise<unknown> | undefined;
      try {
        await c.query("BEGIN");
        await lockProjectMembership(c, ids[1]);
        revocation = updateProjectMember(ids[0], projects[0], ids[1], false).then(() => { revoked = true; });
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(revoked, false);
        await c.query("COMMIT");
        await revocation;
      } finally { await c.query("ROLLBACK"); c.release(); }
    });
    assert.equal((await request(projects[0], "/shared-assessments", 1)).status, 404);
    // Stress both pool.query and transaction connections concurrently; no search-path bleed.
    await Promise.all(Array.from({ length: 20 }, (_, i) => withProjectDatabase(scopes[i % 2], async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        assert.equal((await c.query("SELECT name FROM cc_shared_assessments WHERE id=$1", [assessmentId])).rows[0].name, `PROJECT-${i % 2}`);
        await c.query("COMMIT");
      } finally { c.release(); }
    })));
    assert.equal((await systemPool.query("SELECT to_regclass('public.cc_knowledge') AS table_name")).rows[0].table_name, null);
    assert.equal((await systemPool.query("SHOW search_path")).rows[0].search_path.includes("ccp_"), false);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const id of projects) {
      const schema = `ccp_${id.replaceAll("-", "")}`;
      assert.match(schema, /^ccp_[a-f0-9]{32}$/);
      await systemPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await systemPool.query("DELETE FROM public.cc_project_audit WHERE project_id=$1", [id]);
      await systemPool.query("DELETE FROM public.cc_project_members WHERE project_id=$1", [id]);
      await systemPool.query("DELETE FROM public.cc_projects WHERE id=$1", [id]);
    }
    await systemPool.query("DELETE FROM public.cc_project_audit WHERE actor_id=ANY($1)", [ids]);
    await systemPool.query("DELETE FROM public.cc_clients WHERE id=ANY($1::uuid[])", [clients]);
    await systemPool.query("DELETE FROM public.cc_accounts WHERE id=ANY($1)", [ids]);
    for (const key of ["CC_KNOWLEDGE_STORAGE", "CC_STORAGE_LOCAL_DIR", "PRIVATE_OBJECT_DIR"]) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
    await rm(local, { recursive: true, force: true });
    await pool.end();
  }
});
