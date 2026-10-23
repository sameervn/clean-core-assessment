import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { initializeCollaboration } from "./collaboration/schema";
import { createSession } from "./auth/service";
import { contentSchema } from "./collaboration/contract";
import { deliverNotifications, listNotifications, notificationMessages } from "./collaboration/notifications";
import { transaction } from "./collaboration/service";

test("notification messages never interpolate private collaboration data", () => {
  assert.deepEqual(Object.keys(notificationMessages).sort(), ["request-changes", "reviewer assigned", "submit"]);
  assert.ok(Object.values(notificationMessages).every(m => !m.includes("{") && m.length < 100));
});

test("notification keyset keeps bigint IDs exact and uses one lookahead row", async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({
    id: (9223372036854775807n - BigInt(i)).toString(), assessment_id: "assessment", entity_id: "item",
    action: "submit", created_at: new Date(0), read_at: null,
  }));
  const calls: { sql: string; params: unknown[] }[] = [];
  const c = { query: async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    return { rows };
  } } as unknown as Parameters<typeof listNotifications>[0];
  const page = await listNotifications(c, "recipient", { cursor: "9223372036854775807", filter: "unread" });
  assert.equal(page.notifications.length, 100);
  assert.equal(page.nextCursor, "9223372036854775708");
  assert.equal(page.notifications[0].id, "9223372036854775807");
  assert.deepEqual(calls[0].params, ["recipient", "9223372036854775807", true]);
  assert.match(calls[0].sql, /n\.user_id=\$1/);
  assert.match(calls[0].sql, /e\.id<\$2::bigint/);
  assert.match(calls[0].sql, /n\.read_at IS NULL/);
  assert.match(calls[0].sql, /ORDER BY e\.id DESC LIMIT 101/);
  rows.pop();
  assert.equal((await listNotifications(c, "recipient")).nextCursor, null, "exactly 100 is a terminal page");
  assert.deepEqual(calls[1].params, ["recipient", null, false]);
  rows.splice(0);
  assert.deepEqual(await listNotifications(c, "recipient"), { notifications: [], nextCursor: null });
});

