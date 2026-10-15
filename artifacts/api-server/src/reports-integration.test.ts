import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { initializeReports } from "./reports/schema";
import { createSession } from "./auth/service";
import { sample } from "./reports/engine.mjs";
import { example } from "./reports/contract.mjs";
import { removeObject } from "./knowledge/storage";
import PizZip from "pizzip";

test("real private template lifecycle, ownership, permissions, restart persistence and complete bulk", { skip: process.env.CC_TEST_REPORTS !== "true", timeout: 120_000 }, async () => {
  await initializeReports();
  const { default: app } = await import("./app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const owners = [randomUUID(), randomUUID(), randomUUID()];
  const paths = new Set<string>();
  const sessions: Array<{ token: string; csrf: string }> = [];
  const request = (path: string, method = "GET", body?: unknown, user = 0) => fetch(`${base}/api/report-templates${path}`, {
    method, headers: { Origin: base, Cookie: `cc_session=${sessions[user].token}`, "X-CSRF-Token": sessions[user].csrf, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = async (response: Response, status = 200) => {
    const value: any = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
  };
  try {
    for (const [i, owner] of owners.entries()) {
      await pool.query("INSERT INTO cc_accounts(id,username,password_hash,role,must_change_password) VALUES($1,$2,'not-a-login-hash',$3,false)", [owner, `wordtest-${owner}`, i === 2 ? "Reviewer" : "Developer"]);
      sessions.push(await createSession(pool, owner));
    }
    assert.equal((await request("/sample", "GET", undefined, 2)).status, 200);
    assert.equal((await request("/uploads", "POST", { name: "Forbidden", filename: "test.docx" }, 2)).status, 403);
    const upload = async (body: any, bytes = sample()) => {
      const ticket = await json(await request("/uploads", "POST", body));
      const uploadResponse = await fetch(ticket.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(bytes) });
      assert.equal(uploadResponse.ok, true, "Direct private upload should work");
      paths.add((await pool.query("SELECT object_path FROM cc_report_templates WHERE id=$1", [ticket.id])).rows[0].object_path);
      const processed = await request(`/uploads/${ticket.id}/process`, "POST", {});
      return { ticket, processed };
    };
    const first = await upload({ name: "Private template", filename: "layout.docx" });
    const template = await json(first.processed);
    paths.add((await pool.query("SELECT object_path FROM cc_report_templates WHERE id=$1", [template.id])).rows[0].object_path);
    assert.equal(template.previewed, false);
    assert.equal((await request(`/${template.id}`, "PATCH", { expectedVersion: 1, active: true })).status, 409);
    assert.equal((await request("/preview", "POST", { templateId: template.id }, 1)).status, 404);
    assert.equal((await request("/render", "POST", { templateId: template.id, entities: [example] }, 1)).status, 404);
    assert.equal((await request(`/${template.id}`, "PATCH", { expectedVersion: 1, name: "stolen" }, 1)).status, 404);
    assert.equal((await request(`/${template.id}`, "DELETE", { expectedVersion: 1 }, 1)).status, 404);
    assert.equal((await request("/uploads", "POST", { name: "stolen", filename: "x.docx", replaceId: template.id, expectedVersion: 1 }, 1)).status, 404);
    const preview = await request("/preview", "POST", { templateId: template.id, expectedVersion: 1 });
    assert.equal(preview.status, 200);
    assert(new PizZip(Buffer.from(await preview.arrayBuffer())).file("word/document.xml"));
    await json(await request(`/${template.id}`, "PATCH", { expectedVersion: 1, active: true }));
    await initializeReports(); // Idempotent reinitialization cannot discard durable selection.
    const persisted = await json(await request("/"));
    assert.equal(persisted.activeId, template.id);
    assert.equal((await json(await request("/", "GET", undefined, 1))).templates.length, 0);
    const bulk = await request("/render", "POST", { templateId: template.id, entities: [example, { ...example, entity_kind: "interface" }, { ...example, entity_id: "second" }] });
    assert.equal(bulk.status, 200);
    assert.equal(Object.keys(new PizZip(Buffer.from(await bulk.arrayBuffer())).files).length, 2);
    await pool.query("UPDATE cc_accounts SET overrides=$2 WHERE id=$1", [owners[0], JSON.stringify({ export: false, "templates.manage": false })]);
    assert.equal((await request("/render", "POST", { templateId: template.id, entities: [example] })).status, 403);
    assert.equal((await request("/preview", "POST", { templateId: "sample" })).status, 403);
    assert.equal((await request(`/${template.id}`, "DELETE", { expectedVersion: 1 })).status, 403);
    await pool.query("UPDATE cc_accounts SET overrides='{}' WHERE id=$1", [owners[0]]);
    const replacement = await upload({ name: "Replacement", filename: "layout.docx", replaceId: template.id, expectedVersion: 1 });
    const replaced = await json(replacement.processed);
    assert.equal(replaced.id, template.id); assert.equal(replaced.version, 2); assert.equal(replaced.active, false); assert.equal(replaced.previewed, false);
    paths.add((await pool.query("SELECT object_path FROM cc_report_templates WHERE id=$1", [template.id])).rows[0].object_path);
    assert.equal((await request(`/${template.id}`, "DELETE", { expectedVersion: 1 })).status, 409);
    assert.equal((await request(`/${template.id}`, "DELETE", { expectedVersion: 2 })).status, 204);
    assert.equal((await request("/preview", "POST", { templateId: template.id })).status, 404);
    const bad = await upload({ name: "Not Word", filename: "bad.docx" }, Buffer.from("fake document"));
    assert.equal(bad.processed.status, 400);
    assert.equal((await json(await request("/"))).templates.length, 0);
  } finally {
    const remaining = (await pool.query("SELECT object_path FROM cc_report_templates WHERE owner_id=ANY($1)", [owners])).rows;
    remaining.forEach(r => paths.add(r.object_path));
    for (const path of paths) {
      await removeObject(path);
      await pool.query("DELETE FROM cc_report_template_garbage WHERE object_path=$1", [path]);
    }
    await pool.query("DELETE FROM cc_accounts WHERE id=ANY($1)", [owners]);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});
