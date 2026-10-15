import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createFont } from "./pdf-fontkit";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream, PDFHexString } from "pdf-lib";
import { createPdfText } from "./pdf-text";

const scripts = ["arabic", "hebrew", "devanagari", "bengali", "gujarati", "gurmukhi", "tamil", "telugu", "kannada", "malayalam", "oriya"];
const fonts = await Promise.all(scripts.map(script => {
  const family = script === "gurmukhi" ? "serif" : "sans";
  return readFile(new URL(`../../node_modules/@fontsource/noto-${family}-${script}/files/noto-${family}-${script}-${script}-400-normal.woff`, import.meta.url));
}));
const unicode = await readFile(new URL("../../node_modules/@fontsource/unifont/files/unifont-latin-400-normal.woff", import.meta.url));
const output = new URL("../../../../generated-artifacts/pdf-typography/", import.meta.url);

export const samples = [
  "العَرَبِيَّة: مراجعة (Z_ORDER_123) الإصدار 2026 — لا تغيير.",
  "עִבְרִית: בדיקה (Z_ORDER_123) גרסה 2026 — שָׁלוֹם.",
  "हिन्दी: क्षिति कि क्रिया श्रेणी (Z_ORDER_123) संस्करण 2026.",
  "বাংলা: পরীক্ষা ক্ষতি ক্রিয়া (Z_ORDER_123).",
  "ગુજરાતી: પરીક્ષણ ક્રિયા (Z_ORDER_123).",
  "ਪੰਜਾਬੀ: ਪ੍ਰੀਖਿਆ ਕਿਰਿਆ (Z_ORDER_123).",
  "தமிழ்: சோதனை செயல்பாடு (Z_ORDER_123).",
  "తెలుగు: పరీక్ష క్రియ (Z_ORDER_123).",
  "ಕನ್ನಡ: ಪರೀಕ್ಷೆ ಕ್ರಿಯೆ (Z_ORDER_123).",
  "മലയാളം: പരീക്ഷ ക്രിയ (Z_ORDER_123).",
  "ଓଡ଼ିଆ: ପରୀକ୍ଷା କ୍ରିୟା (Z_ORDER_123).",
];

test("shapes complex scripts, positions marks, preserves logical extraction and paragraph context", async () => {
  const document = await PDFDocument.create();
  const pdf = await createPdfText(document, unicode, fonts);
  const before = JSON.stringify(samples);
  const page = document.addPage([842, 595]);
  samples.forEach((sample, i) => pdf.draw(page, sample, { x: 46, y: 550 - i * 45, size: 17 }));
  const paragraph = `${samples[0]} ${samples[1]} ${samples[2]} `.repeat(8);
  const wrapped = pdf.wrapLines(paragraph, 350, 12);
  assert.ok(wrapped.length > 5);
  assert.ok(wrapped.every(line => pdf.width(line.text, 12) <= 350));
  assert.ok(wrapped.every(line => line.paragraph === paragraph.normalize("NFC")));
  assert.equal(wrapped.map(line => line.text).join("").replace(/\s/g, ""), paragraph.normalize("NFC").replace(/\s/g, ""));
  // Wrapping must retain paragraph direction when a continuation starts with Latin.
  const continuation = pdf.wrapLines("مرحبا Z_ORDER_123 (2026) مرحبا بالعالم", 100, 12);
  assert.ok(continuation.some(line => /^[A-Z]/.test(line.text)));
  assert.ok(continuation.every(line => line.paragraph.startsWith("مرحبا")));
  pdf.appendix(Object.freeze([paragraph, `LTR: Z_ORDER_123 / ${samples[0]} / END_456\n${"क्षि".repeat(140)}`]));
  assert.equal(JSON.stringify(samples), before);
  await mkdir(output, { recursive: true });
  const path = fileURLToPath(new URL("complex.pdf", output));
  await writeFile(path, await document.save());
  const extracted = execFileSync("pdftotext", ["-raw", path, "-"], { encoding: "utf8" });
  await writeFile(new URL("extracted.txt", output), extracted);
  // Poppler applies a display-oriented bidi conversion to RTL text. Verify the
  // PDF's logical ActualText independently, then verify Poppler's text output.
  const loaded = await PDFDocument.load(await readFile(path));
  const contents = loaded.getPage(0).node.Contents() as PDFArray;
  const streams = Array.from({ length: contents.size() }, (_, i) =>
    new TextDecoder().decode(decodePDFRawStream(contents.lookup(i, PDFRawStream)).decode())).join("");
  const logical = [...streams.matchAll(/\/ActualText\s*<([0-9a-f]+)>/gi)]
    .map(match => PDFHexString.of(match[1]).decodeText());
  for (const sample of samples) {
    assert.ok(logical.includes(sample.normalize("NFC")), `Missing logical text: ${sample}`);
    if (!/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(sample)) {
      assert.ok(extracted.includes(sample.normalize("NFC")), `Missing extracted text: ${sample}`);
    } else {
      for (const word of sample.match(/[\p{Script=Arabic}\p{Script=Hebrew}\p{M}]+/gu) || []) {
        assert.ok(extracted.includes([...word.normalize("NFC")].reverse().join("")), `Missing RTL extraction: ${word}`);
      }
    }
  }
  assert.equal((extracted.split("\n").slice(0, 11).join("\n").match(/Z_ORDER_123/g) || []).length, 11);
  execFileSync("pdftoppm", ["-f", "1", "-singlefile", "-scale-to", "1600", "-png", path, fileURLToPath(new URL("complex", output))]);
  execFileSync("pdftoppm", ["-f", "2", "-singlefile", "-scale-to", "1600", "-png", path, fileURLToPath(new URL("wrapped", output))]);
  // Reviewed raster snapshots (Poppler 26.06). Hashes avoid checking generated
  // binary assets into Git. Inspect both PNGs before deliberately updating.
  for (const [name, expected] of [
    ["complex", "ef1a2b4f66a88b68e7e43bfe693452a2fbe69ff9516f5554506b7e3882cf6c69"],
    ["wrapped", "29d9596e3bc1354f0f16b4dda6b5a06e46df6ee4f9123ea50c82318fda373a67"],
  ]) {
    const actual = createHash("sha256").update(await readFile(new URL(`${name}.png`, output))).digest("hex");
    assert.equal(actual, expected, `Visual PDF regression in ${name}.png (use Poppler 26.06)`);
  }

  // Regression invariants independent of ToUnicode / successful extraction.
  const arabic = createFont(fonts[0]);
  const arabicRun = arabic.layout("العَرَبِيَّة");
  assert.equal(arabicRun.direction, "rtl");
  assert.ok(arabicRun.positions.some(position => position.xOffset !== 0 || position.yOffset !== 0), "Arabic marks must be positioned");
  assert.notDeepEqual(arabicRun.glyphs.map(glyph => glyph.id), arabic.glyphsForString("العَرَبِيَّة").map(glyph => glyph.id));
  const hebrew = createFont(fonts[1]).layout("שָׁלוֹם");
  assert.ok(hebrew.positions.some(position => position.xOffset !== 0 || position.yOffset !== 0), "Hebrew marks must be positioned");
  const indic = createFont(fonts[2]);
  assert.notDeepEqual(indic.layout("क्षिति").glyphs.map(glyph => glyph.id), indic.glyphsForString("क्षिति").map(glyph => glyph.id), "Indic conjuncts and pre-base matras must be shaped");
});
