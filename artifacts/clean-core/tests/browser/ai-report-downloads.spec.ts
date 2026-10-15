import { test, expect } from "./fixtures/accounts";
import { type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { readSheet } from "read-excel-file/node";
import { parse } from "csv-parse/sync";
import { PDFDocument } from "pdf-lib";
import { explanationSummary, summaryFingerprint } from "../../src/lib/ai-narratives";
import { validateWorkspace } from "../../src/lib/workspace-store";

const attribution = "AI-generated explanation; explicitly accepted by user; not deterministic assessment";
const reasons = {
  current: "Matches the current assessment summary; this does not validate the AI explanation.",
  changed: "The current assessment summary differs from the accepted explanation's summary.",
  legacy: "No saved summary fingerprint; freshness cannot be verified.",
  removed: "Subject is missing from the current assessment; review before relying on this explanation.",
};
const longText = Array.from({ length: 45 }, (_, i) =>
  `Paragraph ${String(i).padStart(3, "0")}: Retain this accepted guidance, including "quoted evidence", before making any changes.`,
).join("\n") + "\nFINAL EXPLANATION SENTINEL.";
const normalize = (value: string) => value.replace(/\s+/g, "");
const xmlText = (xml: string) => [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
  .map(match => match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")).join("");

async function seed(page: Page) {
  await page.goto("./");
  await page.getByTestId("button-empty-load-demo").click();
  await expect(page.getByTestId("status-save")).toHaveText("Saved locally");
  const workspace = await page.evaluate(() => new Promise<any>((resolve, reject) => {
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("workspace", "readonly");
      const get = tx.objectStore("workspace").get("current");
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
    };
  }));
  const base = workspace.assessment.inventory[0];
  workspace.assessment.inventory = ["current", "changed", "legacy"].map(id => ({
    ...base, id, objectName: `REPORT_${id}`, interfaceName: `INTERFACE_${id}`, dimension: "Integration",
  }));
  const expected = ["object", "interface"].flatMap(kind =>
    (["current", "changed", "legacy", "removed"] as const).map((state, index) => {
      const item = workspace.assessment.inventory[index] || { ...base, id: "removed" };
      const summary = explanationSummary(kind as "object" | "interface", item);
      const note = {
        text: kind === "object" && state === "changed" ? longText
          : `Accepted ${kind} ${state}, "do not replace".\nSecond line <evidence> & retained.`,
        provider: "openai", model: `model-${kind}-${state}`,
        generatedAt: "2026-01-01T01:02:03.000Z", acceptedAt: "2026-01-02T04:05:06.000Z",
        ...(state === "legacy" ? {} : {
          summaryFingerprint: summaryFingerprint(state === "changed"
            ? { ...summary, confidence: summary.confidence === "low" ? "high" : "low" } : summary),
        }),
      };
      return {
        ...note, subject: `${kind}:${state}`, attribution,
        reviewStatus: state === "current" ? "current" : state === "legacy" ? "unknown" : "needs-review",
        reviewReason: reasons[state],
      };
    }),
  );
  workspace.aiNarratives = Object.fromEntries(expected.map(({ subject, attribution: _a, reviewStatus: _s, reviewReason: _r, ...note }) => [subject, note]));
  expect(validateWorkspace(workspace).ok, "synthetic workspace must pass restore validation").toBe(true);
  await page.evaluate(record => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(record, "current");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), workspace);
  await page.reload();
  await page.getByTestId("tab-export").click();
  return expected;
}

test("downloaded AI report appendices retain review warnings and complete accepted text in every format", async ({ page }) => {
  test.setTimeout(180_000);
  const expected = await seed(page);
  for (const [title, extension] of [
    ["Executive Summary (MD)", "md"], ["CSV Inventory Details", "csv"],
    ["Full JSON Payload", "json"], ["Excel Workbook", "xlsx"],
    ["PowerPoint Deck", "pptx"], ["PDF Assessment", "pdf"],
  ]) {
    await test.step(title, async () => {
      const event = page.waitForEvent("download");
      await page.getByRole("heading", { name: title, exact: true }).click();
      const download = await event;
      expect(await download.failure()).toBeNull();
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
      const path = (await download.path())!;
      const bytes = await readFile(path);
      const report = (note: typeof expected[number]) =>
        `${note.subject}\n${attribution}\nReview status: ${note.reviewStatus}\n${note.reviewReason}\n${note.provider} / ${note.model}; generated ${note.generatedAt}; accepted ${note.acceptedAt}\n${note.text}`;
      if (extension === "json" || extension === "xlsx") {
        const sheet = extension === "xlsx" ? await readSheet(bytes, "Accepted AI Explanations", { trim: false }) : [];
        const rows = extension === "json" ? JSON.parse(bytes.toString()).acceptedAiExplanations
          : sheet.slice(1).map(row => Object.fromEntries(sheet[0]
            .flatMap((key, index) => row[index] == null ? [] : [[String(key), row[index]]])));
        expect(rows).toHaveLength(expected.length);
        for (const note of expected) expect(rows.find((row: any) => row.subject === note.subject)).toEqual(note);
      } else if (extension === "csv") {
        // A real CSV parser, not split(',') or split('\\n'): notes contain both plus quotes.
        const rows: Record<string, string>[] = parse(bytes, { columns: true });
        expect(rows).toHaveLength(5); // Three live inventory rows, two retained missing subjects.
        for (const note of expected) {
          const id = note.subject.endsWith(":removed") ? note.subject : note.subject.split(":")[1];
          expect(rows.find(row => row.id === id)?.acceptedAiExplanations).toContain(report(note));
        }
        for (const row of rows.filter(row => row.id.endsWith(":removed"))) expect(row.objectName).toBe("");
      } else if (extension === "md") {
        for (const note of expected) expect(bytes.toString()).toContain(report(note)
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
      } else {
        let content: string;
        if (extension === "pptx") {
          const entries = execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split("\n")
            .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
            .sort((a, b) => Number(a.match(/slide(\d+)/)![1]) - Number(b.match(/slide(\d+)/)![1]));
          const slides = entries.map(name => xmlText(execFileSync("unzip", ["-p", path, name], { encoding: "utf8" })));
          expect(slides.filter(text => text.startsWith("Accepted AI explanation")).length).toBeGreaterThan(expected.length);
          content = slides.map(text => text.replace(/^Accepted AI explanation \(\d+\/\d+\) — not assessment/, "")).join("");
        } else {
          const pdf = await PDFDocument.load(bytes);
          expect(pdf.getPageCount()).toBeGreaterThan(expected.length + 1);
          content = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" })
            .replace(/Accepted AI explanation - not deterministic assessment(?: \(continued\))?/g, "");
        }
        // Ignore only layout whitespace: complete ordered text, including all 45 paragraphs,
        // must survive across slide/page boundaries, not merely the first/last sentence.
        for (const note of expected) expect(normalize(content)).toContain(normalize(report(note)));
      }
    });
  }
});
