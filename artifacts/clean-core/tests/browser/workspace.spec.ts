import { test, expect } from "./fixtures/accounts";
import { type Page, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { emptyWorkspace, type StoredWorkspace } from "../../src/lib/workspace-store";

// Read the actual committed record, independently of the application's state.
async function stored(page: Page): Promise<StoredWorkspace> {
  return page.evaluate(() => new Promise((resolve, reject) => {
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
}

async function saved(page: Page) {
  await expect(page.getByTestId("status-save")).toHaveText("Saved locally");
}

async function pendingClassification(page: Page) {
  return page.evaluate(() => new Promise<any>((resolve, reject) => {
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("workspace", "readonly");
      const get = tx.objectStore("workspace").get("pending-classification");
      tx.oncomplete = () => { resolve(get.result ?? null); db.close(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}

async function demo(page: Page) {
  await page.goto("./");
  await page.getByTestId("button-empty-load-demo").click();
  await saved(page);
  await expect.poll(async () => (await stored(page)).assessment?.inventory.length).toBe(4000);
  await page.getByTestId("tab-evidence").click();
  await page.getByRole("button", { name: "Set Current as Baseline" }).click();
  await expect.poll(async () => (await stored(page)).baseline?.inventory.length).toBe(4000);
  await saved(page);
  return stored(page);
}

async function bytes(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

async function backup(page: Page) {
  const event = page.waitForEvent("download");
  await page.getByTestId("button-export-backup").click();
  const download = await event;
  expect(download.suggestedFilename()).toMatch(/^clean-core-workspace-PRD-.*\.json$/);
  return bytes(download);
}

async function upload(page: Page, buffer: Buffer) {
  await page.getByTestId("input-restore-backup").setInputFiles({
    name: "workspace.json", mimeType: "application/json", buffer,
  });
}

async function visibleBaseline(page: Page) {
  await expect(page.getByText("Baseline Active", { exact: true })).toBeVisible();
  await page.getByTestId("tab-dashboard").click();
  await expect(page.getByRole("heading", { name: "Baseline Progression" })).toBeVisible();
  await page.getByTestId("tab-explorer").click();
  await expect(page.getByText(/4,000|4000/).first()).toBeVisible();
}

type StorageFault = "unavailable" | "blocked" | "open-error" | "none";
type FaultWindow = Window & typeof globalThis & {
  __storageFault: { attempts: number; writes: number; restore: () => void };
};

// Only synthetic records in Playwright's fresh per-test browser context.
async function seedRecoveryRecord(page: Page, corrupt = false) {
  await page.goto("./");
  await expect(page.getByTestId("button-empty-load-demo")).toBeVisible();
  const record = {
    ...emptyWorkspace(),
    system: "RECOVERY",
    narratives: { "recovery-object": "Keep this recoverable note." },
    baseline: { cleanCoreShare: 63, technicalDebtScore: 17, inventory: [{ id: "recovery-object", classification: "C" }] },
    savedAt: "2026-01-01T00:00:00.000Z",
    ...(corrupt ? { weighted: "invalid boolean" } : {}),
  };
  await page.evaluate(record => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(record, "current");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), record);
  return record;
}

async function injectStorageFault(page: Page, mode: StorageFault) {
  // Runs before application imports/hydration, and is limited to this page.
  await page.addInitScript(mode => {
    const factory = window.indexedDB;
    const descriptor = Object.getOwnPropertyDescriptor(window, "indexedDB");
    const open = factory.open;
    const put = IDBObjectStore.prototype.put;
    let enabled = true;
    const control = {
      attempts: 0,
      writes: 0,
      restore: () => {
        enabled = false;
        factory.open = open;
        if (descriptor) Object.defineProperty(window, "indexedDB", descriptor);
        else Reflect.deleteProperty(window, "indexedDB");
      },
    };
    (window as FaultWindow).__storageFault = control;
    IDBObjectStore.prototype.put = function (...args) {
      // Recovery discovery opens a readwrite cursor for expiry cleanup; that
      // is not a canonical autosave. Count actual current-record writes.
      if (this.transaction.db.name === (window as any).__CC_TEST__.dbName && args[1] === "current") control.writes++;
      return put.apply(this, args);
    };
    if (mode === "unavailable") {
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        get: () => { control.attempts++; return undefined; },
      });
    } else if (mode !== "none") {
      factory.open = function (...args) {
        if (!enabled || args[0] !== (window as any).__CC_TEST__.dbName) return open.apply(this, args);
        control.attempts++;
        // Deterministically deliver the native open request's failure callbacks.
        const request = new EventTarget() as IDBOpenDBRequest;
        Object.defineProperty(request, "error", {
          value: new DOMException("Injected browser storage open failure", "UnknownError"),
        });
        setTimeout(() => {
          const event = new Event(mode === "blocked" ? "blocked" : "error");
          if (mode === "blocked") request.onblocked?.call(request, event as IDBVersionChangeEvent);
          else request.onerror?.call(request, event);
        }, 0);
        return request;
      };
    }
  }, mode);
}

async function expectNoAutosave(page: Page) {
  // Negative assertion: advance beyond the 400ms debounce, then yield to IDB.
  await page.clock.runFor(1200);
  expect(await page.evaluate(() => (window as FaultWindow).__storageFault.writes)).toBe(0);
}

for (const mode of ["unavailable", "blocked", "open-error"] as const) {
  test(`storage hydration ${mode}: failed Retry preserves work and recovery reloads it`, async ({ page, context }) => {
    const before = await seedRecoveryRecord(page);
    // A separate page bypasses the fault, but reads the same isolated browser DB.
    const inspector = await context.newPage();
    await inspector.goto("./");
    await expect(inspector.getByText("RECOVERY", { exact: true })).toBeVisible();
    await injectStorageFault(page, mode);
    await page.clock.install();
    await page.reload();
    const message = mode === "unavailable" ? "IndexedDB is not available in this browser."
      : mode === "blocked" ? "Browser storage is blocked by another tab."
      : "Injected browser storage open failure";
    await expect(page.getByText("Browser storage unavailable", { exact: true })).toBeVisible();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(page.getByTestId("button-empty-load-demo")).toBeHidden();
    await expectNoAutosave(page);
    expect(await stored(inspector)).toEqual(before);

    const attempts = await page.evaluate(() => (window as FaultWindow).__storageFault.attempts);
    await page.getByTestId("button-retry-load").click();
    await expect.poll(() => page.evaluate(() => (window as FaultWindow).__storageFault.attempts)).toBeGreaterThan(attempts);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expectNoAutosave(page);
    expect(await stored(inspector)).toEqual(before);

    await page.evaluate(() => (window as FaultWindow).__storageFault.restore());
    await page.getByTestId("button-retry-load").click();
    await expect(page.getByTestId("button-retry-load")).toBeHidden();
    await expect(page.getByText("RECOVERY", { exact: true })).toBeVisible();
    await saved(page);
    await expectNoAutosave(page);
    expect(await stored(page)).toEqual(before);
    await inspector.reload();
    await expect(inspector.getByText("RECOVERY", { exact: true })).toBeVisible();
    expect(await stored(inspector)).toEqual(before);
  });
}

test("corrupt stored workspace hydration warns without autosaving over recoverable data", async ({ page }) => {
  const before = await seedRecoveryRecord(page, true);
  await injectStorageFault(page, "none");
  await page.clock.install();
  for (let load = 0; load < 2; load++) {
    await page.reload();
    await expect(page.getByText("Saved workspace unreadable", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("button-empty-load-demo")).toBeHidden();
    await expect(page.getByText("Baseline Active", { exact: true })).toBeHidden();
    await expectNoAutosave(page);
    expect(await stored(page)).toEqual(before);
  }
});

test("unreadable saved work can be rescued and replacement cancelled or confirmed", async ({ page }) => {
  const before = await seedRecoveryRecord(page, true);
  await page.reload();
  await expect(page.getByTestId("workspace-recovery")).toBeVisible();
  const event = page.waitForEvent("download");
  await page.getByTestId("button-download-unreadable").click();
  const download = await event;
  expect(download.suggestedFilename()).toMatch(/^clean-core-unreadable-.*\.json$/);
  expect(JSON.parse((await bytes(download)).toString())).toEqual(before);
  expect(await stored(page)).toEqual(before);
  await page.getByTestId("button-replace-unreadable").click();
  await page.getByTestId("button-cancel-replace").click();
  expect(await stored(page)).toEqual(before);
  await page.reload();
  await expect(page.getByTestId("workspace-recovery")).toBeVisible();
  await page.getByTestId("button-replace-unreadable").click();
  await page.getByTestId("button-confirm-replace").click();
  await expect(page.getByTestId("button-empty-load-demo")).toBeVisible();
  expect(await stored(page)).toEqual({ ...emptyWorkspace(), savedAt: expect.any(String), revision: expect.any(String) });
  await page.reload();
  await expect(page.getByTestId("workspace-recovery")).toBeHidden();
});

test("failed unreadable replacement preserves the record and allows retry", async ({ page }) => {
  const before = await seedRecoveryRecord(page, true);
  await page.reload();
  await expect(page.getByTestId("workspace-recovery")).toBeVisible();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      IDBObjectStore.prototype.put = original;
      throw new DOMException("Injected quota failure", "QuotaExceededError");
    };
  });
  await page.getByTestId("button-replace-unreadable").click();
  await page.getByTestId("button-confirm-replace").click();
  await expect(page.getByRole("alert").filter({ hasText: "Replacement failed" })).toBeVisible();
  expect(await stored(page)).toEqual(before);
  await expect(page.getByTestId("button-download-unreadable")).toBeVisible();
  await page.getByTestId("button-replace-unreadable").click();
  await page.getByTestId("button-confirm-replace").click();
  await expect(page.getByTestId("button-empty-load-demo")).toBeVisible();
  expect(await stored(page)).toEqual({ ...emptyWorkspace(), savedAt: expect.any(String), revision: expect.any(String) });
});

// Construct inside the browser: Playwright's argument serialization is not the
// IndexedDB structured-clone format we are exercising.
async function seedNonJsonRecord(page: Page, kind: "cycle" | "bigint", generation = 1) {
  await page.evaluate(({ kind, generation }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction("workspace", "readwrite");
      const raw: any = { system: "MALFORMED", evidence: [] };
      // Keep all other fields identical when testing a newer malformed record.
      if (kind === "cycle") raw.payload = generation === 1 ? raw : { self: raw };
      else raw.payload = BigInt(generation);
      tx.objectStore("workspace").put(raw, "current");
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => { database.close(); reject(tx.error); };
      tx.onabort = () => { database.close(); reject(tx.error); };
    };
  }), { kind, generation });
}

async function nonJsonRecordIsIntact(page: Page, kind: "cycle" | "bigint", generation = 1) {
  return page.evaluate(({ kind, generation }) => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction("workspace", "readonly");
      const get = tx.objectStore("workspace").get("current");
      get.onsuccess = () => {
        const raw = get.result;
        resolve(raw.system === "MALFORMED" && (kind === "bigint"
          ? raw.payload === BigInt(generation)
          : generation === 1 ? raw.payload === raw : raw.payload.self === raw));
      };
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => database.close();
    };
  }), { kind, generation });
}

