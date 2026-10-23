import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCleanCoreAssessment,
  buildCleanCoreDemoEvidence,
  type CleanCoreEvidenceSet,
} from "./clean-core-assessment";

function assessment() {
  return buildCleanCoreAssessment({
    system: "PRD",
    targetRelease: "S4HANA_2023",
    weighted: true,
    evidence: buildCleanCoreDemoEvidence("PRD", "S4HANA_2023"),
  });
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      keys.add(key.toLowerCase());
      collectKeys(child, keys);
    });
  }
  return keys;
}

test("clean core output contains no commercial or duration estimates", () => {
  const result = assessment();
  const keys = collectKeys(result);
  for (const forbidden of ["cost", "costbreakdown", "effort", "effortdays", "dayrate", "annualbtpruntime"]) {
    assert.equal(keys.has(forbidden), false, `unexpected assessment key: ${forbidden}`);
  }
  assert.deepEqual(result.totals, { objects: 4_000 });
});

test("the 4,000-object demo remains below the workspace persistence limit", () => {
  const evidence = buildCleanCoreDemoEvidence("PRD", "S4HANA_2023");
  const result = buildCleanCoreAssessment({
    system: "PRD",
    targetRelease: "S4HANA_2023",
    weighted: true,
    evidence,
  });
  const persistedWorkspace = {
    evidence,
    assessment: result,
    classificationOverrides: null,
    narratives: {},
    system: "PRD",
    targetRelease: "S4HANA_2023",
    weighted: true,
    baseline: null,
  };
  assert.ok(Buffer.byteLength(JSON.stringify(persistedWorkspace)) < 40 * 1024 * 1024);
});

