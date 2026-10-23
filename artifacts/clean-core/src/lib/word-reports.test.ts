import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntityModels, resolveSelection, allEntities, MissingEntitiesError, scalar, NOT_PROVIDED, NOT_APPLICABLE } from "./word-reports";
import type { AiNarratives } from "./ai-narratives";

const iface = {
  id: "i1", objectName: "Z_RFC_ORDERS", objectType: "FUGR", interfaceName: "ORDERS_OUT", interfaceType: "RFC",
  sourceSystem: "PRD", targetSystem: "", classification: "C", owner: "Unassigned", package: "ZSD",
  findings: [{ source: "atc", findingId: "CC-17", level: "C", reason: "Unreleased RFC", severity: "high" }],
  highestPriorityFinding: { severity: "high" }, source: ["atc", "interfaces"],
  recommendation: { primary: { id: "api", label: "Released API" }, alternatives: [{ label: "Event mesh" }] },
  interfaceMitigation: { recommendedAction: "Switch to released OData", steps: [{ label: "Map fields" }] },
  classificationReason: { summary: "Level C because…", supportingSignals: ["Usage evidence: 3"] },
};
const obj = { id: "o1", objectName: "ZREPORT", objectType: "PROG", classification: "D", findings: [], source: ["atc"], mitigation: { foo: { bar: 1 } } };
const assessment = {
  system: "PRD", targetRelease: "S4HANA_2025", inventory: [obj, iface], integrations: [iface],
  evidenceQuality: { confidence: "medium", authority: "engine", gaps: ["No usage"] },
  provenance: { engineVersion: "1.2", generatedAt: "2025-01-01", authority: "server" },
};
const note = (text: string) => ({ text, provider: "p", model: "m", generatedAt: "g", acceptedAt: "a", summaryFingerprint: "x" });
const notes = { "object:i1": note("OBJ NOTE"), "interface:i1": note("IF NOTE") } as unknown as AiNarratives;
const evidence = [{ type: "atc", fileName: "atc.csv", count: 4, attestation: "sig", metadata: { source: "ATC", importedAt: "t", freshness: "current", coverage: 80, confidence: "high" } }];
const noVersions = async () => undefined;

test("interfaces dedupe to one interface entity with both AI explanations", async () => {
  const [e] = await buildEntityModels(assessment, [{ id: "i1", kind: "object" }, { id: "i1", kind: "interface" }], {}, notes, evidence, noVersions);
  assert.equal(e.entity_kind, "interface");
  assert.match(e.ai_explanations, /IF NOTE/); assert.match(e.ai_explanations, /OBJ NOTE/);
  assert.equal(e.owner, NOT_PROVIDED); assert.equal(e.target_system, NOT_PROVIDED);
  assert.match(e.evidence, /atc\.csv/); assert.match(e.evidence, /CC-17/); assert.match(e.evidence, /engine 1\.2/);
  assert.deepEqual(e.recommendations.map(r => r.text), ["Released API", "Alternative: Event mesh", "Complexity size: Unassessed"]);
});

test("objects use assessment system and never stringify objects", async () => {
  const [e] = await buildEntityModels(assessment, [{ id: "o1", kind: "object" }], {}, {}, evidence, noVersions);
  assert.equal(e.entity_kind, "object"); assert.equal(e.source_system, "PRD"); assert.equal(e.target_system, NOT_APPLICABLE);
  for (const v of Object.values(e)) assert.ok(!JSON.stringify(v).includes("[object Object]"));
  assert.equal(scalar({ nested: {} }), "");
});

test("missing selections are refused, all-entities is unique", async () => {
  await assert.rejects(buildEntityModels(assessment, [{ id: "gone", kind: "object" }], {}, {}, [], noVersions), MissingEntitiesError);
  assert.deepEqual(resolveSelection(assessment, [{ id: "o1", kind: "object" }, { id: "o1", kind: "object" }]).duplicates, 1);
  assert.equal(allEntities(assessment).length, 2);
});
