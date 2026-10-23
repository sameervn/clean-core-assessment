// Runs inside the disposable production container with no external provider.
import assert from "node:assert/strict";
import { withPrivateTempFile } from "./private-temp.mjs";
const base = "http://127.0.0.1:8080";
let ready = false;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/ready`)).ok) { ready = true; break; } } catch {}
  await new Promise(r => setTimeout(r, 500));
}
assert(ready, "readiness");
assert.equal((await fetch(`${base}/health`)).status, 200);
assert.equal((await fetch(`${base}/api/missing`)).headers.get("content-type")?.includes("application/json"), true);
assert.equal((await fetch(`${base}/assets/absent.js`)).status, 404);
const home = await (await fetch(base)).text();
assert.match(home, /<html/);
assert.match(await (await fetch(`${base}/client-spa-route`)).text(), /<html/);
for (const [, asset] of home.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) assert((await fetch(base + asset)).ok, asset);
const fs = await import("node:fs/promises");
await assert.rejects(fs.writeFile("/app/read-only-check", "must fail"));
await withPrivateTempFile(handle => handle.writeFile("ok"));
let cookie = "", csrf = "";
async function api(path, method = "GET", data) {
  return fetch(`${base}/api${path}`, { method, headers: {
    Origin: base, "Content-Type": "application/json", Cookie: cookie, "X-CSRF-Token": csrf,
  }, body: data === undefined ? undefined : JSON.stringify(data) });
}
let login = await api("/auth/login", "POST", { username: "admin", password: process.env.CC_BOOTSTRAP_PASSWORD });
assert.equal(login.status, 200);
cookie = login.headers.get("set-cookie").split(";")[0];
csrf = (await login.json()).csrfToken;
const changed = await api("/auth/password", "POST", {
  currentPassword: process.env.CC_BOOTSTRAP_PASSWORD,
  newPassword: `${process.env.CC_BOOTSTRAP_PASSWORD}-changed`,
});
assert.equal(changed.status, 200, await changed.text());
// Password change rotates the session.
login = await api("/auth/login", "POST", { username: "admin", password: `${process.env.CC_BOOTSTRAP_PASSWORD}-changed` });
assert.equal(login.status, 200);
cookie = login.headers.get("set-cookie").split(";")[0]; csrf = (await login.json()).csrfToken;
assert.equal((await api("/clean-core/review-demo")).status, 200);
const text = "# Portable guidance\n\nUse released APIs for S/4HANA 2025 developer extensibility.";
const ticketResponse = await api("/clean-core/knowledge/uploads", "POST", {
  title: "Portable guidance", release: "S4HANA_2025", topics: ["developer"],
  filename: "guidance.md", size: Buffer.byteLength(text),
});
assert.equal(ticketResponse.status, 200);
const ticket = await ticketResponse.json();
const upload = await fetch(new URL(ticket.uploadUrl, base), { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: text });
assert(upload.ok);
assert.equal((await fetch(new URL(ticket.uploadUrl, base), { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: "overwrite" })).ok, false);
const processed = await api(`/clean-core/knowledge/${ticket.id}/process`, "POST", {});
assert.equal(processed.status, 200, await processed.text());
assert.equal((await api("/clean-core/knowledge")).status, 200);
const sample = await api("/report-templates/sample");
assert.equal(sample.status, 200);
const bytes = Buffer.from(await sample.arrayBuffer());
assert.equal(bytes.subarray(0, 2).toString(), "PK");
const templateTicketResponse = await api("/report-templates/uploads", "POST", { name: "Portable Word", filename: "template.docx" });
assert.equal(templateTicketResponse.status, 200);
const templateTicket = await templateTicketResponse.json();
assert((await fetch(new URL(templateTicket.uploadUrl, base), { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes })).ok);
const templateResponse = await api(`/report-templates/uploads/${templateTicket.id}/process`, "POST", {});
assert.equal(templateResponse.status, 200, await templateResponse.clone().text());
const template = await templateResponse.json();
const preview = await api("/report-templates/preview", "POST", { templateId: template.id, expectedVersion: template.version });
assert.equal(preview.status, 200);
assert.equal(Buffer.from(await preview.arrayBuffer()).subarray(0, 2).toString(), "PK");
const activated = await api(`/report-templates/${template.id}`, "PATCH", { expectedVersion: template.version, active: true });
assert.equal(activated.status, 200);
process.stdout.write("Production assets/SPA/API, read-only root, login/password, demo, guidance upload/sealing, Word upload/preview/activation passed\n");
