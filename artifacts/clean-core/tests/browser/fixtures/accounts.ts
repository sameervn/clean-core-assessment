/** Playwright fixtures: synthetic signed-in accounts (see accounts-db.ts). */
import { test as base, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { createSyntheticAccount, deleteSyntheticAccounts, type SyntheticAccount } from "./accounts-db";
export * from "./accounts-db";

/** Real login through the API; cookies land in the page's browser context. */
export async function signIn(request: APIRequestContext, baseURL: string, account: SyntheticAccount) {
  const res = await request.post(new URL("/api/auth/login", baseURL).toString(), {
    data: { username: account.username, password: account.password },
    headers: { Origin: new URL(baseURL).origin },
  });
  expect(res.ok(), `login failed for ${account.username}: ${res.status()}`).toBeTruthy();
  return res.json();
}

/** Browser IndexedDB name for this account's scoped workspace. */
export function workspaceDbName(account: Pick<SyntheticAccount, "id">) {
  return `clean-core-assessment::user-${account.id}`;
}

/** Values exposed to page scripts as `window.__CC_TEST__` in every page of the context. */
export interface BrowserTestIdentity { userId: string; dbName: string; channel: string }
export function browserIdentity(account: Pick<SyntheticAccount, "id">): BrowserTestIdentity {
  return {
    userId: account.id,
    dbName: workspaceDbName(account),
    channel: `clean-core-workspace-changed::user-${account.id}`,
  };
}

/**
 * Sign a browser context in as `account` and expose its storage identity.
 * Every page of the context (including `context.newPage()` tabs) shares the
 * session cookie and identity, i.e. same-user concurrency. Use a separate
 * `browser.newContext()` (+ another account) for isolated users.
 */
export async function authenticateContext(context: BrowserContext, baseURL: string, account: SyntheticAccount) {
  await signIn(context.request, baseURL, account);
  const identity = browserIdentity(account);
  await context.addInitScript((id: BrowserTestIdentity) => {
    (window as any).__CC_TEST__ = id;
    // Helper for page.evaluate: open this account's scoped store from a given module URL.
    (window as any).__ccOpenStore = async (modulePath: string) => {
      const m = await import(/* @vite-ignore */ modulePath);
      return { m, s: m.openWorkspaceStore(id.userId) };
    };
  }, identity);
  return identity;
}

type Fixtures = {
  /** Factory for extra accounts; all are deleted at teardown. */
  makeAccount: (opts?: Parameters<typeof createSyntheticAccount>[0]) => Promise<SyntheticAccount>;
  /** Auto: every test runs signed in as a fresh Developer (all assessment permissions). */
  account: SyntheticAccount;
  /** Name of the signed-in account's IndexedDB database. */
  dbName: string;
};

export const test = base.extend<Fixtures>({
  makeAccount: async ({}, use) => {
    const created: string[] = [];
    await use(async (opts) => { const a = await createSyntheticAccount(opts); created.push(a.id); return a; });
    await deleteSyntheticAccounts(created);
  },
  account: [async ({ makeAccount, context, baseURL }, use) => {
    const account = await makeAccount({ role: "Developer" });
    await authenticateContext(context, baseURL!, account);
    await use(account);
  }, { auto: true }],
  dbName: async ({ account }, use) => { await use(workspaceDbName(account)); },
});

export { expect };
export type { Page };
