import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createPdfText } from "./pdf-text";

const fontBytes = await readFile(new URL("../../node_modules/@fontsource/unifont/files/unifont-latin-400-normal.woff", import.meta.url));

test("wraps measured Unicode paragraphs, blank lines, and long identifiers without losing text", async () => {
  const pdf = await createPdfText(await PDFDocument.create(), fontBytes);
  const source = "Café naïve München Ελληνικά Привет\n\n对象：日本語 한국어\n" + "界".repeat(220) + "\n" + "W".repeat(190);
  const lines = pdf.wrap(source, 750, 10);
  assert.equal(lines[1], "");
  assert.ok(lines.every(line => pdf.width(line, 10) <= 750));
  assert.equal(lines.join("").replaceAll(" ", ""), source.replace(/\s/g, ""));
  assert.deepEqual(pdf.wrap("one\r\n\r\ntwo\n", 750, 10), ["one", "", "two", ""]);
  // No split through decomposed accents; normalization is only in the PDF copy.
  assert.deepEqual(pdf.wrap("Cafe\u0301", 750, 10), ["Café"]);
});

test("embeds Unicode in multi-page accepted explanations with extractable text and bounded placement", async () => {
  const document = await PDFDocument.create();
  const pdf = await createPdfText(document, fontBytes);
  const subject = "Subject: Z_Überprüfung_客户_日本語_한국어_Проверка";
  const paragraph = "Café naïve — Ελληνικά Привет 中文 日本語 한국어. " + "界".repeat(110);
  const entries = Object.freeze([
    `${subject}\nAccepted AI explanation — not deterministic assessment.\n\n${Array.from({ length: 75 }, (_, i) => `${i}: ${paragraph}`).join("\n\n")}\nEND-OF-LONG-EXPLANATION`,
    "Interface: Échange_接口\nDernière explication acceptée.",
  ]);
  const before = JSON.stringify(entries);
  pdf.appendix(entries);
  assert.equal(JSON.stringify(entries), before);
  assert.ok(document.getPageCount() > 5);
  const directory = await mkdtemp(join(tmpdir(), "unicode-pdf-"));
  try {
    const path = join(directory, "report.pdf");
    await writeFile(path, await document.save());
    const extracted = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" });
    for (const expected of [subject, "Café naïve", "Ελληνικά Привет", "中文 日本語 한국어", "END-OF-LONG-EXPLANATION", entries[1].split("\n")[0]]) {
      assert.ok(extracted.includes(expected), `Missing text: ${expected}`);
    }
    assert.ok(extracted.includes("(continued)"));
    assert.ok(!extracted.includes("?"));
    assert.equal((extracted.match(/Café naïve/g) || []).length, 75);
    const boxes = execFileSync("pdftotext", ["-bbox", path, "-"], { encoding: "utf8" });
    for (const match of boxes.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g)) {
      assert.ok(Number(match[1]) >= 45 && Number(match[3]) <= 797, `Text exceeds horizontal margins: ${match[0]}`);
      assert.ok(Number(match[2]) >= 20 && Number(match[4]) < 560, `Text exceeds vertical margins: ${match[0]}`);
    }
    assert.ok(boxes.includes("<word "));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fails visibly for unsupported characters rather than silently substituting question marks", async () => {
  const pdf = await createPdfText(await PDFDocument.create(), fontBytes);
  assert.throws(() => pdf.wrap("Not supported: \u{10ffff}", 750, 10), /does not support U\+10FFFF/);
});
