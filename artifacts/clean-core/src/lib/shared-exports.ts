import { FIELD_LABELS, TEXT_FIELDS, normalizeContent, type SharedDetail, type SharedEntity, type TextField } from "./shared-assessments";
import { csvCell } from "./csv";
import { saveBlob } from "./word-reports";

/**
 * Current (not sealed) exports, built ONLY from server-returned latest entity content.
 * Edited content and the immutable published evidence are kept in separate, labelled columns;
 * edited fields are never merged back into or replaced by raw evidence.
 */
export function stateLabel(state: string) {
  const k = String(state || "").toLowerCase();
  if (k === "approved") return "Approved";
  if (k === "submitted") return "Submitted";
  if (k.includes("change")) return "Changes requested (Draft)";
  return "Draft";
}

const sourceText = (e: SharedEntity) => (Array.isArray(e.sources) ? e.sources : []).map((s: any) => `${s?.repository ?? ""}@${s?.commit ?? ""}:${s?.path ?? ""}`).join("; ");

export function sharedRows(detail: SharedDetail) {
  return detail.entities.map(e => {
    const c = normalizeContent(e.content);
    return {
      state: stateLabel(e.state), assessment: detail.assessment.name, assessmentId: String(detail.assessment.id),
      entityId: String(e.id), entityKey: e.entity_key, kind: e.kind, name: e.name, version: e.version,
      submitterId: e.submitter_id == null ? "" : String(e.submitter_id), reviewerId: e.reviewer_id == null ? "" : String(e.reviewer_id),
      classification: c.classification ?? "", disposition: c.disposition ?? "", complexitySize: c.complexitySize ?? "Unassessed",
      ...Object.fromEntries(TEXT_FIELDS.map(f => [f, c[f]])) as Record<TextField, string>,
      sourceProvenance: sourceText(e),
      publishedEvidence: JSON.stringify(e.evidence ?? null),
    };
  });
}
type Row = ReturnType<typeof sharedRows>[number];
const COLUMNS: Array<[keyof Row & string, string]> = [
  ["state", "State"], ["assessment", "Assessment"], ["assessmentId", "Assessment ID"], ["entityId", "Record ID"], ["entityKey", "Entity key"],
  ["kind", "Kind"], ["name", "Name"], ["version", "Version"], ["submitterId", "Submitter ID"], ["reviewerId", "Reviewer ID"],
  ["classification", FIELD_LABELS.classification], ["disposition", FIELD_LABELS.disposition], ["complexitySize", FIELD_LABELS.complexitySize],
  ...TEXT_FIELDS.map(f => [f, FIELD_LABELS[f]] as [any, string]),
  ["sourceProvenance", "Mapped source (repository@commit:path)"], ["publishedEvidence", "Published evidence (immutable JSON)"],
];

const base = (d: SharedDetail) => `shared-${String(d.assessment.name).replace(/[^\w.-]+/g, "_").slice(0, 50)}-current`;
const stamp = () => new Date().toISOString();

export function downloadSharedCsv(d: SharedDetail) {
  const rows = sharedRows(d);
  const body = [COLUMNS.map(([, l]) => csvCell(l)).join(","), ...rows.map(r => COLUMNS.map(([k]) => csvCell(r[k])).join(","))].join("\n");
  saveBlob(new Blob([body], { type: "text/csv;charset=utf-8" }), `${base(d)}.csv`);
}

export function downloadSharedJson(d: SharedDetail) {
  const out = {
    kind: "clean-core-shared-assessment-current", note: "Latest server content; not a sealed approval.", exportedAt: stamp(),
    assessment: d.assessment,
    records: d.entities.map(e => ({
      state: stateLabel(e.state), rawState: e.state, id: e.id, entityKey: e.entity_key, kind: e.kind, name: e.name, version: e.version,
      submitterId: e.submitter_id, reviewerId: e.reviewer_id, content: normalizeContent(e.content), sources: e.sources ?? [], publishedEvidence: e.evidence,
    })),
  };
  saveBlob(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), `${base(d)}.json`);
}

export async function downloadSharedExcel(d: SharedDetail) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const rows = sharedRows(d);
  const header = COLUMNS.map(([, l]) => ({ value: l, fontWeight: "bold" as const }));
  const data = rows.map(r => COLUMNS.map(([k]) => ({ value: String(r[k] ?? ""), type: String })));
  const info = [[{ value: "Assessment", fontWeight: "bold" as const }, { value: String(d.assessment.name), type: String }], [{ value: "Exported", fontWeight: "bold" as const }, { value: stamp(), type: String }], [{ value: "Note", fontWeight: "bold" as const }, { value: "Latest server content per record; State column shows Draft / Submitted / Approved. Not a sealed approval.", type: String }]];
  const blob = await writeExcelFile([{ data: info as any, sheet: "About" }, { data: [header, ...data] as any, sheet: "Records" }] as any).toBlob();
  saveBlob(blob, `${base(d)}.xlsx`);
}

