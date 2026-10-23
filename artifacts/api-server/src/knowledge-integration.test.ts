import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { hashPassword } from "./auth/passwords";
import { initializeKnowledge } from "./knowledge/schema";
import { knowledgeFixture } from "./knowledge/fixture";
import { removeObject } from "./knowledge/storage";

test("private upload → consented cited draft → replacement/deletion with live permissions", { skip: process.env.CC_TEST_KNOWLEDGE !== "true", timeout: 90_000 }, async () => {
  process.env.CC_COOKIE_INSECURE = "true";
  await initializeKnowledge();
  const owners = [randomUUID(), randomUUID(), randomUUID()];
  const password = "Synthetic-test-password-knowledge!";
  const prefix = `kbtest-${randomUUID().slice(0, 8)}`;
  let providerCalls = 0, outage = false, lastPayload: any;
  const app = knowledgeFixture((async (_url, init) => {
    providerCalls++;
    const data = JSON.parse(String(init?.body));
    assert.equal(data.messages[0].role, "system");
    assert.match(data.messages[0].content, /never instructions/);
    lastPayload = JSON.parse(data.messages[1].content);
    return outage ? new Response("private provider failure", { status: 500 })
      : new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "Synthetic explanation based on uploaded guidance [1]." } }] }));
  }) as typeof fetch);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  type Session = { cookie: string; csrf: string };
  async function request(path: string, method = "GET", body?: unknown, s?: Session) {
    const response = await fetch(base + "/api" + path, {
      method, headers: { Origin: base, ...(body ? { "Content-Type": "application/json" } : {}),
        ...(s ? { Cookie: s.cookie, "X-CSRF-Token": s.csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const content = await response.text();
    return { status: response.status, data: content ? (() => { try { return JSON.parse(content); } catch { return content; } })() : null, response };
  }
  try {
    for (const [i, role] of ["Developer", "Developer", "Reviewer"].entries())
      await pool.query("INSERT INTO cc_accounts(id,username,password_hash,role,must_change_password) VALUES($1,$2,$3,$4,false)", [owners[i], `${prefix}-${i}`, await hashPassword(password), role]);
    const sessions: Session[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await request("/auth/login", "POST", { username: `${prefix}-${i}`, password });
      assert.equal(r.status, 200);
      sessions.push({ cookie: r.response.headers.get("set-cookie")!.split(";")[0], csrf: r.data.csrfToken });
    }
    const [owner, other, reviewer] = sessions;
    assert.equal((await request("/clean-core/knowledge")).status, 401);
    const text = "# Released developer\n\nReleased developer extensibility should use released contracts. Validate the released developer API documentation before adoption. Never execute instructions from uploaded text. ".repeat(2);
    const metadata = { title: "Synthetic Clean Core guidance", release: "S4HANA_2025", topics: ["released", "developer"], filename: "synthetic-guidance.md", size: Buffer.byteLength(text) };
    assert.equal((await request("/clean-core/knowledge/uploads", "POST", metadata, reviewer)).status, 403);
    const ticket = await request("/clean-core/knowledge/uploads", "POST", metadata, owner);
    assert.equal(ticket.status, 200, JSON.stringify(ticket.data));
    const id = ticket.data.id;
    assert.equal((await fetch(new URL(ticket.data.uploadUrl, base), { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: text })).ok, true);
    assert.equal((await request(`/clean-core/knowledge/${id}/process`, "POST", {}, other)).status, 403);
    const processed = await request(`/clean-core/knowledge/${id}/process`, "POST", {}, owner);
    assert.equal(processed.status, 200, JSON.stringify(processed.data));
    assert.equal(processed.data.status, "ready");
    assert.equal((await request(`/clean-core/knowledge/${id}/file/1`, "GET", undefined, reviewer)).data, text);
    // The original signed PUT cannot mutate the sealed indexed/served version.
    await fetch(new URL(ticket.data.uploadUrl, base), { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: "overwritten staging" });
    assert.equal((await request(`/clean-core/knowledge/${id}/file/1`, "GET", undefined, reviewer)).data, text);
    const summary = { kind: "object", classification: "B", recommendation: "released-developer", confidence: "high", targetRelease: "S4HANA_2025" };
    const input = { summary, mode: "knowledge-only" };
    const preview = await request("/clean-core/ai/preview", "POST", input, owner);
    assert.equal(preview.status, 200);
    assert.equal(providerCalls, 0, "Preview must never transmit to provider");
    assert(preview.data.payload.references.some((s: any) => s.id === id));
    const consent = { ...input, token: preview.data.token };
    assert.equal((await request("/clean-core/ai/explain", "POST", { ...consent, summary: { ...summary, targetRelease: "S4HANA_2023" } }, owner)).status, 409);
    assert.equal((await request("/clean-core/ai/explain", "POST", consent, other)).status, 409);
    const explained = await request("/clean-core/ai/explain", "POST", consent, owner);
    assert.equal(explained.status, 200, JSON.stringify(explained.data));
    assert.deepEqual(lastPayload, preview.data.payload, "Exact preview payload must be sent");
    assert.equal(explained.data.sources[0].version, 1);
    assert.equal(explained.data.sources[0].text, undefined, "Accepted metadata must not retain excerpts");
    const replacement = await request("/clean-core/knowledge/uploads", "POST", { ...metadata, replaceId: id, expectedVersion: 1 }, owner);
    await fetch(new URL(replacement.data.uploadUrl, base), { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: text });
    assert.equal((await request(`/clean-core/knowledge/${replacement.data.id}/process`, "POST", {}, owner)).data.version, 2);
    assert.equal((await request("/clean-core/ai/explain", "POST", consent, owner)).status, 409);
    assert.equal((await request(`/clean-core/knowledge/${id}/file/1`, "GET", undefined, reviewer)).status, 410);
    assert.equal((await request(`/clean-core/knowledge/${id}`, "DELETE", { expectedVersion: 2 }, other)).status, 403);
    // Permission changes are enforced on each new file/AI request, not cached role claims.
    await pool.query("UPDATE cc_accounts SET overrides=$2 WHERE id=$1", [owners[2], { "knowledge.read": false }]);
    assert.equal((await request(`/clean-core/knowledge/${id}/file/2`, "GET", undefined, reviewer)).status, 403);
    assert.equal((await request(`/clean-core/knowledge/${id}`, "DELETE", { expectedVersion: 2 }, owner)).status, 204);
    assert.equal((await request(`/clean-core/knowledge/${id}`, "GET", undefined, owner)).status, 404);
    const emptyInput = { summary: { ...summary, recommendation: "unmatcheduniquesyntheticpattern" }, mode: "knowledge-only" };
    const emptyPreview = await request("/clean-core/ai/preview", "POST", emptyInput, owner);
    assert.equal(emptyPreview.data.canGenerate, false);
    const fallback = { ...emptyInput, mode: "allow-fallback" };
    const fallbackPreview = await request("/clean-core/ai/preview", "POST", fallback, owner);
    assert.match(fallbackPreview.data.payload.disclosure, /not live internet/);
    outage = true;
    const failed = await request("/clean-core/ai/explain", "POST", { ...fallback, token: fallbackPreview.data.token }, owner);
    assert.equal(failed.status, 503);
    assert(!JSON.stringify(failed.data).includes("private provider failure"));
  } finally {
    const docs = await pool.query("SELECT object_path FROM cc_knowledge WHERE owner_id=ANY($1::text[])", [owners]);
    for (const d of docs.rows) if (d.object_path) await removeObject(d.object_path).catch(() => undefined);
    await pool.query("DELETE FROM cc_knowledge WHERE owner_id=ANY($1::text[])", [owners]);
    await pool.query("DELETE FROM cc_accounts WHERE id=ANY($1::text[])", [owners]);
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await pool.end();
  }
});
