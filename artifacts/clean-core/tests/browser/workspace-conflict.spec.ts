import { test, expect } from "./fixtures/accounts";
import { type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { emptyWorkspace } from "../../src/lib/workspace-store";

const storeUrl = (page: Page, instance = "") =>
  `${new URL("/src/lib/workspace-store.ts", page.url()).href}${instance ? `?instance=${instance}` : ""}`;

async function readStored(page: Page) {
  return page.evaluate(async modulePath => {
    const { s } = await (window as any).__ccOpenStore(modulePath);
    try { return await s.load(); } finally { s.dispose(); }
  }, storeUrl(page));
}

async function openConfiguration(page: Page, expectedSystem = "PRD") {
  await page.getByTestId("button-configuration").click();
  // The live System ID control is the first textbox; Target Release is second.
  await expect(page.getByRole("textbox").nth(0)).toHaveValue(expectedSystem);
}

test("stale tab cannot overwrite newer work and can explicitly load it", async ({ page, context }, testInfo) => {
  const otherTab = await context.newPage();
  await page.goto("/");
  await otherTab.goto("/");

  // Fresh Playwright context, two pages, and the same initially empty IndexedDB.
  await expect(page.getByTestId("button-configuration")).toBeVisible();
  await expect(otherTab.getByTestId("button-configuration")).toBeVisible();
  expect(await readStored(page)).toMatchObject({ workspace: null, revision: null, discarded: false });
  expect(await readStored(otherTab)).toMatchObject({ workspace: null, revision: null, discarded: false });

  await openConfiguration(page);
  await openConfiguration(otherTab);
  await page.getByRole("textbox").nth(0).fill("NEWER");
  await expect(page.getByTestId("status-save").getByText("Saved locally")).toBeVisible();
  await expect(otherTab.getByTestId("workspace-newer-work")).toBeVisible();
  await expect(otherTab.getByRole("textbox").nth(0)).toHaveValue("PRD");
  await expect(page.getByTestId("workspace-newer-work")).toHaveCount(0);

  await otherTab.getByRole("textbox").nth(0).fill("STALE");
  await expect(otherTab.getByTestId("workspace-save-conflict")).toBeVisible();
  await otherTab.screenshot({ path: testInfo.outputPath("workspace-conflict.png"), fullPage: true });
  expect((await readStored(page)).workspace?.system).toBe("NEWER");
  await expect(otherTab.getByRole("textbox").nth(0)).toHaveValue("STALE");

  const [download] = await Promise.all([
    otherTab.waitForEvent("download"),
    otherTab.getByRole("button", { name: "Download this tab's backup" }).click(),
  ]);
  const backupPath = testInfo.outputPath("stale-workspace-backup.json");
  await download.saveAs(backupPath);
  expect(JSON.parse(await readFile(backupPath, "utf8")).workspace.system).toBe("STALE");

  // Edits and retry remain local to the conflicted tab; retry cannot bypass the guard.
  await otherTab.getByRole("textbox").nth(0).fill("STALE-EDITED");
  await expect(otherTab.getByTestId("workspace-save-conflict")).toBeVisible();
  await otherTab.getByTestId("status-save-error").click();
  await expect(otherTab.getByTestId("workspace-save-conflict")).toBeVisible();
  expect((await readStored(page)).workspace?.system).toBe("NEWER");
  await expect(otherTab.getByRole("textbox").nth(0)).toHaveValue("STALE-EDITED");

  otherTab.once("dialog", dialog => dialog.dismiss());
  await otherTab.getByRole("button", { name: "Load newer saved workspace" }).click();
  await expect(otherTab.getByTestId("workspace-save-conflict")).toBeVisible();
  await expect(otherTab.getByRole("textbox").nth(0)).toHaveValue("STALE-EDITED");

  otherTab.once("dialog", dialog => dialog.accept());
  await otherTab.getByRole("button", { name: "Load newer saved workspace" }).click();
  await expect(otherTab.getByTestId("button-configuration")).toBeVisible();
  await expect(otherTab.getByText("NEWER", { exact: true })).toBeVisible();
  await openConfiguration(otherTab, "NEWER");
  await otherTab.getByRole("textbox").nth(0).fill("NEWER-EDITED");
  await expect(otherTab.getByTestId("status-save").getByText("Saved locally")).toBeVisible();
  await expect.poll(async () => (await readStored(otherTab)).workspace?.system).toBe("NEWER-EDITED");
});

test("idle tab explicitly refreshes; delayed notifications do not flag the current revision", async ({ page, context }) => {
  const otherTab = await context.newPage();
  await page.goto("/");
  await otherTab.goto("/");
  await openConfiguration(otherTab);
  await openConfiguration(page);
  await page.getByRole("textbox").nth(0).fill("LATEST");
  await expect(page.getByTestId("status-save").getByText("Saved locally")).toBeVisible();
  await expect(otherTab.getByTestId("workspace-newer-work")).toBeVisible();
  await expect(otherTab.getByRole("textbox").nth(0)).toHaveValue("PRD");
  otherTab.once("dialog", dialog => dialog.dismiss());
  await otherTab.getByRole("button", { name: "Load newer saved workspace" }).click();
  await expect(otherTab.getByRole("textbox").nth(0)).toHaveValue("PRD");
  otherTab.once("dialog", dialog => dialog.accept());
  await otherTab.getByRole("button", { name: "Load newer saved workspace" }).click();
  await openConfiguration(otherTab, "LATEST");
  await page.evaluate(() => {
    const channel = new BroadcastChannel((window as any).__CC_TEST__.channel);
    channel.postMessage("changed");
    channel.close();
  });
  await expect(otherTab.getByTestId("workspace-newer-work")).toHaveCount(0);
  expect((await readStored(otherTab)).workspace?.system).toBe("LATEST");
});

test("notification preserves pending edits and the eventual save still rejects a stale revision", async ({ page, context }) => {
  const otherTab = await context.newPage();
  await page.goto("/");
  await otherTab.goto("/");
  await openConfiguration(otherTab);
  await otherTab.clock.install();
  await otherTab.clock.pauseAt(new Date());
  await otherTab.getByRole("textbox").nth(0).fill("LOCAL-DRAFT");
  await expect(otherTab.getByTestId("status-save").getByText("Saving...")).toBeVisible();
  await page.evaluate(async modulePath => {
    const { m, s } = await (window as any).__ccOpenStore(modulePath);
    try { await s.save({ ...m.emptyWorkspace(), system: "REMOTE" }, null); } finally { s.dispose(); }
  }, storeUrl(page));
  await expect(otherTab.getByTestId("workspace-newer-work")).toBeVisible();
  await expect(otherTab.getByRole("textbox").nth(0)).toHaveValue("LOCAL-DRAFT");
  await otherTab.clock.runFor(500);
  await expect(otherTab.getByTestId("workspace-save-conflict")).toBeVisible();
  expect((await readStored(page)).workspace?.system).toBe("REMOTE");
  await expect(otherTab.getByRole("textbox").nth(0)).toHaveValue("LOCAL-DRAFT");
});

test("focus checks detect newer work when BroadcastChannel is unavailable", async ({ page, context }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "BroadcastChannel", { value: undefined }); });
  await page.goto("/");
  await openConfiguration(page);
  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await openConfiguration(otherTab);
  await otherTab.getByRole("textbox").nth(0).fill("FALLBACK");
  await expect(otherTab.getByTestId("status-save").getByText("Saved locally")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("workspace-newer-work")).toBeVisible();
  await expect(page.getByRole("textbox").nth(0)).toHaveValue("PRD");
});