export async function downloadSharedPdf(d: SharedDetail) {
  const [{ PDFDocument, rgb }, { createPdfText }, { default: fontUrl }, scriptFonts] = await Promise.all([
    import("pdf-lib"), import("./pdf-text"), import("@fontsource/unifont/files/unifont-latin-400-normal.woff?url"),
    import("./pdf-fonts").then(m => m.loadPdfScriptFonts()),
  ]);
  const res = await fetch(fontUrl);
  if (!res.ok) throw new Error("Could not load the PDF Unicode font. Please retry");
  const doc = await PDFDocument.create();
  const pdf = await createPdfText(doc, new Uint8Array(await res.arrayBuffer()), scriptFonts);
  const W = 595, H = 842, M = 44, LH = 12;
  let page = doc.addPage([W, H]); let y = H - M;
  const ensure = (need: number) => { if (y - need < M) { page = doc.addPage([W, H]); y = H - M; } };
  const para = (value: string, size = 9, strong = false, color = rgb(0.1, 0.15, 0.2)) => {
    for (const line of pdf.wrapLines(value || "Not provided", W - 2 * M, size)) { ensure(LH); pdf.drawLine(page, line, { x: M, y, size, strong, color }); y -= size + 3; }
  };
  para(`Shared assessment (current content): ${d.assessment.name}`, 15, true);
  para(`${d.assessment.system} · ${d.assessment.target_release} · exported ${stamp()} · not a sealed approval`, 9, false, rgb(0.35, 0.4, 0.48));
  y -= 8;
  for (const r of sharedRows(d)) {
    ensure(60); y -= 6;
    para(`[${r.state.toUpperCase()}] ${r.name}`, 12, true);
    para(`${r.kind} · ${r.entityKey} · record ${r.entityId} · version ${r.version} · submitter ${r.submitterId || "-"} · reviewer ${r.reviewerId || "-"}`, 8, false, rgb(0.35, 0.4, 0.48));
    para(`Classification: ${r.classification || "Not set"}   Disposition: ${r.disposition || "Not set"}   Complexity size: ${r.complexitySize}`, 9, true);
    for (const f of TEXT_FIELDS) { para(FIELD_LABELS[f], 8, true, rgb(0.3, 0.36, 0.44)); para(r[f]); }
    para("Mapped source", 8, true, rgb(0.3, 0.36, 0.44)); para(r.sourceProvenance || "None");
  }
  const bytes = await doc.save();
  saveBlob(new Blob([Uint8Array.from(bytes).buffer], { type: "application/pdf" }), `${base(d)}.pdf`);
}

export async function downloadSharedPowerPoint(d: SharedDetail) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const deck = new PptxGenJS(); deck.layout = "LAYOUT_WIDE";
  deck.title = `${d.assessment.name} — current saved assessment`;
  for (const r of sharedRows(d)) {
    const text = [
      `${r.kind} · ${r.entityKey} · version ${r.version} · ${r.state}`,
      `Classification: ${r.classification || "Unassessed"} · Complexity: ${r.complexitySize} · Disposition: ${r.disposition || "Unassessed"}`,
      ...TEXT_FIELDS.map(f => `${FIELD_LABELS[f]}\n${r[f] || "Not provided"}`),
      `Source provenance\n${r.sourceProvenance || "None"}`,
    ].join("\n\n");
    for (let offset = 0; offset < text.length; offset += 1400) {
      const slide = deck.addSlide();
      slide.addText(`${r.name} — ${stateLabel(r.state)}`, { x: .5, y: .35, w: 12.3, h: .6, fontSize: 22, bold: true, color: "003F84" });
      slide.addText(text.slice(offset, offset + 1400), { x: .5, y: 1.1, w: 12.3, h: 5.6, fontSize: 14, breakLine: false, fit: "shrink", valign: "top" });
      slide.addText("Current saved content — not a sealed approval", { x: .5, y: 7, w: 12.3, h: .2, fontSize: 9 });
    }
  }
  const bytes = await deck.write({ outputType: "blob" });
  saveBlob(bytes as Blob, `${base(d)}.pptx`);
}
