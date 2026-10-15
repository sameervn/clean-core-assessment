import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createPdfText } from "./pdf-text";
import { drawPdfRecommendations } from "./pdf-recommendations";

test("complete international recommendations wrap and paginate without collisions", async () => {
  const document = await PDFDocument.create();
  const font = await readFile(new URL("../../node_modules/@fontsource/unifont/files/unifont-latin-400-normal.woff", import.meta.url));
  const pdf = await createPdfText(document, font);
  const groups = [
    { label: "Café Ελληνικά Привет 中文 日本語 한국어 ".repeat(8) + "LABEL-END", count: 42, confidenceText: "High", rationales: ["München — façade. ".repeat(40) + "RATIONALE-END"] },
    ...Array.from({ length: 10 }, (_, i) => ({
      label: `GROUP-${i}`, count: i + 1, confidenceText: "Medium",
      rationales: ["Measured width avoids truncation. ".repeat(10) + `END-${i}`],
    })),
    { label: "OVERSIZED", count: 1, confidenceText: "Low", rationales: ["界".repeat(5000) + "OVERSIZED-END"] },
    { label: "FINAL-GROUP", count: 1, confidenceText: "High", rationales: [] },
  ];
  const before = JSON.stringify(groups);
  const draws: Array<{ page: number; value: string; x: number; y: number; size: number; strong?: boolean }> = [];
  drawPdfRecommendations(document, {
    ...pdf,
    draw(page, value, options) {
      draws.push({ page: document.getPages().indexOf(page), value: String(value), ...options });
      pdf.draw(page, value, options);
    },
  }, groups);
  assert.equal(JSON.stringify(groups), before);
  assert.ok(document.getPageCount() >= 4);
  for (const draw of draws) {
    assert.ok(draw.x + pdf.width(draw.value, draw.size, draw.strong) <= 796);
    assert.ok(draw.y >= 52 && draw.y <= 548);
  }
  for (let page = 0; page < document.getPageCount(); page++) {
    const pageDraws = draws.filter(draw => draw.page === page);
    for (let i = 1; i < pageDraws.length; i++) {
      assert.ok(pageDraws[i - 1].y - pageDraws[i].y >= pageDraws[i].size + 1, "Overlapping lines");
    }
  }
  for (let i = 0; i < 10; i++) {
    assert.equal(draws.find(d => d.value === `GROUP-${i} (${i + 1})`)?.page,
      draws.find(d => d.value.includes(`END-${i}`))?.page, "Ordinary group split across pages");
  }
  const compact = (s: string) => s.normalize("NFC").replace(/\s/g, "");
  const body = compact(draws.filter(d => d.y !== 548).map(d => d.value).join(""));
  for (const group of groups) {
    assert.ok(body.includes(compact(`${group.label} (${group.count})`)), "Incomplete label");
    assert.ok(body.includes(compact(`Confidence: ${group.confidenceText}. ${group.rationales.join(" ") || "Validate against object-level evidence."}`)), "Incomplete rationale");
  }
  const directory = new URL("../../../../generated-artifacts/pdf-recommendations/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const path = new URL("report.pdf", directory).pathname;
  await writeFile(path, await document.save());
  const extracted = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" });
  for (const expected of ["Café", "Ελληνικά", "Привет", "中文", "日本語", "한국어", "LABEL-END", "RATIONALE-END", "OVERSIZED-END", "FINAL-GROUP"]) {
    assert.ok(extracted.includes(expected), `Missing extracted text: ${expected}`);
  }
});

test("an oversized label and explicit blank lines retain all content", async () => {
  const document = await PDFDocument.create();
  const font = await readFile(new URL("../../node_modules/@fontsource/unifont/files/unifont-latin-400-normal.woff", import.meta.url));
  const pdf = await createPdfText(document, font);
  const drawn: string[] = [];
  const label = "W".repeat(4000) + "LABEL-TAIL";
  drawPdfRecommendations(document, {
    ...pdf,
    draw(page, value, options) {
      if (options.y !== 548) drawn.push(String(value));
      pdf.draw(page, value, options);
    },
  }, [{ label, count: 1, confidenceText: "High", rationales: ["First\n\nLast"] }]);
  assert.ok(document.getPageCount() > 1);
  assert.equal(drawn.join(""), `${label} (1)Confidence: High. FirstLast`);
  await document.save();
});
