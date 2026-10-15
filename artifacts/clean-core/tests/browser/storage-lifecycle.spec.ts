import { test, expect } from "./fixtures/accounts";
import { type Page } from "@playwright/test";
import { emptyWorkspace, validateWorkspace } from "../../src/lib/workspace-store";

type LifecycleWindow = Window & typeof globalThis & {
  holder: IDBDatabase;
  lifecycle: { opened: number; closed: number; blocked: number };
};

type CloseWindow = Window & typeof globalThis & {
  connections: IDBDatabase[];
  nativeOpen: IDBFactory["open"];
};

/**
 * Read the committed record through an uncounted native connection, then apply
 * the store's own validation. Equivalent to the removed module-level
 * loadWorkspace() without adding a connection to the counted app connections.
 */
async function readCommitted(page: Page) {
  const raw: any = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = (window as CloseWindow).nativeOpen((window as any).__CC_TEST__.dbName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("workspace", "readonly").objectStore("workspace").get("current");
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  }));
  const result = validateWorkspace(raw);
  return { workspace: result.ok ? result.workspace : null, discarded: !result.ok, revision: raw?.revision };
}

for (const nextOperation of ["load", "save"] as const) {
  test(`unexpected connection close reopens on ${nextOperation} without losing the mounted workspace`, async ({ page }) => {
    await page.addInitScript(() => {
      const connections: IDBDatabase[] = [];
      (window as CloseWindow).connections = connections;
      const nativeOpen = indexedDB.open.bind(indexedDB);
      (window as CloseWindow).nativeOpen = nativeOpen;
      indexedDB.open = (name, version) => {
        const request = nativeOpen(name, version);
        if (name === (window as any).__CC_TEST__.dbName) {
          request.addEventListener("success", () => connections.push(request.result));
        }
        return request;
      };
    });
    await page.goto("./");
    await expect(page.getByTestId("button-empty-load-demo")).toBeVisible();
    const record = {
      ...emptyWorkspace(), system: "CLOSE-RECOVERY", aiNarratives: {},
      narratives: { synthetic: "Keep this note after storage closes." },
      baseline: { cleanCoreShare: 63, technicalDebtScore: 17, inventory: [] },
    };
    await page.evaluate(async ({ record, modulePath }) => {
      const { s } = await (window as any).__ccOpenStore(modulePath);
      try { await s.save(record, null); } finally { s.dispose(); }
    }, { record, modulePath: new URL("./src/lib/workspace-store.ts", page.url()).href });
    await page.reload();
    await expect(page.getByText("CLOSE-RECOVERY", { exact: true })).toBeVisible();
    await expect(page.getByTestId("status-save")).toHaveText("Saved locally");
    await page.evaluate(() => {
      const database = (window as CloseWindow).connections[0];
      // Browsers expose no portable force-termination API. Close the real
      // connection, then dispatch the close event an unexpected termination
      // would deliver. Native blocked/versionchange coverage stays separate.
      database.close();
      database.dispatchEvent(new Event("close"));
    });
    await expect(page.getByText("CLOSE-RECOVERY", { exact: true })).toBeVisible();

    if (nextOperation === "load") {
      const loaded = await readCommitted(page);
      expect(loaded).toEqual({ workspace: record, discarded: false, revision: expect.any(String) });
    }
    // A real UI edit saves the still-mounted state, not a test-provided copy.
    await page.getByTestId("tab-evidence").click();
    await page.getByTestId("checkbox-weighted").click();
    await expect.poll(() => page.evaluate(() => (window as CloseWindow).connections.length)).toBe(2);
    await expect(page.getByTestId("status-save")).toHaveText("Saved locally");

    // A late notification from the old connection must not evict the app's new one:
    // two further real UI saves must reuse it (no third connection).
    await page.evaluate(() => { (window as CloseWindow).connections[0].dispatchEvent(new Event("close")); });
    await page.getByTestId("checkbox-weighted").click();
    await expect(page.getByTestId("status-save")).toHaveText("Saved locally");
    await page.getByTestId("checkbox-weighted").click();
    await expect(page.getByTestId("status-save")).toHaveText("Saved locally");
    const loaded = await readCommitted(page);
    expect(loaded).toEqual({ workspace: { ...record, weighted: false }, discarded: false, revision: expect.any(String) });
    expect(await page.evaluate(() => (window as CloseWindow).connections.length)).toBe(2);
    await page.reload();
    await expect(page.getByText("CLOSE-RECOVERY", { exact: true })).toBeVisible();
    await page.getByTestId("tab-evidence").click();
    await expect(page.getByTestId("checkbox-weighted")).not.toBeChecked();
  });
}

