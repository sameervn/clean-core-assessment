import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/accounts";
import { readFile } from "node:fs/promises";

async function stored(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/lib/workspace-store.ts";
    const { s } = await (window as any).__ccOpenStore(path);
    try { return await s.load(); } finally { s.dispose(); }
  });
}

test("closed conflict tab recovers edits without replacing newer saved work", async ({ page, context }, testInfo) => {
  await page.goto("/");
  await page.getByTestId("button-configuration").click();
  const stale = await context.newPage();
  await stale.goto("/");
  await stale.getByTestId("button-configuration").click();
  await page.getByRole("textbox").nth(0).fill("NEWER");
  await expect(page.getByTestId("status-save").getByText("Saved locally")).toBeVisible();
  const canonical = await stored(page);
  await stale.getByRole("textbox").nth(0).fill("STALE");
  await expect(stale.getByText("Recovery draft saved in this browser.", { exact: true })).toBeVisible();
  await stale.getByRole("textbox").nth(0).fill("STALE-FINAL");
  await expect.poll(() => stale.evaluate(async () => {
    const path = "/src/lib/recovery-drafts.ts";
    const { s } = await (window as any).__ccOpenStore("/src/lib/workspace-store.ts");
    try { return (await (await import(/* @vite-ignore */ path)).listRecoveryDrafts(s))[0]?.workspace.system; }
    finally { s.dispose(); }
  })).toBe("STALE-FINAL");
  await stale.close(); // No backup, no unload handler: simulate unexpected tab loss.
  const reopened = await context.newPage();
  await reopened.goto("/");
  const recovery = reopened.getByTestId("recovery-drafts");
  await expect(recovery.getByText(/STALE-FINAL/)).toBeVisible();
  expect(await stored(reopened)).toEqual(canonical);
  const [download] = await Promise.all([
    reopened.waitForEvent("download"),
    recovery.getByRole("button", { name: "Export recovery draft" }).click(),
  ]);
  const path = testInfo.outputPath("recovery.json");
  await download.saveAs(path);
  expect(JSON.parse(await readFile(path, "utf8")).workspace.system).toBe("STALE-FINAL");
  reopened.once("dialog", dialog => dialog.accept());
  await recovery.getByRole("button", { name: "Review recovery draft" }).click();
  await reopened.getByTestId("button-configuration").click();
  await expect(reopened.getByRole("textbox").nth(0)).toHaveValue("STALE-FINAL");
  await expect(reopened.getByTestId("workspace-save-conflict")).toBeVisible();
  await expect(reopened.getByText("Reviewing the retained draft. No additional copy was created.", { exact: true })).toBeVisible();
  expect(await reopened.evaluate(async () => {
    const path = "/src/lib/recovery-drafts.ts";
    const { s } = await (window as any).__ccOpenStore("/src/lib/workspace-store.ts");
    try { return (await (await import(/* @vite-ignore */ path)).listRecoveryDrafts(s)).length; }
    finally { s.dispose(); }
  })).toBe(1);
  expect(await stored(reopened)).toEqual(canonical);
  await reopened.screenshot({ path: testInfo.outputPath("recovered-draft.png"), fullPage: true });
  reopened.once("dialog", dialog => dialog.dismiss());
  await recovery.getByRole("button", { name: "Discard draft" }).click();
  await expect(recovery.getByRole("button", { name: "Export recovery draft" })).toBeVisible();
  reopened.once("dialog", dialog => dialog.accept());
  await recovery.getByRole("button", { name: "Discard draft" }).click();
  await expect(reopened.getByTestId("button-configuration")).toBeVisible();
  await expect(recovery).toHaveCount(0);
  await reopened.reload();
  await expect(reopened.getByTestId("button-configuration")).toBeVisible();
  await expect(recovery).toHaveCount(0);
  expect(await reopened.evaluate(async () => {
    const path = "/src/lib/recovery-drafts.ts";
    const { s } = await (window as any).__ccOpenStore("/src/lib/workspace-store.ts");
    try { return (await (await import(/* @vite-ignore */ path)).listRecoveryDrafts(s)).length; }
    finally { s.dispose(); }
  })).toBe(0);
  expect(await stored(reopened)).toEqual(canonical);
});

