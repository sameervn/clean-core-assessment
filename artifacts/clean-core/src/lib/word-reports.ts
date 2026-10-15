import { apiFetch, apiJson, readApiError } from "./api";
import { aiNarrativeRows, aiNarrativeReportText, type AiNarratives } from "./ai-narratives";
import { exportSourceVersions } from "./source-versions";

export const NOT_PROVIDED = "Not provided";
export const NOT_APPLICABLE = "Not applicable";
export const MAX_RENDER_ENTITIES = 50;
export const SAMPLE_TEMPLATE_ID = "sample";

export interface ReportTemplate { id: string; name: string; version: number; previewed: boolean; active: boolean }
export interface TemplateList { templates: ReportTemplate[]; activeId: string | null; configured: boolean }
export interface TemplateReference { fields: string[]; rowFields: { findings: string[]; recommendations: string[] }; limits: string[]; syntax: string }

export interface ReportEntity {
  entity_id: string; entity_kind: "object" | "interface"; entity_name: string; entity_type: string; package: string; owner: string;
  source_system: string; target_system: string; target_release: string; classification: string; severity: string;
  rationale: string; mitigation: string; evidence: string; notes: string; ai_explanations: string;
  findings: Array<{ text: string; severity: string }>;
  recommendations: Array<{ text: string }>;
}

export type EntityKind = "object" | "interface";
export interface EntitySelection { id: string; kind: EntityKind }

/** Engine placeholders for absent metadata are not real values. */
const PLACEHOLDERS = new Set(["", "unassigned", "unmapped", "unknown", "n/a", "null", "undefined", "[object object]"]);
/** Never emits "[object Object]": objects are reduced to a readable label or dropped. */
export function scalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean).join("; ");
  const o = value as any;
  return scalar(o.label ?? o.summary ?? o.reason ?? o.description ?? o.text ?? o.name ?? o.id ?? "");
}
export function text(value: unknown, missing = NOT_PROVIDED): string {
  const s = scalar(value).trim();
  return PLACEHOLDERS.has(s.toLowerCase()) ? missing : s;
}
function list(value: unknown): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map(scalar).map(s => s.trim()).filter(s => s && !PLACEHOLDERS.has(s.toLowerCase()));
}
export function isInterfaceItem(item: any) { return !!(item?.interfaceName || item?.dimension === "Integration"); }

function itemIndex(assessment: any) {
  const byId = new Map<string, any>();
  for (const item of assessment?.inventory || []) byId.set(item.id, item);
  for (const item of assessment?.integrations || []) byId.set(item.id, { ...byId.get(item.id), ...item });
  return byId;
}

/** Every unique entity in inventory + integrations (interfaces once, as interfaces). */
export function allEntities(assessment: any): EntitySelection[] {
  return [...itemIndex(assessment).values()].map(item => ({ id: item.id, kind: isInterfaceItem(item) ? "interface" : "object" }));
}

/**
 * Unique, ordered selection. An item in both inventory and integrations is reported once —
 * as an interface when it qualifies. Selections no longer in the assessment are returned
 * in `missing` so callers can refuse rather than silently skip them.
 */
export function resolveSelection(assessment: any, requested: EntitySelection[]): { entities: EntitySelection[]; missing: string[]; duplicates: number } {
  const byId = itemIndex(assessment);
  const out = new Map<string, EntitySelection>();
  const missing: string[] = []; let duplicates = 0;
  for (const sel of requested) {
    const item = byId.get(sel.id);
    if (!item) { if (!missing.includes(sel.id)) missing.push(sel.id); continue; }
    if (out.has(sel.id)) { duplicates++; continue; }
    out.set(sel.id, { id: sel.id, kind: isInterfaceItem(item) ? "interface" : "object" });
  }
  return { entities: [...out.values()], missing, duplicates };
}
export function dedupeSelection(assessment: any, requested: EntitySelection[]) { return resolveSelection(assessment, requested).entities; }

export class MissingEntitiesError extends Error {
  constructor(public missing: string[]) {
    super(`${missing.length} selected item(s) are no longer in the current assessment (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}). Clear or refresh your selection, then export again.`);
  }
}