test("opt-in durable notifications: async failure, retries, concurrency, access and privacy", {
  skip: process.env.CC_TEST_COLLABORATION !== "true", timeout: 60_000,
}, async () => {
  await initializeCollaboration();
  const { default: app } = await import("./app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/shared-assessments`;
  const users = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const sessions: Array<{ token: string; csrf: string }> = [];
  let assessmentId: string | undefined;
  const request = async (path: string, user = 0, method = "GET", body?: unknown, expected = 200) => {
    const res = await fetch(`${base}${path}`, { method, headers: {
      Origin: new URL(base).origin, Cookie: `cc_session=${sessions[user].token}`,
      "X-CSRF-Token": sessions[user].csrf, "Content-Type": "application/json",
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json() as any;
    assert.equal(res.status, expected, JSON.stringify(json));
    return json;
  };
  const notifications = async (user: number) => (await request("/notifications", user)).notifications as any[];
  try {
    for (const [i, id] of users.entries()) {
      await pool.query(`INSERT INTO cc_accounts(id,username,password_hash,role,must_change_password)
        VALUES($1,$2,'not-login-capable',$3,false)`, [id, `notificationtest-${id}`, ["Developer", "Reviewer", "Admin", "Reviewer"][i]]);
      sessions.push(await createSession(pool, id));
    }
    assert.deepEqual(await request("/notifications/preferences", 1), { enabled: false });
    await request("/notifications/preferences", 1, "PUT", { enabled: true, userId: users[0] }, 400);
    const content = contentSchema.parse({ classification: "C", classificationExplanation: "PRIVATE explanation",
      narrative: "PRIVATE source", complexitySize: "M", disposition: "refactor",
      recommendation: "", recommendationRationale: "", prerequisites: "", cautions: "",
      alternatives: "", validationQuestions: "", mitigation: "", mitigationValidation: "" });
    const published = await request("", 0, "POST", { importKey: randomUUID(), name: "PRIVATE assessment",
      system: "TST", targetRelease: "S4HANA_2025", entities: [{ key: "Z_PRIVATE", kind: "object",
        name: "PRIVATE record", content, evidence: {} }] });
    assessmentId = published.assessment.id;
    for (const i of [1, 2, 3]) await request(`/${assessmentId}/members`, 2, "PUT", { userId: users[i], access: i === 2 ? "read" : "review" });
    let item = (await request(`/${assessmentId}`)).entities[0];
    const assign = async (user: number) => {
      item = (await request(`/entities/${item.id}/reviewer`, 2, "PUT", { expectedVersion: item.version, reviewerId: users[user] })).entity;
    };
    const act = async (action: string, user: number, comment = "") => {
      const body = { expectedVersion: item.version, action, comment, requestId: randomUUID() };
      item = (await request(`/entities/${item.id}/actions`, user, "POST", body)).entity;
      return body;
    };
    await assign(1);
    await deliverNotifications();
    assert.equal((await notifications(1)).length, 0, "disabled by default");
    await request("/notifications/preferences", 1, "PUT", { enabled: true });
    await request("/notifications/preferences", 0, "PUT", { enabled: true });
    await assign(3);
    await assign(1);
    const submission = await act("submit", 0);
    await request(`/entities/${item.id}/actions`, 0, "POST", submission); // exact retry
    assert.equal((await notifications(1)).length, 0, "save does not synchronously deliver");
    await assert.rejects(deliverNotifications(async fn => transaction(async c => {
      await fn(c);
      throw new Error("Simulated delivery failure before commit");
    })), /Simulated/);
    assert.equal((await notifications(1)).length, 0, "failed batch rolled back");
    assert.equal((await request(`/${assessmentId}`)).entities[0].state, "Submitted", "delivery failure cannot undo saved work");
    await Promise.all([deliverNotifications(), deliverNotifications()]);
    let alerts = await notifications(1);
    assert.equal(alerts.length, 2);
    assert.equal(new Set(alerts.map(n => n.id)).size, 2, "action replay and concurrent workers cannot duplicate");
    assert.ok(alerts.every(n => !n.read && !JSON.stringify(n).includes("PRIVATE")));
    assert.equal((await notifications(3)).length, 0, "disabled reviewer receives no alerts");
    await request(`/notifications/${alerts[0].id}/read`, 3, "PUT", undefined, 404);
    await request(`/notifications/${alerts[0].id}/read`, 1, "PUT");
    await request(`/notifications/${alerts[0].id}/read`, 1, "PUT");
    assert.equal((await notifications(1)).filter(n => n.read).length, 1);
    await initializeCollaboration();
    await deliverNotifications();
    assert.equal((await notifications(1)).length, 2, "restart retains read state without replay");
    await pool.query("UPDATE cc_accounts SET overrides='{\"view\":false}' WHERE id=$1", [users[1]]);
    await request("/notifications", 1, "GET", undefined, 403);
    await pool.query("UPDATE cc_accounts SET overrides='{}' WHERE id=$1", [users[1]]);
    await request(`/${assessmentId}/members`, 2, "PUT", { userId: users[1], access: null });
    assert.equal((await notifications(1)).length, 0, "revocation hides even delivered notifications");
    await request(`/notifications/${alerts[0].id}/read`, 1, "PUT", undefined, 404);
    await request(`/${assessmentId}/members`, 2, "PUT", { userId: users[1], access: "review" });
    await act("request-changes", 1, "PRIVATE review comment with source");
    await deliverNotifications();
    alerts = await notifications(0);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].message, notificationMessages["request-changes"]);
    assert.ok(!JSON.stringify(alerts).includes("PRIVATE"));
    await request("/notifications/preferences", 1, "PUT", { enabled: false });
    await act("submit", 0);
    await deliverNotifications();
    await request("/notifications/preferences", 1, "PUT", { enabled: true });
    await deliverNotifications();
    assert.equal((await notifications(1)).length, 2, "opt-out period does not replay on re-enable");
    // Reassignment before delivery must never redirect a historical event.
    await assign(3);
    await request("/notifications/preferences", 3, "PUT", { enabled: true });
    await assign(1);
    await deliverNotifications();
    assert.equal((await notifications(3)).length, 0, "historical assignments are not retargeted");

    // Isolate paging fixtures from the small delivery assertions above.
    await pool.query("DELETE FROM cc_review_notifications WHERE user_id=ANY($1::text[])", [users]);
    const seed = async (count: number) => {
      const inserted = await pool.query(`INSERT INTO cc_assessment_events
        (assessment_id,entity_id,actor_id,action,recipient_id,notification_processed,comment,created_at)
        SELECT $1,$2,$3,'submit',$4,true,'PRIVATE paging comment','2026-01-01'::timestamptz
        FROM generate_series(1,$5::integer) RETURNING id::text`, [assessmentId, item.id, users[0], users[1], count]);
      const ids: string[] = inserted.rows.map(r => r.id).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      await pool.query(`INSERT INTO cc_review_notifications(event_id,user_id)
        SELECT id,$2 FROM unnest($1::bigint[]) AS id`, [ids, users[1]]);
      return ids;
    };
    const ids = await seed(325);
    await pool.query("UPDATE cc_review_notifications SET read_at=now() WHERE user_id=$1 AND event_id>$2::bigint", [users[1], ids[199]]);
    for (const query of ["cursor=0", "cursor=-1", "cursor=1.5", "cursor=abc",
      "cursor=9223372036854775808", "cursor=99999999999999999999",
      "cursor=1&cursor=2", "cursor[]=1", "cursor[x]=1", "filter=invalid", "filter=unread&filter=all"]) {
      await request(`/notifications?${query}`, 1, "GET", undefined, 400);
    }
    const first = await request("/notifications", 1);
    assert.equal(first.notifications.length, 100);
    assert.equal(first.nextCursor, ids[225]);
    assert.ok(first.notifications.every((n: any) => n.read), "latest page can hide older unread alerts");
    const arrivals = await seed(7);
    const seen = first.notifications.map((n: any) => n.id);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await request(`/notifications?cursor=${cursor}`, 1);
      seen.push(...page.notifications.map((n: any) => n.id));
      cursor = page.nextCursor;
    }
    assert.deepEqual(seen, [...ids].reverse(), "new arrivals cannot offset, duplicate or skip older entries");
    assert.equal(new Set(seen).size, 325);
    const refreshed = await request("/notifications", 1);
    assert.deepEqual(refreshed.notifications.slice(0, 7).map((n: any) => n.id), [...arrivals].reverse(), "refresh discovers new arrivals");
    const unreadFirst = await request("/notifications?filter=unread", 1);
    assert.equal(unreadFirst.notifications.length, 100);
    assert.ok(unreadFirst.notifications.every((n: any) => !n.read));
    const anchor = unreadFirst.nextCursor;
    await request(`/notifications/${anchor}/read`, 1, "PUT");
    const readAt = (await pool.query("SELECT read_at FROM cc_review_notifications WHERE user_id=$1 AND event_id=$2", [users[1], anchor])).rows[0].read_at;
    await request(`/notifications/${anchor}/read`, 1, "PUT");
    assert.deepEqual((await pool.query("SELECT read_at FROM cc_review_notifications WHERE user_id=$1 AND event_id=$2", [users[1], anchor])).rows[0].read_at, readAt, "mark-read retries preserve timestamp");
    const unreadSeen = unreadFirst.notifications.map((n: any) => n.id);
    cursor = anchor;
    while (cursor) {
      const page = await request(`/notifications?filter=unread&cursor=${cursor}`, 1);
      assert.ok(page.notifications.every((n: any) => !n.read));
      unreadSeen.push(...page.notifications.map((n: any) => n.id));
      cursor = page.nextCursor;
    }
    assert.deepEqual(unreadSeen, [...arrivals, ...ids.slice(0, 200)].sort((a, b) => BigInt(a) > BigInt(b) ? -1 : 1),
      "reading the cursor item does not skip older unread alerts");
    assert.equal((await request("/notifications?cursor=1&filter=unread", 1)).nextCursor, null);
    assert.deepEqual(await request(`/notifications?cursor=${anchor}`, 3), { notifications: [], nextCursor: null }, "cursor grants no access to another recipient");
    await request(`/notifications/${ids[0]}/read`, 3, "PUT", undefined, 404);
    await request(`/notifications/${ids[0]}/read`, 1, "PUT");
    assert.equal((await request(`/notifications?cursor=${ids[1]}&filter=unread`, 1)).notifications.length, 0, "older page read state persists");
    await request(`/${assessmentId}/members`, 2, "PUT", { userId: users[1], access: null });
    assert.deepEqual(await request(`/notifications?cursor=${anchor}&filter=unread`, 1), { notifications: [], nextCursor: null }, "membership is checked again on older pages");
    await request(`/notifications/${ids[1]}/read`, 1, "PUT", undefined, 404);
    await request(`/${assessmentId}/members`, 2, "PUT", { userId: users[1], access: "review" });
    await assign(3);
    assert.deepEqual(await request(`/notifications?cursor=${anchor}&filter=unread`, 1), { notifications: [], nextCursor: null }, "reassignment hides previously delivered older alerts");
    await request(`/notifications/${ids[1]}/read`, 1, "PUT", undefined, 404);
  } finally {
    if (assessmentId) {
      await pool.query("DELETE FROM cc_assessment_actions WHERE entity_id IN(SELECT id FROM cc_assessment_entities WHERE assessment_id=$1)", [assessmentId]);
      await pool.query("DELETE FROM cc_assessment_events WHERE assessment_id=$1", [assessmentId]);
      await pool.query("DELETE FROM cc_assessment_revisions WHERE entity_id IN(SELECT id FROM cc_assessment_entities WHERE assessment_id=$1)", [assessmentId]);
      await pool.query("DELETE FROM cc_assessment_entities WHERE assessment_id=$1", [assessmentId]);
      await pool.query("DELETE FROM cc_assessment_members WHERE assessment_id=$1", [assessmentId]);
      await pool.query("DELETE FROM cc_shared_assessments WHERE id=$1", [assessmentId]);
    }
    await pool.query("DELETE FROM cc_review_notification_preferences WHERE user_id=ANY($1::text[])", [users]);
    await pool.query("DELETE FROM cc_account_sessions WHERE user_id=ANY($1::text[])", [users]);
    await pool.query("DELETE FROM cc_accounts WHERE id=ANY($1::text[])", [users]);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});
