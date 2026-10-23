import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { initializeCollaboration } from "./collaboration/schema";
import { createSession } from "./auth/service";
import { contentSchema } from "./collaboration/contract";
import { equivalent } from "./collaboration/workspace-review";
import { deliverNotifications } from "./collaboration/notifications";

test("snapshot equality ignores JSONB object key ordering but preserves arrays and values", () => {
  assert(equivalent({ a: { x: 1, y: "" }, b: [1, 2] }, { b: [1, 2], a: { y: "", x: 1 } }));
  assert(!equivalent([1, 2], [2, 1]));
  assert(!equivalent({ narrative: "" }, { narrative: "new" }));
});

test("selected generated assessments use the shared review workflow safely and idempotently", {
  skip: process.env.CC_TEST_COLLABORATION !== "true", timeout: 90_000,
}, async () => {
  await initializeCollaboration();
  const { default: app } = await import("./app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const sessions: Array<{ token: string; csrf: string }> = [];
  let assessmentId: string | undefined;
  const request = (path: string, method = "GET", body?: unknown, user = 0) => fetch(`${base}/api/shared-assessments${path}`, {
    method, headers: { Origin: base, Cookie: `cc_session=${sessions[user].token}`, "X-CSRF-Token": sessions[user].csrf, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = async (r: Response, status = 200, message?: string) => { const b = await r.json() as any; assert.equal(r.status, status, message || JSON.stringify(b)); return b; };
  try {
    for (const [i, id] of ids.entries()) {
      await pool.query("INSERT INTO cc_accounts(id,username,password_hash,role,must_change_password) VALUES($1,$2,'not-login-capable',$3,false)",
        [id, `selected-review-${id}`, ["Developer", "Reviewer", "Admin", "Developer"][i]]);
      sessions.push(await createSession(pool, id));
    }
    await json(await request("/notifications/preferences", "PUT", { enabled: true }, 1));
    const content = contentSchema.parse({ classification: "C", classificationExplanation: "Unchanged generated assessment",
      disposition: "refactor", narrative: "", complexitySize: "S", recommendation: "Use released API", recommendationRationale: "",
      prerequisites: "", cautions: "", alternatives: "", validationQuestions: "", mitigation: "", mitigationValidation: "" });
    const body = { importKey: `selected-${randomUUID()}`, name: "Selected review fixture", system: "TST", targetRelease: "S4HANA_2025",
      record: { key: "object:o1", kind: "object", name: "Z_UNCHANGED", content, evidence: { id: "o1", classification: "C" } },
      expectedVersion: null, reviewerId: ids[1], shareWithReviewer: false, requestId: randomUUID() };
    await json(await request("/workspace-review", "POST", body), 409);
    assert.equal((await pool.query("SELECT id FROM cc_shared_assessments WHERE import_key=$1", [body.importKey])).rowCount, 0, "no partial assessment on failed preparation");
    body.shareWithReviewer = true;
    const prepared = await Promise.all(Array.from({ length: 3 }, () => request("/workspace-review", "POST", body).then(r => json(r))));
    assessmentId = prepared[0].assessment.id;
    let row = prepared[0].entity;
    for (const p of prepared) assert.equal(p.entity.id, row.id);
    assert.equal(row.version, 1); assert.equal(row.content.narrative, "");
    assert.equal((await json(await request(`/${assessmentId}`))).entities.length, 1);
    const submit = { expectedVersion: row.version, action: "submit", comment: "", requestId: randomUUID() };
    const submitted = await Promise.all(Array.from({ length: 3 }, () => request(`/entities/${row.id}/actions`, "POST", submit).then(r => json(r))));
    for (const r of submitted) assert.equal(r.entity.version, 2);
    row = submitted[0].entity;
    assert.equal(row.state, "Submitted"); assert.deepEqual(row.content, content);
    assert.equal((await json(await request("/workspace-review", "POST", body))).entity.version, 1, "exact prepare retry returns original saved revision for action retry");
    await json(await request(`/entities/${row.id}/actions`, "POST", { ...submit, requestId: randomUUID() }), 409);
    const reviewerDetail = await json(await request(`/${assessmentId}`, "GET", undefined, 1));
    assert.equal(reviewerDetail.entities[0].state, "Submitted");
    assert.equal(reviewerDetail.entities[0].reviewer_id, ids[1]);
    assert.equal(reviewerDetail.events.filter((e: any) => e.action === "submit").length, 1);
    assert.equal(reviewerDetail.events.filter((e: any) => e.action === "published").length, 1);
    assert.equal(reviewerDetail.events.filter((e: any) => e.action === "reviewer assigned").length, 1);
    await Promise.all([deliverNotifications(), deliverNotifications()]);
    const notifications = await json(await request("/notifications", "GET", undefined, 1));
    assert.equal(notifications.notifications.filter((n: any) => n.entityId === row.id).length, 2, "one assignment and one submission alert, never duplicates on retry");
    await json(await request("/workspace-review", "POST", { ...body, requestId: randomUUID() }, 1), 403);
    await json(await request(`/entities/${row.id}/actions`, "POST", { ...submit, expectedVersion: row.version, requestId: randomUUID() }, 1), 403);
    await json(await request(`/${assessmentId}`, "GET", undefined, 2), 404, "Admin needs membership");
    await json(await request(`/${assessmentId}`, "GET", undefined, 3), 404, "Unrelated developer needs membership");
    await json(await request("/workspace-review", "POST", { ...body, expectedVersion: 1, requestId: randomUUID() }), 409);
    await json(await request("/workspace-review", "POST", { ...body, expectedVersion: row.version, reviewerId: ids[0], requestId: randomUUID() }), 400);
    const ifaceBody = { ...body, record: { ...body.record, key: "interface:i1", kind: "interface", name: "IF_UNCHANGED", evidence: { id: "i1", dimension: "Integration" } },
      shareWithReviewer: false, requestId: randomUUID() };
    const iface = await json(await request("/workspace-review", "POST", ifaceBody));
    assert.equal(iface.assessment.id, assessmentId);
    const ifaceSubmit = { ...submit, expectedVersion: iface.entity.version, requestId: randomUUID() };
    assert.equal((await json(await request(`/entities/${iface.entity.id}/actions`, "POST", ifaceSubmit))).entity.state, "Submitted");
    const afterIface = await json(await request(`/${assessmentId}`, "GET", undefined, 1));
    assert.equal(afterIface.entities.length, 2);
    assert(afterIface.entities.every((e: any) => e.state === "Submitted" && e.content.narrative === ""));
    // A normal full publish explicitly adds the remaining records, without forking or replacing submitted content.
    const full = { importKey: body.importKey, name: body.name, system: body.system, targetRelease: body.targetRelease,
      entities: [body.record, ifaceBody.record, { ...body.record, key: "object:o2", name: "Z_UNRELATED" }] };
    assert.equal((await json(await request("", "POST", full))).assessment.id, assessmentId);
    await json(await request("", "POST", full));
    assert.equal((await json(await request(`/${assessmentId}`))).entities.length, 3);
    const rejected = (await json(await request(`/entities/${row.id}/actions`, "POST",
      { action: "request-changes", expectedVersion: row.version, comment: "Please confirm this generated assessment", requestId: randomUUID() }, 1))).entity;
    assert.equal(rejected.state, "Changes requested");
    const refreshed = { ...body, expectedVersion: rejected.version, shareWithReviewer: false, requestId: randomUUID() };
    const saved = await json(await request("/workspace-review", "POST", refreshed));
    assert.equal(saved.entity.version, rejected.version, "unchanged resubmission does not require a content save");
    const resubmitted = (await json(await request(`/entities/${row.id}/actions`, "POST", { ...submit, expectedVersion: saved.entity.version, requestId: randomUUID() }))).entity;
    assert.equal(resubmitted.state, "Submitted");
    await json(await request("/workspace-review", "POST", { ...refreshed, record: { ...body.record, content: { ...content, narrative: "Local draft retained" } }, requestId: randomUUID() }), 409);
    assert.deepEqual((await json(await request(`/${assessmentId}`))).entities.find((e: any) => e.id === row.id).content, content);
    await pool.query("UPDATE cc_accounts SET overrides=$2 WHERE id=$1", [ids[0], JSON.stringify({ classify: false })]);
    await json(await request("/workspace-review", "POST", { ...refreshed, requestId: randomUUID() }), 403);
  } finally {
    if (assessmentId) {
      for (const table of ["cc_assessment_approvals", "cc_assessment_actions", "cc_assessment_revisions"]) await pool.query(`DELETE FROM ${table} WHERE entity_id IN(SELECT id FROM cc_assessment_entities WHERE assessment_id=$1)`, [assessmentId]);
      await pool.query("DELETE FROM cc_assessment_events WHERE assessment_id=$1", [assessmentId]);
      await pool.query("DELETE FROM cc_assessment_entities WHERE assessment_id=$1", [assessmentId]);
      await pool.query("DELETE FROM cc_assessment_members WHERE assessment_id=$1", [assessmentId]);
      await pool.query("DELETE FROM cc_shared_assessments WHERE id=$1", [assessmentId]);
    }
    await pool.query("DELETE FROM cc_review_notification_preferences WHERE user_id=ANY($1)", [ids]);
    await pool.query("DELETE FROM cc_accounts WHERE id=ANY($1)", [ids]);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});