for (const kind of ["cycle", "bigint"] as const) {
  test(`non-JSON ${kind}: recovery, explicit rescue error, cancellation and replacement`, async ({ page }) => {
    await seedRecoveryRecord(page);
    await seedNonJsonRecord(page, kind);
    await page.reload();
    await expect(page.getByTestId("workspace-recovery")).toBeVisible();
    expect(await nonJsonRecordIsIntact(page, kind)).toBe(true);
    const downloads: Download[] = [];
    page.on("download", download => downloads.push(download));
    await page.getByTestId("button-download-unreadable").click();
    await expect(page.getByRole("alert").filter({ hasText: "Could not export this record as JSON. It remains unchanged in this browser." })).toBeVisible();
    expect(downloads).toHaveLength(0);
    await page.getByTestId("button-replace-unreadable").click();
    await page.getByTestId("button-cancel-replace").click();
    expect(await nonJsonRecordIsIntact(page, kind)).toBe(true);
    await page.getByTestId("button-replace-unreadable").click();
    await page.getByTestId("button-confirm-replace").click();
    await expect(page.getByTestId("button-empty-load-demo")).toBeVisible();
    expect(await stored(page)).toMatchObject(emptyWorkspace());
    await page.reload();
    await expect(page.getByTestId("workspace-recovery")).toBeHidden();
    await expect(page.getByTestId("button-empty-load-demo")).toBeVisible();
  });

  for (const newer of ["malformed", "valid"] as const) {
    test(`non-JSON ${kind}: stale replacement protects newer ${newer} record`, async ({ page, context }) => {
      await seedRecoveryRecord(page);
      await seedNonJsonRecord(page, kind);
      await page.reload();
      await expect(page.getByTestId("workspace-recovery")).toBeVisible();
      const other = await context.newPage();
      await other.goto("./");
      await expect(other.getByTestId("workspace-recovery")).toBeVisible();
      if (newer === "malformed") {
        await seedNonJsonRecord(other, kind, 2);
      } else {
        await other.getByTestId("button-replace-unreadable").click();
        await other.getByTestId("button-confirm-replace").click();
        await expect(other.getByTestId("button-empty-load-demo")).toBeVisible();
      }
      const newerValidRecord = newer === "valid" ? await stored(other) : null;
      await page.getByTestId("button-replace-unreadable").click();
      await page.getByTestId("button-confirm-replace").click();
      await expect(page.getByRole("alert").filter({ hasText: "Another tab changed the saved workspace" })).toBeVisible();
      if (newer === "malformed") expect(await nonJsonRecordIsIntact(page, kind, 2)).toBe(true);
      else expect(await stored(page)).toEqual(newerValidRecord);
      // Reload takes a fresh revision, including a changed malformed graph.
      await page.reload();
      if (newer === "malformed") {
        await expect(page.getByTestId("workspace-recovery")).toBeVisible();
        await page.getByTestId("button-replace-unreadable").click();
        await page.getByTestId("button-confirm-replace").click();
      }
      await expect(page.getByTestId("button-empty-load-demo")).toBeVisible();
    });
  }
}

