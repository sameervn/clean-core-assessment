import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/ai-narratives.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { aiNarrativeRows, aiNarrativeReportText, explanationSummary, summaryFingerprint } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const item = { id: "same:id", classification: "A", confidence: "high", solutionRecommendation: { primary: { id: "retain" } }, interfaceName: "Interface" };
const note = { text: "Accepted text\nmust stay unchanged.", provider: "test", model: "test", generatedAt: "2026-01-01", acceptedAt: "2026-01-02" };
const accepted = kind => ({ ...note, summaryFingerprint: summaryFingerprint(explanationSummary(kind, item)) });

test("compares object and interface summaries without mutating accepted notes", () => {
  const notes = { "object:same:id": accepted("object"), "interface:same:id": accepted("interface") };
  const before = structuredClone(notes);
  assert.deepEqual(aiNarrativeRows(notes, [item]).map(row => row.reviewStatus), ["current", "current"]);
  for (const change of [{ classification: "B" }, { confidence: "low" }, { solutionRecommendation: { primary: { id: "replace" } } }]) {
    assert.deepEqual(aiNarrativeRows(notes, [{ ...item, ...change }]).map(row => row.reviewStatus), ["needs-review", "needs-review"]);
  }
  assert.equal(aiNarrativeRows(notes, [{ ...item, objectName: "Renamed", notes: "Unrelated" }])[0].reviewStatus, "current");
  assert.deepEqual(notes, before);
});

test("legacy and missing subjects have explicit reasons, and all accepted text survives", () => {
  const notes = { "object:same:id": note, "object:removed": accepted("object"), "interface:removed": note };
  const rows = aiNarrativeRows(notes, [item]);
  assert.deepEqual(rows.map(row => row.reviewStatus), ["unknown", "needs-review", "needs-review"]);
  assert.match(rows[0].reviewReason, /No saved summary fingerprint/);
  assert.match(rows[1].reviewReason, /missing/);
  for (const row of rows) {
    assert.equal(row.text, note.text);
    assert.match(aiNarrativeReportText(row), new RegExp(`Review status: ${row.reviewStatus}`));
    assert.ok(aiNarrativeReportText(row).endsWith(note.text));
  }
  assert.deepEqual(aiNarrativeRows({}, []), []);
});

test("an interface removed from the integration scope needs review even if its object remains", () => {
  const rows = aiNarrativeRows({ "interface:same:id": accepted("interface") }, [{ ...item, interfaceName: undefined }]);
  assert.equal(rows[0].reviewStatus, "needs-review");
  assert.match(rows[0].reviewReason, /missing/);
});
