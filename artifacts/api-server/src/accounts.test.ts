import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { hashPassword, verifyPassword } from "./auth/passwords";
import { permissions } from "./auth/permissions";

test("role presets, overrides and password hashes", async () => {
  assert.deepEqual(permissions("Reviewer", {}), ["view", "export", "knowledge.read"]);
  assert(!permissions("Developer", {}).includes("knowledge.manage-all"));
  assert(permissions("Developer", {}).includes("knowledge.upload"));
  assert(permissions("Developer", {}).includes("classify"));
  assert(!permissions("Developer", { classify: false }).includes("classify"));
  assert(permissions("Reviewer", { notes: true }).includes("notes"));
  assert(permissions("Admin", { view: false }).includes("view"));
  const hash = await hashPassword("synthetic-password-only");
  assert(await verifyPassword("synthetic-password-only", hash));
  assert(!await verifyPassword("wrong-password", hash));
});

test("local account API integration, revocation and permission boundaries", { skip: process.env.CC_TEST_ACCOUNTS !== "true" }, async () => {
  // Explicit opt-in: creates uniquely named synthetic accounts, removes only those IDs.
  process.env.CC_COOKIE_INSECURE = "true"; // This test server uses loopback HTTP.
  const { default: app } = await import("./app");
  const { bootstrapAdmin } = await import("./auth/service");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const prefix = `test-${randomUUID().slice(0, 8)}`;
  const ids: string[] = [];
  const initial = "Synthetic-test-password-123!";
  const changed = "Changed-synthetic-password-456!";
  type Session = { cookie: string; csrf: string };
  async function request(path: string, method = "GET", body?: unknown, session?: Session, headers: Record<string, string> = {}) {
    const res = await fetch(`${base}/api${path}`, { method, headers: {
      Origin: base, ...(body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}), ...headers,
    }, body: body ? JSON.stringify(body) : undefined });
    const json: any = await res.json();
    return { status: res.status, json, res };
  }
  async function login(name: string, password = initial) {
    const r = await request("/auth/login", "POST", { username: name, password });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return { cookie: r.res.headers.get("set-cookie")!.split(";")[0], csrf: r.json.csrfToken } as Session;
  }
  try {
    const adminId = randomUUID(); ids.push(adminId);
    await pool.query("INSERT INTO cc_accounts(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,'Admin',false)", [adminId, `${prefix}-admin`, await hashPassword(initial)]);
    const count = (await pool.query("SELECT count(*) FROM cc_accounts")).rows[0].count;
    await bootstrapAdmin(); await bootstrapAdmin();
    assert.equal((await pool.query("SELECT count(*) FROM cc_accounts")).rows[0].count, count);
    assert.equal((await request("/clean-core/review-demo")).status, 401);
    const admin = await login(`${prefix}-admin`);
    assert.equal((await request("/admin/audit")).status, 401);
    assert.equal((await request("/admin/audit?page=0", "GET", undefined, admin)).status, 400);
    assert.equal((await request("/admin/audit?action=unknown", "GET", undefined, admin)).status, 400);
    assert.equal((await request("/admin/audit?from=2026-02-30", "GET", undefined, admin)).status, 400);
    assert.equal((await request("/admin/audit?from=2026-10-02&to=2026-10-01", "GET", undefined, admin)).status, 400);
    // Dedicated historical date isolates pagination/date boundary assertions from other accounts.
    for (let i = 0; i < 27; i++) {
      await pool.query("INSERT INTO cc_account_audit(id,actor_id,target_id,action,created_at) VALUES($1,$2,$2,'user_created',$3)", [
        randomUUID(), adminId, `1901-01-02T${i === 26 ? "23:59:59.999" : "00:00:00.000"}Z`,
      ]);
    }
    const auditPath = "/admin/audit?action=user_created&from=1901-01-02&to=1901-01-02";
    const first = await request(auditPath, "GET", undefined, admin);
    assert.equal(first.status, 200);
    assert.equal(first.res.headers.get("cache-control"), "no-store");
    assert.equal(first.json.entries.length, 25);
    assert.equal(first.json.hasMore, true);
    const second = await request(`${auditPath}&page=2`, "GET", undefined, admin);
    assert.equal(second.json.entries.length, 2);
    assert.equal(second.json.hasMore, false);
    assert.equal(new Set([...first.json.entries, ...second.json.entries].map(e => e.id)).size, 27);
    assert.deepEqual(Object.keys(first.json.entries[0]).sort(), ["action", "actorId", "actorUsername", "createdAt", "id", "targetId", "targetUsername"]);
    assert.equal((await request("/admin/audit?to=1901-01-01", "GET", undefined, admin)).json.entries.length, 0);
    assert.equal((await request("/admin/users", "GET", undefined, admin)).status, 200);
    assert.equal((await request("/auth/authorize", "POST", { permission: "notes" }, admin, { Origin: "https://evil.example" })).status, 403);
    assert.equal((await request("/auth/authorize", "POST", { permission: "notes" }, admin, { "X-CSRF-Token": "fake" })).status, 403);
    for (const role of ["Developer", "Reviewer"]) {
      const created = await request("/admin/users", "POST", { username: `${prefix}-${role.toLowerCase()}`, password: initial, role }, admin);
      assert.equal(created.status, 201, JSON.stringify(created.json)); ids.push(created.json.user.id);
      const session = await login(created.json.user.username);
      assert.equal((await request("/clean-core/review-demo", "GET", undefined, session)).status, 403);
      assert.equal((await request("/auth/password", "POST", { currentPassword: initial, newPassword: changed }, session)).status, 200);
      assert.equal((await request("/auth/me", "GET", undefined, session)).json.user, null);
    }
    const reviewer = await login(`${prefix}-reviewer`, changed), developer = await login(`${prefix}-developer`, changed);
    for (const session of [reviewer, developer]) {
      const denied = await request("/admin/audit", "GET", undefined, session);
      assert.equal(denied.status, 403);
      assert.equal(denied.json.entries, undefined);
    }
    assert.equal((await request("/admin/users", "GET", undefined, reviewer)).status, 403);
    assert.equal((await request("/admin/users", "GET", undefined, developer)).status, 403);
    assert.equal((await request("/clean-core/assessment", "POST", {}, reviewer)).status, 403);
    assert.equal((await request("/clean-core/demo", "POST", {}, reviewer)).status, 403);
    assert.equal((await request("/clean-core/evidence", "POST", {}, reviewer)).status, 403);
    const demo = await request("/clean-core/review-demo", "GET", undefined, reviewer);
    assert.equal(demo.status, 200);
    assert(demo.json.assessment.inventory.length > 0);
    assert.equal((await request("/auth/authorize", "POST", { permission: "notes" }, reviewer)).status, 403);
    assert.equal((await request(`/admin/users/${ids[2]}`, "PATCH", { overrides: { notes: true } }, admin)).status, 200);
    assert.equal((await request("/auth/authorize", "POST", { permission: "notes" }, reviewer)).status, 200);
    const inactiveReviewer = await request(`/admin/users/${ids[2]}`, "PATCH", { active: false }, admin);
    assert.equal(inactiveReviewer.json.user.overrides.notes, true, "Deactivation preserves saved grants");
    const activeReviewer = await request(`/admin/users/${ids[2]}`, "PATCH", { active: true }, admin);
    assert.equal(activeReviewer.json.user.overrides.notes, true, "Reactivation preserves saved grants");
    assert.equal((await request(`/admin/users/${ids[1]}`, "PATCH", { overrides: { classify: false } }, admin)).status, 200);
    assert.equal((await request("/clean-core/assessment", "POST", { classificationOverrides: [{}] }, developer)).status, 403);
    assert.equal((await request(`/admin/users/${ids[2]}`, "POST", { role: "Admin" }, reviewer)).status, 401, "Deactivated sessions remain revoked after reactivation");
    assert.equal((await request(`/admin/users/${ids[2]}/reset-password`, "POST", { password: initial }, admin)).status, 200);
    assert.equal((await request("/auth/me", "GET", undefined, reviewer)).json.user, null);
    assert.equal((await request(`/admin/users/${ids[1]}`, "PATCH", { active: false }, admin)).status, 200);
    assert.equal((await request("/auth/me", "GET", undefined, developer)).json.user, null);
    assert.equal((await request("/auth/login", "POST", { username: `${prefix}-developer`, password: changed })).status, 401);
    assert.equal((await request(`/admin/users/${ids[1]}`, "PATCH", { active: true }, admin)).status, 200);
    const another = await login(`${prefix}-developer`, changed);
    assert.equal((await request("/auth/logout", "POST", {}, another)).status, 200);
    assert.equal((await request("/auth/me", "GET", undefined, another)).json.user, null);
    // Exercise last-admin invariant only when no unrelated administrator exists.
    if (Number((await pool.query("SELECT count(*) FROM cc_accounts WHERE role='Admin' AND active")).rows[0].count) === 1) {
      const results = await Promise.all([
        request(`/admin/users/${adminId}`, "PATCH", { active: false }, admin),
        request(`/admin/users/${adminId}`, "PATCH", { role: "Reviewer" }, admin),
      ]);
      assert.deepEqual(results.map(r => r.status), [409, 409]);
    }
    const throttleName = `${prefix}-missing`;
    for (let i = 0; i < 10; i++) assert.equal((await request("/auth/login", "POST", { username: throttleName, password: initial })).status, 401);
    assert.equal((await request("/auth/login", "POST", { username: throttleName, password: initial })).status, 429);
    await login(`${prefix}-admin`); // One exhausted account cannot deny other accounts sign-in.
    const exposed = JSON.stringify((await request("/admin/users", "GET", undefined, admin)).json);
    assert(!exposed.includes("password_hash") && !exposed.includes(initial) && !exposed.includes("scrypt:"));
    const events = (await pool.query("SELECT action FROM cc_account_audit WHERE actor_id=$1", [adminId])).rows.map(r => r.action);
    for (const event of ["user_created", "permissions_changed", "user_activated", "user_deactivated", "password_reset"]) assert(events.includes(event), event);
    await request(`/admin/users/${ids[1]}`, "PATCH", { role: "Reviewer" }, admin);
    assert.equal((await pool.query("SELECT 1 FROM cc_account_audit WHERE actor_id=$1 AND action='role_changed'", [adminId])).rowCount, 1);
    const auditBody = JSON.stringify((await request("/admin/audit", "GET", undefined, admin)).json);
    for (const forbidden of [initial, changed, "password_hash", "token_hash", "csrf", "scrypt:", "assessment"]) assert(!auditBody.includes(forbidden), forbidden);
  } finally {
    await pool.query("DELETE FROM cc_accounts WHERE id=ANY($1::text[])", [ids]);
    await pool.query("DELETE FROM cc_account_audit WHERE actor_id=ANY($1::text[]) OR target_id=ANY($1::text[])", [ids]);
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});