test("native multi-tab blocked open closes late success; Retry and versionchange reopen safely", async ({ page, context }) => {
  // Both tabs share only this test's fresh browser context, never a user's data.
  const otherTab = await context.newPage();
  await otherTab.route("**/__storage-lifecycle", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>Storage holder</title>",
  }));
  await otherTab.goto("./__storage-lifecycle");
  await otherTab.evaluate(() => new Promise<void>((resolve, reject) => {
    // Deliberately keep an older connection open without a versionchange handler.
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      (window as LifecycleWindow).holder = request.result;
      resolve();
    };
  }));

  await page.addInitScript(() => {
    const state = { opened: 0, closed: 0, blocked: 0 };
    (window as LifecycleWindow).lifecycle = state;
    const nativeOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => {
      // Production is still schema v1. Request v2 only in this test so a real
      // native upgrade is blocked by the v1 connection in the other tab.
      const request = nativeOpen(name, name === (window as any).__CC_TEST__.dbName ? 2 : version);
      request.addEventListener("blocked", () => { state.blocked++; });
      request.addEventListener("success", () => {
        state.opened++;
        const database = request.result;
        const nativeClose = database.close.bind(database);
        database.close = () => { state.closed++; nativeClose(); };
      });
      return request;
    };
  });
  await page.goto("./");
  await expect(page.getByText("Browser storage is blocked by another tab.", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as LifecycleWindow).lifecycle.blocked)).toBe(1);
  await otherTab.evaluate(() => (window as LifecycleWindow).holder.close());
  // The failed promise's native request now succeeds. It must be closed, not
  // leaked or cached, and the UI must still wait for an explicit Retry.
  await expect.poll(() => page.evaluate(() => (window as LifecycleWindow).lifecycle)).toEqual({
    opened: 1, closed: 1, blocked: 1,
  });
  await expect(page.getByTestId("button-retry-load")).toBeVisible();

  const record = { ...emptyWorkspace(), system: "LIFECYCLE", narratives: { synthetic: "Keep this note." } };
  await otherTab.evaluate(record => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open((window as any).__CC_TEST__.dbName, 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(record, "current");
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onabort = () => { database.close(); reject(tx.error); };
    };
  }), record);
  await page.getByTestId("button-retry-load").click();
  await expect(page.getByText("LIFECYCLE", { exact: true })).toBeVisible();
  await expect(page.getByTestId("button-retry-load")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as LifecycleWindow).lifecycle.opened)).toBe(2);

  // Deletion in the other tab emits a native versionchange. It must complete
  // without blocking even while the successful Retry's app connection is open.
  await otherTab.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase((window as any).__CC_TEST__.dbName);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("App retained an open connection"));
    request.onsuccess = () => resolve();
  }));
  await expect.poll(() => page.evaluate(() => (window as LifecycleWindow).lifecycle.closed)).toBe(2);
  // Per-user stores no longer share a module-level connection with the mounted
  // app, so a fresh scoped handle (same module, same account) must open a new
  // connection after the versionchange instead of reusing a stale one.
  const restored = await page.evaluate(async ({ record, modulePath }) => {
    const { s } = await (window as any).__ccOpenStore(modulePath);
    try { await s.save(record, null); return await s.load(); } finally { s.dispose(); }
  }, { record, modulePath: new URL("./src/lib/workspace-store.ts", page.url()).href });
  expect(restored).toEqual({ workspace: { ...record, aiNarratives: {} }, discarded: false, revision: expect.any(String) });
  expect(await page.evaluate(() => (window as LifecycleWindow).lifecycle.opened)).toBe(3);
});
