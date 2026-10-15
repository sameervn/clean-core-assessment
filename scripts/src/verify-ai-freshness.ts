import assert from "node:assert/strict";
// Load frontend modules at runtime: this Node-only scripts project intentionally
// does not include DOM types or frontend sources in its TypeScript root.
const frontendLib = "../../artifacts/clean-core/src/lib/";
const { explanationSummary, summaryFingerprint, explanationReviewState } = await import(`${frontendLib}ai-narratives.ts`);
const { emptyWorkspace, buildBackup, parseBackup, validateWorkspace } = await import(`${frontendLib}workspace-store.ts`);

for (const kind of ["object", "interface"] as const) {
  const item = { classification: "A", confidence: "high", recommendation: { id: "retain" } };
  const summary = explanationSummary(kind, item);
  const legacy = {
    text: "Accepted explanation", provider: "openai", model: "test",
    generatedAt: "2026-10-14T00:00:00Z", acceptedAt: "2026-10-14T00:01:00Z",
  };
  const note = { ...legacy, summaryFingerprint: summaryFingerprint(summary) };
  assert.equal(explanationReviewState(note, summary), "current");
  assert.equal(summaryFingerprint({ confidence: summary.confidence, recommendation: summary.recommendation, classification: summary.classification, kind }), note.summaryFingerprint);
  for (const changed of [
    { ...item, classification: "D" },
    { ...item, confidence: "low" },
    { ...item, recommendation: { id: "replace" } },
  ]) {
    assert.equal(explanationReviewState(note, explanationSummary(kind, changed)), "needs-review");
  }
  assert.equal(explanationReviewState(note, explanationSummary(kind, { ...item, notes: "Expert edit", evidence: "private" })), "current");
  assert.equal(explanationReviewState(legacy, summary), "unknown");
  for (const saved of [note, legacy]) {
    const workspace = { ...emptyWorkspace(), narratives: { expert: "Do not change" }, aiNarratives: { [`${kind}:one`]: saved } };
    const restored = parseBackup(JSON.stringify(buildBackup(workspace)));
    assert.ok(restored.ok);
    if (restored.ok) {
      assert.deepEqual(restored.workspace.aiNarratives, workspace.aiNarratives);
      assert.deepEqual(restored.workspace.narratives, workspace.narratives);
    }
  }
  for (const invalid of [null, 123, "", "x".repeat(4097)]) {
    assert.equal(validateWorkspace({ ...emptyWorkspace(), aiNarratives: { [`${kind}:one`]: { ...note, summaryFingerprint: invalid } } }).ok, false);
  }
}
assert.ok(parseBackup(JSON.stringify(buildBackup(emptyWorkspace()))).ok);
console.log("PASS AI summary changes, stable signatures, legacy records, backup roundtrips, and fingerprint validation");
