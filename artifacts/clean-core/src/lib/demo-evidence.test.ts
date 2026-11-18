import assert from "node:assert/strict";
import test from "node:test";
import { isDemoEvidence, withoutDemoEvidence, unloadDemoWorkspace } from "./demo-evidence";
import { emptyWorkspace } from "./workspace-store";

test("unload removes only explicitly marked demo evidence", () => {
  const demo = { metadata: { demo: true }, rows: [{ objectName: "ZDEMO" }] };
  const uploaded = { metadata: { source: "Client inventory" }, attestation: "keep", rows: [{ objectName: "ZDEMO" }] };
  const demoNamedUpload = { fileName: "demo.csv", metadata: { demo: false }, rows: [] };
  const unmarked = { rows: [] };
  const input = [demo, uploaded, demoNamedUpload, unmarked];
  const retained = withoutDemoEvidence(input);
  assert.deepEqual(retained, [uploaded, demoNamedUpload, unmarked]);
  assert.equal(retained[0], uploaded);
  assert.equal(input.length, 4);
});

test("demo detection survives JSON persistence and does not coerce flags", () => {
  assert.equal(isDemoEvidence(JSON.parse('{"metadata":{"demo":true}}')), true);
  assert.equal(isDemoEvidence({ metadata: { demo: "true" } }), false);
  assert.equal(isDemoEvidence({}), false);
  assert.deepEqual(withoutDemoEvidence([{ metadata: { demo: true } }]), []);
  assert.deepEqual(withoutDemoEvidence([]), []);
});

test("unloading clears demo-dependent results but preserves context and uploaded evidence", () => {
  const uploaded = { metadata: { source: "client" }, attestation: "keep", rows: [] };
  const workspace = {
    ...emptyWorkspace(), system: "CLIENT", targetRelease: "S4HANA_2025", weighted: false,
    evidence: [{ metadata: { demo: true } }, uploaded],
    assessment: { inventory: ["demo"] }, narratives: { demo: "edited" },
    aiNarratives: {}, classificationOverrides: [{ objectPattern: "demo" }],
    baseline: { cleanCoreShare: 50, technicalDebtScore: 20, inventory: [] },
  };
  const result = unloadDemoWorkspace(workspace);
  assert.deepEqual(result, {
    ...emptyWorkspace(), system: "CLIENT", targetRelease: "S4HANA_2025", weighted: false,
    evidence: [uploaded],
  });
  assert.equal(result.evidence[0], uploaded);
  assert.equal(workspace.evidence.length, 2);
  assert.deepEqual(workspace.narratives, { demo: "edited" });
  assert.equal(JSON.parse(JSON.stringify(result)).evidence[0].attestation, "keep");
});

test("without demo data, unloading leaves the entire workspace untouched", () => {
  const workspace = { ...emptyWorkspace(), assessment: { client: true }, narratives: { client: "retain" } };
  assert.equal(unloadDemoWorkspace(workspace), workspace);
});
