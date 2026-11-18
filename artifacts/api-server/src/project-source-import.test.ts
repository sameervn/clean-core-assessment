import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool, systemPool, withProjectDatabase, type ProjectDatabaseScope } from "@workspace/db";
import { createSession, digest, publicUser } from "./auth/service";
import type { Identity } from "./auth/middleware";
import { createClient, createProject, authorizedProject, updateProjectMember } from "./projects/service";
import { sealGithubToken } from "./collaboration/github-credentials";
import { contentSchema } from "./collaboration/contract";
import { bulkMatch } from "./collaboration/project-source-match";
import { sameGithubSources } from "./collaboration/source-mapping";
import { previewSourceImport, startSourceImport, getSourceImport, cancelSourceImport, listSourceImports } from "./collaboration/project-source-import";
import { readObject } from "./knowledge/storage";

const commit = "a".repeat(40);
const file = (path: string) => ({ path, sha: "b".repeat(40), size: 10 });
test("bulk matching requires one complete, typed abapGit group and exact namespace/type", () => {
  assert.deepEqual(bulkMatch([file("src/#acme#demo.clas.abap"), file("src/#acme#demo.clas.xml")], "/ACME/DEMO", "Class").paths,
    ["src/#acme#demo.clas.abap", "src/#acme#demo.clas.xml"]);
  assert.equal(bulkMatch([file("a/z.prog.abap"), file("b/z.prog.abap")], "Z", "PROG").status, "ambiguous");
  assert.equal(bulkMatch([file("a/z.prog.xml")], "Z", "PROG").status, "ambiguous");
  assert.equal(bulkMatch([file("z.abap")], "Z", "PROG").status, "unmatched");
  assert.equal(bulkMatch([file("z.clas.abap")], "Z", "PROG").status, "unmatched");
  assert.equal(bulkMatch([file("zz.prog.abap")], "Z").status, "unmatched");
  assert.equal(bulkMatch([file("z.clas.abap"), { ...file("z.clas.xml"), size: 256_001 }], "Z").status, "ambiguous",
    "oversized related files must never be silently omitted");
  assert.equal(bulkMatch([file("z.clas.abap"), ...Array.from({ length: 10 }, (_, n) => file(`z.clas.part${n}.abap`))], "Z").status, "ambiguous");
});
test("reruns require immutable commit/path/hash provenance", () => {
  const sources = [{ repository: "a/b", path: "z.abap", commit, sha256: "c".repeat(64), blob: "b".repeat(40) }];
  assert.ok(sameGithubSources(sources, "a/b", commit, ["z.abap"]));
  assert.ok(!sameGithubSources(sources, "a/b", "d".repeat(40), ["z.abap"]));
  assert.ok(!sameGithubSources(sources, "a/b", commit, ["missing.abap"]));
});

