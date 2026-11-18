import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = new URL("./", import.meta.url).pathname;
const inputs = [
  ["BADI_SD_ROUTE.txt", "BADI_SD_ROUTE_1794969646645.txt"],
  ["Core_Clean_ENH_RTR.txt", "Core_Clean_ENH_RTR_1794969646645.txt"],
  ["PO_Agent_Determination.txt", "PO_Agent_Determination_1794969646645.txt"],
  ["ZOTC_EI_SO_DELETION_IDOC.txt", "ZOTC_EI_SO_DELETION_IDOC_1794969646645.txt"],
];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const originals = new Map();
for (const [name, workspaceName] of inputs) {
  const bytes = await readFile(join(root, "../../attached_assets", workspaceName));
  let encoding = "UTF-8", text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch {
    if (name !== "PO_Agent_Determination.txt") throw new Error(`Unexpected encoding: ${name}`);
    encoding = "Windows-1252 / ISO-8859-1 compatible for observed bytes";
    text = new TextDecoder("windows-1252", { fatal: true }).decode(bytes);
  }
  originals.set(name, { workspaceName, sha256: hash(bytes), encoding, lines: text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n") });
}

const objects = [
  { name: "ZIM_SCM_ROUTE", type: "BADI", file: "BADI_SD_ROUTE.txt", start: 1, end: 77,
    preambles: [1, 3, 5], technology: "Classic BAdI implementation (IF_EX interface)",
    dependencies: "BADI_SD_ROUTE; ZCL_IM_IM_SCM_ROUTE; SAPMV45A; RV_WEIGHT_GROUP_DETERMINE; TVARVC",
    description: "Implementation ZIM_SCM_ROUTE of BADI_SD_ROUTE; implementation class ZCL_IM_IM_SCM_ROUTE; supplied method IF_EX_BADI_SD_ROUTE~ROUTE_DETERMINATION. Implementation and class are linked here, not counted as separate inventory entries." },
  { name: "ZENH_RTRE040_IMG_CONTORL_DP", type: "ENHO", file: "Core_Clean_ENH_RTR.txt", start: 1, end: 27,
    preambles: [1], technology: "Enhancement snippet; exact enhancement subtype to confirm",
    dependencies: "/OPT/CL_C_IDX_UI_PLUGIN_IMAGE~PLUGIN_DATA_CONTEXT_SET; /OPT/VIM_1HEAD; LFB1; Z_6NX_AP",
    description: "Named enhancement label at /OPT/CL_C_IDX_UI_PLUGIN_IMAGE~PLUGIN_DATA_CONTEXT_SET; checks vendor authorization group and clears image archive identifiers when authorization fails. ENHO is inferred from the supplied enhancement label; confirm repository type." },
  { name: "ZENH_RTRE040_IMG_CNTRL_VIM_ATT", type: "ENHO", file: "Core_Clean_ENH_RTR.txt", start: 28, end: 45,
    preambles: [28], technology: "Enhancement snippet; exact enhancement subtype to confirm",
    dependencies: "/OPT/V_VA2_EXIT_ACTEXE_H_IMAGE; LFB1; Z_6NX_AP",
    description: "Named enhancement label at /OPT/V_VA2_EXIT_ACTEXE_H_IMAGE; checks vendor authorization group and exits on authorization failure. ENHO is inferred from the supplied enhancement label; confirm repository type." },
  { name: "ZENH_RTRE040_IMG_CONTORL_VA", type: "ENHO", file: "Core_Clean_ENH_RTR.txt", start: 46, end: 63,
    preambles: [46], technology: "Enhancement snippet; exact enhancement subtype to confirm",
    dependencies: "/OPT/CL_V_VA2_UI_PLUGIN_IMAGE~PLUGIN_DATA_CONTEXT_SET; LFB1; Z_6NX_AP",
    description: "Named enhancement label at /OPT/CL_V_VA2_UI_PLUGIN_IMAGE~PLUGIN_DATA_CONTEXT_SET; checks vendor authorization group and clears image archive identifiers on authorization failure. ENHO is inferred from the supplied enhancement label; confirm repository type." },
  { name: "ZXM06U51", type: "PROG", file: "PO_Agent_Determination.txt", start: 1, end: 41,
    preambles: [2, 3, 4, 5], technology: "Customer exit implementation include",
    dependencies: "ZPTP_PO; M06E0005; EXIT_SAPLEBNF_005; T001; ZUTIL_VALUE_TAB; AGR_USERS",
    description: "Implementation include ZXM06U51 for enhancement M06E0005 and function exit EXIT_SAPLEBNF_005; ZPTP_PO is the supplied customer project/exit label. Determines workflow actors using company country and configured roles. PROG denotes the include program; confirm repository registration in SAP." },
  { name: "ZOTC_EI_SO_DELETION_IDOC", type: "ENHO", file: "ZOTC_EI_SO_DELETION_IDOC.txt", start: 1, end: 127,
    preambles: [1], technology: "Enhancement implementation; exact enhancement subtype to confirm",
    dependencies: "SAPMV45A; USEREXIT_DELETE_DOCUMENT; ZSCM_UTIL_940; NAST; RSNAST0D; DEQUEUE_EVVBAKE",
    description: "ENHANCEMENT implementation in SAPMV45A at USEREXIT_DELETE_DOCUMENT; supplied comments describe outbound IDoc dispatch when a sales order is deleted. Explicit versus implicit enhancement subtype requires SAP confirmation." },
];
const provenance = (o, start = o.start, end = o.end) => `Source: ${o.file}, original lines ${start}-${end}. Source extract only; validate in SAP for S/4HANA 2025.`;
const common = o => ({ objectName: o.name, objectType: o.type, dependency: o.dependencies,
  status: "Source-derived; SAP validation pending", targetRelease: "S4HANA_2025" });

const metadata = objects.map(o => ({ ...common(o), finding: `${o.description} ${provenance(o)}` }));
const enhancements = objects.map((o, i) => ({ ...common(o), enhancementType: o.technology,
  findingId: `SOURCE-EXT-${String(i + 1).padStart(3, "0")}`, category: "Source-derived extension inventory",
  severity: "Info", finding: `${o.description} ${provenance(o)}` }));
const codeRows = [];
function observation(index, id, category, severity, text, start, end, offendingSapObject) {
  const o = objects[index];
  codeRows.push({ ...common(o), findingId: id, category, severity,
    finding: `Manual source observation, not an ATC result: ${text} ${provenance(o, start, end)}`,
    ...(offendingSapObject ? { offendingSapObject } : {}) });
}
observation(0, "SOURCE-CODE-001", "Cross-program coupling", "Warning",
  "Dynamic ASSIGN reads global data from SAPMV45A, including RV45A and XVBAP. Review supportability and target-system compatibility; contract status has not been verified.", 25, 44, "SAPMV45A");
observation(0, "SOURCE-CODE-002", "Function dependency", "Info",
  "Calls RV_WEIGHT_GROUP_DETERMINE. Validate the function contract and behavior on the target release; availability and release status are unverified.", 47, 58, "RV_WEIGHT_GROUP_DETERMINE");
observation(1, "SOURCE-CODE-003", "Database and vendor-extension dependency", "Info",
  "Reads /OPT/VIM_1HEAD and LFB1 and performs AUTHORITY-CHECK on Z_6NX_AP. Validate the installed vendor version, data-access contract and authorization behavior.", 2, 26, "LFB1");
observation(2, "SOURCE-CODE-004", "Database and authorization dependency", "Info",
  "Reads LFB1 and performs AUTHORITY-CHECK on Z_6NX_AP before EXIT. Validate the extension contract and authorization behavior.", 29, 44, "LFB1");
observation(3, "SOURCE-CODE-005", "Database and vendor-extension dependency", "Info",
  "Reads LFB1 and performs AUTHORITY-CHECK on Z_6NX_AP before clearing image archive identifiers. Validate the installed vendor version and extension contract.", 47, 63, "LFB1");
observation(4, "SOURCE-CODE-006", "Workflow-agent and role dependency", "Info",
  "Reads T001, ZUTIL_VALUE_TAB and AGR_USERS, then appends user actors to ACTOR_TAB. The shown country branch is DE; validate functional coverage and role-derived agent policy.", 8, 41, "AGR_USERS");
observation(5, "SOURCE-CODE-007", "Output processing dependency", "Info",
  "Reads NAST and calls SUBMIT RSNAST0D using a constructed selection table. Confirm output processing and configured IDoc message, partner and port details in SAP.", 35, 121, "RSNAST0D");
observation(5, "SOURCE-CODE-008", "Process-state coupling", "Info",
  "Exports ZSO_DEL to ABAP memory, calls DEQUEUE_EVVBAKE and later frees the memory ID. Review ordering, locking and failure paths in the complete surrounding process.", 35, 122, "DEQUEUE_EVVBAKE");

const interfaces = [{
  ...common(objects[5]), interfaceName: "Sales order deletion IDoc dispatch - source-derived candidate",
  interfaceType: "IDoc", interfaceDirection: "outbound",
  category: "Source-derived interface candidate", severity: "Info",
  findingId: "SOURCE-IF-001",
  finding: "Candidate only, not a confirmed live/configured interface. Comments name Bluejay and Newcold as recipients; code submits RSNAST0D with output medium 6. Actual partner profiles, message/basic types, ports, RFC destinations, endpoints and runtime usage are absent. " + provenance(objects[5], 1, 127),
}];
const csv = rows => {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const cell = v => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return keys.map(cell).join(",") + "\r\n" + rows.map(r => keys.map(k => cell(r[k])).join(",")).join("\r\n") + "\r\n";
};
const sets = [
  ["01_object_metadata.csv", "object-metadata", metadata],
  ["02_enhancements.csv", "enhancements", enhancements],
  ["03_custom_code_observations.csv", "custom-code", codeRows],
  ["04_interface_candidate.csv", "interfaces", interfaces],
];
await mkdir(join(root, "sources"), { recursive: true });
for (const [fileName, , rows] of sets) await writeFile(join(root, fileName), csv(rows), "utf8");

const sourceManifest = [];
for (const o of objects) {
  const original = originals.get(o.file);
  const lines = original.lines.slice(o.start - 1, o.end).map((line, i) => {
    if (o.preambles.includes(o.start + i)) return `* ${line.replaceAll("\u00a0", " ").trim()}`;
    return line;
  });
  const output = `${lines.join("\n")}\n`;
  const name = `sources/${o.name}.abap`;
  await writeFile(join(root, name), output, "utf8");
  sourceManifest.push({ objectName: o.name, output: name, sha256: hash(Buffer.from(output)),
    original: o.file, originalSha256: original.sha256, originalEncoding: original.encoding,
    originalStartLine: o.start, originalEndLine: Math.min(o.end, original.lines.length),
    normalizedLineFormula: `original line - ${o.start} + 1`,
    transformations: ["UTF-8 and LF line endings", "Prose headings converted to ABAP full-line comments; header NBSP characters changed to spaces", "No business-logic corrections; incomplete snippets remain incomplete"] });
}
const manifest = {
  description: "Source-derived evidence only. No usage, ATC, release-contract or runtime verification was fabricated.",
  evidenceFiles: sets.map(([fileName, evidenceType, rows]) => ({ fileName, evidenceType, rows: rows.length })),
  originals: [...originals].map(([fileName, v]) => ({ fileName, workspaceFile: v.workspaceName, sha256: v.sha256, encoding: v.encoding })),
  normalizedSources: sourceManifest,
};
await writeFile(join(root, "provenance_manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(join(root, "README.txt"), `NORMALIZED CLEAN CORE INPUTS

These files summarize the four supplied source extracts, not a complete SAP
inventory or a completed assessment. Six custom implementation/exit entries
were identified. The RTR source contains three separate enhancement snippets.
The BAdI implementation and its linked implementation class are not double-counted.

IMPORT ORDER (Evidence & Sources -> select evidence type -> upload CSV)
1. 01_object_metadata.csv -> Object metadata (object-metadata): 6 records.
2. 02_enhancements.csv -> Enhancements (enhancements): 6 records.
3. 03_custom_code_observations.csv -> Custom code (custom-code): 8 observations.
4. 04_interface_candidate.csv -> Interfaces (interfaces): 1 candidate, OPTIONAL.

Use the actual SAP system and target S/4HANA 2025. Start a fresh assessment or
back up first: importing REPLACES the current evidence set of the selected type.
Upload these combined files once each, not one file per source document.
After import, run the assessment. Treat classifications/recommendations as
provisional until independently validated.

SOURCE CODE
Attach sources/*.abap to the matching selected object/interface using:
Object Explorer or Interfaces -> Source code -> Choose File -> Review upload.
Do not import these ABAP files through Upload Evidence. They remain source
snippets, not necessarily complete compilable programs. Nothing is executed.
Each excerpt preserves business logic; only encoding, line endings and prose
headings were normalized. The PO extract was decoded from Windows-1252 /
ISO-8859-1-compatible bytes, including non-breaking spaces in its heading.
The three RTR excerpts were split at their supplied headings. Names such as
CONTORL are preserved exactly as supplied, not automatically corrected.

IMPORTANT LIMITATIONS
- No actual ATC/Cloud Readiness results were supplied. Do NOT import file 03 as ATC.
- No ST03N/SCMON/SUSG usage data was supplied. Missing usage is UNKNOWN, not zero.
- No automatic A/B/C/D level, API release status, size, complexity score, owner,
  package, collection period, transport or ambiguous change date was invented.
- ENHO/PROG identifiers inferred from labels/includes need SAP repository checks.
- The IDoc row is a source-comment/code-derived candidate, not proof of a live
  interface, its recipient systems, configuration or actual execution.
- SAP standard objects/dependencies are linked, not invented as custom objects.
- The linked class ZCL_IM_IM_SCM_ROUTE remains a dependency of ZIM_SCM_ROUTE;
  add its independent inventory record only if your chosen TADIR scope requires it.
- Add real TADIR/SE80, ATC, usage, enhancement and interface configuration extracts
  for a complete assessment. Do not overwrite a larger existing inventory with
  this six-record subset unless that is intentional.
- Source-review observations are human-readable source evidence, not certified
  security defects, SAP contract determinations or verified target-release failures.

PROVENANCE
CSV findings cite original filenames and original line ranges.
provenance_manifest.json records original/output SHA-256 checksums, encoding,
excerpt boundaries and the formula mapping normalized lines to original lines.
Do not upload this README or provenance_manifest.json as assessment evidence.
`);
console.log(JSON.stringify(manifest.evidenceFiles));
