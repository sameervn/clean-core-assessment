import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { createSession, digest, publicUser } from "./auth/service";
import type { Identity } from "./auth/middleware";
import { initializeCollaboration } from "./collaboration/schema";
import { contentSchema } from "./collaboration/contract";
import { sealGithubToken } from "./collaboration/github-credentials";
import { mapGithubSources, mergedSources, sourceMappingSchema } from "./collaboration/source-mapping";
import { removeObject } from "./knowledge/storage";

const commit = "a".repeat(40);
const baseMapping = { repository: "owner/repo", commit, expectedVersion: 1 };
test("source mapping accepts one explicit path or a unique bounded group, never mixed or malformed input", () => {
  assert.equal(sourceMappingSchema.parse({ ...baseMapping, path: "src/z.prog.abap" }).path, "src/z.prog.abap");
  assert.equal(sourceMappingSchema.parse({ ...baseMapping, repository: "https://github.com/Owner/Repo", paths: ["z.abap", "include.abap"] }).repository, "owner/repo");
  for (const bad of [
    baseMapping, { ...baseMapping, paths: [] }, { ...baseMapping, paths: ["z.abap", "z.abap"] },
    { ...baseMapping, path: "z.abap", paths: ["include.abap"] }, { ...baseMapping, paths: Array.from({ length: 11 }, (_, n) => `${n}.abap`) },
    { ...baseMapping, paths: [{ path: "z.abap" }] }, { ...baseMapping, paths: ["z.abap"], userId: "victim" },
    { ...baseMapping, paths: ["z.abap"], commit: "main" },
  ]) assert.throws(() => sourceMappingSchema.parse(bad));
});
test("source groups replace only the selected repository/path pairs and enforce the total cap", () => {
  const old = [{ repository: "owner/repo", path: "z.abap" }, { repository: "other/repo", path: "z.abap" }];
  assert.deepEqual(mergedSources(old, "owner/repo", ["z.abap"]), [old[1]]);
  assert.deepEqual(mergedSources(old, "owner/repo", ["new.abap"]), old);
  assert.throws(() => mergedSources(Array.from({ length: 10 }, (_, i) => ({ repository: "x/y", path: `${i}` })), "owner/repo", ["z.abap"]));
});