function mitigationText(m: any): string {
  if (!m || typeof m !== "object") return text(m);
  const parts = [
    text(m.recommendedAction, ""), text(m.summary, ""),
    m.targetPattern ? `Target pattern: ${scalar(m.targetPattern)}` : "",
    ...list(m.steps).map(s => `- ${s}`),
    m.validation ? `Validation: ${scalar(m.validation)}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : NOT_PROVIDED;
}

export interface ReportContext {
  system?: string;
  targetRelease: string;
  narratives: Record<string, string>;
  aiRows: ReturnType<typeof aiNarrativeRows>;
  evidence?: Array<{ type: string; fileName?: string; count?: number; attestation?: string; metadata?: any }>;
  evidenceQuality?: any;
  provenance?: any;
}

function evidenceLines(item: any, ctx: ReportContext): string[] {
  const reason = item.classificationReason;
  const sources: string[] = Array.isArray(item.source) ? item.source.map(scalar).filter(Boolean) : [];
  const lines: string[] = [];
  lines.push(...list(reason?.supportingSignals));
  const refs = (Array.isArray(item.findings) ? item.findings : []).map((f: any) =>
    [scalar(f.source), scalar(f.findingId), f.offendingSapObject ? `offending ${scalar(f.offendingSapObject)}` : ""].filter(Boolean).join(" · "),
  ).filter(Boolean);
  if (refs.length) lines.push(`Source references: ${[...new Set(refs)].join("; ")}`);
  if (sources.length) lines.push(`Evidence source types: ${sources.join(", ")}`);
  const files = (ctx.evidence || []).filter(e => !sources.length || sources.includes(e.type));
  for (const e of files) {
    const m = e.metadata || {};
    lines.push(`Evidence file: ${text(e.fileName)} (${e.type}; ${e.count ?? 0} rows; source ${text(m.source)}; imported ${text(m.importedAt)}; freshness ${text(m.freshness)}; coverage ${m.coverage ?? NOT_PROVIDED}; confidence ${text(m.confidence)}; attestation ${e.attestation ? "server-attested" : "not attested"})`);
  }
  const q = ctx.evidenceQuality;
  if (q) {
    lines.push(`Overall evidence confidence: ${text(q.confidence)}; authority: ${text(q.authority)}`);
    const gaps = list(q.gaps); if (gaps.length) lines.push(`Evidence gaps: ${gaps.join("; ")}`);
  }
  const p = ctx.provenance;
  if (p) lines.push(`Assessment provenance: engine ${text(p.engineVersion)}; generated ${text(p.generatedAt)}; authority ${text(p.authority)}`);
  return lines;
}

export function buildEntityModel(item: any, kind: EntityKind, ctx: ReportContext): ReportEntity {
  const rec = item.solutionRecommendation || item.recommendation;
  const isIf = kind === "interface";
  const mitigation = isIf ? item.interfaceMitigation || item.mitigation : item.mitigation;
  // Accepted-only AI notes; an interface keeps both its object:id and interface:id explanations.
  const subjects = isIf ? [`interface:${item.id}`, `object:${item.id}`] : [`object:${item.id}`];
  const ai = subjects.flatMap(s => ctx.aiRows.filter(n => n.subject === s)).map(aiNarrativeReportText);
  const findings = (Array.isArray(item.findings) ? item.findings : []).map((f: any) => {
    const head = [scalar(f.source) || "evidence", scalar(f.findingId)].filter(Boolean).join(" · ");
    const body = scalar(f.reason) || scalar(f.category);
    return { text: text(`${head}${f.level ? ` (Level ${scalar(f.level)})` : ""}${body ? `: ${body}` : ""}`), severity: text(f.severity) };
  });
  const primary = rec?.primary ? scalar(rec.primary) : scalar(rec?.label);
  const recs = [primary, ...list(rec?.alternatives).map(a => `Alternative: ${a}`)].filter(Boolean).map(t => ({ text: t }));
  const evidence = evidenceLines(item, ctx);
  const system = text(ctx.system || item.system);
  return {
    entity_id: text(item.id),
    entity_kind: isIf ? "interface" : "object",
    entity_name: text(isIf ? item.interfaceName || item.objectName : item.objectName),
    entity_type: text(isIf ? item.interfaceType || item.objectType : item.objectType),
    package: text(item.package),
    owner: text(item.owner),
    source_system: isIf ? text(item.sourceSystem) : system,
    target_system: isIf ? text(item.targetSystem) : NOT_APPLICABLE,
    target_release: text(ctx.targetRelease?.replace("S4HANA_", "S/4HANA ")),
    classification: item.classification ? `Level ${scalar(item.classification)}` : NOT_PROVIDED,
    severity: text(item.highestPriorityFinding?.severity),
    rationale: text(item.classificationReason?.summary || item.classificationExplanation),
    mitigation: mitigationText(mitigation),
    evidence: evidence.length ? evidence.join("\n") : NOT_PROVIDED,
    notes: text(ctx.narratives[item.id]),
    ai_explanations: ai.length ? ai.join("\n\n") : NOT_APPLICABLE,
    findings: findings.length ? findings : [{ text: NOT_PROVIDED, severity: NOT_APPLICABLE }],
    recommendations: recs.length ? recs : [{ text: NOT_PROVIDED }],
  };
}

export async function buildEntityModels(assessment: any, selection: EntitySelection[], narratives: Record<string, string>, aiNarratives: AiNarratives, evidence?: ReportContext["evidence"], versionsFn = exportSourceVersions): Promise<ReportEntity[]> {
  const { entities, missing } = resolveSelection(assessment, selection);
  if (missing.length) throw new MissingEntitiesError(missing);
  const versions = await versionsFn(aiNarratives);
  const aiRows = aiNarrativeRows(aiNarratives, assessment.inventory, assessment.targetRelease, versions);
  const byId = itemIndex(assessment);
  const ctx: ReportContext = { system: assessment.system, targetRelease: assessment.targetRelease, narratives, aiRows, evidence, evidenceQuality: assessment.evidenceQuality, provenance: assessment.provenance };
  return entities.map(sel => buildEntityModel(byId.get(sel.id), sel.kind, ctx));
}

// ---------- API ----------
const BASE = "/api/report-templates";
export class ReportApiError extends Error { constructor(message: string, public status: number) { super(message); } }

async function ensureOk(res: Response, fallback: string) {
  if (!res.ok) throw new ReportApiError(res.status === 403 ? await readApiError(res, "Your account is not permitted to do this") : await readApiError(res, fallback), res.status);
  return res;
}
export const fetchTemplates = (signal?: AbortSignal) => apiJson<TemplateList>(BASE, { signal, cache: "no-store" });
export const fetchReference = (signal?: AbortSignal) => apiJson<TemplateReference>(`${BASE}/reference`, { signal });

export function filenameFrom(res: Response, fallback: string) {
  const cd = res.headers.get("Content-Disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain?.[1] || fallback;
}

/** Streams the body so callers can report progress; respects abort. */
export async function readBlob(res: Response, onProgress?: (fraction: number | null) => void): Promise<Blob> {
  const total = Number(res.headers.get("Content-Length")) || 0;
  if (!res.body) return res.blob();
  const reader = res.body.getReader();
  const chunks: BlobPart[] = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as unknown as BlobPart); got += value.byteLength;
    onProgress?.(total ? got / total : null);
  }
  return new Blob(chunks, { type: res.headers.get("Content-Type") || "application/octet-stream" });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadFrom(path: string, init: RequestInit & { json?: unknown }, fallbackName: string, opts: { signal?: AbortSignal; onProgress?: (f: number | null) => void; fallbackError: string }) {
  const { json, ...rest } = init;
  const res = await apiFetch(path, {
    ...rest, signal: opts.signal,
    headers: json !== undefined ? { "Content-Type": "application/json" } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  await ensureOk(res, opts.fallbackError);
  const blob = await readBlob(res, opts.onProgress);
  if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  return { blob, filename: filenameFrom(res, fallbackName) };
}

export async function uploadTemplate(file: File, meta: { name: string; replaceId?: string; expectedVersion?: number }, signal?: AbortSignal): Promise<ReportTemplate> {
  const { id, uploadUrl } = await apiJson<{ id: string; uploadUrl: string }>(`${BASE}/uploads`, {
    method: "POST", signal, json: { name: meta.name, filename: file.name, ...(meta.replaceId ? { replaceId: meta.replaceId, expectedVersion: meta.expectedVersion } : {}) },
  });
  // Signed storage URL: no session cookie or CSRF header.
  const put = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": "application/octet-stream" }, signal });
  if (!put.ok) throw new ReportApiError(`Upload to storage failed (HTTP ${put.status})`, put.status);
  return apiJson<ReportTemplate>(`${BASE}/uploads/${encodeURIComponent(id)}/process`, { method: "POST", json: {}, signal });
}
export const patchTemplate = (id: string, body: { name?: string; active?: true; expectedVersion: number }) =>
  apiJson<ReportTemplate>(`${BASE}/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
export async function deleteTemplate(id: string, expectedVersion: number) {
  const res = await apiFetch(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion }) });
  await ensureOk(res, "Could not delete template");
}
export const isAbort = (e: unknown) => (e as any)?.name === "AbortError";
