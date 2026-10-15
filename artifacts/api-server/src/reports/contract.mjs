export const fields = ["entity_id", "entity_kind", "entity_name", "entity_type", "package", "owner", "source_system", "target_system", "target_release", "classification", "severity", "rationale", "mitigation", "evidence", "notes", "ai_explanations"];
export const rowFields = { findings: ["text", "severity"], recommendations: ["text"] };
export const limits = [
  "DOCX only: 4 MB compressed, 20 MB expanded, 300 entries, 2 MB per XML part, 1,000 tags.",
  "Required tags: {entity_id} and {entity_kind}. Only the documented literal tags are supported; no expressions, conditions or raw XML.",
  "Text, tables, headers, footers, styles and embedded PNG/JPEG images are retained. Tags split across Word text runs are supported.",
  "Loops cannot nest. Use {#findings}{text} ({severity}){/findings} or {#recommendations}{text}{/recommendations} in one table row or paragraph.",
  "No macros, encryption, embedded objects, external links/images, fields, content controls, tracked changes, charts or custom XML. Remove these before upload.",
  "Up to 50 unique entities, 200 rows per collection, 20 seconds and 40 MB output per batch. A failed batch produces no archive.",
];
export const reference = { fields, rowFields, limits, syntax: "Use {field_name}. Missing values read Not provided; inapplicable fields read Not applicable. Download and inspect a fictional populated preview before activation." };
export const example = {
  ...Object.fromEntries(fields.map(f => [f, "Not provided"])),
  entity_id: "EXAMPLE_ONLY", entity_kind: "object", entity_name: "Fictional example — not an assessment",
  entity_type: "PROG", package: "Z_EXAMPLE", source_system: "Example source",
  target_system: "Not applicable", target_release: "S4HANA_2025", classification: "Example classification",
  notes: "Sample literal text: <review> & {not_a_tag}.", ai_explanations: "No accepted AI explanation.",
  findings: [{ text: "Example finding one", severity: "Example high" }, { text: "Example finding two", severity: "Example low" }],
  recommendations: [{ text: "Example recommendation — validate against actual evidence." }],
};
