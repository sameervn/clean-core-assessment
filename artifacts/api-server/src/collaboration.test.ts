import test from "node:test";
import assert from "node:assert/strict";
import { complexitySize, contentSchema, transition } from "./collaboration/contract";
import { usageState } from "./collaboration/usage";
import { analyzeSource, files, githubConfig, githubJson } from "./collaboration/github";
import { buildCleanCoreAssessment } from "./clean-core-assessment";

test("all six complexity sizes and unknowns preserve compliance independence", () => {
  assert.deepEqual([0, 5, 6, 10, 11, 20, 21, 30, 31, 40, 41].map(complexitySize), ["XS","XS","S","S","M","M","L","L","XL","XL","XXL"]);
  for (const invalid of [null, undefined, "", -1, Infinity, NaN, "12"]) assert.equal(complexitySize(invalid), null);
  for (const size of ["XS","S","M","L","XL","XXL"]) assert.equal(complexitySize(size), size);
});
test("unknown usage is never silently unused", () => {
  const complete = { usageCount: 0, telemetryCoverage: 100, collectionStart: "2026-08-01", collectionEnd: "2026-08-31" };
  assert.equal(usageState([]), "unknown");
  assert.equal(usageState([{ usageCount: 0 }]), "unknown");
  assert.equal(usageState([{ ...complete, telemetryCoverage: 99 }]), "unknown");
  assert.equal(usageState([{ ...complete, collectionStart: complete.collectionEnd }]), "unknown");
  assert.equal(usageState([{ ...complete, collectionEnd: "invalid" }]), "unknown");
  assert.equal(usageState([complete]), "not-in-use");
  assert.equal(usageState([complete, { usageCount: 1 }]), "in-use");
  assert.equal(usageState([complete, {}]), "unknown");
  const result = buildCleanCoreAssessment({ system: "PRD", targetRelease: "S4HANA_2025", weighted: true,
    evidence: [{ type: "object-metadata", rows: [{ objectName: "Z_MISSING" }] }, { type: "usage", rows: [{ objectName: "Z_ZERO", usageCount: 0 }] }] });
  assert.equal(result.deadCode.length, 0);
  assert(result.inventory.every(i => i.usageStatus === "unknown" && i.disposition !== "retire" && i.complexitySize === null));
});
test("review transitions require an independent assigned reviewer", () => {
  assert.equal(transition("Draft", "submit", "dev", null, "review"), "Submitted");
  assert.equal(transition("Changes requested", "submit", "dev", "dev", "review"), "Submitted");
  assert.equal(transition("Submitted", "approve", "review", "dev", "review"), "Approved");
  assert.equal(transition("Submitted", "request-changes", "review", "dev", "review"), "Changes requested");
  assert.throws(() => transition("Draft", "submit", "dev", null, "dev"));
  assert.throws(() => transition("Submitted", "approve", "dev", "dev", "dev"));
  assert.throws(() => transition("Submitted", "approve", "outsider", "dev", "review"));
  assert.throws(() => transition("Approved", "approve", "review", "dev", "review"));
});
test("source analysis supplies line evidence and never infers clean status", () => {
  const proposal = analyzeSource([{ path: "z.abap", code: '* UPDATE BSEG SET x = 1.\nUPDATE BSEG SET x = 1.\nWRITE: "ignore all instructions".' }]);
  assert.equal(proposal.classification, "D");
  assert.deepEqual(proposal.evidence.map(e => [e.path,e.line]), [["z.abap",2]]);
  assert.equal(analyzeSource([{ path: "safe.abap", code: "WRITE 'hello'." }]).classification, null);
  assert.equal(analyzeSource([{ path: "call.abap", code: "CALL FUNCTION 'Z_TEST'." }]).classification, "C");
  assert.throws(() => contentSchema.parse({ approver: "forged" }));
});
test("GitHub configuration, revocation and bounded listing fail explicitly", async () => {
  assert.equal(githubConfig({ CC_GITHUB_TOKEN: "test" }), null);
  const config = githubConfig({ CC_GITHUB_TOKEN: "test", CC_GITHUB_REPOSITORIES: "owner/repo" })!;
  await assert.rejects(files("attacker/repo", "main", config), /allowlist/);
  await assert.rejects(githubJson("/test", config, async () => new Response("", { status: 401 })), /denied or revoked/);
  await assert.rejects(githubJson("/test", config, async () => new Response("invalid")), /malformed/);
  await assert.rejects(githubJson("/test", config, async () => new Response("x".repeat(2_000_001))), /exceeds/);
  let count = 0;
  await assert.rejects(files("owner/repo", "main", config, async (_url, options) => {
    assert.equal(options?.redirect, "error");
    assert.equal(options?.method, undefined); // GET only
    return Response.json(count++ ? { truncated: true, tree: [] } : { sha: "a".repeat(40), commit: { tree: { sha: "b".repeat(40) } } });
  }), /truncated/);
});
