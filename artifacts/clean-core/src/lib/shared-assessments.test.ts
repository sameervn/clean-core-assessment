import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPublishEntities, buildPublishEntity, importKeyFor, publishBody, normalizeContent, sameSnapshot, MAX_PUBLISH_ENTITIES } from "./shared-assessments";

const assessment = {
  system: "PRD", targetRelease: "S4HANA_2025",
  inventory: [{ id: "o1", objectName: "ZPROG", classification: "C", disposition: "refactor", complexity: 22,
    classificationReason: { summary: "Uses unreleased API" },
    solutionRecommendation: { primary: { label: "Released API", description: "Swap to I_Product" }, rationale: ["r1"], reasons: ["x"], prerequisites: ["p1", "p2"], cautions: "c", alternatives: [{ label: "BTP" }], validationQuestions: ["q?"], confidence: "high" },
    mitigation: { recommendedAction: "Refactor", steps: ["a", "b"], validation: "ATC clean" } }],
  integrations: [{ id: "i1", interfaceName: "ORDERS", dimension: "Integration", classification: "X" }],
};

test("maps all content as strings without losing text", () => {
  const [o, i] = buildPublishEntities(assessment, { o1: "Expert says hi" });
  assert.equal(o.key, "object:o1"); assert.equal(i.kind, "interface");
  assert.equal(o.content.classification, "C"); assert.equal(o.content.disposition, "refactor"); assert.equal(o.content.complexitySize, "L");
  assert.equal(o.content.narrative, "Expert says hi");
  assert.match(o.content.recommendation, /Released API\nSwap to I_Product/);
  assert.match(o.content.recommendationRationale, /r1[\s\S]*x[\s\S]*high/);
  assert.equal(o.content.prerequisites, "p1\np2"); assert.equal(o.content.alternatives, "BTP");
  assert.match(o.content.mitigation, /Refactor\n- a\n- b/); assert.equal(o.content.mitigationValidation, "ATC clean");
  assert.equal(i.content.classification, null); assert.equal(i.content.complexitySize, null);
  for (const v of Object.entries(i.content)) if (!["classification", "disposition", "complexitySize"].includes(v[0])) assert.equal(typeof v[1], "string");
  assert.equal(o.evidence, assessment.inventory[0]);
});

test("enforces limits", () => {
  assert.throws(() => publishBody("k", "n", "PRD", []));
  const many = Array.from({ length: MAX_PUBLISH_ENTITIES + 1 }, (_, n) => ({ key: `object:${n}`, kind: "object" as const, name: "x", content: normalizeContent({}), evidence: {} }));
  assert.throws(() => publishBody("k", "n", "PRD", many), /5,000/);
});

test("direct submission uses the same identity and generated fields with empty optional notes", async () => {
  const all = buildPublishEntities(assessment, {});
  for (const kind of ["object", "interface"] as const) {
    const item = kind === "object" ? assessment.inventory[0] : assessment.integrations[0];
    const selected = buildPublishEntity(item, kind);
    assert.deepEqual(selected, all.find(e => e.kind === kind));
    assert.equal(selected.content.narrative, "");
  }
  assert.equal(await importKeyFor(assessment), await importKeyFor(structuredClone(assessment)));
  assert(sameSnapshot({ x: { a: 1, b: 2 }, notes: "" }, { notes: "", x: { b: 2, a: 1 } }));
  assert(!sameSnapshot({ narrative: "" }, { narrative: "unsaved" }));
  assert(!sameSnapshot([1, 2], [2, 1]));
});
