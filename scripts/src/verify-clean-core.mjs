import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const requireServer = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { tsImport } = await import(pathToFileURL(requireServer.resolve("tsx/esm/api")).href);
const fixture = await tsImport("../../artifacts/clean-core/tests/browser/fixtures/accounts-db.ts", import.meta.url);
const account = await fixture.createSyntheticAccount();
try {
const login = await globalThis.fetch("http://localhost:80/api/auth/login", {
  method: "POST", headers: { Origin: "http://localhost:80", "Content-Type": "application/json" },
  body: JSON.stringify({ username: account.username, password: account.password }),
});
assert.equal(login.status, 200, "Synthetic account signs in");
const session = await login.json();
const cookie = login.headers.get("set-cookie").split(";")[0];
const fetch = (url, init = {}) => globalThis.fetch(url, { ...init, headers: {
  Origin: "http://localhost:80", Cookie: cookie, "X-CSRF-Token": session.csrfToken, ...init.headers,
}});

const base = "http://localhost:80/api/clean-core";
const post = (path, data) => fetch(`${base}/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
});
const upload = (fileName, text, type = "atc") => {
  const form = new FormData();
  form.append("type", type);
  form.append("file", new Blob([text], { type: "text/plain" }), fileName);
  return fetch(`${base}/evidence`, { method: "POST", body: form });
};
const context = { system: "PRD", targetRelease: "S4HANA_2023", weighted: true };
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks++;
  console.log(`PASS ${message}`);
}
const demoResponse = await post("demo", context);
check(demoResponse.status === 200, "demo endpoint succeeds");
const demo = await demoResponse.json();
check(demo.assessment.totals.objects === 4000, "original demo assesses 4,000 objects");
const assessmentResponse = await post("assessment", { ...context, evidence: demo.evidence });
check(assessmentResponse.status === 200, "signed demo evidence can be reassessed");
const assessment = await assessmentResponse.json();
check(assessment.cleanCoreShare === demo.assessment.cleanCoreShare, "rerun preserves scoring");
check(assessment.inventory.length === 4000 && assessment.roadmap.waves.length > 0 && assessment.integrations.length > 0,
  "inventory, interfaces and mitigation roadmap returned");
const samples = [
  ["evidence.csv", "objectName,severity,finding\nZREPORT,high,Unreleased API"],
  ["evidence.tsv", "objectName\tseverity\tfinding\nZREPORT\thigh\tUnreleased API"],
  ["evidence.json", '[{"objectName":"ZREPORT","severity":"high","finding":"Unreleased API"}]'],
  ["evidence.xml", "<items><item><objectName>ZREPORT</objectName><severity>high</severity><finding>Unreleased API</finding></item></items>"],
  ["evidence.txt", "ZREPORT: high: Unreleased API"],
];
let valid;
for (const [name, text] of samples) {
  const response = await upload(name, text);
  check(response.status === 200, `${name} upload normalized`);
  valid = await response.json();
  check(valid.count === 1 && /^[a-f0-9]{64}$/.test(valid.attestation), `${name} receives integrity attestation`);
}
const changed = structuredClone(valid);
changed.rows[0].finding = "tampered";
check((await post("assessment", { ...context, evidence: [changed] })).status === 400, "tampered evidence rejected");
const overrideResponse = await post("assessment", {
  ...context, evidence: [valid], classificationOverrides: [{ objectPattern: "ZREPORT", level: "B", reason: "Architect review" }],
});
check(overrideResponse.status === 200, "classification override succeeds");
check((await overrideResponse.json()).inventory[0].classification === "B", "classification override changes result");
for (const [name, text, type] of [
  ["empty.json", "", "atc"], ["broken.json", "{oops", "atc"], ["bad.exe", "file", "atc"],
  ["bad.xml", '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><item><objectName>Z</objectName></item>', "atc"],
  ["unknown.csv", samples[0][1], "unsupported"],
]) check((await upload(name, text, type)).status === 400, `${name}/${type} rejected`);
check((await post("assessment", { ...context, evidence: [] })).status === 400, "empty assessment rejected");
check((await post("assessment", { ...context, evidence: [valid, valid] })).status === 400, "duplicate evidence types rejected");
check((await post("demo", { ...context, system: " " })).status === 400, "blank assessment context rejected");
check((await upload("oversize.txt", "x".repeat(16_000_001))).status === 413, "oversized upload rejected");
check((await fetch(`${base}/sources`)).status === 404, "source administration is not exposed");
check((await fetch("http://localhost:80/api/projects")).status === 404, "source project selection is not exposed");
console.log(`${checks} API checks passed.`);
} finally {
  await fixture.deleteSyntheticAccounts([account.id]);
  await fixture.closeFixturePool();
}
