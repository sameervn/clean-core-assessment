// Exercise the actual frontend export handler without browser automation.
// Compile the checked-in TypeScript handler and its local helpers in memory.
import fs from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const frontRequire = createRequire(new URL("../../artifacts/clean-core/package.json", import.meta.url));
const serverRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { transformSync } = serverRequire("esbuild");
const source = fs.readFileSync(new URL("../../artifacts/clean-core/src/pages/clean-core-assessment.tsx", import.meta.url), "utf8");
const helpers = source.slice(source.indexOf("const EVIDENCE_TYPES"), source.indexOf("export default function")).replace(/^export /gm, "");
const exportHandler = source.slice(source.indexOf("  const handleExport = async"), source.indexOf("  const aiReviewQueue ="));
assert.ok(exportHandler.includes("downloadBlob"), "Export handler found");
const exportModules = ["pdf-lib", "pptxgenjs", "write-excel-file/browser"];
for (const name of exportModules) {
  assert.ok(!source.replace(/^import type .*;$/gm, "").includes(`from "${name}"`), `${name} must not be eagerly imported`);
  assert.ok(exportHandler.includes(`import("${name}")`), `${name} loads inside the export handler`);
}
const csvSource = fs.readFileSync(new URL("../../artifacts/clean-core/src/lib/csv.ts", import.meta.url), "utf8").replaceAll("export ", "");
const aiSource = fs.readFileSync(new URL("../../artifacts/clean-core/src/lib/ai-narratives.ts", import.meta.url), "utf8").replace(/^import type .*;$/gm, "").replaceAll("export ", "");
// Inject only the module loader so we can capture downloads and simulate a
// failed chunk fetch while still exercising real report generators.
const testHandler = exportHandler.replaceAll('import("', 'loadExportModule("');
const js = transformSync(`${helpers}\n${csvSource}\n${aiSource}\n${testHandler}\nreturn handleExport;`, { loader: "tsx", format: "cjs", target: "es2022" }).code;
const { tsImport } = await import(pathToFileURL(serverRequire.resolve("tsx/esm/api")).href);
const { exportSourceVersions } = await tsImport("../../artifacts/clean-core/src/lib/source-versions.ts", import.meta.url);
const engine = await tsImport("../../artifacts/api-server/src/clean-core-assessment.ts", import.meta.url);
const { attestEvidenceValue } = await tsImport("../../artifacts/api-server/src/evidence-attestation.ts", import.meta.url);
const evidence = engine.buildCleanCoreDemoEvidence("PRD", "S4HANA_2023").map(set => ({
  ...set, fileName: `Demo · ${set.type}.json`, count: set.rows.length, attestation: attestEvidenceValue(set),
}));
const demo = JSON.parse(JSON.stringify({ evidence, assessment: engine.buildCleanCoreAssessment({ system: "PRD", targetRelease: "S4HANA_2023", weighted: true, evidence }) }));
const files = [];
const errors = [];
const modules = Object.fromEntries(await Promise.all(exportModules.map(async name =>
  [name, await import(pathToFileURL(frontRequire.resolve(name)).href)],
)));
const { PDFDocument } = modules["pdf-lib"];
const { default: readExcelFile } = await import(pathToFileURL(frontRequire.resolve("read-excel-file/node")).href);
const pdfHelpers = {
  "@/lib/pdf-fonts": {
    loadPdfScriptFonts: async () => {
      const fontsSource = fs.readFileSync(new URL("../../artifacts/clean-core/src/lib/pdf-fonts.ts", import.meta.url), "utf8");
      return [...fontsSource.matchAll(/import\("([^"]+)\?url"\)/g)].map(([, name]) => new Uint8Array(fs.readFileSync(frontRequire.resolve(name))));
    },
  },
  "@/lib/pdf-text": await tsImport("../../artifacts/clean-core/src/lib/pdf-text.ts", import.meta.url),
  "@/lib/pdf-recommendations": await tsImport("../../artifacts/clean-core/src/lib/pdf-recommendations.ts", import.meta.url),
  "@fontsource/unifont/files/unifont-latin-400-normal.woff?url": {
    default: `data:font/woff;base64,${fs.readFileSync(frontRequire.resolve("@fontsource/unifont/files/unifont-latin-400-normal.woff")).toString("base64")}`,
  },
};
const PptxGenJS = modules.pptxgenjs.default;
const loads = [];
let failLoad = false;
async function loadExportModule(name) {
  loads.push(name);
  if (failLoad) throw new Error("Report library could not be loaded");
  if (name in pdfHelpers) return pdfHelpers[name];
  assert.ok(exportModules.includes(name));
  return name === "pptxgenjs" ? { ...modules[name], default: DownloadablePptx } : modules[name];
}
class DownloadablePptx extends PptxGenJS {
  async writeFile({ fileName }) {
    const content = await this.write({ outputType: "nodebuffer" });
    files.push({ content, name: fileName, mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    return fileName;
  }
}
const aiNarratives = {
  [`object:${demo.assessment.inventory[0].id}`]: { text: "Mock AI explanation for export verification.", provider: "openai", model: "test-model", generatedAt: "2026-01-01T00:00:00Z", acceptedAt: "2026-01-01T00:01:00Z" },
};
const handler = new Function("assessment", "evidence", "system", "targetRelease", "narratives", "baseline", "aiNarratives",
  "loadExportModule", "downloadBlob", "toast", "guarded", "exportSourceVersions", js)(
  demo.assessment, demo.evidence, "PRD", "S4HANA_2023", {}, null, aiNarratives,
  loadExportModule,
  (content, name, mime) => files.push({ content, name, mime }), (value) => errors.push(value), async (_permission, action) => action(), exportSourceVersions,
);
for (const type of ["Full JSON", "CSV Details", "Exec Summary", "Excel", "PowerPoint", "PDF", "Evidence Pack"]) {
  const before = files.length;
  loads.length = 0;
  await handler(type);
  const expectedModule = { Excel: "write-excel-file/browser", PowerPoint: "pptxgenjs", PDF: "pdf-lib" }[type];
  assert.deepEqual(loads, type === "PDF" ? ["pdf-lib", "@/lib/pdf-text", "@fontsource/unifont/files/unifont-latin-400-normal.woff?url", "@/lib/pdf-recommendations", "@/lib/pdf-fonts"]
    : expectedModule ? [expectedModule] : [], `${type} loads only its own generator`);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(files.length, before + 1, `${type} generates a download`);
  const file = files.at(-1);
  const bytes = Buffer.from(await new Blob([file.content]).arrayBuffer());
  assert.ok(bytes.length > 100, `${type} is not empty`);
  if (file.name.endsWith(".xlsx")) {
    const workbook = await readExcelFile(bytes, { trim: false });
    assert.deepEqual(workbook.map(sheet => sheet.sheet), ["Accepted AI Explanations", "Overview", "Object Inventory", "Mitigation Roadmap"]);
    assert.equal(workbook.find(sheet => sheet.sheet === "Object Inventory").data.length, 4001);
    const [overviewHeaders, overview] = workbook.find(sheet => sheet.sheet === "Overview").data;
    assert.equal(overview[overviewHeaders.indexOf("totalObjects")], 4000, "Excel numbers remain numeric");
    const [headers, note] = workbook.find(sheet => sheet.sheet === "Accepted AI Explanations").data;
    assert.match(note[headers.indexOf("attribution")], /AI-generated/);
  } else if (file.name.endsWith(".pdf")) {
    assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 2);
  } else if (file.name.endsWith(".pptx")) {
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
  } else if (file.name.endsWith(".json")) {
    assert.ok(JSON.parse(bytes.toString()));
    if (type === "Full JSON") assert.match(JSON.parse(bytes.toString()).acceptedAiExplanations[0].attribution, /AI-generated/);
  } else if (["CSV Details", "Exec Summary"].includes(type)) {
    assert.match(bytes.toString(), /AI-generated/);
  }
  console.log(`PASS ${type}: ${file.name} (${bytes.length} bytes)`);
}
// Exported user text must not become a formula, and empty sections must still
// produce named worksheets when there is no accepted AI appendix.
const subject = Object.keys(aiNarratives)[0];
const originalNote = { ...aiNarratives[subject] };
aiNarratives[subject].text = '  =HYPERLINK("https://example.invalid","not a formula")\nRetain whitespace.  ';
await handler("Excel");
let sheets = await readExcelFile(Buffer.from(await files.at(-1).content.arrayBuffer()), { trim: false });
let [headers, note] = sheets.find(sheet => sheet.sheet === "Accepted AI Explanations").data;
assert.equal(note[headers.indexOf("text")], aiNarratives[subject].text);
delete aiNarratives[subject];
const inventory = demo.assessment.inventory;
const waves = demo.assessment.roadmap.waves;
demo.assessment.inventory = [];
demo.assessment.roadmap.waves = [];
await handler("Excel");
sheets = await readExcelFile(Buffer.from(await files.at(-1).content.arrayBuffer()));
assert.deepEqual(sheets.map(sheet => sheet.sheet), ["Overview", "Object Inventory", "Mitigation Roadmap"]);
assert.equal(sheets.find(sheet => sheet.sheet === "Object Inventory").data.length, 0);
demo.assessment.inventory = inventory;
demo.assessment.roadmap.waves = waves;
aiNarratives[subject] = originalNote;
assert.equal(errors.length, 0, JSON.stringify(errors));
console.log("PASS Excel: numeric cells, literal formula-like text, whitespace and empty sections");
for (const type of ["Excel", "PowerPoint", "PDF"]) {
  failLoad = true;
  const before = files.length;
  await handler(type);
  assert.equal(files.length, before, "A failed import does not download a report");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].title, `${type} export failed`);
  assert.equal(errors[0].variant, "destructive");
  assert.match(errors[0].description, /Report library could not be loaded/);
  errors.length = 0;
  failLoad = false;
  await handler(type);
  assert.equal(errors.length, 0, `${type} can retry after a failed load`);
  assert.equal(files.length, before + 1);
  console.log(`PASS ${type}: library-load failure toast and retry`);
}
const storeSource = fs.readFileSync(new URL("../../artifacts/clean-core/src/lib/workspace-store.ts", import.meta.url), "utf8")
  .replace(/^import type .*;$/gm, "").replaceAll("export ", "");
