import { complexitySize } from "./collaboration/contract";
import { usageState } from "./collaboration/usage";
import { evidenceKey, parseEvidenceXml } from "./evidence-xml";
import { assertInputBounds } from "./input-bounds";

export const CLEAN_CORE_EVIDENCE_TYPES = [
  "atc", "cloud-readiness", "custom-code", "usage", "modifications",
  "enhancements", "object-metadata", "interfaces", "readiness-check",
  "cloud-alm", "process-data",
] as const;

export type CleanCoreEvidenceType = typeof CLEAN_CORE_EVIDENCE_TYPES[number];
export const CLEAN_CORE_MAX_NORMALIZED_BYTES = 16_000_000;

export interface CleanCoreEvidenceRow {
  objectName: string;
  objectType?: string;
  finding?: string;
  findingId?: string;
  category?: string;
  severity?: string;
  status?: string;
  apiStatus?: string;
  enhancementType?: string;
  usageCount?: number;
  telemetryCoverage?: number;
  owner?: string;
  package?: string;
  module?: string;
  process?: string;
  size?: number;
  complexity?: number;
  lastChange?: string;
  transport?: string;
  offendingSapObject?: string;
  successor?: string;
  interfaceName?: string;
  interfaceType?: string;
  interfaceDirection?: string;
  sourceSystem?: string;
  targetSystem?: string;
  processCriticality?: number;
  dependency?: string;
  duplicateOf?: string;
  targetRelease?: string;
  releaseStatus?: string;
  collectionStart?: string;
  collectionEnd?: string;
  source?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface ClassificationOverride {
  finding?: string;
  category?: string;
  objectPattern?: string;
  level: "A" | "B" | "C" | "D";
  reason?: string;
}

export interface CleanCoreEvidenceSet {
  type: CleanCoreEvidenceType;
  rows: CleanCoreEvidenceRow[];
  metadata?: Record<string, unknown>;
}

export function buildCleanCoreDemoEvidence(system: string, targetRelease: string): CleanCoreEvidenceSet[] {
  const common = {
    collectionStart: "2026-08-01",
    collectionEnd: "2026-08-31",
    telemetryCoverage: 100,
  };
  const evidence: CleanCoreEvidenceSet[] = [
    {
      type: "object-metadata",
      metadata: { source: "YASH demo landscape", freshness: "current", coverage: 100, confidence: "high", demo: true },
      rows: [
        { objectName: "ZFI_AGING_REPORT", objectType: "PROG", package: "ZFI_REPORTING", module: "FI", process: "Record to Report", owner: "Finance IT", size: 1840, complexity: 34, lastChange: "2026-07-18", processCriticality: 5, ...common },
        { objectName: "ZSD_ORDER_API", objectType: "CLAS", package: "ZSD_INTEGRATION", module: "SD", process: "Order to Cash", owner: "Digital Sales", size: 920, complexity: 18, lastChange: "2026-08-12", processCriticality: 5, ...common },
        { objectName: "ZMM_STOCK_SYNC", objectType: "PROG", package: "ZMM_CORE", module: "MM", process: "Plan to Produce", owner: "Supply Chain IT", size: 1260, complexity: 27, lastChange: "2026-06-30", processCriticality: 4, ...common },
        { objectName: "ZHR_EMPLOYEE_TILE", objectType: "CLAS", package: "ZHR_FIORI", module: "HCM", process: "Hire to Retire", owner: "HR Technology", size: 410, complexity: 8, lastChange: "2026-08-25", processCriticality: 3, ...common },
        { objectName: "ZPP_CAPACITY_OLD", objectType: "PROG", package: "ZPP_LEGACY", module: "PP", process: "Plan to Produce", owner: "Manufacturing IT", size: 760, complexity: 16, lastChange: "2021-11-02", processCriticality: 2, ...common },
        { objectName: "ZAR_CREDIT_CHECK", objectType: "BADI", package: "ZFI_AR", module: "FI", process: "Order to Cash", owner: "Finance IT", size: 290, complexity: 11, lastChange: "2026-05-09", processCriticality: 4, ...common },
        { objectName: "ZBTP_TAX_EVENT", objectType: "CLAS", package: "ZFI_BTP", module: "FI", process: "Record to Report", owner: "Cloud Extensions", size: 330, complexity: 6, lastChange: "2026-08-28", processCriticality: 3, ...common },
        { objectName: "ZMM_VENDOR_CDS", objectType: "DDLS", package: "ZMM_ANALYTICS", module: "MM", process: "Source to Pay", owner: "Data Products", size: 180, complexity: 4, lastChange: "2026-08-20", processCriticality: 3, ...common },
      ],
    },
    {
      type: "usage",
      metadata: { source: "SCMON/SUSG demo extract", freshness: "current", coverage: 100, confidence: "high", demo: true },
      rows: [
        { objectName: "ZFI_AGING_REPORT", objectType: "PROG", usageCount: 8420, ...common },
        { objectName: "ZSD_ORDER_API", objectType: "CLAS", usageCount: 126000, ...common },
        { objectName: "ZMM_STOCK_SYNC", objectType: "PROG", usageCount: 38900, ...common },
        { objectName: "ZHR_EMPLOYEE_TILE", objectType: "CLAS", usageCount: 15400, ...common },
        { objectName: "ZPP_CAPACITY_OLD", objectType: "PROG", usageCount: 0, ...common },
        { objectName: "ZAR_CREDIT_CHECK", objectType: "BADI", usageCount: 97200, ...common },
        { objectName: "ZBTP_TAX_EVENT", objectType: "CLAS", usageCount: 6200, ...common },
        { objectName: "ZMM_VENDOR_CDS", objectType: "DDLS", usageCount: 22100, ...common },
      ],
    },
    {
      type: "atc",
      metadata: { source: "ATC demo run", freshness: "current", coverage: 75, confidence: "high", demo: true },
      rows: [
        { objectName: "ZFI_AGING_REPORT", objectType: "PROG", findingId: "S4HANA_READINESS/DB_OPERATION", finding: "Direct write to SAP standard table BSEG", category: "Database Compliance", severity: "Error", offendingSapObject: "BSEG", successor: "I_JournalEntryItem", ...common },
        { objectName: "ZSD_ORDER_API", objectType: "CLAS", findingId: "CLOUD_API_RELEASE", finding: "Released OData V4 API used for sales orders", category: "Released APIs", severity: "Info", status: "compliant", successor: "API_SALES_ORDER_SRV", ...common },
        { objectName: "ZMM_STOCK_SYNC", objectType: "PROG", findingId: "S4HANA_READINESS/SELECT_STAR", finding: "Unreleased table access requires redesign", category: "Database Compliance", severity: "High", offendingSapObject: "MARD", successor: "I_StockQuantityCurrentValue", ...common },
        { objectName: "ZHR_EMPLOYEE_TILE", objectType: "CLAS", findingId: "ABAP_CLOUD_RELEASE", finding: "ABAP Cloud compliant developer extensibility", category: "Released APIs", severity: "Info", status: "clean", ...common },
        { objectName: "ZAR_CREDIT_CHECK", objectType: "BADI", findingId: "CLASSIC_EXTENSION", finding: "Classic BAdI implementation uses restricted contract", category: "Extensions", severity: "Warning", successor: "BADI_SD_SLS_CHECK_BEFORE_SAVE", ...common },
        { objectName: "ZMM_VENDOR_CDS", objectType: "DDLS", findingId: "CDS_RELEASED", finding: "Released CDS view contract", category: "Data Models", severity: "Info", status: "released", successor: "I_Supplier", ...common },
      ],
    },
    {
      type: "interfaces",
      metadata: { source: "Interface catalog demo extract", freshness: "current", coverage: 38, confidence: "medium", demo: true },
      rows: [
        { objectName: "ZSD_ORDER_API", objectType: "CLAS", interfaceName: "Sales Order API", interfaceType: "OData V4", status: "released", dependency: "SAP_COM_0109", ...common },
        { objectName: "ZMM_STOCK_SYNC", objectType: "PROG", interfaceName: "Warehouse Stock RFC", interfaceType: "RFC", status: "classic", dependency: "Z_WM_STOCK_GET", ...common },
        { objectName: "ZBTP_TAX_EVENT", objectType: "CLAS", interfaceName: "Tax Determination Event", interfaceType: "Business Event", status: "released", dependency: "SAP BTP Event Mesh", ...common },
      ],
    },
    {
      type: "readiness-check",
      metadata: { source: "S/4HANA Readiness Check demo", freshness: "current", coverage: 25, confidence: "high", demo: true },
      rows: [
        { objectName: "ZFI_AGING_REPORT", objectType: "PROG", findingId: "RC-FI-ACDOCA-001", finding: "Totals and index tables replaced by Universal Journal", targetRelease, releaseStatus: "incompatible", offendingSapObject: "BSID", successor: "I_OperationalAcctgDocItem", ...common },
        { objectName: "ZMM_STOCK_SYNC", objectType: "PROG", findingId: "RC-MM-MATDOC-002", finding: "Inventory data model changed for S/4HANA", targetRelease, releaseStatus: "changed", offendingSapObject: "MSEG", successor: "I_MaterialDocumentItem", ...common },
      ],
    },
  ];

  const metadata = evidence.find((set) => set.type === "object-metadata")!;
  const usage = evidence.find((set) => set.type === "usage")!;
  const atc = evidence.find((set) => set.type === "atc")!;
  const interfaces = evidence.find((set) => set.type === "interfaces")!;
  const readiness = evidence.find((set) => set.type === "readiness-check")!;
  const modules = [
    ["FI", "Record to Report", "Finance IT"],
    ["SD", "Order to Cash", "Digital Sales"],
    ["MM", "Source to Pay", "Supply Chain IT"],
    ["PP", "Plan to Produce", "Manufacturing IT"],
    ["HCM", "Hire to Retire", "HR Technology"],
    ["EWM", "Warehouse Operations", "Logistics IT"],
    ["PM", "Asset Maintenance", "Enterprise Asset IT"],
    ["BW", "Enterprise Analytics", "Data Products"],
  ] as const;
  const objectTypes = ["PROG", "CLAS", "FUNC", "DDLS", "BADI"] as const;

  for (let index = 9; index <= 4_000; index += 1) {
    const [module, process, owner] = modules[index % modules.length];
    const objectType = objectTypes[index % objectTypes.length];
    const objectName = `Z${module}_${objectType}_${String(index).padStart(4, "0")}`;
    const packageName = `Z${module}_${index % 5 === 0 ? "INTEGRATION" : index % 3 === 0 ? "REPORTING" : "CORE"}`;
    const complexity = 3 + ((index * 7) % 43);
    const usageCount = index % 17 === 0 ? 0 : 100 + ((index * 791) % 180_000);
    const levelBand = index % 10;
    const finding = levelBand <= 5
      ? { findingId: "CLEAN_CORE_STANDARD", finding: "Released standard API with no extension required", category: "Standard Adoption", severity: "Info", status: "released standard no extension" }
      : levelBand <= 7
        ? { findingId: "ABAP_CLOUD_RELEASE", finding: "Released API used through ABAP Cloud developer extensibility", category: "Released APIs", severity: "Info", status: "released compliant" }
        : levelBand === 8
          ? { findingId: "CLASSIC_EXTENSION", finding: "Classic BAdI implementation uses a restricted contract", category: "Extensions", severity: "Warning", status: "classic restricted" }
          : { findingId: "UNRELEASED_API", finding: "Unreleased internal API requires redesign", category: "Core Modification", severity: "Error", status: "not released" };

    metadata.rows.push({
      objectName, objectType, package: packageName, module, process, owner,
      size: 120 + ((index * 97) % 4_800), complexity,
      lastChange: index % 17 === 0 ? "2021-06-15" : `2026-${String((index % 8) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
      processCriticality: 1 + (index % 5), ...common,
    });
    usage.rows.push({ objectName, objectType, usageCount, ...common });
    atc.rows.push({ objectName, objectType, ...finding, dependency: finding.findingId, ...common });

    if (index % 25 === 0) {
      interfaces.rows.push({
        objectName, objectType, interfaceName: `${module} Enterprise Interface ${index}`,
        interfaceType: index % 50 === 0 ? "RFC" : "OData V4",
        status: index % 50 === 0 ? "classic" : "released",
        dependency: index % 50 === 0 ? `Z_${module}_RFC_${index}` : `SAP_COM_${String(index % 9999).padStart(4, "0")}`,
        ...common,
      });
    }
    if (index % 40 === 0) {
      readiness.rows.push({
        objectName, objectType, findingId: `RC-${module}-${String(index).padStart(4, "0")}`,
        finding: index % 80 === 0 ? "Data model simplification requires successor adoption" : "Target release compatibility confirmed",
        targetRelease, releaseStatus: index % 80 === 0 ? "changed" : "compatible",
        successor: index % 80 === 0 ? `I_${module}_BusinessObject` : undefined,
        ...common,
      });
    }
  }

  return evidence;
}

const LEVEL_VALUE = { A: 1, B: 2, C: 3, D: 4 } as const;
function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function scalar(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

function parseDelimited(content: string): Record<string, unknown>[] {
  const records: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  const firstLine = content.slice(0, content.indexOf("\n") < 0 ? content.length : content.indexOf("\n"));
  if (firstLine.length > 20_000) throw new Error("Delimited header exceeds 20,000 characters");
  const candidates = [",", "\t", ";", "|"];
  const delimiter = candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  for (let i = 0; i < content.length; i += 1) {
    if (value.length > 20_000 || row.length > 128 || records.length > 20_001) throw new Error("Delimited evidence complexity limit exceeded");
    const char = content[i];
    if (char === '"' && quoted && content[i + 1] === '"') {
      value += '"'; i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(value.trim()); value = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[i + 1] === "\n") i += 1;
      row.push(value.trim()); value = "";
      if (row.some(Boolean)) records.push(row);
      row = [];
    } else value += char;
  }
  row.push(value.trim());
  if (quoted || value.length > 20_000 || row.length > 128) throw new Error("Invalid or excessive delimited evidence");
  if (row.some(Boolean)) records.push(row);
  if (records.length < 2) throw new Error("Delimited files require a header and at least one data row");
  const headers = records[0].map(evidenceKey);
  if (!headers.some(Boolean)) throw new Error("The evidence file has no recognizable header");
  if (!headers.some((header) => [
    "objectname", "object", "repositoryobject", "program", "include", "name",
    "customobject", "component", "service", "interfacename",
  ].includes(header))) {
    throw new Error("Delimited evidence requires an object name, object, program, component, service, or interface header");
  }
  return records.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])),
  );
}

function parsePlainText(content: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (records.length >= 20_000 || line.length > 100_000) throw new Error("Text evidence complexity limit exceeded");
    const value = line.trim();
    if (!value || value.startsWith("#") || value.startsWith("//")) continue;
    const parts = value.split(/\t|\|/).map((part) => part.trim());
    if (parts.length >= 3) {
      records.push({
        objectname: parts[0], severity: parts[1], finding: parts[2],
        findingid: parts[3] || "", category: parts[4] || "",
      });
      continue;
    }
    const first = value.indexOf(":");
    const second = value.indexOf(":", first + 1);
    if (first > 0 && second > first) {
      const severity = value.slice(first + 1, second).trim();
      const finding = value.slice(second + 1).trim();
      if (finding && ["error", "warning", "info", "critical", "high", "medium", "low"].includes(severity.toLowerCase())) {
        records.push({ objectname: value.slice(0, first), severity, finding });
      }
    }
  }
  return records;
}

function extractJsonRecords(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const object = parsed as Record<string, unknown>;
  for (const key of ["items", "results", "objects", "findings", "value", "rows"]) {
    if (Array.isArray(object[key])) return object[key] as unknown[];
  }
  const d = object.d as Record<string, unknown> | undefined;
  if (d && Array.isArray(d.results)) return d.results;
  return [];
}

function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = scalar(row[normalizeHeader(key)]);
    if (value) return value;
  }
  return "";
}

function numeric(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  const value = pick(row, ...keys).replace(/,/g, "");
  if (!value) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function normalizeRecord(rawValue: unknown, type: CleanCoreEvidenceType): CleanCoreEvidenceRow | null {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return null;
  const raw = Object.fromEntries(Object.entries(rawValue as Record<string, unknown>)
    .map(([key, value]) => [evidenceKey(key), value]));
  const objectName = pick(raw, "objectName", "object", "repositoryObject", "program", "include",
    "name", "customObject", "component", "service", "interfaceName");
  if (!objectName) return null;
  const row: CleanCoreEvidenceRow = {
    objectName,
    objectType: pick(raw, "objectType", "repositoryObjectType", "type") || undefined,
    finding: pick(raw, "finding", "messageText", "message", "description", "checkTitle", "issue") || undefined,
    findingId: pick(raw, "findingId", "checkId", "ruleId", "check") || undefined,
    category: pick(raw, "category", "dimension", "checkCategory") || undefined,
    severity: pick(raw, "severity", "priority", "messageKind", "level") || undefined,
    status: pick(raw, "status", "state", "compliance") || undefined,
    apiStatus: pick(raw, "apiStatus", "releaseStatus", "released", "cloudStatus") || undefined,
    enhancementType: pick(raw, "enhancementType", "technology", "extensibility", "extensionType") || undefined,
    usageCount: numeric(raw, "usageCount", "executions", "callCount", "count"),
    telemetryCoverage: numeric(raw, "telemetryCoverage", "runtimeCoverage", "observationCoverage"),
    owner: pick(raw, "owner", "responsible", "assignee", "changedBy") || undefined,
    package: pick(raw, "package", "devclass") || undefined,
    module: pick(raw, "module", "applicationComponent", "component") || undefined,
    process: pick(raw, "process", "businessProcess", "processName") || undefined,
    size: numeric(raw, "size", "linesOfCode", "loc"),
    complexity: numeric(raw, "complexity", "cyclomaticComplexity"),
    lastChange: pick(raw, "lastChange", "changedAt", "lastChanged") || undefined,
    transport: pick(raw, "transport", "transportRequest", "request") || undefined,
    offendingSapObject: pick(raw, "offendingSapObject", "sapObject", "referencedObject", "calledObject", "standardObject") || undefined,
    successor: pick(raw, "successor", "successorApi", "releasedApi", "replacement") || undefined,
    interfaceName: pick(raw, "interfaceName", "interface", "service", "endpoint") || undefined,
    interfaceType: pick(raw, "interfaceType", "protocol") || undefined,
    interfaceDirection: pick(raw, "interfaceDirection", "direction", "flow") || undefined,
    sourceSystem: pick(raw, "sourceSystem", "senderSystem", "sourceApplication") || undefined,
    targetSystem: pick(raw, "targetSystem", "receiverSystem", "targetApplication") || undefined,
    processCriticality: numeric(raw, "processCriticality", "criticality"),
    dependency: pick(raw, "dependency", "dependsOn", "calledBy") || undefined,
    duplicateOf: pick(raw, "duplicateOf", "cloneOf", "duplicate") || undefined,
    targetRelease: pick(raw, "targetRelease", "targetVersion", "release", "toRelease") || undefined,
    releaseStatus: pick(raw, "releaseStatus", "impactStatus", "changeStatus", "targetStatus") || undefined,
    collectionStart: pick(raw, "collectionStart", "periodStart", "startDate") || undefined,
    collectionEnd: pick(raw, "collectionEnd", "periodEnd", "endDate") || undefined,
    source: type,
  };
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== "")) as CleanCoreEvidenceRow;
}

export function parseCleanCoreEvidence(type: CleanCoreEvidenceType, content: string): CleanCoreEvidenceRow[] {
  if (typeof content !== "string" || content.length > CLEAN_CORE_MAX_NORMALIZED_BYTES
    || Buffer.byteLength(content, "utf8") > CLEAN_CORE_MAX_NORMALIZED_BYTES) throw new Error("Evidence exceeds 16 MB");
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  if (!trimmed) throw new Error("The uploaded file is empty");
  let records: unknown[];
  if (trimmed.startsWith("<")) records = parseEvidenceXml(trimmed);
  else if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed: unknown = JSON.parse(trimmed);
    assertInputBounds(parsed);
    records = extractJsonRecords(parsed);
  }
  else {
    try {
      records = parseDelimited(trimmed);
    } catch (error) {
      records = parsePlainText(trimmed);
      if (!records.length) throw error;
    }
  }
  if (!records.length) throw new Error("The evidence document does not contain a record array");
  if (records.length > 20_000) throw new Error("Evidence exceeds 20,000 rows");
  const rows = records.map((record) => normalizeRecord(record, type)).filter((row): row is CleanCoreEvidenceRow => !!row);
  if (!rows.length) throw new Error(`No recognizable ${type} records found. Include an object name, object, program, component, service, or interface column.`);
  for (const row of rows) {
    const start = validDate(row.collectionStart);
    const end = validDate(row.collectionEnd);
    if (row.collectionStart && start === undefined) throw new Error(`Invalid collection start date for ${row.objectName}`);
    if (row.collectionEnd && end === undefined) throw new Error(`Invalid collection end date for ${row.objectName}`);
    if (start !== undefined && end !== undefined && start > end) {
      throw new Error(`Collection start is after collection end for ${row.objectName}`);
    }
  }
  return rows;
}

function validDate(value?: string): number | undefined {
  if (!value) return undefined;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : undefined;
}

export function buildEvidenceMetadata(type: CleanCoreEvidenceType, rows: CleanCoreEvidenceRow[], importedAt = new Date().toISOString()) {
  const starts = rows.map((row) => validDate(row.collectionStart)).filter((v): v is number => v !== undefined);
  const ends = rows.map((row) => validDate(row.collectionEnd)).filter((v): v is number => v !== undefined);
  const end = ends.length ? Math.max(...ends) : undefined;
  const ageDays = end === undefined ? undefined : Math.max(0, Math.floor((Date.parse(importedAt) - end) / 86_400_000));
  const expectedFields: Partial<Record<CleanCoreEvidenceType, (keyof CleanCoreEvidenceRow)[]>> = {
    atc: ["finding"],
    "cloud-readiness": ["finding", "targetRelease"],
    "custom-code": ["finding"],
    usage: ["usageCount", "collectionStart", "collectionEnd"],
    modifications: ["finding"],
    enhancements: ["enhancementType"],
    "object-metadata": ["objectType", "package", "owner"],
    interfaces: ["interfaceName", "interfaceType"],
    "readiness-check": ["finding", "targetRelease"],
    "cloud-alm": ["status"],
    "process-data": ["process"],
  };
  const fields = expectedFields[type] || [];
  const fieldCount = rows.length * Math.max(1, fields.length);
  const populated = rows.reduce((count, row) =>
    count + fields.reduce<number>((sum, field) => sum + (row[field] !== undefined && row[field] !== "" ? 1 : 0), 0), 0);
  const coverage = Math.round((populated / fieldCount) * 100);
  const freshness = ageDays === undefined ? "unknown" : ageDays <= 90 ? "current" : ageDays <= 365 ? "aging" : "stale";
  return {
    source: `User-uploaded ${type} evidence; not a live SAP system assertion`,
    importedAt,
    ...(starts.length ? { collectionStart: new Date(Math.min(...starts)).toISOString() } : {}),
    ...(end !== undefined ? { collectionEnd: new Date(end).toISOString() } : {}),
    freshness,
    coverage,
    confidence: freshness === "stale" || coverage < 50 || (type === "usage" && end === undefined)
      ? "low" : coverage >= 80 && freshness !== "unknown" ? "high" : "medium",
    coverageBasis: `Required-field completeness for ${type} evidence`,
  };
}

function wildcardMatches(value: string, pattern?: string): boolean {
  if (!pattern) return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function inferredFinding(row: CleanCoreEvidenceRow, type: CleanCoreEvidenceType) {
  const text = [row.finding, row.findingId, row.category, row.status, row.apiStatus, row.enhancementType, row.releaseStatus].filter(Boolean).join(" ");
  let level: "A" | "B" | "C" | "D" = "A";
  let category = row.category || (type === "interfaces" ? "Integration" : type === "usage" ? "Operations" : "Extensions");
  let reason = row.finding || row.status || "No non-clean-core finding in supplied evidence";
  if (type === "modifications" || /modification|direct\s+(table\s+)?write|implicit enhancement|unreleased api|not released|non.?compliant/i.test(text)) {
    level = "D";
    reason = row.finding || "Modification, implicit enhancement, direct write, or unreleased API evidence";
  } else if (/classic|explicit enhancement|customer exit|badi|wrapper|restricted|deprecated|warning|priority.?2/i.test(text)
      || type === "enhancements") {
    level = "C";
    reason = row.finding || "Classic or restricted extension evidence";
  } else if (/released|developer extensibility|abap cloud|key.?user|clean|compliant|approved/i.test(text)) {
    level = /key.?user|standard|no extension/i.test(text) ? "A" : "B";
    reason = row.finding || (level === "A" ? "Clean or key-user evidence" : "Released developer extensibility evidence");
  } else if (type === "atc" || type === "cloud-readiness" || type === "readiness-check") {
    level = /error|priority.?1|high|critical|\b1\b/i.test(text) ? "D" : "C";
    reason = row.finding || "Imported assessment finding";
  } else if (type === "interfaces") {
    level = /released|event|odata.?v4/i.test(text) ? "B" : "C";
    category = "Integration";
    reason = row.finding || "Interface release status requires review";
  }
  return { level, category, reason };
}

function applyOverride(
  objectName: string,
  finding: { level: "A" | "B" | "C" | "D"; category: string; reason: string; findingId?: string },
  overrides: ClassificationOverride[],
) {
  const matched = overrides.find((override) =>
    wildcardMatches(objectName, override.objectPattern)
    && (!override.finding || wildcardMatches(finding.reason, override.finding) || wildcardMatches(finding.findingId || "", override.finding))
    && wildcardMatches(finding.category, override.category));
  return matched ? {
    ...finding, level: matched.level,
    reason: matched.reason || `${finding.reason} (classification override applied)`,
    overridden: true,
    originalLevel: finding.level,
    originalReason: finding.reason,
    overrideReason: matched.reason || "Classification override applied",
  } : { ...finding, overridden: false };
}

function groupRollup(inventory: any[], key: string) {
  const groups = new Map<string, any[]>();
  for (const object of inventory) {
    const value = String(object[key] || "Unmapped");
    groups.set(value, [...(groups.get(value) || []), object]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, objects]) => ({
    name, count: objects.length,
    cleanCoreShare: Math.round((objects.filter((object) => object.classification === "A" || object.classification === "B").length / objects.length) * 1000) / 10,
    technicalDebtScore: Math.round(objects.reduce((sum, object) => sum + object.score, 0) * 10) / 10,
    levels: Object.fromEntries(["A", "B", "C", "D"].map((level) => [level, objects.filter((object) => object.classification === level).length])),
  }));
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `cc-${(hash >>> 0).toString(16)}`;
}

function normalizeRelease(value?: string): string {
  return (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function classifyReleaseRisk(status?: string): "low" | "medium" | "high" | "review" {
  const value = (status || "").toLowerCase();
  if (/blocked|incompatible|not.?available|removed|breaking|critical|high/.test(value)) return "high";
  if (/deprecated|restricted|changed|impacted|warning|medium/.test(value)) return "medium";
  if (/compatible|released|supported|unchanged|available|clean|passed?/.test(value)) return "low";
  return "review";
}

function buildMitigation(input: {
  objectName: string;
  disposition: string;
  classification: "A" | "B" | "C" | "D";
  successor: string | null;
  tier: string;
  dependencies: string[];
}) {
  const dependencyCheck = input.dependencies.length
    ? `Validate ${input.dependencies.length} identified dependency relationship(s) before changing the object.`
    : "Confirm inbound and outbound dependencies with repository and runtime evidence before changing the object.";
  if (input.disposition === "retire") {
    return {
      recommendedAction: `Confirm inactivity and retire ${input.objectName} through controlled decommissioning.`,
      targetPattern: "Decommissioned custom code",
      steps: [
        "Validate the usage window and confirm that no seasonal or background execution was missed.",
        "Obtain process-owner approval and identify dependent jobs, interfaces, roles, and transports.",
        "Block new changes, archive the source and configuration, then remove it through a governed transport.",
      ],
      validation: "No runtime calls, scheduled jobs, interface traffic, or unresolved dependents remain after the observation period.",
    };
  }
  if (input.classification === "D") {
    return {
      recommendedAction: `Redesign ${input.objectName} to remove the core modification or unreleased dependency.`,
      targetPattern: input.successor || (input.tier === "side-by-side-btp" ? "Side-by-side extension using released APIs or events" : "ABAP Cloud developer extensibility"),
      steps: [
        dependencyCheck,
        input.successor ? `Validate ${input.successor} as the released successor contract.` : "Identify a released SAP API, CDS view, event, or extension point for the required behavior.",
        "Build the replacement outside the modified core path and regression-test the affected business process.",
      ],
      validation: "The replacement uses only released contracts, passes ATC and process regression checks, and the original modification is removed.",
    };
  }
  if (input.classification === "C") {
    return {
      recommendedAction: `Remediate ${input.objectName} by replacing its classic or restricted extension contract.`,
      targetPattern: input.successor || "Released extension point or side-by-side integration",
      steps: [
        dependencyCheck,
        input.successor ? `Map current behavior to ${input.successor}.` : "Select the closest released extension point or integration contract.",
        "Migrate consumers incrementally and run contract plus business-process regression tests.",
      ],
      validation: "Restricted dependencies are removed and the remediated object passes clean-core checks against the target release.",
    };
  }
  return {
    recommendedAction: `Retain ${input.objectName} with clean-core governance and release monitoring.`,
    targetPattern: input.classification === "A" ? "Standard or key-user extensibility" : "Released developer extensibility",
    steps: [
      "Keep the released contract and ownership information documented.",
      "Monitor API lifecycle and target-release compatibility in each assessment cycle.",
      "Prevent new unreleased dependencies through ATC and transport governance.",
    ],
    validation: "The object remains on released contracts with current evidence and no new C/D findings.",
  };
}

function buildInterfaceMitigation(input: {
  objectName: string;
  interfaceName: string | null;
  interfaceType: string | null;
  releaseStatus: string | null;
  successor: string | null;
  dependencies: string[];
}) {
  const label = input.interfaceName || input.objectName;
  const text = `${input.interfaceType || ""} ${input.releaseStatus || ""}`.toLowerCase();
  if (/rfc|classic|restricted|unreleased|deprecated|not.?released/.test(text)) {
    return {
      recommendedAction: `Modernize ${label} away from the classic or unreleased contract.`,
      targetPattern: input.successor || "Released OData, SOAP, event, or SAP Integration Suite contract",
      steps: [
        "Identify every producer, consumer, service account, and operational dependency.",
        input.successor ? `Validate ${input.successor} as the supported replacement.` : "Select a released API or event contract and define a versioned target interface.",
        "Run both contracts in parallel where possible, complete consumer contract tests, then decommission the legacy endpoint.",
      ],
      validation: "All consumers use the released replacement, monitoring is active, and the legacy contract receives no traffic.",
    };
  }
  if (/event/.test(text)) {
    return {
      recommendedAction: `Retain ${label} as an event-driven integration with explicit schema governance.`,
      targetPattern: "Versioned released business event",
      steps: [
        "Document event owner, subscribers, schema version, retry behavior, and dead-letter handling.",
        "Validate subscriber compatibility and business idempotency.",
        "Monitor delivery failures and lifecycle announcements.",
      ],
      validation: "Schema compatibility, replay handling, ownership, and operational monitoring are confirmed.",
    };
  }
  if (/released|odata|soap|api/.test(text)) {
    return {
      recommendedAction: `Retain ${label} on its released contract and strengthen lifecycle governance.`,
      targetPattern: input.successor || "Versioned released interface contract",
      steps: [
        "Confirm the release status for the target S/4HANA version.",
        "Document producers, consumers, authentication, ownership, and service-level expectations.",
        "Add contract tests and monitor SAP lifecycle notices.",
      ],
      validation: "Contract tests pass, owners and consumers are known, and target-release support is documented.",
    };
  }
  return {
    recommendedAction: `Review ${label} because its protocol or release status is incomplete.`,
    targetPattern: "Documented released interface contract",
    steps: [
      "Complete the interface catalog with protocol, direction, systems, consumers, and owner.",
      "Verify release status and identify any restricted dependency.",
      "Choose retain, modernize, or retire based on verified runtime usage.",
    ],
    validation: "The interface has complete catalog evidence and an approved clean-core disposition.",
  };
}

export const CLEAN_CORE_SOLUTION_PATTERNS = {
  "standard-retain": {
    id: "standard-retain",
    label: "Use standard functionality",
    description: "Retain SAP standard behavior where evidence shows no extension requirement.",
    prerequisites: ["Confirm standard process fit and target-release regression evidence."],
    cautions: ["A clean technical finding alone does not prove business-process fit."],
  },
  "controlled-retire": {
    id: "controlled-retire",
    label: "Controlled retirement",
    description: "Decommission unused code after confirming no seasonal, background, interface, or dependent use.",
    prerequisites: ["Validate usage, clear dependents, and obtain process-owner approval."],
    cautions: ["Zero observed executions does not prove obsolescence."],
  },
  "key-user": {
    id: "key-user",
    label: "Key-user extensibility",
    description: "Use supported in-app extensibility for a bounded requirement.",
    prerequisites: ["Confirm a released extension point, owner, and transport governance."],
    cautions: ["Complex logic or orchestration is not a key-user fit."],
  },
  "released-developer": {
    id: "released-developer",
    label: "Released BAdI or API developer extensibility",
    description: "Implement in-stack through a released BAdI, API, CDS view, or extension contract.",
    prerequisites: ["Verify target-release status and map behavior to the contract."],
    cautions: ["A named successor remains a candidate until semantic fit is validated."],
  },
  "rap-abap-cloud": {
    id: "rap-abap-cloud",
    label: "RAP with ABAP Cloud",
    description: "Build an in-stack RAP service using released ABAP Cloud contracts.",
    prerequisites: ["Confirm transactional fit and released APIs and data models."],
    cautions: ["All dependencies must remain within the ABAP Cloud contract."],
  },
  "btp-cap": {
    id: "btp-cap",
    label: "SAP BTP side-by-side extension with CAP",
    description: "Keep differentiated logic outside the core, connected by released APIs or events.",
    prerequisites: ["Define boundaries, data ownership, contracts, and operations."],
    cautions: ["Replication, identity, resilience, and consistency require architecture review."],
  },
  "integration-suite": {
    id: "integration-suite",
    label: "Integration Suite API or event integration",
    description: "Use a released, versioned API or business event through governed integration.",
    prerequisites: ["Catalog consumers and verify target-release contract status."],
    cautions: ["Design versioning, retries, idempotency, and monitoring."],
  },
} as const;

type SolutionPatternId = keyof typeof CLEAN_CORE_SOLUTION_PATTERNS;

function buildSolutionRecommendation(input: {
  objectName: string;
  objectType: string;
  packageName: string;
  classification: "A" | "B" | "C" | "D";
  disposition: string;
  tier: string;
  top: any;
  findings: any[];
  records: { row: CleanCoreEvidenceRow; type: CleanCoreEvidenceType }[];
  usage: number;
  process: string | null;
  dependencies: string[];
  successor: string | null;
  interfaceName: string | null;
  interfaceType: string | null;
  releaseStatus: string | null;
}) {
  const technicalReason = (finding: any) => finding.overridden && finding.originalReason
    ? finding.originalReason
    : finding.reason;
  const signalText = [
    input.objectName, input.objectType, input.packageName, input.top.category, technicalReason(input.top),
    input.successor, input.interfaceName, input.interfaceType, input.releaseStatus,
    ...input.findings.map((finding) => `${finding.findingId || ""} ${technicalReason(finding) || ""}`),
  ].filter(Boolean).join(" ");
  let id: SolutionPatternId;
  let rule: string;
  if (input.disposition === "retire") {
    id = "controlled-retire"; rule = "REC-RETIRE-ZERO-USAGE";
  } else if (input.interfaceName || input.top.category === "Integration"
      || /interface|integration|rfc|idoc|odata|soap|business event|event mesh/i.test(signalText)) {
    id = "integration-suite"; rule = "REC-INTEGRATION-CONTRACT";
  } else if (input.classification === "A" && /standard|no extension/i.test(signalText)) {
    id = "standard-retain"; rule = "REC-STANDARD-CLEAN";
  } else if (input.classification === "A" || /key.?user/i.test(signalText)) {
    id = "key-user"; rule = "REC-KEY-USER";
  } else if (/badi|extension point/i.test(signalText) && (input.successor || /released|approved|clean|compliant/i.test(signalText))) {
    id = "released-developer"; rule = "REC-RELEASED-BADI";
  } else if (/btp|side.?by.?side|\bcap\b/i.test(signalText) || (input.tier === "side-by-side-btp" && !input.interfaceName)) {
    id = "btp-cap"; rule = "REC-BTP-CAP-BOUNDARY";
  } else if (/abap cloud|\brap\b|behavior definition|managed scenario/i.test(signalText)
      || (input.classification === "B" && /clas|ddls|prog/i.test(input.objectType))) {
    id = "rap-abap-cloud"; rule = "REC-RAP-ABAP-CLOUD";
  } else if (input.classification === "B" || input.classification === "C" || input.successor) {
    id = "released-developer"; rule = "REC-RELEASED-DEVELOPER";
  } else {
    id = "btp-cap"; rule = "REC-REDESIGN-SIDE-BY-SIDE";
  }

  const alternativesById: Record<SolutionPatternId, SolutionPatternId[]> = {
    "standard-retain": ["key-user"],
    "controlled-retire": ["standard-retain"],
    "key-user": ["released-developer"],
    "released-developer": ["rap-abap-cloud"],
    "rap-abap-cloud": ["btp-cap"],
    "btp-cap": ["rap-abap-cloud"],
    "integration-suite": ["btp-cap"],
  };
  const hasUsage = input.records.some(({ row, type }) =>
    type === "usage" && typeof row.usageCount === "number" && Number.isFinite(row.usageCount));
  const hasProcess = !!input.process && input.process !== "Unmapped";
  const hasInterface = input.records.some(({ row, type }) =>
    type === "interfaces" && !!(
      row.interfaceName || row.interfaceType || row.interfaceDirection || row.sourceSystem || row.targetSystem
    ));
  const releaseValues = input.records.flatMap(({ row }) =>
    [row.releaseStatus, row.apiStatus, row.status].filter((value): value is string => typeof value === "string" && !!value.trim()));
  const hasRelease = releaseValues.length > 0;
  const hasNegativeReleaseStatus = releaseValues.some((value) =>
    /\b(?:unreleased|not\s*released|non[-\s]?compliant|not\s*supported|unsupported|not\s*compatible|incompatible|not\s*available|restricted|deprecated|review|unknown|blocked|removed|changed|candidate)\b/i.test(value));
  const releaseConfirmed = !hasNegativeReleaseStatus && releaseValues.some((value) =>
    /\b(?:released|supported|compatible|approved|clean|compliant|standard)\b/i.test(value));
  const hasDependency = input.dependencies.length > 0;
  const missing = [
    !hasProcess && "business-process",
    !hasInterface && "interface",
    !hasUsage && "usage",
    !hasRelease && "release-status",
    !hasDependency && "dependency",
  ].filter((value): value is string => !!value);
  const pattern = CLEAN_CORE_SOLUTION_PATTERNS[id];
  const reasons = [
    `Level ${input.classification}/${input.disposition} matched ${rule}.`,
    `Usage: ${hasUsage ? input.usage.toLocaleString() : "unknown"}; successor: ${input.successor || "none"}; interface: ${input.interfaceName || "none"}.`,
  ];
  const validationQuestions = missing.map((item) => ({
    "business-process": "Which process and owner approve this pattern?",
    interface: "Which inbound/outbound producers and consumers must be preserved?",
    usage: "Which runtime window confirms actual and seasonal usage?",
    "release-status": "Is the target contract released for the target release?",
    dependency: "Which repository, job, role, interface, and runtime dependencies exist?",
  }[item]!));
  if (hasRelease && !releaseConfirmed) {
    validationQuestions.push("Which released target contract is confirmed for the target release?");
  }
  if (!validationQuestions.length) validationQuestions.push("Have process and architecture owners validated semantic fit?");
  const confidencePenalty = missing.length + (hasRelease && !releaseConfirmed ? 1 : 0);
  return {
    ...pattern,
    rationale: `${rule} selected this pattern from supplied evidence; architecture approval remains required.`,
    reasons,
    suitabilitySignals: [
      `Level ${input.classification}; ${input.disposition}`,
      input.interfaceType ? `Interface: ${input.interfaceType}` : `Object: ${input.objectType || "Unknown"}`,
      input.successor ? `Successor: ${input.successor}` : `Tier: ${input.tier}`,
    ],
    alternatives: alternativesById[id].map((alternativeId) => ({
      id: alternativeId,
      label: CLEAN_CORE_SOLUTION_PATTERNS[alternativeId].label,
    })),
    confidence: confidencePenalty === 0 ? "high" : confidencePenalty <= 2 ? "medium" : "low",
    validationQuestions,
    trace: {
      rule,
      override: input.top.overridden ? {
        applied: true,
        originalLevel: input.top.originalLevel,
        originalReason: input.top.originalReason,
        overriddenLevel: input.top.level,
        reason: input.top.overrideReason,
      } : { applied: false },
    },
  };
}

export function buildCleanCoreAssessment(input: {
  system: string;
  targetRelease: string;
  weighted: boolean;
  evidence: CleanCoreEvidenceSet[];
  classificationOverrides?: ClassificationOverride[];
}) {
  const overrides = input.classificationOverrides || [];
  const includesAutomatedEvidence = input.evidence.some((set) => set.metadata?.attested === true);
  const evidenceAuthority = includesAutomatedEvidence
    ? "Evidence-derived assessment from attested scheduled imports; it is not SAP certification."
    : "Evidence-derived assessment from user-uploaded files; it is not a live or authoritative SAP system result.";
  const all = input.evidence.flatMap((set) => set.rows.map((row) => ({ row, type: set.type })));
  const typesByName = new Map<string, Set<string>>();
  for (const { row } of all) {
    if (!row.objectType) continue;
    const name = row.objectName.toUpperCase();
    const types = typesByName.get(name) || new Set<string>();
    types.add(row.objectType.toUpperCase());
    typesByName.set(name, types);
  }
  const byObject = new Map<string, typeof all>();
  for (const item of all) {
    const name = item.row.objectName.toUpperCase();
    const inferredTypes = typesByName.get(name);
    const objectType = item.row.objectType?.toUpperCase()
      || (inferredTypes?.size === 1 ? [...inferredTypes][0] : "UNKNOWN");
    const key = `${objectType}::${name}`;
    byObject.set(key, [...(byObject.get(key) || []), item]);
  }
  const inventory = [...byObject.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, records]) => {
    const metadata = (field: keyof CleanCoreEvidenceRow) => records.map(({ row }) => row[field]).find((value) => value !== undefined && value !== "");
    const findings = records.map(({ row, type }) => {
      const result = applyOverride(row.objectName, { ...inferredFinding(row, type), findingId: row.findingId }, overrides);
      return {
        ...result,
        findingId: row.findingId,
        source: type,
        severity: row.severity,
        status: row.status,
        offendingSapObject: row.offendingSapObject,
        successor: row.successor,
        targetRelease: row.targetRelease,
        releaseStatus: row.releaseStatus,
      };
    }).sort((a, b) => LEVEL_VALUE[b.level] - LEVEL_VALUE[a.level] || a.reason.localeCompare(b.reason));
    const top = findings[0];
    const usageValue = metadata("usageCount");
    const hasUsageEvidence = typeof usageValue === "number" && Number.isFinite(usageValue);
    const usage = hasUsageEvidence ? usageValue : 0;
    const observedUsage = usageState(records.filter(r => r.type === "usage").map(r => r.row));
    const criticality = Math.min(5, Math.max(1, Number(metadata("processCriticality") || 1)));
    const weight = input.weighted ? (1 + Math.log10(usage + 1)) * criticality : 1;
    const levelValue = LEVEL_VALUE[top.level];
    const levelPoints = (levelValue - 1) * 25;
    const score = Math.round(levelPoints * weight * 10) / 10;
    const disposition = observedUsage === "not-in-use"
      ? "retire" : top.level === "A" || top.level === "B" ? "retain" : top.level === "C" ? "remediate" : "redesign";
    const tier = top.level === "A" ? "key-user" : top.level === "B" ? "developer-extensibility"
      : /interface|rfc|idoc|proxy|side.?by.?side/i.test(`${metadata("objectType")} ${top.category}`) ? "side-by-side-btp" : "developer-extensibility";
    const size = Number(metadata("size") || 0);
    const complexity = Number(metadata("complexity") || 0);
    const confidence = records.some(({ type }) => type === "object-metadata")
      && records.some(({ type }) => type === "usage") ? "high"
      : records.length >= 2 ? "medium" : "low";
    const objectName = records[0].row.objectName;
    const dependencies = [...new Set(records.map(({ row }) => row.dependency).filter((value): value is string => !!value))];
    const successor = String(top.successor || metadata("successor") || "") || null;
    const interfaceRecord = records.find(({ type }) => type === "interfaces")?.row;
    const interfaceName = String(interfaceRecord?.interfaceName || metadata("interfaceName") || "") || null;
    const interfaceType = String(interfaceRecord?.interfaceType || metadata("interfaceType") || "") || null;
    const releaseStatus = String(interfaceRecord?.releaseStatus || interfaceRecord?.status || metadata("releaseStatus") || top.releaseStatus || "") || null;
    const interfaceDirection = String(interfaceRecord?.interfaceDirection || metadata("interfaceDirection") || "") || null;
    const sourceSystem = String(interfaceRecord?.sourceSystem || metadata("sourceSystem") || "") || null;
    const targetSystem = String(interfaceRecord?.targetSystem || metadata("targetSystem") || "") || null;
    const topDetails = top as any;
    const dispositionReason = disposition === "retire"
      ? `${objectName} has zero recorded usage in the supplied usage evidence, so retirement is the default treatment pending owner confirmation.`
      : disposition === "redesign"
        ? `${objectName} has a Level D finding that indicates a core modification, direct access, or unreleased contract requiring redesign.`
        : disposition === "remediate"
          ? `${objectName} has a Level C classic or restricted extension that should be moved to a released contract.`
          : `${objectName} is on a standard or released extensibility path and can be retained with lifecycle governance.`;
    const matchedRule = top.findingId || `${top.source}:${top.category}`;
    const classificationExplanation = top.overridden
      ? `${objectName} is Level ${top.level} because a manual override was applied: ${topDetails.overrideReason}. The underlying evidence originally indicated Level ${topDetails.originalLevel}: ${topDetails.originalReason}.`
      : `${objectName} is Level ${top.level} because ${top.reason} The determining signal came from ${top.source}${top.findingId ? ` rule ${top.findingId}` : ""}.`;
    const supportingSignals = [...new Set([
      ...findings.slice(0, 4).map((finding) => `${finding.source}${finding.findingId ? ` · ${finding.findingId}` : ""}: ${finding.reason}`),
      records.some(({ type }) => type === "usage")
        ? `Usage evidence: ${usage.toLocaleString()} recorded execution(s).`
        : "Usage evidence was not supplied for this object.",
      `Process criticality: ${criticality} of 5.`,
      `Evidence coverage: ${records.length} record(s) from ${new Set(records.map(({ type }) => type)).size} source type(s).`,
    ])];
    const classificationReason = {
      summary: classificationExplanation,
      matchedRule,
      evidenceSource: top.source,
      dispositionReason,
      supportingSignals,
      override: top.overridden ? {
        applied: true,
        reason: topDetails.overrideReason,
        originalLevel: topDetails.originalLevel,
        originalReason: topDetails.originalReason,
      } : { applied: false },
    };
    const mitigation = buildMitigation({
      objectName,
      disposition,
      classification: top.level,
      successor,
      tier,
      dependencies,
    });
    const interfaceMitigation = interfaceName || top.category === "Integration"
      ? buildInterfaceMitigation({ objectName, interfaceName, interfaceType, releaseStatus, successor, dependencies })
      : null;
    const recommendation = buildSolutionRecommendation({
      objectName,
      objectType: String(metadata("objectType") || "Unknown"),
      packageName: String(metadata("package") || ""),
      classification: top.level,
      disposition,
      tier,
      top,
      findings,
      records,
      usage,
      process: String(metadata("process") || "") || null,
      dependencies,
      successor,
      interfaceName,
      interfaceType,
      releaseStatus,
    });
    return {
      id: stableId(`${input.system}:${key}`), system: input.system, objectName,
      objectType: metadata("objectType") || "Unknown", classification: top.level,
      classificationExplanation, classificationReason, score, highestPriorityFinding: top,
      findings, usage, usageCount: hasUsageEvidence ? usage : null, usageStatus: observedUsage,
      owner: metadata("owner") || "Unassigned", package: metadata("package") || "Unassigned",
      module: metadata("module") || "Unmapped", process: metadata("process") || "Unmapped",
      size, complexity, complexitySize: complexitySize(metadata("complexity")), lastChange: metadata("lastChange") || null, transport: metadata("transport") || null,
      offendingSapObject: top.offendingSapObject || metadata("offendingSapObject") || null,
      source: [...new Set(records.map(({ type }) => type))], confidence, disposition,
      extensibilityTier: tier, successor,
      interfaceName, interfaceType, releaseStatus, interfaceDirection, sourceSystem, targetSystem, interfaceMitigation,
      dependencies, mitigation, recommendation, recommendedSolution: recommendation.label,
      duplicateOf: metadata("duplicateOf") || null,
      dimension: top.category || "Extensions",
      processCriticality: criticality,
      scoringTrace: {
        version: "clean-core-score-v1",
        matchedFinding: {
          source: top.source,
          findingId: top.findingId || null,
          reason: top.reason,
          level: top.level,
          overridden: top.overridden,
        },
        levelValue,
        levelPoints,
        usageCount: usage,
        processCriticality: criticality,
        weighted: input.weighted,
        multiplier: Math.round(weight * 1000) / 1000,
        formula: "score = levelPoints × multiplier",
        score,
      },
    };
  });
  const clean = inventory.filter((object) => object.classification === "A" || object.classification === "B").length;
  const totalScore = inventory.reduce((sum, object) => sum + object.score, 0);
  const clusters = groupRollup(inventory, "process").map((cluster) => ({
    ...cluster,
    clusterId: stableId(`${input.system}:${cluster.name}`),
    dependencies: [...new Set(inventory.filter((object) => object.process === cluster.name).flatMap((object) => object.dependencies))],
    blastRadius: inventory.filter((object) => object.process === cluster.name)
      .reduce((sum, object) => sum + object.dependencies.length + (object.interfaceName ? 1 : 0), 0),
  }));
  const ranked = [...inventory].sort((a, b) =>
    b.score - a.score
    || b.processCriticality - a.processCriticality
    || b.dependencies.length - a.dependencies.length
    || a.objectName.localeCompare(b.objectName));
  const remediation = ranked.filter((object) => object.disposition !== "retain");
  const quickWins = remediation.filter((object) => object.disposition === "retire" || object.dependencies.length === 0).slice(0, 20);
  const waveDefinitions = [
    {
      wave: 1,
      name: "Retire unused custom code",
      objective: "Remove unused objects before redesign work begins so teams do not modernize code that no longer serves a business process.",
      rationale: "Objects with verified zero usage are isolated first because owner validation and controlled retirement reduce the change surface for later waves.",
      prerequisites: ["Use a representative usage window", "Confirm process-owner approval", "Check jobs, roles, interfaces, and repository dependencies"],
      mitigationSteps: ["Freeze new changes", "Archive source and configuration", "Retire through a governed transport", "Observe the landscape for unexpected calls"],
      expectedOutcome: "Unused custom code is removed and later remediation scope is smaller.",
      exitCriteria: ["No recorded execution during the agreed observation period", "No unresolved dependents", "Owner approval and retirement transport are recorded"],
      items: ranked.filter((object) => object.disposition === "retire"),
    },
    {
      wave: 2,
      name: "Contain critical core risks",
      objective: "Remove direct core modifications, unreleased APIs, and high-risk data access from active business processes.",
      rationale: "Level D objects create the greatest upgrade and regression exposure and must be contained before broader modernization.",
      prerequisites: ["Map business-process criticality", "Validate dependency and interface consumers", "Confirm a released successor or approved redesign pattern"],
      mitigationSteps: ["Freeze expansion of the risky pattern", "Design against released APIs, CDS views, events, or extension points", "Migrate and regression-test the business process", "Remove the original modification"],
      expectedOutcome: "Active Level D behavior is replaced by released clean-core contracts.",
      exitCriteria: ["No direct core modification remains", "ATC and target-release checks pass", "Process and interface regression evidence is approved"],
      items: ranked.filter((object) => object.disposition !== "retire" && object.classification === "D"),
    },
    {
      wave: 3,
      name: "Modernize classic extensions and interfaces",
      objective: "Move classic enhancements, restricted contracts, and legacy interfaces to released extensibility and integration patterns.",
      rationale: "Level C objects and classic interfaces are addressable after critical risks and shared dependencies are understood.",
      prerequisites: ["Complete producer and consumer inventory", "Select released replacement contracts", "Define coexistence and cutover controls"],
      mitigationSteps: ["Replace classic exits and restricted APIs", "Version interface contracts and add contract tests", "Migrate consumers in dependency order", "Decommission legacy endpoints after traffic reaches zero"],
      expectedOutcome: "Classic extensions and integrations operate on released, supportable contracts.",
      exitCriteria: ["Restricted contracts are removed", "All consumers pass contract tests", "Ownership and operational monitoring are documented"],
      items: ranked.filter((object) => object.disposition !== "retire" && object.classification === "C"),
    },
    {
      wave: 4,
      name: "Govern the compliant core",
      objective: "Keep standard and released extensions clean as the landscape evolves.",
      rationale: "Level A and B objects require lifecycle, ownership, and transport controls so new debt is not reintroduced.",
      prerequisites: ["Assign accountable owners", "Document released contracts", "Enable recurring evidence collection and ATC checks"],
      mitigationSteps: ["Monitor API lifecycle and target-release compatibility", "Block new unreleased dependencies", "Review exceptions and overrides", "Refresh evidence on the governance cadence"],
      expectedOutcome: "Clean objects remain compliant and future changes are detected early.",
      exitCriteria: ["Owners and contracts are documented", "Recurring checks are active", "No unresolved C/D findings are introduced"],
      items: ranked.filter((object) => object.disposition !== "retire" && (object.classification === "A" || object.classification === "B")),
    },
  ];
  const waves = waveDefinitions.map(({ items, ...wave }) => ({
    ...wave,
    count: items.length,
    objectIds: items.map((item) => item.id),
    interfaceIds: items.filter((item) => item.interfaceName || item.dimension === "Integration").map((item) => item.id),
    classificationMix: Object.fromEntries(["A", "B", "C", "D"].map((level) => [level, items.filter((item) => item.classification === level).length])),
    solutionPatterns: [...new Map(items.map((item) => [item.recommendation.id, item.recommendation])).values()]
      .map((recommendation) => ({
        id: recommendation.id,
        label: recommendation.label,
        count: items.filter((item) => item.recommendation.id === recommendation.id).length,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  }));
  const inventoryNames = new Set(inventory.map((object) => object.objectName.toUpperCase()));
  const coverageByType = Object.fromEntries(input.evidence.map((set) => {
    const names = new Set(set.rows.map((row) => row.objectName.toUpperCase()));
    const matched = [...inventoryNames].filter((name) => names.has(name)).length;
    return [set.type, inventoryNames.size ? Math.round((matched / inventoryNames.size) * 100) : 0];
  }));
  const usageCoverage = Number(coverageByType.usage || 0);
  const metadataCoverage = Number(coverageByType["object-metadata"] || 0);
  const usageSet = input.evidence.find((set) => set.type === "usage");
  const usageFreshness = String(usageSet?.metadata?.freshness || "unknown");
  const evidenceQuality = {
    confidence: usageCoverage >= 80 && metadataCoverage >= 80 && usageFreshness === "current" ? "high"
      : (usageCoverage >= 50 || metadataCoverage >= 50 || input.evidence.length >= 2) ? "medium" : "low",
    coverageByType,
    gaps: [
      ...(!input.evidence.some((set) => set.type === "usage") ? ["No usage evidence; dead-code conclusions are unavailable"] : []),
      ...(!input.evidence.some((set) => set.type === "object-metadata") ? ["No object metadata; ownership and transport coverage are limited"] : []),
      ...(input.evidence.some((set) => set.type === "usage") && usageCoverage < 80 ? [`Usage evidence covers ${usageCoverage}% of assessed object names`] : []),
      ...(input.evidence.some((set) => set.type === "object-metadata") && metadataCoverage < 80 ? [`Object metadata covers ${metadataCoverage}% of assessed object names`] : []),
      ...(usageSet && usageFreshness !== "current" ? [`Usage evidence freshness is ${usageFreshness}`] : []),
    ],
    provenance: input.evidence.map((set) => ({ type: set.type, count: set.rows.length, metadata: set.metadata || null })),
    authority: evidenceAuthority,
  };
  return {
    system: input.system, targetRelease: input.targetRelease, weighted: input.weighted,
    provenance: {
      engineVersion: "clean-core-heuristic-v1",
      generatedAt: new Date().toISOString(),
      authority: includesAutomatedEvidence
        ? "Deterministic heuristic assessment derived from attested scheduled evidence; not SAP certification."
        : "Deterministic heuristic assessment derived from user-uploaded evidence; not SAP certification.",
    },
    inventory,
    rollups: {
      bySystem: groupRollup(inventory, "system"), byPackage: groupRollup(inventory, "package"),
      byModule: groupRollup(inventory, "module"), byOwner: groupRollup(inventory, "owner"),
      byProcess: groupRollup(inventory, "process"), byDimension: groupRollup(inventory, "dimension"),
      byRecommendedSolution: groupRollup(inventory, "recommendedSolution"),
    },
    solutionRollups: [...new Map(inventory.map((object) => [object.recommendation.id, object.recommendation])).values()]
      .map((recommendation) => ({
        id: recommendation.id,
        label: recommendation.label,
        description: recommendation.description,
        count: inventory.filter((object) => object.recommendation.id === recommendation.id).length,
        confidence: Object.fromEntries(["high", "medium", "low"].map((level) => [
          level,
          inventory.filter((object) => object.recommendation.id === recommendation.id && object.recommendation.confidence === level).length,
        ])),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    cleanCoreShare: inventory.length ? Math.round((clean / inventory.length) * 1000) / 10 : 100,
    technicalDebtScore: Math.round(totalScore * 10) / 10,
    clusters,
    dependencySummary: {
      links: inventory.reduce((sum, object) => sum + object.dependencies.length, 0),
      objectsWithDependencies: inventory.filter((object) => object.dependencies.length).length,
      clusters: clusters.map(({ clusterId, name, blastRadius, dependencies }) => ({ clusterId, name, blastRadius, dependencies })),
    },
    blastRadiusSummary: [...clusters].sort((a, b) => b.blastRadius - a.blastRadius).slice(0, 20),
    levelD: inventory.filter((object) => object.classification === "D"),
    deadCode: inventory.filter((object) => object.usageStatus === "not-in-use"),
    duplicates: inventory.filter((object) => object.duplicateOf),
    integrations: inventory.filter((object) => object.interfaceName || object.dimension === "Integration"),
    recommendations: remediation.slice(0, 50).map((object) => ({
      objectId: object.id, objectName: object.objectName, priority: object.classification === "D" ? "critical" : "high",
      disposition: object.disposition, extensibilityTier: object.extensibilityTier, successor: object.successor,
      reason: object.classificationExplanation, mitigation: object.mitigation,
      recommendedSolution: object.recommendedSolution, recommendation: object.recommendation,
    })),
    roadmap: { waves }, roadmapWaves: waves, quickWins,
    upgradeRisk: inventory.flatMap<any>((object) => {
      const matchingEvidence = object.findings.filter((finding: any) =>
        normalizeRelease(finding.targetRelease) === normalizeRelease(input.targetRelease)
        && (finding.source === "cloud-readiness" || finding.source === "readiness-check" || !!finding.releaseStatus));
      if (matchingEvidence.length) {
        const riskRank = { low: 1, review: 2, medium: 3, high: 4 } as const;
        const contributors = matchingEvidence.map((finding: any) => ({
          source: finding.source,
          findingId: finding.findingId || null,
          releaseStatus: finding.releaseStatus || "review",
          risk: classifyReleaseRisk(finding.releaseStatus),
          explanation: finding.reason,
        })).sort((a: any, b: any) =>
          riskRank[b.risk as keyof typeof riskRank] - riskRank[a.risk as keyof typeof riskRank]
          || String(a.findingId || a.explanation).localeCompare(String(b.findingId || b.explanation)));
        const highest = contributors[0];
        return [{
        objectId: object.id,
        objectName: object.objectName,
        offendingSapObject: object.offendingSapObject || null,
        targetRelease: input.targetRelease,
        releaseStatus: highest.releaseStatus,
        risk: highest.risk,
        evidenceSource: highest.source,
        findingId: highest.findingId,
        contributors,
        explanation: `${contributors.length} imported release finding(s) are scoped to ${input.targetRelease}; highest status '${highest.releaseStatus}' maps to ${highest.risk} risk. ${highest.explanation}`,
        }];
      }
      if ((object.classification === "C" || object.classification === "D") && object.offendingSapObject) return [{
        objectId: object.id,
        objectName: object.objectName,
        offendingSapObject: object.offendingSapObject,
        targetRelease: input.targetRelease,
        releaseStatus: null,
        risk: "unverified",
        evidenceSource: null,
        findingId: null,
        contributors: [],
        explanation: `No imported release-impact evidence scoped to ${input.targetRelease}; target-release risk is unavailable and requires review.`,
      }];
      return [];
    }),
    totals: { objects: inventory.length },
    evidenceQuality, evidence: evidenceQuality,
  };
}