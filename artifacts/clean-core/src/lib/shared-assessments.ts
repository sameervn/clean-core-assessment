import { apiFetch, apiJson, readApiError } from "./api";
import { complexitySize, itemComplexitySize, type ComplexitySize } from "./complexity-size";
import { isInterfaceItem, scalar } from "./word-reports";

export const BASE = "/api/shared-assessments";
export const MAX_PUBLISH_ENTITIES = 5000;
export const MAX_PUBLISH_BYTES = 8_000_000;
export const MAX_COMPANY_TEMPLATE_BYTES = 4_000_000;
export const MAX_APPROVAL_BATCH = 50;

export type Classification = "A" | "B" | "C" | "D";
export type Disposition = "keep" | "retire" | "refactor" | "redesign" | "move-to-btp";
export const CLASSIFICATIONS: Classification[] = ["A", "B", "C", "D"];
export const DISPOSITIONS: Disposition[] = ["keep", "retire", "refactor", "redesign", "move-to-btp"];
export type Access = "read" | "edit" | "review";

export interface SharedContent {
  classification: Classification | null;
  classificationExplanation: string;
  disposition: Disposition | null;
  narrative: string;
  complexitySize: ComplexitySize | null;
  recommendation: string;
  recommendationRationale: string;
  prerequisites: string;
  cautions: string;
  alternatives: string;
  validationQuestions: string;
  mitigation: string;
  mitigationValidation: string;
}
export const TEXT_FIELDS = ["classificationExplanation", "narrative", "recommendation", "recommendationRationale", "prerequisites", "cautions", "alternatives", "validationQuestions", "mitigation", "mitigationValidation"] as const;
export type TextField = typeof TEXT_FIELDS[number];
export const FIELD_LABELS: Record<keyof SharedContent, string> = {
  classification: "Classification", classificationExplanation: "Classification explanation", disposition: "Disposition",
  narrative: "Expert narrative", complexitySize: "Complexity size", recommendation: "Recommendation",
  recommendationRationale: "Recommendation rationale", prerequisites: "Prerequisites", cautions: "Cautions",
  alternatives: "Alternatives", validationQuestions: "Validation questions", mitigation: "Mitigation", mitigationValidation: "Mitigation validation",
};

export interface SharedAssessmentSummary { id: string; name: string; system: string; target_release: string; access: Access | null; count: number }
export interface SharedEntity {
  id: string; assessment_id: string; entity_key: string; kind: "object" | "interface"; name: string;
  evidence: any; content: SharedContent; sources: any[] | null; version: number; state: string;
  submitter_id: string | number | null; reviewer_id: string | number | null;
}
export interface SharedDetail { assessment: SharedAssessmentSummary & Record<string, any>; entities: SharedEntity[]; members: any[]; events: any[] }
export interface Proposal { classification: Classification | null; classificationExplanation: string; recommendation: string; evidence: Array<{ path: string; line: number; text: string }>; notice: string; references?: Array<{ id?: string; title?: string; section?: string; release?: string; version?: number; text?: string }>; guidance?: string }
export interface Approval { id: string; entity_id: string; version: number; approver: string; approved_at: string; kind: string; name: string; assessment_id: string; assessment_name: string; superseded: boolean; template_name: string | null; template_version: number | null }
export interface CompanyTemplate { id: string; name: string; version: number; previewed: boolean; active: boolean }
export interface GithubStatus { configured: boolean; connected: boolean; repositories: string[] }

