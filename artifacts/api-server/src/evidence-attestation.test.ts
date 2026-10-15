import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { attestEvidenceValue, verifyEvidenceAttestation } from "./evidence-attestation";

process.env.SESSION_SECRET = "test-only-attestation-secret";

test("canonical evidence attestations survive object key reordering", () => {
  const original = { type: "atc", rows: [{ z: 1, a: "two" }], metadata: { importedAt: "now", count: 1 } };
  const reordered = { metadata: { count: 1, importedAt: "now" }, rows: [{ a: "two", z: 1 }], type: "atc" };
  const attestation = attestEvidenceValue(original);

  assert.equal(verifyEvidenceAttestation(reordered, attestation), true);
});

test("legacy insertion-order attestations remain importable from browser storage", () => {
  const legacyValue = { type: "atc", rows: [{ z: 1, a: "two" }], metadata: { importedAt: "now", count: 1 } };
  const legacyAttestation = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(JSON.stringify(legacyValue))
    .digest("hex");

  assert.equal(verifyEvidenceAttestation(legacyValue, legacyAttestation), true);
});

test("tampered evidence is rejected", () => {
  const original = { type: "atc", rows: [{ id: "A" }], metadata: { count: 1 } };
  const attestation = attestEvidenceValue(original);

  assert.equal(
    verifyEvidenceAttestation({ ...original, rows: [{ id: "B" }] }, attestation),
    false,
  );
});