test("4,000-object inventory and baseline survive a real reload", async ({ page }) => {
  const before = await demo(page);
  await page.reload();
  await visibleBaseline(page);
  expect(await stored(page)).toEqual(before);
  await page.getByTestId("tab-evidence").click();
  const exported = JSON.parse((await backup(page)).toString());
  expect(exported.workspace.assessment.inventory).toEqual(before.assessment.inventory);
  expect(exported.workspace.baseline).toEqual(before.baseline);
});

test("backup round trip, and cancelling restore, demo and clear preserves all work", async ({ page }) => {
  // Multiple full-payload comparisons/downloads and a live restore exceed two minutes.
  test.setTimeout(300_000);
  const before = await demo(page);
  const file = await backup(page);
  const parsed = JSON.parse(file.toString());
  expect(parsed.format).toBe("clean-core-workspace-backup");
  expect(parsed.version).toBe(1);
  expect(parsed.workspace.evidence.length).toBeGreaterThan(0);

  for (const action of ["restore", "demo", "reset"]) {
    if (action === "restore") await upload(page, file);
    else await page.getByTestId(action === "demo" ? "button-load-demo" : "button-reset-workspace").click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByTestId("button-cancel-replace").click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    expect(await stored(page)).toEqual(before);
  }
  // Reload catches a delayed destructive write after cancellation.
  await page.reload();
  await visibleBaseline(page);
  await page.getByTestId("tab-evidence").click();
  expect(JSON.parse((await backup(page)).toString()).workspace).toEqual(parsed.workspace);
  await page.getByTestId("button-reset-workspace").click();
  await page.getByTestId("button-confirm-replace").click();
  await expect.poll(async () => (await stored(page)).assessment).toBeNull();
  await saved(page);
  await page.reload();
  await page.getByTestId("tab-evidence").click();
  await expect(page.getByText("Baseline Active", { exact: true })).toBeHidden();

  const recompute = page.waitForResponse(r => r.url().endsWith("/api/clean-core/assessment") && r.request().method() === "POST");
  await upload(page, file);
  expect((await recompute).ok()).toBe(true);
  await expect.poll(async () => (await stored(page)).baseline?.inventory.length).toBe(4000);
  await saved(page);
  const restored = await stored(page);
  expect(restored.assessment.inventory).toEqual(before.assessment.inventory);
  expect(restored.baseline).toEqual(before.baseline);
  expect(restored.evidence).toEqual(before.evidence);
  await page.reload();
  await visibleBaseline(page);
  expect(await stored(page)).toEqual(restored);
});

