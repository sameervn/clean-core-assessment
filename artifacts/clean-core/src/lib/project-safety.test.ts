import test from "node:test";
import assert from "node:assert/strict";
import { apiFetch, apiJson, captureProjectGuard, setActiveProjectId, resetSessionRequests } from "./api";
import { saveDraft, loadDraft, clearDraft, normalizeContent } from "./shared-assessments";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("multi-step source operations cannot resume writes after a project or session change", () => {
  setActiveProjectId(A);
  const oldOperation = captureProjectGuard();
  oldOperation();
  setActiveProjectId(B);
  assert.throws(oldOperation, { name: "AbortError" });
  setActiveProjectId(A);
  assert.throws(oldOperation, { name: "AbortError" }); // Returning to A does not revive stale confirmation.
  const oldSession = captureProjectGuard();
  resetSessionRequests();
  assert.throws(oldSession, { name: "AbortError" });
  setActiveProjectId(null);
});

test("product calls require an explicit project and capture its request header", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get("X-CC-Project-ID"), A);
    return Response.json({ ok: true });
  };
  try {
    setActiveProjectId(null);
    await assert.rejects(apiFetch("/api/clean-core/knowledge"), /project/i);
    assert.equal(calls, 0);
    setActiveProjectId(A);
    assert.deepEqual(await apiJson("/api/clean-core/knowledge"), { ok: true });
  } finally { globalThis.fetch = original; setActiveProjectId(null); }
});

test("late JSON bodies and cloned report responses cannot cross a project switch", async () => {
  const original = globalThis.fetch;
  let complete!: () => void;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      complete = () => { controller.enqueue(new TextEncoder().encode('{"project":"A"}')); controller.close(); };
    },
  }));
  try {
    setActiveProjectId(A);
    const response = await apiFetch("/api/shared-assessments");
    const clone = response.clone();
    const body = response.json();
    setActiveProjectId(B);
    complete();
    await assert.rejects(body, { name: "AbortError" });
    await assert.rejects(clone.blob(), { name: "AbortError" });
    await clone.body?.cancel().catch(() => undefined);
  } finally { globalThis.fetch = original; setActiveProjectId(null); }
});

test("an old editor's late draft writes/deletes remain bound to the original project", () => {
  const oldStorage = globalThis.localStorage;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  const draft = (narrative: string) => ({ baseVersion: 1, content: normalizeContent({ narrative }), savedAt: "2026-11-18T00:00:00Z" });
  try {
    setActiveProjectId(A);
    saveDraft("fixture-user", "same-entity", draft("client A"), A);
    setActiveProjectId(B);
    saveDraft("fixture-user", "same-entity", draft("client B"), B);
    saveDraft("fixture-user", "same-entity", draft("late client A"), A);
    assert.equal(loadDraft("fixture-user", "same-entity", B)?.content.narrative, "client B");
    assert.equal(loadDraft("fixture-user", "same-entity", A)?.content.narrative, "late client A");
    clearDraft("fixture-user", "same-entity", A);
    assert.equal(loadDraft("fixture-user", "same-entity", B)?.content.narrative, "client B");
    clearDraft("fixture-user", "same-entity", B);
  } finally {
    setActiveProjectId(null);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: oldStorage });
  }
});
