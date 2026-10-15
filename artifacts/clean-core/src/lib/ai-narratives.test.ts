import assert from "node:assert/strict";
import test from "node:test";
import { aiExplanationReviewQueue, retainedAiExplanations, explanationSummary, summaryFingerprint, type AcceptedExplanation } from "./ai-narratives";

const item = { id: "one", objectName: "Example", classification: "B", confidence: "high", dimension: "Integration" };
const accepted = (kind: "object" | "interface", record = item) => ({
  text: "Keep this accepted explanation",
  acceptedAt: "2026-10-14T00:00:00Z",
  summaryFingerprint: summaryFingerprint(explanationSummary(kind, record)),
} as AcceptedExplanation);

test("unavailable notes are retained separately regardless of fingerprint and return to review when records return", () => {
  const notes = {
    "object:one": { ...accepted("object"), summaryFingerprint: undefined },
    "interface:missing:id": { ...accepted("interface"), text: "Original\n説明 <text>" },
    "object:missing:id": { ...accepted("object"), summaryFingerprint: undefined },
  };
  const before = JSON.stringify(notes);
  const retained = retainedAiExplanations([item], notes);
  assert.deepEqual(retained.map(row => row.subject), ["interface:missing:id", "object:missing:id"]);
  assert.equal(retained[0].note, notes["interface:missing:id"]);
  assert.deepEqual(aiExplanationReviewQueue([item], notes).map(row => row.subject), ["object:one"]);
  assert.equal(retainedAiExplanations([], notes).length, 3);
  const restored = [item, { ...item, id: "missing:id", classification: "D" }];
  assert.equal(retainedAiExplanations(restored, notes).length, 0);
  assert.equal(aiExplanationReviewQueue(restored, notes).length, 3);
  assert.deepEqual(retainedAiExplanations([item], {}), []);
  assert.equal(JSON.stringify(notes), before);
});

test("review queue excludes current and unaccepted subjects and separates object/interface notes", () => {
  const notes = {
    "object:one": accepted("object"),
    "interface:one": accepted("interface", { ...item, classification: "C" }),
  };
  const queue = aiExplanationReviewQueue([item, { ...item, id: "two" }], notes);
  assert.deepEqual(queue.map(({ subject, state }) => ({ subject, state })), [
    { subject: "interface:one", state: "needs-review" },
  ]);
});

test("a removed interface is retained even when its object and matching summary remain", () => {
  const objectOnly = { ...item, dimension: "Extension" };
  for (const summaryFingerprint of [accepted("interface").summaryFingerprint, undefined]) {
    const notes = {
      "object:one": accepted("object"),
      "interface:one": { ...accepted("interface"), summaryFingerprint },
    };
    assert.deepEqual(retainedAiExplanations([objectOnly], notes).map(row => row.subject), ["interface:one"]);
    assert.deepEqual(aiExplanationReviewQueue([objectOnly], notes), []);
    assert.deepEqual(retainedAiExplanations([{ ...objectOnly, interfaceName: "Restored" }], notes), []);
    assert.deepEqual(retainedAiExplanations([item], notes), []);
  }
});

test("legacy notes have unknown freshness and input changes require review without mutating data", () => {
  const notes = {
    "object:one": { ...accepted("object"), summaryFingerprint: undefined },
    "interface:one": accepted("interface"),
  };
  const inventory = [{ ...item, classification: "D", expertNotes: "Keep expert notes" }];
  const before = JSON.stringify({ inventory, notes });
  assert.deepEqual(aiExplanationReviewQueue(inventory, notes).map(row => row.state), ["unknown", "needs-review"]);
  assert.equal(JSON.stringify({ inventory, notes }), before);
  assert.equal(aiExplanationReviewQueue([], notes).length, 0);
});

test("review queue updates on reacceptance and ignores changes outside AI input summaries", () => {
  const changed = { ...item, classification: "C" };
  assert.equal(aiExplanationReviewQueue([changed], { "object:one": accepted("object") }).length, 1);
  assert.equal(aiExplanationReviewQueue([changed], { "object:one": accepted("object", changed) }).length, 0);
  assert.equal(aiExplanationReviewQueue([{ ...item, objectName: "Renamed", expertNotes: "Edited" }], {
    "object:one": accepted("object"),
  }).length, 0);
});