test("project-wide imports isolate schemas/accounts, reject stale saves, preserve approvals and cancel safely", {
  skip: process.env.CC_TEST_PROJECT_SOURCE_IMPORT !== "true", timeout: 120_000,
}, async () => {
  const local = await mkdtemp(join(tmpdir(), "cc-source-import-"));
  const previousStorage = process.env.CC_KNOWLEDGE_STORAGE;
  const previousDir = process.env.CC_STORAGE_LOCAL_DIR;
  process.env.CC_KNOWLEDGE_STORAGE = "local";
  process.env.CC_STORAGE_LOCAL_DIR = local;
  const users = [randomUUID(), randomUUID()];
  const projects: string[] = [], clients: string[] = [];
  const scopes: ProjectDatabaseScope[] = [], identities: Identity[] = [];
  const sessions: Array<{ token: string; csrf: string }> = [];
  let server: ReturnType<import("express").Express["listen"]> | undefined;
  const assessmentId = randomUUID(), entityId = randomUUID();
  const bytes = Buffer.from("REPORT z_demo.\nWRITE 'synthetic fixture'.");
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  const data = [{ path: "src/z_demo.prog.abap", type: "blob", mode: "100644", size: bytes.length, sha: blob },
    { path: "other/z_demo.prog.abap", type: "blob", mode: "100644", size: bytes.length, sha: blob }];
  let calls = 0;
  let pause: (() => Promise<void>) | null = null;
  const fakeGithub: typeof fetch = async (url, init) => {
    calls++;
    const u = new URL(String(url));
    assert.equal(u.origin, "https://api.github.com");
    assert.equal(init?.method, undefined, "GitHub access is read-only");
    if (u.pathname.includes("/commits/")) return Response.json({ sha: commit, commit: { tree: { sha: "b".repeat(40) } } });
    if (u.pathname.includes("/git/trees/")) return Response.json({ tree: data, truncated: false });
    if (u.pathname.endsWith(`/git/blobs/${blob}`)) {
      if (pause) await pause();
      return Response.json({ sha: blob, encoding: "base64", content: bytes.toString("base64") });
    }
    throw new Error("Unexpected GitHub request");
  };
  const inProject = <T>(n: number, fn: () => Promise<T>) => withProjectDatabase(scopes[n], fn);
  const wait = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const result = await inProject(0, () => getSourceImport(identities[0], id));
      if (result.status !== "running") return result;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("Import did not finish");
  };
  try {
    for (const [n, id] of users.entries()) {
      const account = (await systemPool.query(`INSERT INTO public.cc_accounts(id,username,password_hash,role,must_change_password)
        VALUES($1,$2,'not-login-capable',$3,false) RETURNING *`, [id, `bulk-source-${id}`, n === 0 ? "Admin" : "Developer"])).rows[0];
      const session = await createSession(systemPool, id); sessions.push(session);
      identities.push({ user: publicUser(account), csrf: session.csrf, tokenHash: digest(session.token) });
    }
    for (let n = 0; n < 2; n++) {
      const client = await createClient(users[0], `Bulk source fixture ${randomUUID()}`); clients.push(client.id);
      const project = await createProject(users[0], { clientId: client.id, name: "Bulk source isolation" }); projects.push(project.id);
      scopes.push(await authorizedProject(users[0], project.id));
      await inProject(n, async () => {
        await pool.query(`INSERT INTO cc_shared_assessments(id,owner_id,import_key,name,system,target_release)
          VALUES($1,$2,'same-key','Fixture','TEST','S4HANA_2025')`, [assessmentId, users[0]]);
        await pool.query("INSERT INTO cc_assessment_members VALUES($1,$2,'edit')", [assessmentId, users[0]]);
        await pool.query(`INSERT INTO cc_assessment_entities(id,assessment_id,entity_key,kind,name,content,evidence,state)
          VALUES($1,$2,'same-object','object','Z_DEMO',$3,$4,'Approved')`, [entityId, assessmentId,
          JSON.stringify(contentSchema.parse({ narrative: "Keep approved narrative", classification: "C", classificationExplanation: "Keep manual classification",
            disposition: "keep", complexitySize: "S", recommendation: "", recommendationRationale: "", prerequisites: "",
            cautions: "", alternatives: "", validationQuestions: "", mitigation: "", mitigationValidation: "" })),
          JSON.stringify({ snapshot: { objectType: "PROG", objectName: "Z_DEMO" } })]);
      });
    }
    await inProject(0, async () => {
      await pool.query(`INSERT INTO cc_github_credentials(user_id,repository,username,encrypted_token,credential_version)
        VALUES($1,'owner/repo','synthetic',$2,$3)`, [users[0], sealGithubToken("github_pat_" + "synthetic".repeat(8), users[0], "owner/repo", "synthetic"), randomUUID()]);
    });
    await assert.rejects(inProject(1, () => previewSourceImport(identities[0], { repository: "owner/repo", ref: "main", folder: "" }, fakeGithub)), /Connect this repository/);
    const preview = await inProject(0, () => previewSourceImport(identities[0], { repository: "owner/repo", ref: "main", folder: "src" }, fakeGithub));
    assert.equal(preview.entries[0].status, "ready");
    assert.equal(preview.entries[0].state, "Approved");
    assert.equal((await inProject(0, () => pool.query("SELECT version FROM cc_assessment_entities WHERE id=$1", [entityId]))).rows[0].version, 1);
    assert.equal((await inProject(1, () => listSourceImports(identities[0]))).length, 0);
    await assert.rejects(inProject(1, () => getSourceImport(identities[0], preview.id)), /not found/);
    // HTTP verifies the project membership gate and explicit confirmation, not just service helpers.
    const { default: app } = await import("./app");
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const request = (path: string, user = 0, method = "GET", body?: unknown) => fetch(`${base}/api/shared-assessments/github/imports${path}`, {
      method, headers: { Origin: base, Cookie: `cc_session=${sessions[user].token}`, "X-CSRF-Token": sessions[user].csrf,
        "X-CC-Project-ID": projects[0], "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal((await request(`/${preview.id}`, 1)).status, 404);
    assert.equal((await request(`/${preview.id}`, 1, "POST", { confirmed: true })).status, 404);
    assert.equal((await request(`/${preview.id}`, 0, "POST", { confirmed: false })).status, 400);
    await updateProjectMember(users[0], projects[0], users[1], true);
    assert.equal((await request(`/${preview.id}`, 1)).status, 404, "another project member cannot read private run");
    await inProject(0, () => startSourceImport(identities[0], preview.id, fakeGithub));
    const finished = await wait(preview.id);
    assert.equal(finished.status, "completed");
    assert.equal(finished.entries[0].status, "imported");
    const saved = (await inProject(0, () => pool.query("SELECT * FROM cc_assessment_entities WHERE id=$1", [entityId]))).rows[0];
    assert.equal(saved.version, 2); assert.equal(saved.state, "Draft");
    assert.equal(saved.content.narrative, "Keep approved narrative"); assert.equal(saved.content.classification, "C");
    assert.equal(saved.sources[0].commit, commit); assert.equal(saved.sources[0].blob, blob);
    assert.equal(saved.sources[0].sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(await inProject(0, () => readObject(saved.sources[0].objectPath)), bytes);
    assert.equal((await inProject(1, () => pool.query("SELECT version,jsonb_array_length(sources) AS sources FROM cc_assessment_entities WHERE id=$1", [entityId]))).rows[0].sources, 0);
    await inProject(0, () => startSourceImport(identities[0], preview.id, fakeGithub));
    assert.equal((await inProject(0, () => pool.query("SELECT version FROM cc_assessment_entities WHERE id=$1", [entityId]))).rows[0].version, 2, "double start adds no revision");
    const again = await inProject(0, () => previewSourceImport(identities[0], { repository: "owner/repo", ref: "main", folder: "src" }, fakeGithub));
    assert.equal(again.entries[0].status, "unchanged");
    await inProject(0, () => pool.query("UPDATE cc_assessment_entities SET state='Approved' WHERE id=$1", [entityId]));
    const approvedAgain = await inProject(0, () => previewSourceImport(identities[0], { repository: "owner/repo", ref: "main", folder: "src" }, fakeGithub));
    assert.equal(approvedAgain.entries[0].status, "unchanged");
    assert.equal(approvedAgain.entries[0].state, "Approved", "identical sources preserve approval state and version");
    const ambiguous = await inProject(0, () => previewSourceImport(identities[0], { repository: "owner/repo", ref: "main", folder: "" }, fakeGithub));
    assert.equal(ambiguous.entries[0].status, "ambiguous");
    // Changed versions fail independently without overwriting any narrative or approval state.
    await inProject(0, () => pool.query("UPDATE cc_assessment_entities SET sources='[]' WHERE id=$1", [entityId]));
    const stale = await inProject(0, () => previewSourceImport(identities[0], { repository: "owner/repo", ref: "main", folder: "src" }, fakeGithub));
    await inProject(0, () => pool.query("UPDATE cc_assessment_entities SET version=version+1,state='Submitted' WHERE id=$1", [entityId]));
    await inProject(0, () => startSourceImport(identities[0], stale.id, fakeGithub));
    assert.equal((await wait(stale.id)).entries[0].status, "failed");
    assert.equal((await inProject(0, () => pool.query("SELECT state FROM cc_assessment_entities WHERE id=$1", [entityId]))).rows[0].state, "Submitted");
    const cancelling = await inProject(0, () => previewSourceImport(identities[0], { repository: "owner/repo", ref: "main", folder: "src" }, fakeGithub));
    let release!: () => void, entered!: () => void;
    const atBlob = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    pause = async () => { entered(); await gate; };
    await inProject(0, () => startSourceImport(identities[0], cancelling.id, fakeGithub));
    await atBlob;
    await inProject(0, () => cancelSourceImport(identities[0], cancelling.id));
    release();
    // Wait until staging cleanup and per-record outcome reporting are finished.
    for (let n = 0; n < 200; n++) {
      const job = await inProject(0, () => getSourceImport(identities[0], cancelling.id));
      if (job.entries[0].status === "failed") break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const afterCancel = (await inProject(0, () => pool.query("SELECT version,sources,state FROM cc_assessment_entities WHERE id=$1", [entityId]))).rows[0];
    assert.equal(afterCancel.version, 3); assert.deepEqual(afterCancel.sources, []); assert.equal(afterCancel.state, "Submitted");
    assert.ok(calls > 0);
    pause = null;
    // Expired background leases are recoverable and never silently resume with stale authorization.
    await inProject(0, () => pool.query("UPDATE cc_github_imports SET status='running',heartbeat_at=now()-interval '3 minutes' WHERE id=$1", [cancelling.id]));
    assert.equal((await inProject(0, () => getSourceImport(identities[0], cancelling.id))).status, "interrupted");
    const rotated = await inProject(0, () => previewSourceImport(identities[0], { repository: "owner/repo", ref: "main", folder: "src" }, fakeGithub));
    await inProject(0, () => pool.query("UPDATE cc_github_credentials SET credential_version=$1 WHERE user_id=$2", [randomUUID(), users[0]]));
    await assert.rejects(inProject(0, () => startSourceImport(identities[0], rotated.id, fakeGithub)), /connection changed/i);
    // Batches continue safely: only the first 200 *new* matches are admitted; the rest stay visible.
    await inProject(0, async () => {
      await pool.query(`INSERT INTO cc_assessment_entities(id,assessment_id,entity_key,kind,name,content,evidence)
        SELECT gen_random_uuid(),assessment_id,'batch-'||n,'object',name,content,evidence
        FROM cc_assessment_entities CROSS JOIN generate_series(1,200) n WHERE id=$1`, [entityId]);
    });
    const bounded = await inProject(0, () => previewSourceImport(identities[0], { repository: "owner/repo", ref: "main", folder: "src" }, fakeGithub));
    assert.equal(bounded.entries.filter(e => e.status === "ready").length, 200);
    assert.equal(bounded.entries.filter(e => e.status === "deferred").length, 1);
    await inProject(0, () => pool.query("UPDATE cc_assessment_entities SET name='Business display name' WHERE id=$1", [entityId]));
    const technicalName = await inProject(0, () => previewSourceImport(identities[0], { repository: "owner/repo", ref: "main", folder: "src" }, fakeGithub));
    assert.ok(["ready", "deferred"].includes(technicalName.entries.find(e => e.id === entityId)!.status), "match technical evidence identity rather than a display name");
    await inProject(0, () => pool.query("UPDATE cc_assessment_members SET access='read' WHERE assessment_id=$1 AND user_id=$2", [assessmentId, users[0]]));
    await assert.rejects(inProject(0, () => startSourceImport(identities[0], bounded.id, fakeGithub)), /permissions/i);
    await inProject(0, () => pool.query("DELETE FROM cc_assessment_members WHERE assessment_id=$1 AND user_id=$2", [assessmentId, users[0]]));
    await assert.rejects(inProject(0, () => getSourceImport(identities[0], bounded.id)), /access removed/);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    for (const scope of scopes) await systemPool.query(`DROP SCHEMA IF EXISTS "${scope.schema}" CASCADE`);
    for (const id of projects) {
      await systemPool.query("DELETE FROM public.cc_project_audit WHERE project_id=$1", [id]);
      await systemPool.query("DELETE FROM public.cc_project_members WHERE project_id=$1", [id]);
      await systemPool.query("DELETE FROM public.cc_projects WHERE id=$1", [id]);
    }
    for (const id of clients) {
      await systemPool.query("DELETE FROM public.cc_project_audit WHERE target_id=$1", [id]);
      await systemPool.query("DELETE FROM public.cc_clients WHERE id=$1", [id]);
    }
    for (const id of users) {
      await systemPool.query("DELETE FROM public.cc_project_audit WHERE actor_id=$1", [id]);
      await systemPool.query("DELETE FROM public.cc_account_sessions WHERE user_id=$1", [id]);
      await systemPool.query("DELETE FROM public.cc_accounts WHERE id=$1", [id]);
    }
    if (previousStorage === undefined) delete process.env.CC_KNOWLEDGE_STORAGE; else process.env.CC_KNOWLEDGE_STORAGE = previousStorage;
    if (previousDir === undefined) delete process.env.CC_STORAGE_LOCAL_DIR; else process.env.CC_STORAGE_LOCAL_DIR = previousDir;
    await rm(local, { recursive: true, force: true });
    await systemPool.end();
  }
});