test("incomplete conflict edits remain discoverable and exportable after closing", async ({ page, context }, testInfo) => {
  await page.goto("/");
  await page.getByTestId("button-configuration").click();
  const stale = await context.newPage();
  await stale.goto("/");
  await stale.getByTestId("button-configuration").click();
  await page.getByRole("textbox").nth(0).fill("NEWER");
  await expect(page.getByTestId("status-save").getByText("Saved locally")).toBeVisible();
  const canonical = await stored(page);
  await stale.getByRole("textbox").nth(0).fill("");
  await expect(stale.getByText("Recovery draft saved in this browser.", { exact: true })).toBeVisible();
  await stale.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  const recovery = reopened.getByTestId("recovery-drafts");
  await expect(recovery.getByText(/Needs repair: system must be 1-100 characters/)).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Review recovery draft" })).toBeDisabled();
  const [download] = await Promise.all([
    reopened.waitForEvent("download"),
    recovery.getByRole("button", { name: "Export recovery draft" }).click(),
  ]);
  const path = testInfo.outputPath("incomplete-recovery.json");
  await download.saveAs(path);
  expect(JSON.parse(await readFile(path, "utf8")).workspace.system).toBe("");
  expect(await stored(reopened)).toEqual(canonical);
});

test("draft retention and isolated writes never change canonical storage", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("button-configuration")).toBeVisible();
  const result = await page.evaluate(async () => {
    const storePath = "/src/lib/workspace-store.ts";
    const draftPath = "/src/lib/recovery-drafts.ts";
    const { m: store, s } = await (window as any).__ccOpenStore(storePath);
    const drafts = await import(/* @vite-ignore */ draftPath);
    try {
    const existing = await s.load();
    await s.save(store.emptyWorkspace(), existing?.revision ?? null);
    const before = await s.load();
    await Promise.all([
      drafts.writeRecoveryDraft(s, "tab-a", { ...store.emptyWorkspace(), system: "A" }),
      drafts.writeRecoveryDraft(s, "tab-b", { ...store.emptyWorkspace(), system: "B" }),
    ]);
    const db = await s.database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put({
        updatedAt: Date.now() - drafts.DRAFT_RETENTION_MS - 1000,
        workspace: store.emptyWorkspace(),
      }, "recovery:expired");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const remaining = await drafts.listRecoveryDrafts(s);
    await drafts.deleteRecoveryDraft(s, "tab-a");
    return { before, after: await s.load(), remaining, final: await drafts.listRecoveryDrafts(s) };
    } finally { s.dispose(); }
  });
  expect(result.remaining.map(d => d.id).sort()).toEqual(["tab-a", "tab-b"]);
  expect(result.final.map(d => d.id)).toEqual(["tab-b"]);
  expect(result.after).toEqual(result.before);
});

test("failed draft write warns users to export rather than promising recovery", async ({ page, context }) => {
  await page.goto("/");
  await page.getByTestId("button-configuration").click();
  const stale = await context.newPage();
  await stale.goto("/");
  await stale.getByTestId("button-configuration").click();
  await page.getByRole("textbox").nth(0).fill("NEWER");
  await expect(page.getByTestId("status-save").getByText("Saved locally")).toBeVisible();
  await stale.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (typeof key === "string" && key.startsWith("recovery:")) throw new DOMException("Full", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  await stale.getByRole("textbox").nth(0).fill("STALE");
  await expect(stale.getByText("Recovery draft could not be saved. Download this tab's backup before closing it.", { exact: true })).toBeVisible();
  expect((await stored(page)).workspace.system).toBe("NEWER");
});