const storeJs = transformSync(`${storeSource}\nreturn { validateWorkspace, buildBackup, parseBackup };`, { loader: "ts", target: "es2022" }).code;
const store = new Function(storeJs)();
const ws = { system: "PRD", targetRelease: "S4HANA_2023", weighted: true, evidence: demo.evidence,
  assessment: demo.assessment, classificationOverrides: null, narratives: {}, baseline: null };
const withAi = { ...ws, narratives: { expert: "Existing expert note" }, aiNarratives };
const restoredAi = store.parseBackup(JSON.stringify(store.buildBackup(withAi)));
assert.ok(restoredAi.ok);
assert.deepEqual(restoredAi.workspace.aiNarratives, aiNarratives);
assert.deepEqual(restoredAi.workspace.narratives, withAi.narratives);
assert.ok(store.parseBackup(JSON.stringify(store.buildBackup(ws))).ok, "Older backups without AI remain supported");
const invalidAi = structuredClone(withAi);
invalidAi.aiNarratives[Object.keys(aiNarratives)[0]].provider = "invalid";
assert.equal(store.validateWorkspace(invalidAi).ok, false, "Invalid AI attribution rejected");
const aiHelpers = new Function(transformSync(`${aiSource}\nreturn { explanationSummary };`, { loader: "ts" }).code)();
const minimal = aiHelpers.explanationSummary("interface", { ...demo.assessment.inventory[0], sourceCode: "PRIVATE", notes: "PRIVATE", objectName: "PRIVATE" });
assert.deepEqual(Object.keys(minimal).sort(), ["classification", "confidence", "kind", "recommendation"]);
assert.ok(!JSON.stringify(minimal).includes("PRIVATE"));
assert.equal(store.validateWorkspace(ws).ok, true, "demo workspace validates");
assert.equal(store.parseBackup(JSON.stringify(store.buildBackup(ws))).ok, true, "demo backup roundtrips");
assert.equal(store.parseBackup('{"format":"bad"}').ok, false);
assert.equal(store.parseBackup("{broken").ok, false);
assert.equal(store.validateWorkspace({ ...ws, assessment: { inventory: [{ id: "fake" }] } }).ok, false);
console.log("PASS workspace backup roundtrip and malformed backup rejection");
