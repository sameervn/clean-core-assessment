export type UsageState = "in-use" | "not-in-use" | "unknown";
/** Coverage is telemetry coverage, not required-field completeness. */
export function usageState(rows: Array<Record<string, any>>): UsageState {
  if (rows.some(r => typeof r.usageCount === "number" && Number.isFinite(r.usageCount) && r.usageCount > 0)) return "in-use";
  if (!rows.length) return "unknown";
  return rows.every(r => r.usageCount === 0 && r.telemetryCoverage === 100
    && typeof r.collectionStart === "string" && typeof r.collectionEnd === "string"
    && Number.isFinite(Date.parse(r.collectionStart)) && Number.isFinite(Date.parse(r.collectionEnd))
    && Date.parse(r.collectionEnd) > Date.parse(r.collectionStart)) ? "not-in-use" : "unknown";
}
