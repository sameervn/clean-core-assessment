import { test, expect } from "./fixtures/accounts";
import { type Page } from "@playwright/test";
import { emptyWorkspace, validateWorkspace, type StoredWorkspace } from "../../src/lib/workspace-store";
import { explanationSummary, summaryFingerprint, type AiNarratives } from "../../src/lib/ai-narratives";

const timestamp = "2026-10-14T00:00:00.000Z";
const attribution = { provider: "openai" as const, model: "browser-fixture", generatedAt: timestamp, acceptedAt: timestamp };

function fixture(): StoredWorkspace {
  // Both kinds share IDs deliberately: replacing one must not remove its sibling.
  const inventory = ["current", "changed", "legacy"].map(state => ({
    id: `review-${state}`, objectName: `Z_REVIEW_${state.toUpperCase()}`,
    interfaceName: `Endpoint ${state}`, objectType: "CLAS", module: "FI",
    package: "Z_REVIEW", classification: "B", confidence: "high",
    disposition: "retain", dimension: "Integration", dependencies: [],
  }));
  const aiNarratives: AiNarratives = {};
  for (const item of inventory) {
    for (const kind of ["object", "interface"] as const) {
      aiNarratives[`${kind}:${item.id}`] = {
        ...attribution, text: `Accepted ${kind} for ${item.id}`,
        ...(item.id.endsWith("legacy") ? {} : {
          summaryFingerprint: summaryFingerprint(explanationSummary(kind,
            item.id.endsWith("changed") ? { ...item, classification: "C" } : item)),
        }),
      };
    }
  }
  return {
    ...emptyWorkspace(), aiNarratives,
    narratives: Object.fromEntries(inventory.map(item => [item.id, `Expert note for ${item.id}`])),
    assessment: {
      system: "PRD", targetRelease: "S4HANA_2023", inventory,
      cleanCoreShare: 100, technicalDebtScore: 0, totals: { objects: 3 },
      provenance: { generatedAt: timestamp, engineVersion: "browser-fixture" },
      evidenceQuality: { confidence: "high", gaps: [] }, roadmap: { waves: [] },
      rollups: {}, clusters: [], levelD: [], deadCode: [], duplicates: [],
      integrations: [], recommendations: [], quickWins: [], upgradeRisk: [],
    },
  };
}

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

async function restoreFixture(page: Page, before: StoredWorkspace, configureStatus = true) {
  expect(validateWorkspace(before).ok).toBe(true);
  if (configureStatus) await page.route("**/api/clean-core/ai/status", route => route.fulfill({
    json: { state: "configured", provider: "openai", model: "browser-fixture", message: "Test AI ready" },
  }));
  await page.goto("./");
  await expect(page.getByTestId("button-empty-load-demo")).toBeVisible();
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
  }), before);
  await page.reload();
}