// ---------- content mapping (pure) ----------
const str = (v: unknown) => scalar(v).trim();
function lines(v: unknown): string {
  if (!v) return "";
  const arr = Array.isArray(v) ? v : [v];
  return arr.map(e => typeof e === "string" ? e : str((e as any)?.label ?? (e as any)?.reason ?? (e as any)?.description ?? (e as any)?.summary ?? (e as any)?.text ?? (e as any)?.id ?? e)).map(s => s.trim()).filter(Boolean).join("\n");
}
function solution(item: any) {
  if (item?.solutionRecommendation) return item.solutionRecommendation;
  const r = item?.recommendation;
  if (!r || typeof r !== "object") return null;
  return { ...r, primary: r.primary || { id: r.id, label: r.label, description: r.description } };
}
function mitigationParts(m: any): { text: string; validation: string } {
  if (!m) return { text: "", validation: "" };
  if (typeof m !== "object") return { text: str(m), validation: "" };
  const text = [
    str(m.recommendedAction), str(m.summary), m.targetPattern ? `Target pattern: ${str(m.targetPattern)}` : "",
    ...(Array.isArray(m.steps) ? m.steps : m.steps ? [m.steps] : []).map((s: unknown) => `- ${str(s)}`),
  ].filter(s => s && s !== "- ").join("\n");
  return { text, validation: lines(m.validation) };
}

export function buildContent(item: any, kind: "object" | "interface", narrative: string | undefined): SharedContent {
  const rec = solution(item);
  const primary = rec?.primary;
  const recommendation = [str(primary?.label || primary?.id), str(primary?.description)].filter(Boolean).join("\n");
  const rationale = [lines(rec?.rationale), lines(rec?.reasons) ? `Reasons:\n${lines(rec?.reasons)}` : "", lines(rec?.suitabilitySignals) ? `Suitability signals:\n${lines(rec?.suitabilitySignals)}` : "", rec?.confidence ? `Confidence: ${str(rec.confidence)}` : ""].filter(Boolean).join("\n\n");
  const m = mitigationParts(kind === "interface" ? item?.interfaceMitigation || item?.mitigation : item?.mitigation);
  const cls = str(item?.classification).toUpperCase();
  const disp = str(item?.disposition).toLowerCase();
  return {
    classification: (CLASSIFICATIONS as string[]).includes(cls) ? cls as Classification : null,
    classificationExplanation: str(item?.classificationReason?.summary || item?.classificationExplanation),
    disposition: (DISPOSITIONS as string[]).includes(disp) ? disp as Disposition : null,
    narrative: typeof narrative === "string" ? narrative : "",
    complexitySize: itemComplexitySize(item),
    recommendation,
    recommendationRationale: rationale,
    prerequisites: lines(rec?.prerequisites),
    cautions: lines(rec?.cautions),
    alternatives: lines(rec?.alternatives),
    validationQuestions: lines(rec?.validationQuestions),
    mitigation: m.text,
    mitigationValidation: m.validation,
  };
}

export interface PublishEntity { key: string; kind: "object" | "interface"; name: string; content: SharedContent; evidence: any }
export function buildPublishEntity(item: any, kind: "object" | "interface", narrative?: string): PublishEntity {
  return { key: `${kind}:${item.id}`, kind, name: str(kind === "interface" ? item.interfaceName || item.objectName : item.objectName) || str(item.id), content: buildContent(item, kind, narrative), evidence: item };
}
export function buildPublishEntities(assessment: any, narratives: Record<string, string>): PublishEntity[] {
  const byId = new Map<string, any>();
  for (const item of assessment?.inventory || []) byId.set(item.id, item);
  for (const item of assessment?.integrations || []) byId.set(item.id, { ...byId.get(item.id), ...item });
  return [...byId.values()].map(item => {
    const kind = isInterfaceItem(item) ? "interface" as const : "object" as const;
    return buildPublishEntity(item, kind, narratives[item.id]);
  });
}

export function sameSnapshot(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  return Object.keys(aa).length === Object.keys(bb).length && Object.keys(aa).every(k => Object.hasOwn(bb, k) && sameSnapshot(aa[k], bb[k]));
}

