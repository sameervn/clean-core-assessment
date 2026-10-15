import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, validateWorkspace, buildBackup, parseBackup } from "./workspace-store";
import { aiNarrativeRows, aiNarrativeReportText, explanationSummary, summaryFingerprint, sourceFreshness, type AcceptedExplanation } from "./ai-narratives";

test("new defaults are 2025; historical workspaces, backups and baseline targets stay recorded", () => {
  assert.equal(emptyWorkspace().targetRelease, "S4HANA_2025");
  const historic = { ...emptyWorkspace(), targetRelease: "S4HANA_2023", baseline: { targetRelease: "S4HANA_2022", cleanCoreShare: 50, technicalDebtScore: 10, inventory: [] } };
  const restored = parseBackup(JSON.stringify(buildBackup(historic)));
  assert(restored.ok);
  assert.equal(restored.workspace.targetRelease, "S4HANA_2023");
  assert.equal(restored.workspace.baseline?.targetRelease, "S4HANA_2022");
});
test("source metadata survives backup validation and stale sources are explicit in reports", () => {
  const summary = explanationSummary("object", { classification: "B", confidence: "high", recommendation: { id: "released-developer" } }, "S4HANA_2025");
  const note: AcceptedExplanation = { text: "Synthetic explanation", provider: "openai", model: "synthetic",
    generatedAt: "2026-10-14T00:00:00Z", acceptedAt: "2026-10-14T00:00:00Z", summaryFingerprint: summaryFingerprint(summary),
    knowledgeMode: "knowledge-only", knowledgeDisclosure: "Uploaded guidance only",
    sources: [{ id: "11111111-1111-4111-8111-111111111111", title: "Client guidance", version: 1, release: "S4HANA_2025", section: "Page 2", applicability: "target-release" }] };
  assert(validateWorkspace({ ...emptyWorkspace(), aiNarratives: { "object:test": note } }).ok);
  const deereNote: AcceptedExplanation = { ...note, provider: "deere-gateway", model: "approved/model:version" };
  const deereRestore = parseBackup(JSON.stringify(buildBackup({ ...emptyWorkspace(), aiNarratives: { "object:test": deereNote } })));
  assert(deereRestore.ok);
  assert.deepEqual(deereRestore.workspace.aiNarratives["object:test"], deereNote);
  assert(!validateWorkspace({ ...emptyWorkspace(), aiNarratives: { "object:test": { ...note, sources: [{ ...note.sources![0], text: "Deleted content must not be retained as source excerpt" }] } } }).ok);
  assert.equal(sourceFreshness(note), "unverified");
  assert.equal(sourceFreshness(note, {}), "stale-source");
  assert.equal(sourceFreshness(note, { [note.sources![0].id]: 2 }), "stale-source");
  assert.equal(sourceFreshness(note, { [note.sources![0].id]: 1 }), "current");
  const rows = aiNarrativeRows({ "object:test": note }, [], "S4HANA_2025", {});
  assert.match(aiNarrativeReportText(rows[0]), /stale-source/);
  assert.match(aiNarrativeReportText(rows[0]), /Client guidance · version 1 · Page 2/);
  assert.notEqual(summaryFingerprint(summary), summaryFingerprint({ ...summary, targetRelease: "S4HANA_2023" }));
});