test("compare-and-write is atomic across module instances and protects legacy revisions", async ({ page, context }) => {
  const otherTab = await context.newPage();
  await page.goto("/");
  await otherTab.goto("/");
  const firstStoreUrl = storeUrl(page, "atomic-first");
  const secondStoreUrl = storeUrl(otherTab, "atomic-second");

  await page.evaluate(async ({ modulePath, record }) => {
    const { s } = await (window as any).__ccOpenStore(modulePath);
    try { await s.save(record, null); } finally { s.dispose(); }
  }, { modulePath: firstStoreUrl, record: emptyWorkspace() });

  const [firstRevision, secondRevision] = await Promise.all([
    page.evaluate(async modulePath => (window as any).__ccOpenStore(modulePath).then(async ({ s }: any) => { try { return (await s.load()).revision; } finally { s.dispose(); } }), firstStoreUrl),
    otherTab.evaluate(async modulePath => (window as any).__ccOpenStore(modulePath).then(async ({ s }: any) => { try { return (await s.load()).revision; } finally { s.dispose(); } }), secondStoreUrl),
  ]);
  expect(firstRevision).toBeTruthy();
  expect(secondRevision).toBe(firstRevision);

  const saveFrom = (target: Page, modulePath: string, system: string, revision: string | null) =>
    target.evaluate(async ({ modulePath, system, revision }) => {
      const { m, s } = await (window as any).__ccOpenStore(modulePath);
      try {
        return { ok: true, revision: await s.save({ ...m.emptyWorkspace(), system }, revision) };
      } catch (error) {
        return { ok: false, name: (error as Error).name };
      } finally { s.dispose(); }
    }, { modulePath, system, revision });
  const outcomes = await Promise.all([
    saveFrom(page, firstStoreUrl, "ATOMIC-A", firstRevision),
    saveFrom(otherTab, secondStoreUrl, "ATOMIC-B", secondRevision),
  ]);
  expect(outcomes.filter(result => result.ok)).toHaveLength(1);
  expect(outcomes.filter(result => result.name === "WorkspaceConflictError")).toHaveLength(1);
  expect((await readStored(page)).workspace?.system).toBe(
    outcomes[0].ok ? "ATOMIC-A" : "ATOMIC-B",
  );

  // Install a legacy record without its revision field, then save against the
  // fingerprint returned by loadWorkspace. Reusing that old fingerprint conflicts.
  await page.evaluate(record => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(record, "current");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { ...emptyWorkspace(), system: "LEGACY" });
  const legacyRevision = await page.evaluate(async modulePath =>
    (window as any).__ccOpenStore(modulePath).then(async ({ s }: any) => { try { return (await s.load()).revision; } finally { s.dispose(); } }), firstStoreUrl);
  expect(legacyRevision).toMatch(/^legacy:/);
  const legacySave = await saveFrom(page, firstStoreUrl, "LEGACY-SAVED", legacyRevision);
  expect(legacySave.ok).toBe(true);
  const staleLegacySave = await saveFrom(otherTab, secondStoreUrl, "LEGACY-STALE", legacyRevision);
  expect(staleLegacySave).toEqual({ ok: false, name: "WorkspaceConflictError" });
  expect((await readStored(page)).workspace?.system).toBe("LEGACY-SAVED");
});