/** Stable identity: same workspace assessment => same key, so retries never duplicate. */
export async function importKeyFor(assessment: any): Promise<string> {
  const ids = [...(assessment?.inventory || []), ...(assessment?.integrations || [])].map((i: any) => String(i.id)).sort();
  const basis = JSON.stringify([assessment?.system, assessment?.targetRelease, assessment?.provenance?.generatedAt, assessment?.provenance?.engineVersion, ids]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return `ws-${[...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 48)}`;
}

export function publishBody(importKey: string, name: string, system: string, entities: PublishEntity[]) {
  if (entities.length === 0) throw new Error("This assessment has no objects or interfaces to publish.");
  if (entities.length > MAX_PUBLISH_ENTITIES) throw new Error(`Shared assessments accept up to ${MAX_PUBLISH_ENTITIES.toLocaleString()} records; this one has ${entities.length.toLocaleString()}.`);
  const body = JSON.stringify({ importKey, name, system, targetRelease: "S4HANA_2025", entities });
  const bytes = new TextEncoder().encode(body).byteLength;
  if (bytes > MAX_PUBLISH_BYTES) throw new Error(`Publish request is ${(bytes / 1_000_000).toFixed(2)} MB; the limit is 8 MB. Nothing was sent.`);
  return body;
}

export function normalizeContent(c: Partial<SharedContent> | null | undefined): SharedContent {
  const out: any = { classification: null, disposition: null, complexitySize: null };
  for (const f of TEXT_FIELDS) out[f] = typeof c?.[f] === "string" ? c[f] : "";
  if (c?.classification && (CLASSIFICATIONS as string[]).includes(c.classification)) out.classification = c.classification;
  if (c?.disposition && (DISPOSITIONS as string[]).includes(c.disposition)) out.disposition = c.disposition;
  out.complexitySize = complexitySize(c?.complexitySize ?? null);
  return out;
}

// ---------- user-scoped drafts ----------
export interface Draft { baseVersion: number; content: SharedContent; error?: string; conflict?: boolean; savedAt: string }
const draftKey = (userId: string | number, entityId: string) => `cc-shared-draft:${userId}:${entityId}`;
const memoryDrafts = new Map<string, Draft>();
export function loadDraft(userId: string | number, entityId: string): Draft | null {
  const key = draftKey(userId, entityId);
  if (memoryDrafts.has(key)) return memoryDrafts.get(key)!;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isInteger(parsed.baseVersion) || parsed.baseVersion < 1 || !parsed.content || typeof parsed.content !== "object") return null;
    return { ...parsed, content: normalizeContent(parsed.content) };
  } catch { return null; }
}
export function saveDraft(userId: string | number, entityId: string, d: Draft) {
  const key = draftKey(userId, entityId); memoryDrafts.set(key, d);
  try { localStorage.setItem(key, JSON.stringify(d)); return true; } catch { return false; }
}
export function clearDraft(userId: string | number, entityId: string) {
  const key = draftKey(userId, entityId); memoryDrafts.delete(key);
  try { localStorage.removeItem(key); } catch { /* already retained in server or explicitly discarded */ }
}
export function listDraftIds(userId: string | number): string[] {
  const prefix = `cc-shared-draft:${userId}:`; const out: string[] = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(prefix)) out.push(k.slice(prefix.length)); } } catch { /* ignore */ }
  return out;
}

// ---------- API ----------
const enc = encodeURIComponent;
export type ApiErr = Error & { status?: number };
export const listShared = (signal?: AbortSignal) => apiJson<{ assessments: SharedAssessmentSummary[] }>(BASE, { signal, cache: "no-store" });
export const getShared = (id: string, signal?: AbortSignal) => apiJson<SharedDetail>(`${BASE}/${enc(id)}`, { signal, cache: "no-store" });
export const getWorkspaceReview = (importKey: string, key: string, signal?: AbortSignal) =>
  apiJson<import("@workspace/api-client-react").WorkspaceReviewContext>(`${BASE}/workspace-review?${new URLSearchParams({ importKey, key })}`, { signal, cache: "no-store" });
export const prepareWorkspaceReview = (body: import("@workspace/api-client-react").WorkspaceReviewInput) =>
  apiJson<import("@workspace/api-client-react").WorkspaceReviewResult>(`${BASE}/workspace-review`, { method: "POST", json: body });
export async function publishShared(body: string) {
  const res = await apiFetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (!res.ok) { const e = new Error(res.status === 413 ? "The server rejected the request as too large (limit 5,000 records / 8 MB)." : await readApiError(res, "Publish failed")) as ApiErr; e.status = res.status; throw e; }
  return res.json() as Promise<{ assessment: SharedAssessmentSummary; existing: boolean }>;
}
export const putContent = (id: string, expectedVersion: number, content: SharedContent) =>
  apiJson<{ entity: SharedEntity }>(`${BASE}/entities/${enc(id)}`, { method: "PUT", json: { expectedVersion, content } });