for (const kind of ["object", "interface"] as const) {
  for (const availability of ["unavailable", "disabled", "HTTP failure", "network failure"] as const) {
    test(`${kind}: AI status ${availability} keeps generation blocked and expert notes editable across reloads`, async ({ page }) => {
      const before = fixture();
      const expectedNarratives = { ...before.narratives };
      const generationRequests: string[] = [];
      let statusRequests = 0;
      const message = availability === "unavailable" || availability === "disabled"
        ? `Fixture AI is ${availability}. Expert notes remain available.`
        : "AI status unavailable. Assessments and notes still work.";
      // Intercept the entire AI API, including unexpected generation requests,
      // so regressions cannot reach a live provider.
      await page.route("**/api/clean-core/ai/**", async route => {
        if (new URL(route.request().url()).pathname.endsWith("/status")) {
          statusRequests++;
          if (availability === "network failure") return route.abort("failed");
          if (availability === "HTTP failure") return route.fulfill({
            status: 503, json: { message: "Fixture status service failed" },
          });
          return route.fulfill({ json: { state: availability, message } });
        }
        generationRequests.push(route.request().url());
        return route.abort("blockedbyclient");
      });
      await restoreFixture(page, before, false);
      const ai = page.getByRole("region", { name: "AI explanation", exact: true });
      const expert = page.getByPlaceholder("Add architectural context, planned successor details, or remediation notes...");
      const openDetail = async () => {
        await page.getByTestId("tab-ai-review").click();
        await page.getByRole("button", { name: `Review ${kind} Z_REVIEW_CHANGED`, exact: true }).click();
      };
      const assertUnavailable = async () => {
        await expect(ai.getByText(message, { exact: true })).toBeVisible();
        await expect(ai.getByText(`Accepted ${kind} for review-changed`, { exact: true })).toBeVisible();
        const preview = ai.getByRole("button", { name: "Preview AI request", exact: true });
        await expect(preview).toBeDisabled();
        // A forced pointer click on the disabled native button must not open
        // consent or start generation (normal click would wait for enablement).
        await preview.click({ force: true });
        await expect(ai.getByRole("button", { name: "I consent — generate explanation", exact: true })).toHaveCount(0);
        expect(generationRequests).toEqual([]);
      };
      const assertStored = async () => {
        await expect.poll(async () => (await stored(page)).narratives).toEqual(expectedNarratives);
        await expect(page.getByTestId("status-save")).toHaveText("Saved locally");
        const saved = await stored(page);
        expect(saved.aiNarratives).toEqual(before.aiNarratives);
        expect(saved.assessment).toEqual(before.assessment);
      };
      await openDetail();
      await assertUnavailable();
      await expect(expert).toHaveValue(before.narratives["review-changed"]);
      // Save twice, with a reload between edits, proving restored notes remain
      // editable and neither save overwrites accepted explanations or siblings.
      for (const edit of [1, 2]) {
        expectedNarratives["review-changed"] = `${kind} expert revision ${edit} while ${availability}\nManual remediation context.`;
        await expect(expert).toBeEditable();
        await expert.fill(expectedNarratives["review-changed"]);
        await page.getByRole("button", { name: "Save Narrative", exact: true }).click();
        await assertStored();
        await assertUnavailable();
        const previousStatusRequests = statusRequests;
        await page.reload();
        await openDetail();
        await assertUnavailable();
        expect(statusRequests).toBeGreaterThan(previousStatusRequests);
        await expect(expert).toHaveValue(expectedNarratives["review-changed"]);
        await assertStored();
      }
      expect(generationRequests).toEqual([]);
    });
  }
}

for (const kind of ["object", "interface"] as const) {
  test(`${kind} AI consent preview sends only the displayed summary, never private assessment details`, async ({ page }) => {
    const before = fixture();
    const privateDetails = {
      objectName: "Z_PRIVATE_PAYROLL_NAME",
      interfaceName: "PRIVATE_PAYROLL_ENDPOINT",
      sourceSystem: "PRIVATE_SOURCE_SYSTEM",
      targetSystem: "PRIVATE_TARGET_SYSTEM",
      rawEvidence: "PRIVATE_RAW_EVIDENCE_CONTENT",
      sourceCode: "PRIVATE_SOURCE_CODE_CONTENT",
      classificationExplanation: "PRIVATE_CLASSIFICATION_EVIDENCE",
    };
    const item = before.assessment.inventory.find((row: { id: string }) => row.id === "review-legacy");
    Object.assign(item, privateDetails, {
      recommendation: { primary: { id: "retain-released-api", title: "PRIVATE_RECOMMENDATION_NAME" } },
    });
    before.system = before.assessment.system = "PRIVATE_ASSESSMENT_SYSTEM";
    before.narratives[item.id] = "PRIVATE_EXPERT_NOTE_CONTENT";
    const forbidden = [
      ...Object.values(privateDetails), item.id, item.package,
      before.system, before.narratives[item.id], "PRIVATE_RECOMMENDATION_NAME",
    ];
    // Keep this expectation independent of explanationSummary: using the
    // production mapper here would let an accidental field leak pass unnoticed.
    const expected = {
      kind, classification: "B", recommendation: "retain-released-api", confidence: "high",
    };
    const requests: unknown[] = [];
    await page.route("**/api/clean-core/ai/explain", route => {
      requests.push(route.request().postDataJSON());
      expect(route.request().method()).toBe("POST");
      return route.fulfill({ json: { ...attribution, text: "Deterministic consent draft" } });
    });
    await restoreFixture(page, before);
    await page.getByTestId("tab-ai-review").click();
    await page.getByRole("button", { name: `Review ${kind} ${item.objectName}`, exact: true }).click();
    const ai = page.getByRole("region", { name: "AI explanation", exact: true });
    await expect(page.getByPlaceholder("Add architectural context, planned successor details, or remediation notes..."))
      .toHaveValue(before.narratives[item.id]);
    if (kind === "interface") {
      await expect(page.getByText(privateDetails.sourceSystem, { exact: true })).toBeVisible();
      await expect(page.getByText(privateDetails.targetSystem, { exact: true })).toBeVisible();
    }
    expect(requests).toEqual([]);
    await ai.getByRole("button", { name: "Preview AI request", exact: true }).click();
    const preview = ai.locator("pre");
    await expect(preview).toBeVisible();
    const displayed = await preview.innerText();
    expect(JSON.parse(displayed)).toEqual(expected);
    for (const value of forbidden) expect(displayed).not.toContain(value);
    expect(requests).toEqual([]);

    // Dismissing and reopening the preview must still not grant consent.
    await ai.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(preview).toHaveCount(0);
    await ai.getByRole("button", { name: "Preview AI request", exact: true }).click();
    await expect(preview).toHaveText(displayed);
    expect(requests).toEqual([]);
    await ai.getByRole("button", { name: "I consent — generate explanation", exact: true }).click();
    await expect(ai.getByText("Deterministic consent draft", { exact: true })).toBeVisible();
    expect(requests).toEqual([JSON.parse(displayed)]);
    expect(requests).toEqual([expected]);
    for (const value of forbidden) expect(JSON.stringify(requests)).not.toContain(value);
  });
}

