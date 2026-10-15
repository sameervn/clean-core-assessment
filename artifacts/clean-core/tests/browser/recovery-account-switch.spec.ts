import { readFile } from "node:fs/promises";
import { type TestInfo } from "@playwright/test";
import {
  test, expect, type Page, type SyntheticAccount,
  expireSyntheticSessions, setSyntheticOverrides,
} from "./fixtures/accounts";

// Explicit identities are essential here: the context's __CC_TEST__ intentionally
// remains the initial account, and must not make B's assertions read A's store.
async function records(page: Page, account: SyntheticAccount) {
  return page.evaluate(async userId => {
    const storePath = "/src/lib/workspace-store.ts";
    const draftPath = "/src/lib/recovery-drafts.ts";
    const { openWorkspaceStore } = await import(/* @vite-ignore */ storePath);
    const { listRecoveryDrafts } = await import(/* @vite-ignore */ draftPath);
    const store = openWorkspaceStore(userId);
    try { return { canonical: await store.load(), drafts: await listRecoveryDrafts(store) }; }
    finally { store.dispose(); }
  }, account.id);
}

async function login(page: Page, account: SyntheticAccount) {
  await page.getByTestId("input-username").fill(account.username);
  await page.getByTestId("input-password").fill(account.password);
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("text-current-user")).toHaveText(account.username);
}

async function logout(page: Page) {
  await page.getByTestId("button-account-menu").click();
  await page.getByTestId("menu-logout").click();
  await expect(page.getByTestId("button-login")).toBeVisible();
}

async function exportedDraft(page: Page, info: TestInfo, name: string) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("recovery-drafts").getByRole("button", { name: "Export recovery draft" }).click(),
  ]);
  const path = info.outputPath(`${name}.json`);
  await download.saveAs(path);
  return JSON.parse(await readFile(path, "utf8")).workspace;
}

for (const transition of ["logout", "session expiry"] as const) {
  test(`${transition}: multi-tab recovery exports and delayed autosaves stay with their account`, async ({
    page, context, account: a, makeAccount,
  }, info) => {
    const b = await makeAccount({ role: "Developer" });
    const stale = await context.newPage();
    const pending = await context.newPage();
    const tabs = [page, stale, pending];
    for (const tab of tabs) {
      await tab.goto("/");
      await tab.getByTestId("button-configuration").click();
    }
    await page.getByRole("textbox").nth(0).fill("A-CANONICAL");
    await expect(page.getByTestId("status-save").getByText("Saved locally")).toBeVisible();
    await stale.getByRole("textbox").nth(0).fill("A-PRIVATE-DRAFT");
    await expect(stale.getByText("Recovery draft saved in this browser.", { exact: true })).toBeVisible();
    const aBefore = await records(page, a);
    expect(aBefore.canonical.workspace.system).toBe("A-CANONICAL");
    expect(aBefore.drafts.map((d: any) => d.workspace.system)).toEqual(["A-PRIVATE-DRAFT"]);

    // Hold an actual UI autosave past the authentication transition, not a
    // fabricated write to a fresh store. Advancing later catches stale timers.
    await pending.clock.install();
    await pending.clock.pauseAt(new Date());
    await pending.getByRole("textbox").nth(0).fill("A-DELAYED-PRIVATE");
    await expect(pending.getByTestId("status-save").getByText("Saving...")).toBeVisible();
    if (transition === "logout") {
      await logout(page); // Real logout broadcasts to the other two tabs.
    } else {
      await expireSyntheticSessions(a);
      for (const tab of tabs) await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
    }
    for (const tab of tabs) {
      await expect(tab.getByTestId("button-login")).toBeVisible();
      await expect(tab.getByTestId("recovery-drafts")).toHaveCount(0);
      await expect(tab.getByTestId("workspace-save-conflict")).toHaveCount(0);
    }
    await login(page, b);
    for (const tab of tabs) {
      await expect(tab.getByTestId("text-current-user")).toHaveText(b.username);
      await expect(tab.getByTestId("button-configuration")).toBeVisible();
      await expect(tab.getByTestId("recovery-drafts")).toHaveCount(0);
    }
    await pending.clock.runFor(1500);
    await pending.clock.resume();
    expect(await records(page, a)).toEqual(aBefore);
    expect(await records(page, b)).toMatchObject({ canonical: { workspace: null }, drafts: [] });

    // Give B distinct canonical data and a real conflict draft, so absence
    // alone cannot make an incorrectly scoped export look successful.
    for (const tab of [page, stale]) await tab.getByTestId("button-configuration").click();
    await page.getByRole("textbox").nth(0).fill("B-CANONICAL");
    await expect(page.getByTestId("status-save").getByText("Saved locally")).toBeVisible();
    await stale.getByRole("textbox").nth(0).fill("B-PRIVATE-DRAFT");
    await expect(stale.getByText("Recovery draft saved in this browser.", { exact: true })).toBeVisible();
    const bBefore = await records(page, b);
    expect(bBefore.canonical.workspace.system).toBe("B-CANONICAL");
    expect(bBefore.drafts.map((d: any) => d.workspace.system)).toEqual(["B-PRIVATE-DRAFT"]);

    // A changed permission signature remounts the scoped workspace without
    // deleting or relabelling either account's recovery data.
    await setSyntheticOverrides(b, { notes: false });
    for (const tab of tabs) {
      await tab.evaluate(() => window.dispatchEvent(new Event("focus")));
      await tab.getByTestId("button-account-menu").click();
      await expect(tab.getByTestId("text-effective-permissions")).not.toContainText("notes");
      await tab.keyboard.press("Escape");
      await expect(tab.getByTestId("recovery-drafts")).toContainText("B-PRIVATE-DRAFT");
      expect(await exportedDraft(tab, info, `permission-${tabs.indexOf(tab)}`)).toEqual(bBefore.drafts[0].workspace);
    }
    await setSyntheticOverrides(b, {});
    for (const tab of tabs) {
      await tab.reload();
      await expect(tab.getByTestId("text-current-user")).toHaveText(b.username);
      await expect(tab.getByTestId("recovery-drafts")).toContainText("B-PRIVATE-DRAFT");
      await expect(tab.getByTestId("recovery-drafts")).not.toContainText("A-PRIVATE");
      expect(await exportedDraft(tab, info, `b-${tabs.indexOf(tab)}`)).toEqual(bBefore.drafts[0].workspace);
    }
    expect(await records(page, a)).toEqual(aBefore);
    expect(await records(page, b)).toEqual(bBefore);

    await logout(page);
    await login(page, a);
    for (const tab of tabs) {
      await expect(tab.getByTestId("text-current-user")).toHaveText(a.username);
      await tab.reload();
      await expect(tab.getByTestId("recovery-drafts")).toContainText("A-PRIVATE-DRAFT");
      await expect(tab.getByTestId("recovery-drafts")).not.toContainText("B-PRIVATE");
      expect(await exportedDraft(tab, info, `a-${tabs.indexOf(tab)}`)).toEqual(aBefore.drafts[0].workspace);
      await tab.getByTestId("button-configuration").click();
      await expect(tab.getByRole("textbox").nth(0)).toHaveValue("A-CANONICAL");
    }
    expect(await records(page, a)).toEqual(aBefore);
    expect(await records(page, b)).toEqual(bBefore);
  });
}