export const entityAction = (id: string, body: { expectedVersion: number; action: "submit" | "approve" | "request-changes"; comment: string; requestId: string }) =>
  apiJson<{ entity: SharedEntity }>(`${BASE}/entities/${enc(id)}/actions`, { method: "POST", json: body });
export const getAdministration = (signal?: AbortSignal) => apiJson<{ assessments: Array<{ id: string; name: string; owner_id: string }>; users: Array<{ id: string; username: string; role: string }> }>(`${BASE}/administration`, { signal, cache: "no-store" });
export const putMember = (id: string, userId: string, access: Access | null) => apiJson<{ ok: true }>(`${BASE}/${enc(id)}/members`, { method: "PUT", json: { userId, access } });
export const putReviewer = (id: string, expectedVersion: number, reviewerId: string | null) => apiJson<{ entity: SharedEntity }>(`${BASE}/entities/${enc(id)}/reviewer`, { method: "PUT", json: { expectedVersion, reviewerId } });
export const githubStatus = (signal?: AbortSignal) => apiJson<GithubStatus>(`${BASE}/github/status`, { signal, cache: "no-store" });
export const githubConnect = () => apiJson<GithubStatus>(`${BASE}/github/connect`, { method: "POST", json: {} });
export async function githubDisconnect() { const res = await apiFetch(`${BASE}/github/connect`, { method: "DELETE" }); if (!res.ok) throw new Error(await readApiError(res, "Disconnect failed")); }
export const githubFiles = (repository: string, ref: string, signal?: AbortSignal) => apiJson<{ commit: string; files: Array<{ path: string; sha: string; size: number }> }>(`${BASE}/github/files?repository=${enc(repository)}&ref=${enc(ref)}`, { signal });
export const mapSource = (id: string, body: { expectedVersion: number; repository: string; commit: string; path: string }) => apiJson<{ entity: SharedEntity; proposal: Proposal | null }>(`${BASE}/entities/${enc(id)}/source`, { method: "POST", json: body });
export const getSource = (id: string, index: number, signal?: AbortSignal) => apiJson<{ source: any; code: string }>(`${BASE}/entities/${enc(id)}/source/${index}`, { signal });
export const evaluateSource = (id: string, expectedVersion: number) => apiJson<{ proposal: Proposal }>(`${BASE}/entities/${enc(id)}/evaluate`, { method: "POST", json: { expectedVersion } });
export const listApprovals = (params: import("@workspace/api-client-react").ListSharedApprovalsParams, signal?: AbortSignal) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  return apiJson<import("@workspace/api-client-react").ApprovalPage>(`${BASE}/approvals/list?${query}`, { signal, cache: "no-store" });
};
export const listCompanyTemplates = (signal?: AbortSignal) => apiJson<{ templates: CompanyTemplate[]; configured: boolean }>(`${BASE}/company-templates`, { signal, cache: "no-store" });
export async function uploadCompanyTemplate(file: File, name: string, replace?: { id: string; expectedVersion: number }) {
  const fd = new FormData(); fd.append("file", file); fd.append("name", name);
  if (replace) { fd.append("replaceId", replace.id); fd.append("expectedVersion", String(replace.expectedVersion)); }
  const res = await apiFetch(`${BASE}/company-templates`, { method: "POST", body: fd });
  if (!res.ok) throw new Error(await readApiError(res, "Upload failed"));
  return res.json().catch(() => ({}));
}
export const setCompanyDefault = (id: string, expectedVersion: number) => apiJson<{ ok: true }>(`${BASE}/company-templates/${enc(id)}/default`, { method: "PUT", json: { expectedVersion } });

export const isEditor = (a?: { access?: Access | null } | null) => a?.access === "edit";
export const stateKey = (s: string) => String(s || "").toLowerCase().replace(/[\s_]+/g, "-");
export const sameId = (a: unknown, b: unknown) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