test("every object has evidence-specific reasoning and mitigation", () => {
  const result = assessment();
  assert.equal(result.inventory.length, 4_000);
  for (const object of result.inventory) {
    assert.match(object.classificationExplanation, new RegExp(object.objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(object.classificationReason.summary, object.classificationExplanation);
    assert.ok(object.classificationReason.matchedRule);
    assert.ok(object.classificationReason.evidenceSource);
    assert.ok(object.classificationReason.dispositionReason);
    assert.ok(object.classificationReason.supportingSignals.length >= 3);
    assert.ok(object.mitigation.recommendedAction);
    assert.ok(object.mitigation.steps.length >= 3);
    assert.ok(object.mitigation.validation);
  }
});

test("interfaces expose drill-down context and mitigation", () => {
  const result = assessment();
  assert.ok(result.integrations.length > 100);
  for (const item of result.integrations) {
    assert.ok(item.interfaceName || item.dimension === "Integration");
    assert.ok(item.interfaceMitigation);
    assert.ok(item.interfaceMitigation.recommendedAction);
    assert.ok(item.interfaceMitigation.steps.length >= 3);
    assert.ok(item.releaseStatus);
  }
});

test("roadmap waves are ordered, actionable, and mutually exclusive", () => {
  const result = assessment();
  assert.equal(result.roadmap.waves.length, 4);
  const ids = result.roadmap.waves.flatMap((wave) => wave.objectIds);
  assert.equal(ids.length, result.inventory.length);
  assert.equal(new Set(ids).size, result.inventory.length);
  result.roadmap.waves.forEach((wave, index) => {
    assert.equal(wave.wave, index + 1);
    assert.equal(wave.count, wave.objectIds.length);
    assert.ok(wave.objective);
    assert.ok(wave.rationale);
    assert.ok(wave.prerequisites.length >= 3);
    assert.ok(wave.mitigationSteps.length >= 3);
    assert.ok(wave.expectedOutcome);
    assert.ok(wave.exitCriteria.length >= 3);
  });
});

function recommendations(evidence: CleanCoreEvidenceSet[], classificationOverrides?: Parameters<typeof buildCleanCoreAssessment>[0]["classificationOverrides"]) {
  return buildCleanCoreAssessment({
    system: "TST",
    targetRelease: "S4HANA_2023",
    weighted: false,
    evidence,
    classificationOverrides,
  });
}

test("deterministic recommendation rules cover the controlled clean-core patterns", () => {
  const common = { process: "Order to Cash", dependency: "BUSINESS_PARTNER", targetRelease: "S4HANA_2023" };
  const evidence: CleanCoreEvidenceSet[] = [
    {
      type: "object-metadata",
      rows: [
        { objectName: "Z_STANDARD", objectType: "PROG", package: "ZSD", ...common },
        { objectName: "Z_RETIRE", objectType: "PROG", package: "ZSD", ...common },
        { objectName: "Z_KEY_USER", objectType: "CLAS", package: "ZSD", ...common },
        { objectName: "Z_RELEASED_BADI", objectType: "BADI", package: "ZSD", ...common },
        { objectName: "Z_RAP_SERVICE", objectType: "CLAS", package: "ZRAP", ...common },
        { objectName: "ZBTP_CAP_APP", objectType: "CLAS", package: "ZBTP", ...common },
        { objectName: "Z_ORDER_EVENT", objectType: "CLAS", package: "ZINT", ...common },
      ],
    },
    {
      type: "usage",
      rows: [
        { objectName: "Z_STANDARD", usageCount: 20 },
        { objectName: "Z_RETIRE", usageCount: 0, telemetryCoverage: 100, collectionStart: "2026-08-01", collectionEnd: "2026-08-31" },
        { objectName: "Z_KEY_USER", usageCount: 5 },
        { objectName: "Z_RELEASED_BADI", usageCount: 10 },
        { objectName: "Z_RAP_SERVICE", usageCount: 30 },
        { objectName: "ZBTP_CAP_APP", usageCount: 40 },
        { objectName: "Z_ORDER_EVENT", usageCount: 50 },
      ],
    },
    {
      type: "atc",
      rows: [
        { objectName: "Z_STANDARD", findingId: "CLEAN_CORE_STANDARD", finding: "Released standard functionality; no extension required", status: "released" },
        { objectName: "Z_RETIRE", findingId: "CLEAN_CORE_STANDARD", finding: "Released standard functionality; no extension required", status: "released" },
        { objectName: "Z_KEY_USER", findingId: "KEY_USER", finding: "Approved key-user extension point", status: "released" },
        { objectName: "Z_RELEASED_BADI", findingId: "CLASSIC_EXTENSION", finding: "Classic BAdI must move to released BAdI", successor: "BADI_SD_RELEASED" },
        { objectName: "Z_RAP_SERVICE", findingId: "ABAP_CLOUD_RELEASE", finding: "ABAP Cloud compliant RAP managed scenario", status: "released" },
        { objectName: "ZBTP_CAP_APP", findingId: "UNRELEASED_API", finding: "Unreleased API requires side-by-side redesign" },
        { objectName: "Z_ORDER_EVENT", findingId: "EVENT_RELEASED", finding: "Released business event", status: "released" },
      ],
    },
    {
      type: "interfaces",
      rows: [
        { objectName: "Z_ORDER_EVENT", interfaceName: "Sales Order Changed", interfaceType: "Business Event", status: "released", dependency: "SAP BTP Event Mesh" },
      ],
    },
  ];
  const result = recommendations(evidence);
  const patterns = Object.fromEntries(result.inventory.map((object) => [object.objectName, object.recommendation.id]));
  assert.deepEqual(patterns, {
    ZBTP_CAP_APP: "btp-cap",
    Z_KEY_USER: "key-user",
    Z_ORDER_EVENT: "integration-suite",
    Z_RAP_SERVICE: "rap-abap-cloud",
    Z_RELEASED_BADI: "released-developer",
    Z_RETIRE: "controlled-retire",
    Z_STANDARD: "standard-retain",
  });
  for (const object of result.inventory) {
    assert.ok(object.recommendation.label);
    assert.ok(object.recommendation.description);
    assert.ok(object.recommendation.rationale);
    assert.ok(object.recommendation.reasons.length >= 2);
    assert.ok(object.recommendation.prerequisites.length >= 1);
    assert.ok(object.recommendation.suitabilitySignals.length >= 3);
    assert.ok(object.recommendation.cautions.length >= 1);
    assert.ok(object.recommendation.alternatives.length >= 1);
    assert.ok(object.recommendation.validationQuestions.length >= 1);
    assert.ok(object.recommendation.trace.rule);
  }
  assert.ok(result.solutionRollups.length >= 7);
  assert.ok(result.roadmap.waves.every((wave) => Array.isArray(wave.solutionPatterns)));
});

test("missing recommendation evidence lowers confidence and asks explicit questions", () => {
  const result = recommendations([{
    type: "atc",
    rows: [{ objectName: "Z_AMBIGUOUS", objectType: "CLAS", finding: "Released API", status: "released" }],
  }]);
  const recommendation = result.inventory[0].recommendation;
  assert.equal(recommendation.confidence, "low");
  assert.ok(recommendation.validationQuestions.some((question) => /process and owner/i.test(question)));
  assert.ok(recommendation.validationQuestions.some((question) => /dependencies/i.test(question)));
  assert.ok(recommendation.validationQuestions.some((question) => /runtime window/i.test(question)));
  assert.ok(recommendation.validationQuestions.some((question) => /inbound\/outbound/i.test(question)));
});

test("empty evidence rows do not imply zero usage, interface coverage, or released status", () => {
  const result = recommendations([
    {
      type: "object-metadata",
      rows: [{ objectName: "Z_EMPTY_EVIDENCE", objectType: "PROG", process: "Order to Cash", dependency: "BUSINESS_PARTNER" }],
    },
    { type: "usage", rows: [{ objectName: "Z_EMPTY_EVIDENCE" }] },
    { type: "interfaces", rows: [{ objectName: "Z_EMPTY_EVIDENCE" }] },
    {
      type: "atc",
      rows: [{ objectName: "Z_EMPTY_EVIDENCE", findingId: "UNRELEASED_API", finding: "Unreleased API requires redesign" }],
    },
  ]);
  const object = result.inventory[0];
  assert.equal(object.disposition, "redesign");
  assert.equal(object.recommendation.confidence, "low");
  assert.ok(object.recommendation.validationQuestions.some((question) => /runtime window/i.test(question)));
  assert.ok(object.recommendation.validationQuestions.some((question) => /inbound\/outbound/i.test(question)));
  assert.ok(object.recommendation.validationQuestions.some((question) => /released for the target release/i.test(question)));
});

test("successor candidates and unsuitable release statuses cannot produce high confidence", () => {
  for (const releaseStatuses of [
    ["unknown"],
    ["unreleased"],
    ["non-compliant"],
    ["not supported"],
    ["not compatible"],
    ["released", "unreleased"],
  ]) {
    const result = recommendations([
      {
        type: "object-metadata",
        rows: [{
          objectName: "Z_RELEASE_REVIEW",
          objectType: "CLAS",
          process: "Order to Cash",
          dependency: "BUSINESS_PARTNER",
        }],
      },
      { type: "usage", rows: [{ objectName: "Z_RELEASE_REVIEW", usageCount: 12 }] },
      {
        type: "atc",
        rows: [{
          objectName: "Z_RELEASE_REVIEW",
          finding: "Candidate successor requires release validation",
          successor: "CANDIDATE_API",
          status: releaseStatuses[0],
        }],
      },
      ...(releaseStatuses.length > 1 ? [{
        type: "readiness-check" as const,
        rows: [{
          objectName: "Z_RELEASE_REVIEW",
          finding: "Conflicting target-release evidence",
          releaseStatus: releaseStatuses[1],
        }],
      }] : []),
      {
        type: "interfaces",
        rows: [{
          objectName: "Z_RELEASE_REVIEW",
          interfaceName: "Candidate API",
          interfaceType: "OData V4",
          sourceSystem: "SAP",
          targetSystem: "CRM",
        }],
      },
    ]);
    const recommendation = result.inventory[0].recommendation;
    assert.notEqual(recommendation.confidence, "high", releaseStatuses.join(" / "));
    assert.ok(
      recommendation.validationQuestions.some((question) => /released target contract|released for the target release/i.test(question)),
      releaseStatuses.join(" / "),
    );
  }
});

test("override commentary does not replace imported recommendation signals", () => {
  const evidence: CleanCoreEvidenceSet[] = [{
    type: "atc",
    rows: [{
      objectName: "Z_STANDARD_OVERRIDE",
      objectType: "PROG",
      findingId: "CLEAN_CORE_STANDARD",
      finding: "Released standard functionality; no extension required",
      status: "released",
    }],
  }];
  const baseline = recommendations(evidence);
  const overridden = recommendations(evidence, [{
    objectPattern: "Z_STANDARD_OVERRIDE",
    level: "A",
    reason: "Reviewed and approved",
  }]);
  assert.equal(baseline.inventory[0].recommendation.id, "standard-retain");
  assert.equal(overridden.inventory[0].recommendation.id, "standard-retain");
});

test("classification overrides remain visible in recommendation traces", () => {
  const result = recommendations([
    {
      type: "atc",
      rows: [{ objectName: "Z_OVERRIDE", objectType: "PROG", findingId: "CLEAN_CORE_STANDARD", finding: "Released standard functionality", status: "released" }],
    },
    {
      type: "usage",
      rows: [{ objectName: "Z_OVERRIDE", objectType: "PROG", usageCount: 12 }],
    },
  ], [{ objectPattern: "Z_OVERRIDE", level: "D", reason: "Architecture review exception" }]);
  const object = result.inventory[0];
  assert.equal(object.classification, "D");
  assert.equal(object.recommendation.trace.override.applied, true);
  assert.equal(object.recommendation.trace.override.originalLevel, "A");
  assert.match(object.recommendation.trace.override.originalReason, /Released standard functionality/);
  assert.equal(object.recommendation.trace.override.reason, "Architecture review exception");
});

test("bulk classification overrides remain below the workspace persistence limit", () => {
  const evidence = buildCleanCoreDemoEvidence("PRD", "S4HANA_2023");
  const result = buildCleanCoreAssessment({
    system: "PRD",
    targetRelease: "S4HANA_2023",
    weighted: true,
    evidence,
    classificationOverrides: [{
      objectPattern: "ZFI*",
      level: "D",
      reason: "Architecture review exception",
    }],
  });
  const persistedWorkspace = {
    evidence,
    assessment: result,
    classificationOverrides: [{
      objectPattern: "ZFI*",
      level: "D",
      reason: "Architecture review exception",
    }],
    narratives: {},
    system: "PRD",
    targetRelease: "S4HANA_2023",
    weighted: true,
    baseline: null,
  };
  assert.ok(Buffer.byteLength(JSON.stringify(persistedWorkspace)) < 40 * 1024 * 1024);
});