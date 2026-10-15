import { test, expect } from "./fixtures/accounts";
import { type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { emptyWorkspace, validateWorkspace, type StoredWorkspace } from "../../src/lib/workspace-store";

const note = "Edited note must survive reload and retry.";

function fixture(): StoredWorkspace {
  return {
    ...emptyWorkspace(),
    narratives: { "recovery-object": "Keep the original synthetic note." },
    assessment: {
      system: "PRD",
      targetRelease: "S4HANA_2023",
      inventory: [{
        id: "recovery-object", objectName: "Z_RECOVERY", objectType: "CLAS",
        module: "FI", package: "Z_RECOVERY", classification: "B",
        confidence: "high", disposition: "retain", dependencies: [],
      }],
      cleanCoreShare: 100,
      technicalDebtScore: 0,
      totals: { objects: 1 },
      provenance: { generatedAt: "2026-01-01T00:00:00.000Z", engineVersion: "browser-fixture" },
      evidenceQuality: { confidence: "high", gaps: [] },
      roadmap: { waves: [] },
      rollups: {}, clusters: [], levelD: [], deadCode: [], duplicates: [],
      integrations: [], recommendations: [], quickWins: [], upgradeRisk: [],
    },
    savedAt: "2026-01-01T00:00:00.000Z",
  };
}

async function seed(page: Page, record: StoredWorkspace) {
  await page.goto("./");
  await expect(page.getByTestId("button-empty-load-demo")).toBeVisible();
  await page.evaluate(value => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspace");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(value, "current");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), record);
  await page.reload();
}

test("lazy section failures stay local and saved edits recover; backup availability is checked", async ({ page }) => {
  const record = fixture();
  expect(validateWorkspace(record).ok).toBe(true);
  await page.route("**/src/components/dashboard-charts.tsx*", route => route.abort());
  // A removed deployment asset returns 404 rather than a network abort.
  await page.route("**/src/pages/evidence-tab.tsx*", route => route.fulfill({ status: 404, body: "Asset no longer exists" }));
  await seed(page, record);

  await expect(page.getByText("Charts could not be loaded", { exact: true })).toBeVisible();
  await expect(page.getByTestId("text-app-title")).toBeVisible();
  await expect(page.getByTestId("tab-explorer")).toBeVisible();
  const documentStart = await page.evaluate(() => performance.timeOrigin);
  await page.getByRole("button", { name: "Retry charts" }).click();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStart);
  await expect(page.getByText("Charts could not be loaded", { exact: true })).toBeVisible();

  await page.getByTestId("tab-evidence").click();
  await expect(page.getByText("Evidence could not be loaded", { exact: true })).toBeVisible();
  await page.getByTestId("tab-explorer").click();
  await page.getByRole("button", { name: "Open details for Z_RECOVERY" }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__restorePut = () => { IDBObjectStore.prototype.put = original; };
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Injected quota failure", "QuotaExceededError");
    };
  });
  await page.getByRole("textbox", { name: /Add architectural context/ }).fill(note);
  await page.getByRole("button", { name: "Save Narrative" }).click();
  await expect(page.getByTestId("status-save-error")).toBeVisible();

  await page.getByTestId("tab-dashboard").click();
  await expect(page.getByRole("button", { name: "Reload saved workspace" })).toBeDisabled();
  await page.getByTestId("tab-evidence").click();
  await expect(page.getByRole("button", { name: "Reload saved workspace" })).toBeDisabled();
  await expect(page.getByTestId("button-export-backup")).toBeVisible();
  const unsavedBackup = page.waitForEvent("download");
  await page.getByTestId("button-export-backup").click();
  const unsavedDownload = await unsavedBackup;
  expect(await unsavedDownload.failure()).toBeNull();
  expect(await readFile((await unsavedDownload.path())!, "utf8")).toContain(note);

  await page.evaluate(() => (window as any).__restorePut());
  await page.getByTestId("status-save-error").click();
  await expect(page.getByTestId("status-save")).toHaveText("Saved locally");
  await page.unroute("**/src/components/dashboard-charts.tsx*");
  await page.unroute("**/src/pages/evidence-tab.tsx*");
  await page.getByRole("button", { name: "Reload saved workspace" }).click();

  await page.getByTestId("tab-explorer").click();
  await page.getByRole("button", { name: "Open details for Z_RECOVERY" }).click();
  await expect(page.getByRole("textbox", { name: /Add architectural context/ })).toHaveValue(note);
  await page.getByTestId("tab-evidence").click();
  await expect(page.getByTestId("button-export-backup")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByTestId("button-export-backup").click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^clean-core-workspace-PRD-.*\.json$/);
  expect(await download.failure()).toBeNull();
});
