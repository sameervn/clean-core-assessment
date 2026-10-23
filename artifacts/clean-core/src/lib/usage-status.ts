/**
 * Conservative usage semantics (aligned with the engine):
 * - explicit engine usageStatus wins;
 * - any positive observed count => in-use;
 * - not in-use ONLY if every supplied row for the object is an explicit zero AND each row's
 *   observation (row metadata preferred, then set metadata) has strict end > start and
 *   telemetryCoverage === 100 (metadata.coverage is completeness, not telemetry);
 * - anything else => unknown, with no fabricated count.
 */
export type UsageStatus = "in-use" | "not-in-use" | "unknown";
export interface UsageDetail { status: UsageStatus; count: number | null; reason: string; period?: string }
type EvidenceSet = { type: string; rows?: any[]; metadata?: any };

const names = (row: any) => [row?.objectName, row?.object, row?.name, row?.interfaceName].filter(v => typeof v === "string" && v).map((v: string) => v.toUpperCase());
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() ? Number(v.replace(/,/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};
const rowCount = (row: any) => num(row?.usageCount ?? row?.executions ?? row?.callCount ?? row?.count);

export function observationValid(meta: any): { ok: boolean; reason: string; period?: string } {
  const s = Date.parse(meta?.collectionStart ?? ""), e = Date.parse(meta?.collectionEnd ?? "");
  if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: false, reason: "Observation period missing" };
  if (!(e > s)) return { ok: false, reason: "Observation period invalid" };
  const period = `${new Date(s).toISOString().slice(0, 10)} to ${new Date(e).toISOString().slice(0, 10)}`;
  if (num(meta?.telemetryCoverage) !== 100) return { ok: false, reason: "Telemetry coverage not confirmed at 100%", period };
  return { ok: true, reason: "Complete observation", period };
}

function rowMeta(row: any, set: EvidenceSet) {
  const m = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const pick = (k: string) => m[k] ?? row?.[k] ?? set.metadata?.[k];
  return { collectionStart: pick("collectionStart"), collectionEnd: pick("collectionEnd"), telemetryCoverage: pick("telemetryCoverage") };
}

export function usageFor(item: any, evidence: EvidenceSet[]): UsageDetail {
  const local = evidenceUsage(item, evidence);
  const engine = item?.usageStatus;
  if (engine === "in-use" || engine === "not-in-use" || engine === "unknown") {
    const engineCount = typeof item.usageCount === "number" && Number.isFinite(item.usageCount) ? item.usageCount : null;
    const count = engine === "unknown" ? null : engine === "not-in-use" ? 0 : engineCount ?? local.count;
    return { status: engine, count, reason: local.status === engine ? `Engine status; ${local.reason.toLowerCase()}` : "Engine status", period: local.period };
  }
  return local;
}

function evidenceUsage(item: any, evidence: EvidenceSet[]): UsageDetail {
  const keys = new Set([item?.objectName, item?.interfaceName, item?.id].filter(v => typeof v === "string" && v).map((v: string) => v.toUpperCase()));
  const sets = (evidence || []).filter(e => e.type === "usage");
  let total = 0, positive = false, rows = 0, incomplete: string | null = null, period: string | undefined;
  for (const set of sets) for (const row of set.rows || []) {
    if (!names(row).some(n => keys.has(n))) continue;
    rows++;
    const c = rowCount(row);
    if (c === null) { incomplete = incomplete ?? "a usage row has no count"; continue; }
    if (c > 0) { positive = true; total += c; continue; }
    const obs = observationValid(rowMeta(row, set));
    period = period ?? obs.period;
    if (!obs.ok) incomplete = incomplete ?? obs.reason.toLowerCase();
  }
  if (positive) return { status: "in-use", count: total, reason: "Positive observed execution count" };
  if (!sets.length) return { status: "unknown", count: null, reason: "No usage evidence loaded" };
  if (!rows) return { status: "unknown", count: null, reason: "No usage row for this object" };
  if (incomplete) return { status: "unknown", count: null, reason: `Zero observed, but ${incomplete}`, period };
  return { status: "not-in-use", count: 0, reason: "Explicit zero in every row over a complete observation period with 100% telemetry coverage", period };
}

export function usageCounts(items: any[], evidence: EvidenceSet[]) {
  const c: Record<UsageStatus, number> = { "in-use": 0, "not-in-use": 0, unknown: 0 };
  for (const i of items || []) c[usageFor(i, evidence).status]++;
  return c;
}
export const USAGE_LABEL: Record<UsageStatus, string> = { "in-use": "In use", "not-in-use": "Not in use", unknown: "Unknown" };