test("invalid JSON, invalid schema and unverified evidence never replace the workspace", async ({ page }) => {
  const before = await demo(page);
  const file = await backup(page);
  for (const invalid of ["{not json", JSON.stringify({ format: "clean-core-workspace-backup", version: 1, workspace: {} })]) {
    await upload(page, Buffer.from(invalid));
    await expect(page.getByText("Restore rejected", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    expect(await stored(page)).toEqual(before);
  }
  // Structurally valid backup, but its evidence signature is invalid.
  const tampered = JSON.parse(file.toString());
  tampered.workspace.evidence[0].attestation = "0".repeat(64);
  await upload(page, Buffer.from(JSON.stringify(tampered)));
  await page.getByTestId("button-confirm-replace").click();
  await expect(page.getByText("Restore aborted", { exact: true }).first()).toBeVisible();
  expect(await stored(page)).toEqual(before);
  expect(JSON.parse((await backup(page)).toString()).workspace).toEqual(JSON.parse(file.toString()).workspace);
  await page.reload();
  await visibleBaseline(page);
  expect(await stored(page)).toEqual(before);
});

test("quota failure keeps committed data, allows rescue download and retry", async ({ page }) => {
  const before = await demo(page);
  // Inject only a browser storage write fault; reads and API calls remain real.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).__restorePut = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Simulated storage quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByTestId("checkbox-weighted").click();
  await expect(page.getByTestId("status-save-error")).toBeVisible();
  await expect(page.getByTestId("status-save-error")).toHaveAttribute("title", /quota/i);
  expect(await stored(page)).toEqual(before);
  const rescue = JSON.parse((await backup(page)).toString());
  expect(rescue.workspace.weighted).toBe(!before.weighted);
  expect(rescue.workspace.assessment).toBeNull();
  expect(rescue.workspace.baseline).toEqual(before.baseline);
  await page.evaluate(() => (window as any).__restorePut());
  await page.getByTestId("status-save-error").click();
  await saved(page);
  const after = await stored(page);
  expect(after.weighted).toBe(!before.weighted);
  expect(after.baseline).toEqual(before.baseline);
  await page.reload();
  await page.getByTestId("tab-evidence").click();
  await expect(page.getByTestId("checkbox-weighted")).not.toBeChecked();
  expect(await stored(page)).toEqual(after);
});

test("all export cards produce actual nonempty browser downloads", async ({ page }) => {
  const workspace = await demo(page);
  await page.getByTestId("tab-export").click();
  for (const [title, extension] of [
    ["Full JSON Payload", "json"], ["CSV Inventory Details", "csv"],
    ["Executive Summary (MD)", "md"], ["PowerPoint Deck", "pptx"],
    ["Excel Workbook", "xlsx"], ["PDF Assessment", "pdf"], ["Evidence Pack (JSON)", "json"],
  ]) {
    const event = page.waitForEvent("download");
    await page.getByRole("heading", { name: title, exact: true }).click();
    const download = await event;
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    const content = await bytes(download);
    expect(content.length).toBeGreaterThan(100);
    if (title === "Full JSON Payload") expect(JSON.parse(content.toString()).inventory).toEqual(workspace.assessment.inventory);
    if (title === "Evidence Pack (JSON)") expect(JSON.parse(content.toString()).evidence).toEqual(workspace.evidence);
    if (extension === "csv") {
      expect(content.toString()).toContain("objectName");
      expect(content.toString()).toContain(workspace.assessment.inventory[0].objectName);
    }
    if (extension === "md") expect(content.toString()).toContain("Total Objects: 4000");
    if (extension === "pdf") expect(content.subarray(0, 5).toString()).toBe("%PDF-");
    if (extension === "xlsx" || extension === "pptx") expect(content.subarray(0, 2).toString()).toBe("PK");
  }
});

for (const mode of ["single", "bulk"] as const) {
  test(`${mode} classification failure can be discarded without changing saved work or blocking a new edit`, async ({ page }) => {
    const before = await demo(page);
    const targets = before.assessment.inventory.filter((item: any) => item.classification !== "A").slice(0, 3);
    expect(targets).toHaveLength(3);
    const discarded = mode === "single" ? targets.slice(0, 1) : targets.slice(0, 2);
    const independent = targets[2];
    const reason = `${mode} changes that must be discarded`;
    const openOverride = async (objectName: string, auditReason: string) => {
      await page.getByPlaceholder("Search objects by name...").fill(objectName);
      await page.getByRole("button", { name: `Open details for ${objectName}`, exact: true }).click();
      const section = page.getByRole("heading", { name: "Classification Override", exact: true }).locator("..");
      await section.getByRole("combobox").click();
      await page.getByRole("option", { name: "Level A (Standard)", exact: true }).click();
      await page.getByPlaceholder("Reason for manual override...").fill(auditReason);
    };
    await page.getByTestId("tab-explorer").click();
    if (mode === "single") {
      await openOverride(discarded[0].objectName, reason);
    } else {
      // Select two distinct objects so this exercises a genuinely bulk discard.
      for (const target of discarded) {
        await page.getByPlaceholder("Search objects by name...").fill(target.objectName);
        await page.getByRole("checkbox", { name: `Select ${target.objectName}`, exact: true }).check();
      }
      await page.getByRole("combobox").filter({ hasText: "Set level" }).click();
      await page.getByRole("option", { name: "Set level A", exact: true }).click();
      await page.getByPlaceholder("Required audit reason").fill(reason);
    }
    let fail = true;
    const requests: any[] = [];
    await page.route("**/api/clean-core/assessment", async route => {
      requests.push(route.request().postDataJSON());
      if (fail) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Injected recalculation outage" }) });
      else await route.continue();
    });
    await page.getByRole("button", { name: mode === "single" ? "Apply Override" : "Apply to selected", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Classification changes not applied", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Pending classification rules")).toContainText(reason);
    expect(requests).toHaveLength(1);
    expect(requests[0].classificationOverrides).toEqual(discarded.map((item: any) => ({
      objectPattern: item.objectName, level: "A", reason,
    })));
    expect(await stored(page)).toEqual(before);

    await dialog.getByRole("button", { name: "Discard pending changes", exact: true }).click();
    await expect(dialog).toBeHidden();
    // Let any erroneous debounced autosave settle before comparing the entire record.
    await page.clock.install();
    await page.clock.runFor(1200);
    await saved(page);
    expect(await stored(page)).toEqual(before);
    expect(requests).toHaveLength(1);
    // Backup reads live application state, guarding against an unsaved in-memory mutation.
    await page.getByTestId("tab-evidence").click();
    const exported = JSON.parse((await backup(page)).toString()).workspace;
    expect(exported.classificationOverrides).toEqual(before.classificationOverrides);
    expect(exported.assessment).toEqual(before.assessment);

    fail = false;
    const newReason = "Independent review after discarding failed changes";
    await page.getByTestId("tab-explorer").click();
    await openOverride(independent.objectName, newReason);
    await page.getByRole("button", { name: "Apply Override", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await stored(page)).assessment.inventory
      .find((item: any) => item.id === independent.id).classification).toBe("A");
    await saved(page);
    expect(requests).toHaveLength(2);
    const after = await stored(page);
    const expectedRules = [{ objectPattern: independent.objectName, level: "A", reason: newReason }];
    expect(requests[1].classificationOverrides).toEqual(expectedRules);
    expect(after.classificationOverrides).toEqual(expectedRules);
    for (const target of discarded) {
      expect(after.assessment.inventory.find((item: any) => item.id === target.id)).toEqual(target);
    }
    expect(after.evidence).toEqual(before.evidence);
    expect(after.baseline).toEqual(before.baseline);
    expect(after.narratives).toEqual(before.narratives);
    await page.reload();
    await expect(page.getByTestId("tab-explorer")).toBeVisible();
    await expect(dialog).toBeHidden();
    expect(await stored(page)).toEqual(after);
  });

  test(`${mode} classification failure preserves committed work and retries intended edits`, async ({ page }) => {
    const before = await demo(page);
    const target = before.assessment.inventory.find((item: any) => item.classification !== "A");
    const reason = `${mode} review retained after recalculation failure`;
    await page.getByTestId("tab-explorer").click();
    await page.getByPlaceholder("Search objects by name...").fill(target.objectName);
    if (mode === "single") {
      await page.getByRole("button", { name: `Open details for ${target.objectName}`, exact: true }).click();
      const section = page.getByRole("heading", { name: "Classification Override", exact: true }).locator("..");
      await section.getByRole("combobox").click();
      await page.getByRole("option", { name: "Level A (Standard)", exact: true }).click();
      await page.getByPlaceholder("Reason for manual override...").fill(reason);
    } else {
      await page.getByRole("checkbox", { name: "Select all filtered objects", exact: true }).check();
      await page.getByRole("combobox").filter({ hasText: "Set level" }).click();
      await page.getByRole("option", { name: "Set level A", exact: true }).click();
      await page.getByPlaceholder("Required audit reason").fill(reason);
    }
    let fail = true;
    const requests: any[] = [];
    await page.route("**/api/clean-core/assessment", async route => {
      requests.push(route.request().postDataJSON());
      if (fail) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Injected recalculation outage" }) });
      else await route.continue();
    });
    await page.getByRole("button", { name: mode === "single" ? "Apply Override" : "Apply to selected", exact: true }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Classification changes not applied", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Pending classification rules")).toContainText(reason);
    expect(await stored(page)).toEqual(before);
    // A repeated failure retains the exact submission, not a new or partial set of rules.
    await dialog.getByRole("button", { name: "Retry classification changes" }).click();
    await expect(dialog.getByRole("button", { name: "Retry classification changes" })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(await stored(page)).toEqual(before);
    const downloadEvent = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Download pending rules" }).click();
    expect(JSON.parse((await bytes(await downloadEvent)).toString())).toEqual(requests[0].classificationOverrides);
    expect((await pendingClassification(page)).rules).toEqual(requests[0].classificationOverrides);
    await page.reload();
    await expect(dialog.getByText("Recover pending classification changes", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Pending classification rules")).toContainText(reason);
    expect(await stored(page)).toEqual(before);
    expect(requests).toHaveLength(2); // Recovery must never automatically submit.
    fail = false;
    await dialog.getByRole("button", { name: "Resume classification changes" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await stored(page)).assessment.inventory.find((item: any) => item.id === target.id).classification).toBe("A");
    await saved(page);
    expect(await pendingClassification(page)).toBeNull();
    const after = await stored(page);
    expect(after.classificationOverrides).toEqual(requests[0].classificationOverrides);
    expect(after.evidence).toEqual(before.evidence);
    expect(after.baseline).toEqual(before.baseline);
    await page.reload();
    await expect(page.getByTestId("tab-explorer")).toBeVisible();
    expect((await stored(page)).assessment).toEqual(after.assessment);
    expect((await stored(page)).classificationOverrides).toEqual(after.classificationOverrides);
    await expect(dialog).toBeHidden();
  });
}

test("pending classification recovery cannot resume against replacement evidence and discard survives reload", async ({ page }) => {
  const before = await demo(page);
  const target = before.assessment.inventory.find((item: any) => item.classification !== "A");
  await page.getByTestId("tab-explorer").click();
  await page.getByPlaceholder("Search objects by name...").fill(target.objectName);
  await page.getByRole("button", { name: `Open details for ${target.objectName}`, exact: true }).click();
  const section = page.getByRole("heading", { name: "Classification Override", exact: true }).locator("..");
  await section.getByRole("combobox").click();
  await page.getByRole("option", { name: "Level A (Standard)", exact: true }).click();
  await page.getByPlaceholder("Reason for manual override...").fill("Retain original evidence binding");
  let requests = 0;
  await page.route("**/api/clean-core/assessment", async route => {
    requests++;
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Injected outage"}' });
  });
  await page.getByRole("button", { name: "Apply Override", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry classification changes" })).toBeVisible();
  const draft = await pendingClassification(page);
  // Simulate another tab replacing evidence while retaining overlapping object names.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("workspace", "readwrite");
      const store = tx.objectStore("workspace");
      const get = store.get("current");
      get.onsuccess = () => {
        const ws = get.result;
        ws.evidence[0].metadata.importedAt = "2026-10-14T00:00:00.000Z";
        ws.revision = crypto.randomUUID();
        store.put(ws, "current");
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  const replacement = await stored(page);
  await page.reload();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Resume classification changes" })).toBeDisabled();
  await expect(dialog).toContainText("different assessment");
  expect(requests).toBe(1);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download pending rules" }).click();
  expect(JSON.parse((await bytes(await download)).toString())).toEqual(draft.rules);
  await dialog.getByRole("button", { name: "Discard pending changes" }).click();
  await expect(dialog).toBeHidden();
  expect(await pendingClassification(page)).toBeNull();
  expect(await stored(page)).toEqual(replacement);
  await page.reload();
  await expect(page.getByTestId("tab-dashboard")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(await stored(page)).toEqual(replacement);
});

test("Interfaces editor preserves narrative identity and recalculated classification through reload and backup restore", async ({ page }) => {
  test.setTimeout(300_000);
  const before = await demo(page);
  const interfaces = before.assessment.inventory.filter((item: any) => item.interfaceName || item.dimension === "Integration");
  const target = interfaces.find((item: any) => item.classification !== "A");
  expect(target, "demo contains a non-standard interface").toBeDefined();
  const neighbor = interfaces.find((item: any) => item.id !== target.id && item.objectName !== target.objectName);
  expect(neighbor, "a second interface guards against notes leaking between identities").toBeDefined();
  const note = `Interface review for ${target.objectName}\nUse a released successor — retain owner approval and migration context.`;
  const reason = "Interface architecture review: approved released contract";
  const noteInput = page.getByPlaceholder("Add architectural context, planned successor details, or remediation notes...");
  const openInterface = async (item: any) => {
    await page.getByTestId("tab-interfaces").click();
    await page.getByPlaceholder("Search interfaces by endpoint or object name...").fill(item.objectName);
    await page.getByRole("button", { name: `Open interface details for ${item.objectName}`, exact: true }).click();
  };
  const recompute = () => page.waitForResponse(response =>
    response.url().endsWith("/api/clean-core/assessment") && response.request().method() === "POST");

  await openInterface(target);
  await noteInput.fill(note);
  await page.getByRole("button", { name: "Save Narrative", exact: true }).click();
  await expect.poll(async () => (await stored(page)).narratives[target.id]).toBe(note);
  const overrideSection = page.getByRole("heading", { name: "Classification Override", exact: true }).locator("..");
  await overrideSection.getByRole("combobox").click();
  await page.getByRole("option", { name: "Level A (Standard)", exact: true }).click();
  await page.getByPlaceholder("Reason for manual override...").fill(reason);
  const response = recompute();
  await page.getByRole("button", { name: "Apply Override", exact: true }).click();
  expect((await response).ok()).toBe(true);
  await expect.poll(async () => (await stored(page)).assessment.inventory
    .find((item: any) => item.id === target.id)?.classification).toBe("A");
  await saved(page);

  const assertEdits = async () => {
    // Wait for hydration before inspecting storage or opening the separate editor.
    await expect(page.getByTestId("tab-interfaces")).toBeVisible();
    const workspace = await stored(page);
    expect(workspace.narratives).toEqual({ ...before.narratives, [target.id]: note });
    expect(workspace.classificationOverrides).toEqual([
      { objectPattern: target.objectName, level: "A", reason },
    ]);
    const item = workspace.assessment.inventory.find((entry: any) => entry.id === target.id);
    expect(item).toMatchObject({ id: target.id, objectName: target.objectName, classification: "A" });
    expect(item.classificationReason.override).toMatchObject({ applied: true, reason });
    expect(workspace.assessment.inventory.find((entry: any) => entry.id === neighbor.id)).toEqual(neighbor);
    expect(workspace.assessment.inventory).toHaveLength(before.assessment.inventory.length);
    expect(workspace.baseline).toEqual(before.baseline);
    expect(workspace.evidence).toEqual(before.evidence);
    await openInterface(neighbor);
    await expect(noteInput).toHaveValue(before.narratives[neighbor.id] || "");
    await openInterface(target);
    await expect(noteInput).toHaveValue(note);
    await expect(page.getByRole("button", { name: `Open interface details for ${target.objectName}`, exact: true })
      .getByLabel(/^Level A:/)).toBeVisible();
    await expect(page.getByText(`Manual override applied: “${reason}”`, { exact: false })).toBeVisible();
    return workspace;
  };

  await assertEdits();
  await page.reload();
  const edited = await assertEdits();
  await page.getByTestId("tab-evidence").click();
  const file = await backup(page);
  const exported = JSON.parse(file.toString()).workspace;
  expect(exported.narratives).toEqual(edited.narratives);
  expect(exported.classificationOverrides).toEqual(edited.classificationOverrides);
  expect(exported.assessment.inventory).toEqual(edited.assessment.inventory);

  // Eliminate both persisted and in-memory edits before importing the backup.
  await page.getByTestId("button-reset-workspace").click();
  await page.getByTestId("button-confirm-replace").click();
  await expect.poll(async () => {
    const workspace = await stored(page);
    return { assessment: workspace.assessment, notes: workspace.narratives, overrides: workspace.classificationOverrides };
  }).toEqual({ assessment: null, notes: {}, overrides: null });
  await saved(page);
  await page.reload();
  await page.getByTestId("tab-evidence").click();
  const restoreResponse = recompute();
  await upload(page, file);
  expect((await restoreResponse).ok()).toBe(true);
  await expect.poll(async () => (await stored(page)).narratives).toEqual(edited.narratives);
  await saved(page);
  const restored = await assertEdits();
  expect(restored.assessment.inventory).toEqual(edited.assessment.inventory);
  await page.reload();
  await assertEdits();
});

test("select all filtered objects includes unrendered matches and preserves unrelated selections", async ({ page }) => {
  test.setTimeout(300_000);
  const before = await demo(page);
  const inventory = before.assessment.inventory;
  // Stay within the API's 500-rule limit while exceeding the rendered window.
  const modules = [...new Set(inventory.map((item: any) => item.module))];
  const module = modules.find(module => {
    const count = inventory.filter((item: any) => item.module === module && item.classification === "A").length;
    return count > 150 && count <= 500;
  });
  expect(module, "live demo has a LOB with 151–500 Level A objects").toBeDefined();
  const matching = inventory.filter((item: any) => item.module === module && item.classification === "A");
  const unrelated = inventory.find((item: any) => item.module === module && item.classification !== "A")!;
  expect(matching.length).toBeGreaterThan(150);
  expect(unrelated).toBeDefined();
  const matchingNames = new Set(matching.map((item: any) => item.objectName));
  const offscreen = matching[150];
  const search = page.getByPlaceholder("Search objects by name...");
  const selectAll = page.getByRole("checkbox", { name: "Select all filtered objects", exact: true });
  const checkbox = (name: string) => page.getByRole("checkbox", { name: `Select ${name}`, exact: true });
  const filterLevel = async (current: string, next: string) => {
    await page.getByRole("combobox").filter({ hasText: current }).click();
    await page.getByRole("option", { name: next, exact: true }).click();
  };
  const selectedCount = (count: number) => page.getByText(`${count} selected`, { exact: true });

  await page.getByTestId("tab-explorer").click();
  await page.getByRole("combobox").filter({ hasText: "All LOBs" }).click();
  await page.getByRole("option", { name: module, exact: true }).click();
  await search.fill(unrelated.objectName);
  await checkbox(unrelated.objectName).check();
  await search.clear();
  await filterLevel("All levels", "Level A");
  await expect(page.getByRole("button", { name: /^Open details for / })).toHaveCount(150);
  await expect(checkbox(offscreen.objectName)).toHaveCount(0);
  await expect(page.getByText(`${matching.length} objects`, { exact: true })).toBeVisible();
  await selectAll.check();
  await expect(selectedCount(matching.length + 1)).toBeVisible();
  await expect(selectAll).toBeChecked();

  // Clearing the filter changes the view, not the selected set.
  await filterLevel("Level A", "All levels");
  await expect(selectedCount(matching.length + 1)).toBeVisible();
  await expect(selectAll).not.toBeChecked();
  await search.fill(unrelated.objectName);
  await expect(checkbox(unrelated.objectName)).toBeChecked();
  await search.fill(offscreen.objectName);
  await expect(checkbox(offscreen.objectName)).toBeChecked();
  await search.clear();
  await filterLevel("All levels", "Level A");

  // Deselecting the filtered group must leave the unrelated selection alone.
  await selectAll.uncheck();
  await expect(selectedCount(1)).toBeVisible();
  await expect(selectAll).not.toBeChecked();
  await search.fill(offscreen.objectName);
  await expect(checkbox(offscreen.objectName)).not.toBeChecked();
  await search.clear();
  await filterLevel("Level A", "All levels");
  await search.fill(unrelated.objectName);
  await expect(checkbox(unrelated.objectName)).toBeChecked();
  expect(await stored(page)).toEqual(before);
  // Remove only the unrelated selection so the saved edit targets exactly the group.
  await checkbox(unrelated.objectName).uncheck();
  await search.clear();
  await filterLevel("All levels", "Level A");
  await selectAll.check();
  await expect(selectedCount(matching.length)).toBeVisible();
  await expect(checkbox(offscreen.objectName)).toHaveCount(0);

  const reason = "Filtered group architecture review including unrendered objects";
  const reasonInput = page.getByPlaceholder("Required audit reason");
  await reasonInput.locator("..").getByRole("combobox").click();
  await page.getByRole("option", { name: "Set level D", exact: true }).click();
  await reasonInput.fill(reason);
  const response = page.waitForResponse(response =>
    response.url().endsWith("/api/clean-core/assessment") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Apply to selected", exact: true }).click();
  expect((await response).ok()).toBe(true);
  const expectedRules = matching.map((item: any) => ({
    objectPattern: item.objectName, level: "D", reason,
  }));
  await expect.poll(async () => (await stored(page)).classificationOverrides).toEqual(expectedRules);
  await saved(page);
  const after = await stored(page);
  expect(after.assessment.inventory.filter((item: any) => matchingNames.has(item.objectName))
    .map((item: any) => item.classification)).toEqual(matching.map(() => "D"));
  expect(after.assessment.inventory.filter((item: any) => !matchingNames.has(item.objectName)))
    .toEqual(inventory.filter((item: any) => !matchingNames.has(item.objectName)));
  expect(after.baseline).toEqual(before.baseline);
  expect(after.evidence).toEqual(before.evidence);
  expect(after.narratives).toEqual(before.narratives);
  await expect(page.getByRole("button", { name: "Apply to selected", exact: true })).toBeHidden();
});

test("bulk classification edits affect only selected objects and survive reload and attested backup restore", async ({ page }) => {
  test.setTimeout(300_000);
  const before = await demo(page);
  // Pick real demo objects whose initial level differs from both override levels.
  const candidates = before.assessment.inventory.filter((item: any) => item.classification === "A");
  expect(candidates.length).toBeGreaterThanOrEqual(4);
  const [replaced, preserved, added, deselected] = candidates.slice(0, 4);
  const singles = [replaced, preserved].map((object, index) => ({
    objectPattern: object.objectName, level: "D", reason: `Individual architecture approval ${index + 1}`,
  }));
  const bulkReason = "Bulk architecture review: approved released extension migration";
  const search = page.getByPlaceholder("Search objects by name...");
  const recompute = () => page.waitForResponse(response =>
    response.url().endsWith("/api/clean-core/assessment") && response.request().method() === "POST");
  const openObject = async (objectName: string) => {
    await page.getByTestId("tab-explorer").click();
    await search.fill(objectName);
    await page.getByRole("button", { name: `Open details for ${objectName}`, exact: true }).click();
  };
  for (const rule of singles) {
    await openObject(rule.objectPattern);
    const section = page.getByRole("heading", { name: "Classification Override", exact: true }).locator("..");
    await section.getByRole("combobox").click();
    await page.getByRole("option", { name: "Level D (Modification)", exact: true }).click();
    await page.getByPlaceholder("Reason for manual override...").fill(rule.reason);
    const response = recompute();
    await page.getByRole("button", { name: "Apply Override", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect.poll(async () => (await stored(page)).assessment.inventory
      .find((item: any) => item.objectName === rule.objectPattern)?.classification).toBe("D");
    await saved(page);
  }
  const beforeBulk = await stored(page);
  expect(beforeBulk.classificationOverrides).toEqual(singles);
  // Selection must survive filtering, but an explicitly deselected object must not change.
  for (const object of [replaced, added, deselected]) {
    await search.fill(object.objectName);
    await page.getByRole("checkbox", { name: `Select ${object.objectName}`, exact: true }).check();
  }
  await page.getByRole("checkbox", { name: `Select ${deselected.objectName}`, exact: true }).uncheck();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  const apply = page.getByRole("button", { name: "Apply to selected", exact: true });
  const reason = page.getByPlaceholder("Required audit reason");
  await expect(apply).toBeDisabled();
  await reason.fill("   ");
  await expect(apply).toBeDisabled();
  expect(await stored(page)).toEqual(beforeBulk);
  await reason.locator("..").getByRole("combobox").click();
  await page.getByRole("option", { name: "Set level C", exact: true }).click();
  await reason.fill(bulkReason);
  await expect(apply).toBeEnabled();
  const response = recompute();
  await apply.click();
  expect((await response).ok()).toBe(true);
  const selectedNames = new Set([replaced.objectName, added.objectName]);
  const bulkRules = before.assessment.inventory
    .filter((item: any) => selectedNames.has(item.objectName))
    .map((item: any) => ({ objectPattern: item.objectName, level: "C", reason: bulkReason }));
  const expectedRules = [singles[1], ...bulkRules];
  await expect.poll(async () => (await stored(page)).classificationOverrides).toEqual(expectedRules);
  await expect.poll(async () => (await stored(page)).assessment.inventory
    .filter((item: any) => selectedNames.has(item.objectName))
    .map((item: any) => item.classification)).toEqual(["C", "C"]);
  await saved(page);
  await expect(apply).toBeHidden();
  for (const object of [replaced, added, deselected]) {
    await search.fill(object.objectName);
    await expect(page.getByRole("checkbox", { name: `Select ${object.objectName}`, exact: true })).not.toBeChecked();
  }

  const assertBulkEdits = async () => {
    const workspace = await stored(page);
    expect(workspace.classificationOverrides).toEqual(expectedRules);
    expect(workspace.baseline).toEqual(before.baseline);
    expect(workspace.evidence).toEqual(before.evidence);
    expect(workspace.narratives).toEqual(beforeBulk.narratives);
    expect(workspace.assessment.inventory).toHaveLength(4000);
    // Compare whole objects, not just levels, for ALL unselected entries.
    expect(workspace.assessment.inventory.filter((item: any) => !selectedNames.has(item.objectName)))
      .toEqual(beforeBulk.assessment.inventory.filter((item: any) => !selectedNames.has(item.objectName)));
    for (const rule of expectedRules) {
      const item = workspace.assessment.inventory.find((item: any) => item.objectName === rule.objectPattern);
      expect(item.classification).toBe(rule.level);
      expect(item.classificationReason.override).toMatchObject({ applied: true, reason: rule.reason });
      await openObject(rule.objectPattern);
      await expect(page.getByRole("button", { name: `Open details for ${rule.objectPattern}`, exact: true })
        .getByLabel(new RegExp(`^Level ${rule.level}:`))).toBeVisible();
      await expect(page.getByText(`Manual override applied: “${rule.reason}”`, { exact: false })).toBeVisible();
    }
    return workspace;
  };
  const edited = await assertBulkEdits();
  await page.reload();
  expect((await assertBulkEdits()).assessment.inventory).toEqual(edited.assessment.inventory);
  await page.getByTestId("tab-evidence").click();
  const file = await backup(page);
  const exported = JSON.parse(file.toString()).workspace;
  expect(exported.classificationOverrides).toEqual(expectedRules);
  expect(exported.assessment.inventory).toEqual(edited.assessment.inventory);
  expect(exported.evidence).toEqual(before.evidence);
  await page.getByTestId("button-reset-workspace").click();
  await page.getByTestId("button-confirm-replace").click();
  await expect.poll(async () => {
    const workspace = await stored(page);
    return { assessment: workspace.assessment, overrides: workspace.classificationOverrides };
  }).toEqual({ assessment: null, overrides: null });
  await saved(page);
  await page.reload();
  await page.getByTestId("tab-evidence").click();
  const restoreResponse = recompute();
  await upload(page, file);
  expect((await restoreResponse).ok()).toBe(true);
  await expect.poll(async () => (await stored(page)).classificationOverrides).toEqual(expectedRules);
  await saved(page);
  expect((await assertBulkEdits()).assessment.inventory).toEqual(edited.assessment.inventory);
  await page.reload();
  expect((await assertBulkEdits()).assessment.inventory).toEqual(edited.assessment.inventory);
});

test("object overrides and expert narratives survive reload and an attested backup round trip", async ({ page }) => {
  // Includes three live 4,000-object calculations plus two reload/verification cycles.
  test.setTimeout(300_000);
  const before = await demo(page);
  const edits = ["A", "D"].map((classification, index) => {
    const object = before.assessment.inventory.find((item: any) => item.classification === classification);
    expect(object, `demo contains a Level ${classification} object`).toBeDefined();
    return {
      object,
      level: classification === "A" ? "D" : "A",
      reason: `Architecture review ${index + 1}: approved classification exception`,
      note: `Review ${index + 1} for ${object.objectName}\nSuccessor: released API; owner approval required — preserve this note.`,
    };
  });
  const openObject = async (objectName: string) => {
    await page.getByTestId("tab-explorer").click();
    await page.getByPlaceholder("Search objects by name...").fill(objectName);
    await page.getByRole("button", { name: `Open details for ${objectName}`, exact: true }).click();
  };

  const noteInput = page.getByPlaceholder("Add architectural context, planned successor details, or remediation notes...");

  const recompute = () => page.waitForResponse(response =>
    response.url().endsWith("/api/clean-core/assessment") && response.request().method() === "POST");

  for (const edit of edits) {
    await openObject(edit.object.objectName);
    await noteInput.fill(edit.note);
    await page.getByRole("button", { name: "Save Narrative", exact: true }).click();
    await expect.poll(async () => (await stored(page)).narratives[edit.object.id]).toBe(edit.note);
    const overrideSection = page.getByRole("heading", { name: "Classification Override", exact: true }).locator("..");
    await overrideSection.getByRole("combobox").click();
    await page.getByRole("option", { name: edit.level === "D" ? "Level D (Modification)" : "Level A (Standard)", exact: true }).click();
    await page.getByPlaceholder("Reason for manual override...").fill(edit.reason);
    const response = recompute();
    await page.getByRole("button", { name: "Apply Override", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect.poll(async () => (await stored(page)).assessment.inventory
      .find((item: any) => item.id === edit.object.id)?.classification).toBe(edit.level);
    await saved(page);
  }

  const assertEdits = async () => {
    const workspace = await stored(page);
    expect(workspace.classificationOverrides).toEqual(edits.map(edit => ({
      objectPattern: edit.object.objectName, level: edit.level, reason: edit.reason,
    })));
    expect(workspace.narratives).toEqual(Object.fromEntries(edits.map(edit => [edit.object.id, edit.note])));
    expect(workspace.baseline).toEqual(before.baseline);
    expect(workspace.evidence).toEqual(before.evidence);
    expect(workspace.assessment.inventory).toHaveLength(4000);
    for (const edit of edits) {
      const item = workspace.assessment.inventory.find((item: any) => item.id === edit.object.id);
      expect(item.classification).toBe(edit.level);
      // Original level belongs to the winning finding, not necessarily the object's
      // old aggregate level: applying an override can change which finding wins.
      expect(item.classificationReason.override).toMatchObject({
        applied: true, reason: edit.reason,
      });
      await openObject(edit.object.objectName);
      await expect(page.getByRole("button", { name: `Open details for ${edit.object.objectName}`, exact: true })
        .getByLabel(new RegExp(`^Level ${edit.level}:`))).toBeVisible();
      await expect(page.getByText(`Manual override applied: “${edit.reason}”`, { exact: false })).toBeVisible();
      await expect(noteInput).toHaveValue(edit.note);
    }
    return workspace;
  };

  await assertEdits();
  await page.reload();
  const edited = await assertEdits();
  await page.getByTestId("tab-evidence").click();
  const file = await backup(page);
  const exported = JSON.parse(file.toString()).workspace;
  expect(exported.classificationOverrides).toEqual(edited.classificationOverrides);
  expect(exported.narratives).toEqual(edited.narratives);
  expect(exported.assessment.inventory).toEqual(edited.assessment.inventory);

  // Clear and reload first so restore cannot pass using leftover in-memory edits.
  await page.getByTestId("button-reset-workspace").click();
  await page.getByTestId("button-confirm-replace").click();
  await expect.poll(async () => {
    const workspace = await stored(page);
    return { assessment: workspace.assessment, overrides: workspace.classificationOverrides, notes: workspace.narratives };
  }).toEqual({ assessment: null, overrides: null, notes: {} });
  await saved(page);
  await page.reload();
  await page.getByTestId("tab-evidence").click();
  const response = recompute();
  await upload(page, file);
  expect((await response).ok()).toBe(true);
  await expect.poll(async () => (await stored(page)).narratives).toEqual(edited.narratives);
  await saved(page);
  const restored = await assertEdits();
  expect(restored.assessment.inventory).toEqual(edited.assessment.inventory);
  await page.reload();
  await assertEdits();
});