test("selected-record source snapshots persist privately, read across authorized sessions and map atomically", {
  skip: process.env.CC_TEST_GITHUB !== "true", timeout: 120_000,
}, async () => {
  await initializeCollaboration();
  const { default: app } = await import("./app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const ids = Array.from({ length: 3 }, () => randomUUID());
  const identities: Identity[] = [];
  const sessions: Array<{ token: string; csrf: string }> = [];
  const assessmentIds: string[] = [];
  const paths = new Set<string>();
  const token = "github_pat_" + "synthetic".repeat(8);
  const data = new Map([
    ["src/z_demo.clas.abap", Buffer.from("CLASS z_demo DEFINITION.\nENDCLASS.\n")],
    ["src/z_demo.clas.locals_imp.abap", Buffer.from("* Synthetic class include\nWRITE 'fixture'.\n")],
  ]);
  const blobs = [...data].map(([path, bytes]) => ({ path, type: "blob", mode: "100644", size: bytes.length,
    sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") }));
  const fakeGithub: typeof fetch = async (url, options) => {
    const u = new URL(String(url));
    assert.equal(u.origin, "https://api.github.com"); assert.equal(options?.method, undefined);
    assert.equal(options?.redirect, "error");
    if (u.pathname.includes("/commits/")) return Response.json({ sha: commit, commit: { tree: { sha: "b".repeat(40) } } });
    if (u.pathname.includes("/git/trees/")) return Response.json({ tree: blobs, truncated: false });
    const blob = blobs.find(b => u.pathname.endsWith(`/git/blobs/${b.sha}`));
    if (blob) return Response.json({ sha: blob.sha, encoding: "base64", content: data.get(blob.path)!.toString("base64") });
    throw new Error("Unexpected fixture URL");
  };
  const request = (path: string, method = "GET", body?: unknown, user = 0) => fetch(`${base}/api/shared-assessments${path}`, {
    method, headers: { Origin: base, Cookie: `cc_session=${sessions[user].token}`, "X-CSRF-Token": sessions[user].csrf, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = async (r: Response, status = 200) => { const b = await r.json() as any; assert.equal(r.status, status, JSON.stringify(b)); return b; };
  try {
    for (const [i, id] of ids.entries()) {
      const row = (await pool.query(`INSERT INTO cc_accounts(id,username,password_hash,role,must_change_password)
        VALUES($1,$2,'not-login-capable',$3,false) RETURNING *`, [id, `source-test-${id}`, i === 1 ? "Reviewer" : "Developer"])).rows[0];
      const session = await createSession(pool, id); sessions.push(session);
      identities.push({ user: publicUser(row), tokenHash: digest(session.token), csrf: session.csrf });
    }
    const content = contentSchema.parse({ classification: "C", classificationExplanation: "Preserve manual decision", disposition: "refactor",
      narrative: "Keep this narrative", complexitySize: "S", recommendation: "Keep recommendation", recommendationRationale: "", prerequisites: "",
      cautions: "", alternatives: "", validationQuestions: "", mitigation: "", mitigationValidation: "" });
    const selected = { key: "object:same-id", kind: "object", name: "Z_DEMO", content, evidence: { id: "same-id", objectType: "CLAS", objectName: "Z_DEMO" } };
    const publish = { importKey: `source-${randomUUID()}`, name: "Source fixture", system: "TST", targetRelease: "S4HANA_2025", entities: [selected] };
    const a = (await json(await request("", "POST", publish))).assessment; assessmentIds.push(a.id);
    let row = (await json(await request(`/${a.id}`))).entities[0];
    assert.equal(row.reviewer_id, null, "no reviewer or approval submission required");
    assert.equal((await json(await request(`/${a.id}`))).members.length, 1, "new source assessment is private");
    await pool.query(`INSERT INTO cc_github_credentials(user_id,repository,username,encrypted_token,credential_version)
      VALUES($1,'owner/repo','synthetic',$2,$3)`, [ids[0], sealGithubToken(token, ids[0], "owner/repo", "synthetic"), randomUUID()]);
    const initial = await mapGithubSources(identities[0], row.id, { ...baseMapping, paths: [...data.keys()] }, fakeGithub);
    row = initial.entity;
    row.sources.forEach((s: any) => paths.add(s.objectPath));
    assert.equal(row.version, 2); assert.equal(row.sources.length, 2); assert.equal(row.state, "Draft");
    assert.deepEqual(row.content, content); assert.equal(initial.proposal, null);
    assert.equal((await json(await request(`/${a.id}`))).entities[0].sources.length, 2, "server reload retains group");
    // Selected-record publication is idempotent and cannot wipe mapped sources or manual content.
    await json(await request("", "POST", publish));
    assert.equal((await json(await request(`/${a.id}`))).entities.length, 1);
    await pool.query("INSERT INTO cc_assessment_members VALUES($1,$2,'review')", [a.id, ids[1]]);
    const read = await json(await request(`/entities/${row.id}/source/0?version=2`, "GET", undefined, 1));
    assert.equal(read.code, data.get(blobs[0].path)!.toString());
    assert.equal(read.source.commit, commit);
    const originalSources = row.sources;
    await pool.query("UPDATE cc_assessment_entities SET sources=$2 WHERE id=$1",
      [row.id, JSON.stringify(originalSources.map((s: any, i: number) => i === 0 ? { ...s, sha256: "0".repeat(64) } : s))]);
    await json(await request(`/entities/${row.id}/source/0?version=2`, "GET", undefined, 1), 503);
    await pool.query("UPDATE cc_assessment_entities SET sources=$2 WHERE id=$1", [row.id, JSON.stringify(originalSources)]);
    assert.equal((await json(await request("/github/status", "GET", undefined, 1))).repositories.length, 0);
    await json(await request(`/entities/${row.id}/source/0`, "GET", undefined, 2), 404);
    await assert.rejects(mapGithubSources(identities[1], row.id, { ...baseMapping, expectedVersion: 2, path: blobs[0].path }, fakeGithub));
    await assert.rejects(mapGithubSources(identities[0], row.id, { ...baseMapping, expectedVersion: 1, path: blobs[0].path }, fakeGithub), /changed/);
    // All-or-nothing: a missing second source must not commit the valid first source.
    await assert.rejects(mapGithubSources(identities[0], row.id,
      { ...baseMapping, expectedVersion: 2, paths: [blobs[0].path, "missing.abap"] }, fakeGithub), /allowed source/);
    assert.equal((await json(await request(`/${a.id}`))).entities[0].version, 2);
    // A concurrent token rotation rejects the whole staged update.
    let rotated = false;
    const rotating: typeof fetch = async (url, opts) => {
      if (!rotated) {
        rotated = true;
        await pool.query("UPDATE cc_github_credentials SET credential_version=$2 WHERE user_id=$1", [ids[0], randomUUID()]);
      }
      return fakeGithub(url, opts);
    };
    await assert.rejects(mapGithubSources(identities[0], row.id,
      { ...baseMapping, expectedVersion: 2, path: blobs[0].path }, rotating), /connection changed/);
    assert.equal((await json(await request(`/${a.id}`))).entities[0].version, 2);
    // Approved snapshot is retained, but new source evidence creates a new Draft version.
    await pool.query("UPDATE cc_assessment_entities SET state='Approved' WHERE id=$1", [row.id]);
    const approvalId = randomUUID();
    await pool.query("INSERT INTO cc_assessment_approvals(id,entity_id,version,approver_id,snapshot) VALUES($1,$2,2,$3,$4)",
      [approvalId, row.id, ids[1], JSON.stringify({ fixture: true, content, sources: row.sources })]);
    const mapped = await mapGithubSources(identities[0], row.id,
      { ...baseMapping, expectedVersion: 2, path: blobs[0].path }, fakeGithub);
    mapped.entity.sources.forEach((s: any) => paths.add(s.objectPath));
    assert.equal(mapped.entity.state, "Draft"); assert.equal(mapped.entity.version, 3);
    assert.deepEqual(mapped.entity.content, content); assert.equal(mapped.entity.sources.length, 2);
    assert.deepEqual((await pool.query("SELECT snapshot FROM cc_assessment_approvals WHERE id=$1", [approvalId])).rows[0].snapshot.content, content);
    await json(await request(`/entities/${row.id}/source/0?version=2`), 409);
    // Same name/key in another owner's workspace and a different kind never cross-links.
    const other = (await json(await request("", "POST", publish, 2))).assessment; assessmentIds.push(other.id);
    assert.equal((await json(await request(`/${other.id}`, "GET", undefined, 2))).entities[0].sources.length, 0);
    const ifacePublish = { ...publish, entities: [{ ...selected, key: "interface:same-id", kind: "interface" }] };
    await json(await request("", "POST", ifacePublish));
    const reload = await json(await request(`/${a.id}`));
    assert.equal(reload.entities.find((e: any) => e.kind === "interface").sources.length, 0);
    assert.equal(reload.entities.find((e: any) => e.kind === "object").sources.length, 2);
    const another = (await json(await request("", "POST", { ...publish, importKey: `different-${randomUUID()}` }))).assessment;
    assessmentIds.push(another.id);
    assert.equal((await json(await request(`/${another.id}`))).entities[0].sources.length, 0, "same owner and name/key, different workspace identity");
    // Losing evidence permission or disconnecting does not disclose new GitHub content.
    await pool.query("UPDATE cc_accounts SET overrides=$2 WHERE id=$1", [ids[0], JSON.stringify({ evidence: false })]);
    await assert.rejects(mapGithubSources(identities[0], row.id,
      { ...baseMapping, expectedVersion: 3, path: blobs[0].path }, fakeGithub), /Load evidence/);
    await pool.query("DELETE FROM cc_github_credentials WHERE user_id=$1", [ids[0]]);
    assert.equal((await json(await request(`/entities/${row.id}/source/0?version=3`, "GET", undefined, 1))).source.repository, "owner/repo");
  } finally {
    for (const id of assessmentIds) {
      for (const table of ["cc_assessment_approvals", "cc_assessment_actions", "cc_assessment_revisions"]) {
        await pool.query(`DELETE FROM ${table} WHERE entity_id IN(SELECT id FROM cc_assessment_entities WHERE assessment_id=$1)`, [id]);
      }
      await pool.query("DELETE FROM cc_assessment_events WHERE assessment_id=$1", [id]);
      await pool.query("DELETE FROM cc_assessment_entities WHERE assessment_id=$1", [id]);
      await pool.query("DELETE FROM cc_assessment_members WHERE assessment_id=$1", [id]);
      await pool.query("DELETE FROM cc_shared_assessments WHERE id=$1", [id]);
    }
    await pool.query("DELETE FROM cc_accounts WHERE id=ANY($1)", [ids]);
    await Promise.all([...paths].map(p => removeObject(p)));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});