test("AI Review counts, filters and detail navigation preserve notes when refreshing either kind", async ({ page }) => {
  const before = fixture();
  const requests: unknown[] = [];
  // Exercise the real UI and persistence without credentials or provider calls.
  await page.route("**/api/clean-core/ai/explain", route => {
    const input = route.request().postDataJSON();
    requests.push(input);
    return route.fulfill({ json: { ...attribution, text: `Refreshed ${input.kind} explanation` } });
  });
  await restoreFixture(page, before);
  const tab = page.getByTestId("tab-ai-review");
  await expect(tab).toHaveText("AI Review (4)");
  await tab.click();
  const queue = page.getByTestId("ai-review-queue");
  const table = queue.getByRole("table");
  const reviews = table.getByRole("button", { name: /^Review / });
  const remaining = [
    "Review object Z_REVIEW_CHANGED", "Review interface Z_REVIEW_CHANGED",
    "Review object Z_REVIEW_LEGACY", "Review interface Z_REVIEW_LEGACY",
  ];
  const assertRows = async (names: string[]) => {
    await expect(reviews).toHaveCount(names.length);
    for (const name of names) await expect(table.getByRole("button", { name, exact: true })).toBeVisible();
  };
  const filter = async (name: string) => {
    await page.getByRole("combobox", { name: "AI review status" }).click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  await expect(queue.getByText("AI explanations needing review (4)", { exact: true })).toBeVisible();
  await expect(queue.getByText("2 changed · 2 unknown", { exact: true })).toBeVisible();
  await assertRows(remaining);
  await expect(table.getByText("Z_REVIEW_CURRENT", { exact: true })).toHaveCount(0);
  await filter("Changed inputs");
  await assertRows(remaining.slice(0, 2));
  await filter("Unknown freshness");
  await assertRows(remaining.slice(2));
  const search = page.getByRole("textbox", { name: "Search AI reviews" });
  await search.fill("Z_REVIEW_CHANGED");
  await assertRows([]);
  await expect(table.getByText("No explanations match these filters.")).toBeVisible();
  await filter("All needing review");
  await assertRows(remaining.slice(0, 2));
  await search.fill("endpoint LEGACY");
  await assertRows(remaining.slice(2));
  await search.fill("review-changed");
  await assertRows(remaining.slice(0, 2));
  await search.clear();

  const ai = page.getByRole("region", { name: "AI explanation", exact: true });
  const expert = page.getByPlaceholder("Add architectural context, planned successor details, or remediation notes...");
  // Navigate all four review entries, including legacy warnings and both detail types.
  for (const state of ["changed", "legacy"]) {
    for (const kind of ["object", "interface"]) {
      await table.getByRole("button", { name: `Review ${kind} Z_REVIEW_${state.toUpperCase()}`, exact: true }).click();
      await expect(ai.getByText(`Accepted ${kind} for review-${state}`, { exact: true })).toBeVisible();
      await expect(ai.getByRole("status")).toContainText(state === "changed" ? "Needs review" : "Review status unknown");
      await expect(expert).toHaveValue(before.narratives[`review-${state}`]);
      if (kind === "object") await expect(queue.getByRole("heading", { name: "Dependencies", exact: true })).toBeVisible();
      else await expect(queue.getByText("Source System", { exact: true })).toBeVisible();
    }
  }
  expect((await stored(page)).aiNarratives).toEqual(before.aiNarratives);

  const expectedNotes = { ...before.aiNarratives };
  for (const [kind, state] of [["object", "changed"], ["interface", "legacy"]] as const) {
    const name = `Review ${kind} Z_REVIEW_${state.toUpperCase()}`;
    const subject = `${kind}:review-${state}`;
    await table.getByRole("button", { name, exact: true }).click();
    await ai.getByRole("button", { name: "Preview AI request", exact: true }).click();
    await ai.getByRole("button", { name: "I consent — generate explanation", exact: true }).click();
    await expect(ai.getByText(`Refreshed ${kind} explanation`, { exact: true })).toBeVisible();
    // Generating a draft is not acceptance and must not affect counts or storage.
    await assertRows(remaining);
    expect((await stored(page)).aiNarratives).toEqual(expectedNotes);
    await ai.getByRole("button", { name: "Replace accepted AI explanation", exact: true }).click();
    remaining.splice(remaining.indexOf(name), 1);
    await expect(tab).toHaveText(`AI Review (${remaining.length})`);
    await expect(queue.getByText(`AI explanations needing review (${remaining.length})`, { exact: true })).toBeVisible();
    await expect(queue.getByText(kind === "object" ? "1 changed · 2 unknown" : "1 changed · 1 unknown", { exact: true })).toBeVisible();
    await assertRows(remaining);
    await expect(ai.getByRole("status")).toHaveCount(0);
    await expect(expert).toHaveValue(before.narratives[`review-${state}`]);
    expectedNotes[subject] = {
      ...attribution, text: `Refreshed ${kind} explanation`, acceptedAt: expect.any(String),
      summaryFingerprint: summaryFingerprint(explanationSummary(kind, before.assessment.inventory.find((item: { id: string }) => item.id === `review-${state}`))),
    };
    await expect.poll(async () => (await stored(page)).aiNarratives).toEqual(expectedNotes);
    expect((await stored(page)).narratives).toEqual(before.narratives);
  }
  expect(requests).toEqual([
    { kind: "object", classification: "B", recommendation: "", confidence: "high" },
    { kind: "interface", classification: "B", recommendation: "", confidence: "high" },
  ]);
  await expect(page.getByTestId("status-save")).toHaveText("Saved locally");
  await page.reload();
  await expect(tab).toHaveText("AI Review (2)");
  await tab.click();
  await assertRows(remaining);
  const after = await stored(page);
  expect(after.aiNarratives).toEqual(expectedNotes);
  expect(after.narratives).toEqual(before.narratives);
  expect(after.assessment).toEqual(before.assessment);
});

// Removal is independent of generation/replacement. Test either kind first so
// deleting a shared record ID cannot silently delete its other-kind sibling.
for (const firstKind of ["object", "interface"] as const) {
  test(`removing accepted AI explanations (${firstKind} first) preserves expert notes and sibling reviews across reloads`, async ({ page }) => {
    const before = fixture();
    const expectedNotes = { ...before.aiNarratives };
    const generationRequests: string[] = [];
    await page.route("**/api/clean-core/ai/explain", route => {
      generationRequests.push(route.request().url());
      return route.abort();
    });
    await restoreFixture(page, before);
    const tab = page.getByTestId("tab-ai-review");
    const queue = page.getByTestId("ai-review-queue");
    const table = queue.getByRole("table");
    const ai = page.getByRole("region", { name: "AI explanation", exact: true });
    const expert = page.getByPlaceholder("Add architectural context, planned successor details, or remediation notes...");
    const empty = table.getByText("No accepted AI explanations for current records need review.", { exact: true });
    const remaining = [
      { kind: "object", state: "changed" }, { kind: "interface", state: "changed" },
      { kind: "object", state: "legacy" }, { kind: "interface", state: "legacy" },
    ];
    const reviewName = ({ kind, state }: typeof remaining[number]) => `Review ${kind} Z_REVIEW_${state.toUpperCase()}`;
    const assertQueue = async () => {
      await expect(tab).toHaveText(`AI Review (${remaining.length})`);
      await expect(queue.getByText(`AI explanations needing review (${remaining.length})`, { exact: true })).toBeVisible();
      const changed = remaining.filter(row => row.state === "changed").length;
      await expect(queue.getByText(`${changed} changed · ${remaining.length - changed} unknown`, { exact: true })).toBeVisible();
      await expect(table.getByRole("button", { name: /^Review / })).toHaveCount(remaining.length);
      for (const row of remaining) {
        await expect(table.getByRole("button", { name: reviewName(row), exact: true })).toBeVisible();
      }
      await expect(empty).toHaveCount(remaining.length ? 0 : 1);
    };
    const assertSaved = async () => {
      // Compare the entire maps, not just the removed entry: siblings, current
      // explanations outside the queue, and all expert notes must stay intact.
      await expect.poll(async () => (await stored(page)).aiNarratives).toEqual(expectedNotes);
      const saved = await stored(page);
      expect(saved.narratives).toEqual(before.narratives);
      expect(saved.assessment).toEqual(before.assessment);
      await expect(page.getByTestId("status-save")).toHaveText("Saved locally");
    };
    await tab.click();
    await assertQueue();
    const secondKind = firstKind === "object" ? "interface" : "object";
    for (const state of ["changed", "legacy"]) {
      for (const kind of [firstKind, secondKind]) {
        const row = { kind, state };
        const text = `Accepted ${kind} for review-${state}`;
        await table.getByRole("button", { name: reviewName(row), exact: true }).click();
        await expect(ai.getByText(text, { exact: true })).toBeVisible();
        await expect(expert).toHaveValue(before.narratives[`review-${state}`]);
        await ai.getByRole("button", { name: "Remove accepted AI explanation", exact: true }).click();
        delete expectedNotes[`${kind}:review-${state}`];
        remaining.splice(remaining.findIndex(item => item.kind === kind && item.state === state), 1);
        await expect(ai.getByText(text, { exact: true })).toHaveCount(0);
        await expect(ai.getByRole("button", { name: "Remove accepted AI explanation", exact: true })).toHaveCount(0);
        await expect(ai.getByRole("status")).toHaveCount(0);
        await expect(expert).toHaveValue(before.narratives[`review-${state}`]);
        await assertQueue();
        await assertSaved();
        await page.reload();
        await expect(tab).toHaveText(`AI Review (${remaining.length})`);
        await tab.click();
        await assertQueue();
        await assertSaved();
        // Reopen every surviving review after hydration, including the
        // same-ID sibling when only one kind has been removed.
        for (const sibling of remaining) {
          await table.getByRole("button", { name: reviewName(sibling), exact: true }).click();
          await expect(ai.getByText(`Accepted ${sibling.kind} for review-${sibling.state}`, { exact: true })).toBeVisible();
          await expect(expert).toHaveValue(before.narratives[`review-${sibling.state}`]);
        }
      }
    }
    expect(Object.keys(expectedNotes).sort()).toEqual(["interface:review-current", "object:review-current"]);
    expect(generationRequests).toEqual([]);
  });
}

for (const kind of ["object", "interface"] as const) {
  for (const scenario of ["failed response", "discarded draft", "cancelled request", "navigation during request"] as const) {
    test(`${kind}: ${scenario} preserves accepted notes and allows retry`, async ({ page }) => {
      const before = fixture();
      const subject = `${kind}:review-changed`;
      const staleText = `Unaccepted ${scenario} ${kind}`;
      const retryText = `Successful retry ${kind}`;
      const inputs: unknown[] = [];
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      let delivered!: () => void;
      const delivery = new Promise<void>(resolve => { delivered = resolve; });
      const pending = scenario === "cancelled request" || scenario === "navigation during request";
      await page.route("**/api/clean-core/ai/explain", async route => {
        inputs.push(route.request().postDataJSON());
        if (inputs.length === 1) {
          if (scenario === "failed response") {
            await route.fulfill({ status: 503, json: { message: "Fixture generation failed. Try again." } });
          } else {
            if (pending) await held;
            await route.fulfill({ json: { ...attribution, text: staleText } });
          }
          delivered();
        } else {
          await route.fulfill({ json: { ...attribution, text: retryText } });
        }
      });
      await restoreFixture(page, before);
      const tab = page.getByTestId("tab-ai-review");
      await expect(tab).toHaveText("AI Review (4)");
      await tab.click();
      const queue = page.getByTestId("ai-review-queue");
      const ai = page.getByRole("region", { name: "AI explanation", exact: true });
      const expert = page.getByPlaceholder("Add architectural context, planned successor details, or remediation notes...");
      const open = async (targetKind: string, state = "changed") => {
        await queue.getByRole("button", { name: `Review ${targetKind} Z_REVIEW_${state.toUpperCase()}`, exact: true }).click();
        await expect(ai.getByText(`Accepted ${targetKind} for review-${state}`, { exact: true })).toBeVisible();
        await expect(expert).toHaveValue(before.narratives[`review-${state}`]);
      };
      const unchanged = async () => {
        await expect(tab).toHaveText("AI Review (4)");
        await expect(queue.getByText("2 changed · 2 unknown", { exact: true })).toBeVisible();
        await expect(queue.getByRole("table").getByRole("button", { name: /^Review / })).toHaveCount(4);
        const snapshot = await stored(page);
        expect(snapshot.aiNarratives).toEqual(before.aiNarratives);
        expect(snapshot.narratives).toEqual(before.narratives);
        expect(snapshot.assessment).toEqual(before.assessment);
      };
      const consent = () => ai.getByRole("button", { name: "I consent — generate explanation", exact: true }).click();
      await open(kind);
      await ai.getByRole("button", { name: "Preview AI request", exact: true }).click();
      await consent();
      if (pending) {
        await expect.poll(() => inputs.length).toBe(1);
        await expect(ai.getByRole("button", { name: "Generating…", exact: true })).toBeDisabled();
        await unchanged();
        const aborted = page.waitForEvent("requestfailed", request => request.url().endsWith("/api/clean-core/ai/explain"));
        if (scenario === "cancelled request") {
          await ai.getByRole("button", { name: "Cancel", exact: true }).click();
        } else {
          // Same ID, different kind: a late object response must not become an interface draft (or vice versa).
          await open(kind === "object" ? "interface" : "object");
        }
        await aborted;
        release();
        await delivery;
        await expect(ai.getByText(staleText, { exact: true })).toHaveCount(0);
        await expect(ai.getByRole("button", { name: "Replace accepted AI explanation", exact: true })).toHaveCount(0);
        await expect(ai.getByRole("alert")).toHaveCount(0);
        await unchanged();
        if (scenario === "navigation during request") {
          // Also check a different entity before returning to retry the original.
          await open(kind, "legacy");
          await expect(ai.getByText(staleText, { exact: true })).toHaveCount(0);
          await open(kind);
        }
      } else if (scenario === "failed response") {
        await expect(ai.getByRole("alert")).toHaveText("Fixture generation failed. Try again.");
        await expect(ai.getByRole("button", { name: "I consent — generate explanation", exact: true })).toBeEnabled();
      } else {
        await expect(ai.getByText(staleText, { exact: true })).toBeVisible();
        await unchanged();
        await ai.getByRole("button", { name: "Discard", exact: true }).click();
        await expect(ai.getByText(staleText, { exact: true })).toHaveCount(0);
      }
      await expect(ai.getByText(before.aiNarratives[subject].text, { exact: true })).toBeVisible();
      await expect(expert).toHaveValue(before.narratives["review-changed"]);
      await unchanged();
      // Retry in-place after errors; cancelled/discarded drafts require fresh consent.
      if (scenario !== "failed response") {
        await ai.getByRole("button", { name: "Preview AI request", exact: true }).click();
      }
      await consent();
      await expect(ai.getByText(retryText, { exact: true })).toBeVisible();
      await expect(ai.getByText(staleText, { exact: true })).toHaveCount(0);
      await expect(ai.getByRole("alert")).toHaveCount(0);
      await unchanged();
      await ai.getByRole("button", { name: "Replace accepted AI explanation", exact: true }).click();
      const expectedNotes = {
        ...before.aiNarratives,
        [subject]: {
          ...attribution, text: retryText, acceptedAt: expect.any(String),
          summaryFingerprint: summaryFingerprint(explanationSummary(kind,
            before.assessment.inventory.find((item: { id: string }) => item.id === "review-changed"))),
        },
      };
      await expect(tab).toHaveText("AI Review (3)");
      await expect(queue.getByText("1 changed · 2 unknown", { exact: true })).toBeVisible();
      await expect.poll(async () => (await stored(page)).aiNarratives).toEqual(expectedNotes);
      await expect(page.getByTestId("status-save")).toHaveText("Saved locally");
      await page.reload();
      await expect(tab).toHaveText("AI Review (3)");
      const after = await stored(page);
      expect(after.aiNarratives).toEqual(expectedNotes);
      expect(after.narratives).toEqual(before.narratives);
      expect(after.assessment).toEqual(before.assessment);
      expect(inputs).toEqual(Array(2).fill({ kind, classification: "B", recommendation: "", confidence: "high" }));
    });
  }
}
