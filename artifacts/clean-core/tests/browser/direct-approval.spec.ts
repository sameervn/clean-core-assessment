import { test, expect, authenticateContext, deleteSyntheticSharedAssessments } from "./fixtures/accounts";
import { emptyWorkspace, type StoredWorkspace } from "../../src/lib/workspace-store";

test.use({ actionTimeout: 15_000 });

test("unchanged object and interface go directly to their reviewer, with safe retry and no duplicate publication", async ({ page, account, makeAccount, browser, baseURL }) => {
  const reviewer = await makeAccount({ role: "Reviewer" });
  const reviewerContext = await browser.newContext({ baseURL });
  await authenticateContext(reviewerContext, baseURL!, reviewer);
  const reviewPage = await reviewerContext.newPage();
  const inventory = [
    { id: "direct-object", objectName: "Z_DIRECT_OBJECT", dimension: "Custom Code" },
    { id: "direct-interface", objectName: "Z_DIRECT_INTERFACE", dimension: "Integration", interfaceName: "Direct endpoint", protocol: "RFC" },
    { id: "unrelated", objectName: "Z_DO_NOT_PUBLISH", dimension: "Custom Code" },
  ].map(item => ({ ...item, objectType: "CLAS", module: "FI", package: "Z_DIRECT", classification: "C",
    classificationReason: { summary: "Generated assessment unchanged" }, disposition: "refactor", confidence: "high", dependencies: [], complexitySize: "S" }));
  const before: StoredWorkspace = {
    ...emptyWorkspace(), narratives: {},
    assessment: { system: "PRD", targetRelease: "S4HANA_2025", inventory, integrations: [],
      cleanCoreShare: 0, technicalDebtScore: 12, totals: { objects: inventory.length },
      provenance: { generatedAt: new Date().toISOString(), engineVersion: "direct-review-fixture" },
      evidenceQuality: { confidence: "high", gaps: [] }, roadmap: { waves: [] },
      rollups: {}, clusters: [], levelD: [], deadCode: [], duplicates: [], recommendations: [], quickWins: [], upgradeRisk: [] },
  };
  let actionCalls = 0;
  let failAction = true;
  await page.route("**/api/shared-assessments/entities/*/actions", async route => {
    actionCalls++;
    if (failAction) { failAction = false; await route.fulfill({ status: 503, json: { message: "Synthetic submission outage" } }); }
    else await route.continue();
  });
  await page.route("**/api/clean-core/ai/status", route => route.fulfill({ json: { state: "unavailable", message: "Not needed for review test" } }));
  try {
    await page.goto("./");
    await expect(page.getByTestId("button-empty-load-demo")).toBeVisible();
    await page.evaluate(ws => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open((window as any).__CC_TEST__.dbName, 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction("workspace", "readwrite");
        tx.objectStore("workspace").put(ws, "current");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }), before);
    await page.reload();
    await page.getByTestId("tab-explorer").click();
    await page.getByRole("button", { name: "Open details for Z_DIRECT_OBJECT", exact: true }).click();
    const objectPanel = page.getByTestId("review-object");
    await expect(objectPanel.getByTestId("button-send-approval-object")).toBeEnabled();
    // Dirty notes must not silently submit the previous saved text.
    const note = page.getByPlaceholder("Add architectural context, planned successor details, or remediation notes...");
    await note.fill("Unsaved note");
    await expect(objectPanel.getByTestId("button-send-approval-object")).toBeDisabled();
    await note.fill("");
    await objectPanel.getByTestId("button-send-approval-object").click();
    await objectPanel.getByTestId("select-approval-reviewer").selectOption(reviewer.id);
    await objectPanel.getByTestId("checkbox-share-reviewer").check();
    await objectPanel.getByTestId("button-confirm-send-approval").click();
    await expect(objectPanel.getByTestId("status-submit-error")).toContainText("Synthetic submission outage");
    await expect(note).toHaveValue("");
    // Preparation succeeded; refetch must find exactly one shared record and permit a safe retry.
    await expect(objectPanel.getByTestId("status-local-review")).toHaveText("Draft");
    const share = objectPanel.getByTestId("checkbox-share-reviewer");
    if (await share.isVisible()) await share.check();
    await objectPanel.getByTestId("button-confirm-send-approval").click();
    await expect(objectPanel.getByTestId("status-local-review")).toHaveText("Submitted");
    await expect(objectPanel.getByTestId("button-send-approval-object")).toHaveCount(0);
    expect(actionCalls).toBe(2);
    const developerMe = await (await page.request.get("/api/auth/me")).json();
    const shared = await (await page.request.get("/api/shared-assessments")).json();
    const assessmentId = shared.assessments.find((a: any) => a.owner_id === account.id).id;
    const detail = async () => (await (await page.request.get(`/api/shared-assessments/${assessmentId}`)).json());
    let saved = await detail();
    expect(saved.entities).toHaveLength(1);
    const object = saved.entities[0];
    expect(object.content.narrative).toBe("");
    expect(object.content.classificationExplanation).toBe("Generated assessment unchanged");
    expect(saved.events.filter((e: any) => e.action === "submit")).toHaveLength(1);
    // A lost submission response replay is handled by the existing action idempotency.
    const actionRow = saved.events.find((e: any) => e.action === "submit");
    expect(actionRow.version).toBe(object.version);
    await reviewPage.goto(`/shared-assessments?id=${assessmentId}`);
    await reviewPage.getByTestId(`row-entity-${object.id}`).click();
    await expect(reviewPage.getByTestId("button-approve-entity")).toBeVisible();
    await expect(reviewPage.getByTestId("button-submit-entity")).toHaveCount(0);
    const reviewerMe = await (await reviewerContext.request.get("/api/auth/me")).json();
    const denied = await reviewerContext.request.post(`/api/shared-assessments/entities/${object.id}/actions`, {
      headers: { Origin: new URL(baseURL!).origin, "X-CSRF-Token": reviewerMe.csrfToken },
      data: { expectedVersion: object.version, action: "submit", comment: "", requestId: crypto.randomUUID() },
    });
    expect(denied.status()).toBe(403);
    const duplicate = await page.request.post(`/api/shared-assessments/entities/${object.id}/actions`, {
      headers: { Origin: new URL(baseURL!).origin, "X-CSRF-Token": developerMe.csrfToken },
      data: { expectedVersion: object.version, action: "submit", comment: "", requestId: crypto.randomUUID() },
    });
    expect(duplicate.status()).toBe(409);
    await page.getByTestId("tab-interfaces").click();
    await page.getByRole("button", { name: "Open interface details for Z_DIRECT_INTERFACE", exact: true }).click();
    const interfacePanel = page.getByTestId("review-interface");
    await interfacePanel.getByTestId("button-send-approval-interface").click();
    await interfacePanel.getByTestId("select-approval-reviewer").selectOption(reviewer.id);
    await expect(interfacePanel.getByTestId("checkbox-share-reviewer")).toHaveCount(0);
    await interfacePanel.getByTestId("button-confirm-send-approval").click();
    await expect(interfacePanel.getByTestId("status-local-review")).toHaveText("Submitted");
    saved = await detail();
    expect(saved.entities).toHaveLength(2);
    expect(saved.entities.every((e: any) => e.state === "Submitted" && e.content.narrative === "")).toBe(true);
    expect(saved.entities.some((e: any) => e.name === "Z_DO_NOT_PUBLISH")).toBe(false);
    expect(saved.events.filter((e: any) => e.action === "submit")).toHaveLength(2);
    await reviewPage.reload();
    const iface = saved.entities.find((e: any) => e.kind === "interface");
    await reviewPage.getByTestId(`row-entity-${iface.id}`).click();
    await expect(reviewPage.getByTestId("button-approve-entity")).toBeVisible();
    await page.screenshot({ path: "../../generated-artifacts/clean-core-browser/direct-approval-interface.png" });
    await page.reload();
    await page.getByTestId("tab-interfaces").click();
    await page.getByRole("button", { name: "Open interface details for Z_DIRECT_INTERFACE", exact: true }).click();
    await expect(page.getByTestId("review-interface").getByTestId("status-local-review")).toHaveText("Submitted");
  } finally {
    await reviewerContext.close();
    await deleteSyntheticSharedAssessments(account);
  }
});
