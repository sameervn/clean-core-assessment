import { fields } from "../reports/contract.mjs";

/** Only immutable server-saved content enters approved reports. */
export function reportModel(row: any) {
  const c = row.content;
  const original = row.evidence?.snapshot ?? {};
  const model: Record<string, unknown> = Object.fromEntries(fields.map(f => [f, "Not provided"]));
  const evidence = JSON.stringify({ importedEvidence: row.evidence, sources: row.sources.map(({ objectPath: _, ...s }: any) => s) });
  return {
    ...model, entity_id: `${row.kind}:${row.entity_key}:v${row.version}`, entity_kind: row.kind, entity_name: row.name,
    entity_type: String(original.objectType ?? original.interfaceType ?? "Not provided"),
    package: String(original.package ?? "Not applicable"), owner: String(original.owner ?? "Not provided"),
    source_system: row.system, target_system: String(original.targetSystem ?? "Not applicable"),
    target_release: row.targetRelease, classification: c.classification ?? "Unassessed",
    rationale: c.classificationExplanation, notes: `${c.narrative}\n\nApproved revision ${row.version} by ${row.approvedBy} at ${row.approvedAt}.`,
    complexity: c.complexitySize ?? "Unassessed",
    mitigation: `${c.mitigation}\nValidation: ${c.mitigationValidation}`,
    evidence: evidence.length > 38_000 ? `${evidence.slice(0, 38_000)}\n[Evidence excerpt truncated for Word output. Full evidence is retained in the immutable server approval snapshot.]` : evidence,
    findings: [{ text: c.classificationExplanation || "Unassessed", severity: "Reviewed assessment" }],
    recommendations: [
      c.recommendation, c.recommendationRationale, `Disposition: ${c.disposition ?? "Unassessed"}`,
      `Complexity: ${c.complexitySize ?? "Unassessed"}`, `Prerequisites: ${c.prerequisites}`,
      `Cautions: ${c.cautions}`, `Alternatives: ${c.alternatives}`, `Validation questions: ${c.validationQuestions}`,
    ].map(text => ({ text })),
  };
}
