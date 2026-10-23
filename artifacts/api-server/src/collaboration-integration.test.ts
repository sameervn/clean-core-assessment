import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PizZip from "pizzip";
import { pool } from "@workspace/db";
import { initializeCollaboration } from "./collaboration/schema";
import { initializeReports } from "./reports/schema";
import { createSession } from "./auth/service";
import { sample } from "./reports/engine.mjs";
import { contentSchema } from "./collaboration/contract";

test("durable cross-account review, stale writes, sealed exports and private source access", { skip: process.env.CC_TEST_COLLABORATION !== "true", timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "cc-collaboration-"));
  process.env.CC_KNOWLEDGE_STORAGE = "local";
  process.env.CC_STORAGE_LOCAL_DIR = root;
  process.env.PRIVATE_OBJECT_DIR = "/fixture/private";
  await initializeReports(); await initializeCollaboration();
  const { default: app } = await import("./app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const owners = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const sessions: Array<{ token: string; csrf: string }> = [];
  const request = (path: string, method = "GET", body?: unknown, user = 0) => fetch(`${base}/api/shared-assessments${path}`, {
    method, headers: { Origin: base, Cookie: `cc_session=${sessions[user].token}`, "X-CSRF-Token": sessions[user].csrf,
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const json = async (response: Response, status = 200) => { const body = await response.json() as any; assert.equal(response.status, status, JSON.stringify(body)); return body; };
  let assessmentId: string | undefined;
  let templateId: string | undefined;
  const previousDefault = (await pool.query("SELECT id FROM cc_company_templates WHERE active")).rows[0]?.id;
  try {
    for (const [i,id] of owners.entries()) {
      await pool.query("INSERT INTO cc_accounts(id,username,password_hash,role,must_change_password) VALUES($1,$2,'not-login-capable',$3,false)",
        [id, `reviewtest-${id}`, ["Developer","Reviewer","Admin","Developer"][i]]);
      sessions.push(await createSession(pool,id));
    }
    const content = contentSchema.parse({ classification: "C", classificationExplanation: "Original evidence explanation", disposition: "refactor", narrative: "Developer narrative",
      complexitySize: "XL", recommendation: "Use released contracts", recommendationRationale: "Original rationale",
      prerequisites: "", cautions: "", alternatives: "", validationQuestions: "", mitigation: "Review source", mitigationValidation: "Run ATC" });
    const input = { importKey: randomUUID(), name: "Integration test", system: "TST", targetRelease: "S4HANA_2025",
      entities: [{ key: "Z_REVIEW", kind: "object", name: "Z_REVIEW", content, evidence: { objectType: "PROG" } },
        { key: "IF_REVIEW", kind: "interface", name: "IF_REVIEW", content, evidence: { interfaceType: "RFC" } }] };
    const published = await json(await request("", "POST", input));
    assessmentId = published.assessment.id;
    assert.equal((await json(await request("", "POST", input))).assessment.id, assessmentId);
    assert.equal((await request("", "POST", input, 1)).status, 403);
    assert.equal((await request(`/${assessmentId}`, "GET", undefined, 3)).status, 404);
    assert.equal((await request(`/${assessmentId}`, "GET", undefined, 2)).status, 404, "Admin has no implied content membership");
    await json(await request(`/${assessmentId}/members`, "PUT", { userId: owners[1], access: "review" }, 2));
    await json(await request(`/${assessmentId}/members`, "PUT", { userId: owners[2], access: "read" }, 2));
    const detail = await json(await request(`/${assessmentId}`));
    let row = detail.entities.find((e: any) => e.kind === "object");
    const action = (action: string, version: number, user: number, comment = "", requestId = randomUUID()) =>
      request(`/entities/${row.id}/actions`, "POST", { expectedVersion: version, action, comment, requestId }, user);
    assert.equal((await action("submit", row.version, 0)).status, 409);
    row = (await json(await request(`/entities/${row.id}/reviewer`, "PUT", { expectedVersion: row.version, reviewerId: owners[1] }, 2))).entity;
    const requestId = randomUUID();
    const submittedVersion = row.version;
    row = (await json(await action("submit", row.version, 0, "", requestId))).entity;
    assert.equal(row.state, "Submitted");
    assert.equal((await json(await action("submit", submittedVersion, 0, "", requestId))).entity.version, row.version);
    assert.equal((await action("approve", row.version, 0)).status, 403);
    assert.equal((await request(`/entities/${row.id}`, "PUT", { expectedVersion: row.version, content: { ...content, classification: "A" } }, 1)).status, 403);
    row = (await json(await request(`/entities/${row.id}`, "PUT", { expectedVersion: row.version, content: { ...content, narrative: "Reviewed narrative" } }, 1))).entity;
    assert.equal(row.state, "Submitted");
    assert.equal((await action("approve", row.version - 1, 1)).status, 409);
    assert.equal((await request(`/entities/${row.id}`, "PUT", { expectedVersion: row.version, content: { ...content, approver: owners[1] } })).status, 400);
    const form = (bytes: Uint8Array, replaceId?: string, expectedVersion?: number) => {
      const f = new FormData(); f.set("file", new Blob([bytes as any]), "template.docx"); f.set("name", "Test company");
      if (replaceId) { f.set("replaceId", replaceId); f.set("expectedVersion", String(expectedVersion)); } return f;
    };
    assert.equal((await request("/company-templates", "POST", form(new Uint8Array(sample())))).status, 403);
    assert.equal((await request("/company-templates", "POST", form(new TextEncoder().encode("not DOCX")), 2)).status, 400);
    const template = await json(await request("/company-templates", "POST", form(new Uint8Array(sample())), 2)); templateId = template.id;
    assert.equal((await request(`/company-templates/${template.id}/default`, "PUT", { expectedVersion: 1 }, 2)).status, 409);
    assert.equal((await request(`/company-templates/${template.id}/preview`, "POST", { expectedVersion: 1 }, 2)).status, 200);
    await json(await request(`/company-templates/${template.id}/default`, "PUT", { expectedVersion: 1 }, 2));
    row = (await json(await action("approve", row.version, 1, "Reviewed source and narrative"))).entity;
    assert.equal(row.state, "Approved");
    let approvals = (await json(await request("/approvals/list", "GET", undefined, 1))).approvals.filter((p: any) => p.assessment_id === assessmentId);
    assert.equal(approvals.length, 1); assert.equal(approvals[0].template_version, 1);
    const report = await request("/approvals/download", "POST", { ids: [approvals[0].id] }, 1);
    assert.equal(report.status, 200);
    const sealedBytes = Buffer.from(await report.arrayBuffer());
    const document = new PizZip(sealedBytes).file("word/document.xml")!.asText();
    assert.match(document, /Reviewed narrative/); assert.match(document, /XL/);
    assert.equal((await request("/approvals/download", "POST", { ids: [approvals[0].id] }, 3)).status, 404);
    row = (await json(await request(`/entities/${row.id}`, "PUT", { expectedVersion: row.version, content: { ...content, narrative: "Later unapproved change" } }))).entity;
    assert.equal(row.state, "Draft");
    await json(await request("/company-templates", "POST", form(new Uint8Array(sample()), templateId, 1), 2));
    assert.deepEqual(Buffer.from(await (await request("/approvals/download", "POST", { ids: [approvals[0].id] }, 1)).arrayBuffer()), sealedBytes);
    await initializeCollaboration(); // Simulated process/schema restart must preserve records.
    assert.equal((await json(await request("/approvals/list", "GET", undefined, 1))).approvals.filter((p: any) => p.assessment_id === assessmentId).length, 0);
    approvals = (await json(await request("/approvals/list?showSuperseded=true", "GET", undefined, 1))).approvals.filter((p: any) => p.assessment_id === assessmentId);
    assert.equal(approvals[0].superseded, true);
    row = (await json(await action("submit", row.version, 0))).entity;
    assert.equal((await action("request-changes", row.version, 1)).status, 400);
    row = (await json(await action("request-changes", row.version, 1, "Clarify mitigation"))).entity;
    assert.equal(row.state, "Changes requested");
    row = (await json(await action("submit", row.version, 0))).entity;
    assert.equal(row.state, "Submitted");
    // Keep navigating historical snapshots while another record is approved.
    const historical = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, id] of historical.entries()) await pool.query(`INSERT INTO cc_assessment_approvals
      (id,entity_id,version,approver_id,snapshot,approved_at) VALUES($1,$2,$3,$4,'{}','2000-01-01'::timestamptz)`,
      [id, row.id, 100 + i, owners[1]]);
    const archivePath = "/approvals/list?limit=1&showSuperseded=true";
    const pageOne = await json(await request(archivePath, "GET", undefined, 1));
    const oldIds = [approvals[0].id, ...historical];
    let interfaceRow = detail.entities.find((e: any) => e.kind === "interface");
    interfaceRow = (await json(await request(`/entities/${interfaceRow.id}/reviewer`, "PUT", { expectedVersion: interfaceRow.version, reviewerId: owners[1] }, 2))).entity;
    const interfaceAction = (action: string) => request(`/entities/${interfaceRow.id}/actions`, "POST",
      { expectedVersion: interfaceRow.version, action, comment: "", requestId: randomUUID() }, action === "submit" ? 0 : 1);
    interfaceRow = (await json(await interfaceAction("submit"))).entity;
    // Replacement above intentionally retired the prior default.
    assert.equal((await request(`/company-templates/${templateId}/preview`, "POST", { expectedVersion: 2 }, 2)).status, 200);
    await json(await request(`/company-templates/${templateId}/default`, "PUT", { expectedVersion: 2 }, 2));
    const [pageTwoResponse, newApprovalResponse] = await Promise.all([
      request(`${archivePath}&cursor=${encodeURIComponent(pageOne.nextCursor)}`, "GET", undefined, 1),
      interfaceAction("approve"),
    ]);
    await json(newApprovalResponse);
    let archivePage = await json(pageTwoResponse);
    const visited = [pageOne.approvals[0].id];
    while (true) {
      visited.push(...archivePage.approvals.map((p: any) => p.id));
      if (!archivePage.nextCursor) break;
      archivePage = await json(await request(`${archivePath}&cursor=${encodeURIComponent(archivePage.nextCursor)}`, "GET", undefined, 1));
    }
    assert.deepEqual([...visited].sort(), oldIds.sort(), "concurrent approval must not repeat or skip historical snapshots");
    const previousPage = await json(await request(`${archivePath}&cursor=${encodeURIComponent(pageOne.pageCursor)}`, "GET", undefined, 1));
    assert.equal(previousPage.approvals[0].id, pageOne.approvals[0].id);
    const refreshed = await json(await request(archivePath, "GET", undefined, 1));
    assert.equal(refreshed.approvals[0].entity_id, interfaceRow.id, "refresh discovers the concurrent approval");
    await json(await request(`/${assessmentId}/members`, "PUT", { userId: owners[1], access: null }, 2));
    assert.equal((await json(await request("/approvals/list?showSuperseded=true", "GET", undefined, 1))).approvals.filter((p: any) => p.assessment_id === assessmentId).length, 0);
    assert.equal((await request("/approvals/list?limit=101")).status, 400);
    assert.equal((await request("/approvals/list?cursor=invalid")).status, 400);
    assert.equal((await request("/approvals/download", "POST", { ids: Array.from({ length: 51 }, () => randomUUID()) })).status, 400);
    assert.equal((await request(`/entities/${row.id}/source/0`, "GET", undefined, 1)).status, 404);
    assert.equal((await request("/approvals/download", "POST", { ids: [approvals[0].id] }, 1)).status, 404);
    assert.equal((await action("approve", row.version, 1)).status, 404);
  } finally {
    if (assessmentId) {
      for (const table of ["cc_assessment_approvals","cc_assessment_actions","cc_assessment_revisions"]) await pool.query(`DELETE FROM ${table} WHERE entity_id IN (SELECT id FROM cc_assessment_entities WHERE assessment_id=$1)`, [assessmentId]);
      await pool.query("DELETE FROM cc_assessment_events WHERE assessment_id=$1", [assessmentId]);
      await pool.query("DELETE FROM cc_assessment_entities WHERE assessment_id=$1", [assessmentId]);
      await pool.query("DELETE FROM cc_assessment_members WHERE assessment_id=$1", [assessmentId]);
      await pool.query("DELETE FROM cc_shared_assessments WHERE id=$1", [assessmentId]);
    }
    if (templateId) { await pool.query("DELETE FROM cc_company_template_versions WHERE template_id=$1", [templateId]); await pool.query("DELETE FROM cc_company_templates WHERE id=$1", [templateId]); }
    if (previousDefault) await pool.query("UPDATE cc_company_templates SET active=true WHERE id=$1", [previousDefault]);
    await pool.query("DELETE FROM cc_accounts WHERE id=ANY($1)", [owners]);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true }); await pool.end();
  }
});
