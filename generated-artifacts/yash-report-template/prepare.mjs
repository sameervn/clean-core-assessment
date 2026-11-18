import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const PizZip = require("pizzip");
const { XMLParser, XMLBuilder } = require("fast-xml-parser");
const base = new URL("../../", import.meta.url);
const original = await readFile(new URL("attached_assets/S4HANA_CleanCore_CustomCode_(1)_1794978067646.docx", base));
const zip = new PizZip(original, { checkCRC32: true });
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, parseTagValue: false, trimValues: false });
const builder = new XMLBuilder({ preserveOrder: true, ignoreAttributes: false, suppressEmptyNode: true });
const tree = parser.parse(zip.file("word/document.xml").asText());
const paragraphs = [];
const tables = [];
const plain = a => Array.isArray(a) ? a.map(n => Object.entries(n).filter(([k]) => k !== ":@").map(([k,v]) => k === "#text" ? String(v) : plain(v)).join("")).join("") : "";
function walk(a) {
  if (!Array.isArray(a)) return;
  for (const n of a) {
    if (n["w:p"]) paragraphs.push(n);
    if (n["w:tbl"]) tables.push(n["w:tbl"]);
    for (const [k,v] of Object.entries(n)) if (k !== ":@") walk(v);
  }
}
walk(tree);
if (paragraphs.length !== 107 || plain(paragraphs[30]["w:p"]).startsWith("ZFILE100") !== true) throw new Error("Unexpected source layout; inspect before converting.");
function set(index, value) {
  const p = paragraphs[index]["w:p"];
  const pr = p.find(n => n["w:pPr"]);
  const runPr = p.find(n => n["w:r"])?.["w:r"].find(n => n["w:rPr"]);
  paragraphs[index]["w:p"] = [
    ...(pr ? [pr] : []),
    { "w:r": [...(runPr ? [runPr] : []), ...value.split("\n").flatMap((s,i) => [
      ...(i ? [{ "w:br": [] }] : []),
      { "w:t": [{ "#text": s }], ":@": { "@_xml:space": "preserve" } },
    ])] },
  ];
}
const notProvided = "Not provided — requires documented object/interface evidence.";
const replacements = {
  1: "SAP Custom Object / Interface Assessment",
  3: "Object / Interface", 4: "{entity_id}\nKind: {entity_kind}",
  6: "Not provided", 8: "Not provided", 10: "Not provided", 12: "Not provided",
  14: "Documented standard fit and the assessed Clean Core approach. Product/app availability must be verified for the target release.",
  16: "Clean Core assessment", 18: "Not provided", 19: "Assessment classification",
  20: "{classification}", 22: "Not provided", 24: "Not provided",
  26: "Standard fit not provided; validate against the target release.",
  28: "Target: {target_release}\nComplexity: {complexity}\nRecommended mitigation: {mitigation}",
  30: "{rationale}\nAccepted AI explanation (if present): {ai_explanations}",
  32: "Assessment narrative / business context as documented:\n{notes}",
  33: "5. Object / Interface Overview",
  34: "Name: {entity_name}\nType: {entity_type}\nPackage: {package}\nOwner: {owner}\nSource system: {source_system}\nTarget system: {target_system}\nTarget release: {target_release}",
  36: notProvided, 38: notProvided, 40: notProvided,
  48: "Not provided", 49: "Not provided", 50: "Not provided",
  51: "Not provided", 52: "Not provided", 53: "Validate against source and data dictionary.",
  61: notProvided, 63: "Business/program outputs: Not provided.\nAssessment recommendations:\n{#recommendations}{text}{/recommendations}",
  65: "Documented integration context:\nSource: {source_system}\nTarget: {target_system}\nAdditional interface configuration: Not provided.",
  67: notProvided, 69: notProvided, 71: notProvided,
  73: "Assessed complexity: {complexity}\nMeasured runtime/performance evidence: Not provided.",
  75: "Assessment evidence and provenance (may include dependency references):\n{evidence}",
  77: "Assessment findings requiring review:\n{#findings}{text} (Severity: {severity}){/findings}\nOnly supplied evidence supports this report; absent functional/configuration details are not inferred.",
  79: "Not provided as a structured change history. Use the saved assessment revision/approval history. Any approval metadata included in the narrative remains in section 4.",
  85: "{entity_type}", 86: "{entity_id}", 87: "{entity_name}",
  88: "Kind: {entity_kind}; classification: {classification}; complexity: {complexity}",
  105: "Functional Forms Inventory: Not provided.",
  106: "Key Technical Features: Not provided as a separate verified inventory. Refer to the assessment narrative, evidence and findings above.",
};
for (const [i,value] of Object.entries(replacements)) set(Number(i), value);
for (const tbl of tables) {
  const rows = tbl.filter(n => n["w:tr"]);
  const heading = plain(rows[0]?.["w:tr"]);
  if (heading.startsWith("Table Name") || heading.startsWith("Object Type")) {
    let count = 0;
    for (let i = 0; i < tbl.length; i++) if (tbl[i]["w:tr"] && ++count > 2) { tbl.splice(i--,1); }
  }
}
zip.file("word/document.xml", builder.build(tree));
// The source has Word custom metadata. Remove only these unsupported parts and
// their relationships/content-type declarations; do not weaken the validator.
const removed = Object.keys(zip.files).filter(n => n.startsWith("customXml/") || n === "docProps/custom.xml");
for (const n of removed) zip.remove(n);
for (const name of ["_rels/.rels", "word/_rels/document.xml.rels"]) {
  zip.file(name, zip.file(name).asText().replace(/<Relationship\b[^>]*\bType="[^"]*\/(?:customXml|custom-properties)"[^>]*\/>/g, ""));
}
zip.file("[Content_Types].xml", zip.file("[Content_Types].xml").asText().replace(/<Override\b[^>]*\bPartName="\/(?:customXml\/[^"]+|docProps\/custom\.xml)"[^>]*\/>/g, ""));
for (const f of Object.values(zip.files)) {
  if (!/\.(xml|rels)$/.test(f.name)) continue;
  const xml = f.asText().replace(/<w:shapeDefaults>[\s\S]*?<\/w:shapeDefaults>/g, "");
  if (xml.includes('xmlns:v="urn:schemas-microsoft-com:vml"')) {
    if (/<\/?v:|\sv:[a-z]/i.test(xml)) throw new Error(`Actual VML content cannot be converted automatically: ${f.name}`);
    zip.file(f.name, xml.replace(/\sxmlns:v="urn:schemas-microsoft-com:vml"/g, ""));
  }
}
zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>YASH Clean Core Object and Interface Assessment</dc:title><dc:creator>YASH Technologies</dc:creator></cp:coreProperties>`);
const bytes = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
const engine = await import(new URL("artifacts/api-server/src/reports/engine.mjs", base));
await engine.validate(bytes);
const xml = zip.file("word/document.xml").asText();
if (/ZFILE100|ZFILE_CFG|ZFILE_FMT|CG3Y|CLOSE DATASET|10-Jan-2026|F_BKPF_BUK|FILL_FILE_LIST/.test(xml)) throw new Error("Original example data remains.");
const { example } = await import(new URL("artifacts/api-server/src/reports/contract.mjs", base));
for (const kind of ["object", "interface"]) {
  const rendered = engine.render(bytes, { ...example, entity_id: `EXAMPLE_${kind.toUpperCase()}_ONLY`, entity_kind: kind, entity_name: `Fictional ${kind} — layout preview only` });
  await writeFile(new URL(`YASH_${kind}_layout_preview.docx`, import.meta.url), rendered);
}
await writeFile(new URL("YASH_Clean_Core_Reusable_Template.docx", import.meta.url), bytes);
await writeFile(new URL("artifacts/api-server/src/reports/yash-clean-core.docx", base), bytes);
await writeFile(new URL("conversion-notes.txt", import.meta.url), `Retained the 20 numbered sections, original table structure (with sample-only spare data rows removed), styles, theme, numbering and embedded PNG branding.\nReplaced ZFILE100 sample data with supported literal placeholders or explicit Not provided text.\nRemoved unsupported custom XML and custom properties and their references. No report validator restrictions were relaxed.\nUncollected functional fields are explicitly Not provided; narrative, classification, recommendations, findings, complexity, evidence and accepted AI explanations use the existing report model.\nOriginal SHA-256: ${createHash("sha256").update(original).digest("hex")}\nReusable template SHA-256: ${createHash("sha256").update(bytes).digest("hex")}\nPreviews contain fictional data only.\n`);
console.log(`Validated reusable DOCX (${bytes.length} bytes), with object/interface previews.`);
