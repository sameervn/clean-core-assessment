import { test } from "node:test";
import assert from "node:assert/strict";
import { exportSourceVersions } from "./source-versions";
import type { AiNarratives } from "./ai-narratives";
const notes = { "object:test": { sources: [{ id: "test", version: 1 }] } } as unknown as AiNarratives;
test("exports without citations do not request the optional library", async () => {
  const request = async () => { throw new Error("Must not be called"); };
  assert.equal(await exportSourceVersions({}, request), undefined);
  assert.equal(await exportSourceVersions({ "object:x": { sources: [] } } as unknown as AiNarratives, request), undefined);
});
test("stalled requests and stalled response bodies cannot hold up exports", async () => {
  let signal: AbortSignal | null | undefined;
  const stalled = (_path: string, init?: RequestInit) => { signal = init?.signal; return new Promise<Response>(() => {}); };
  assert.equal(await exportSourceVersions(notes, stalled, 10), undefined);
  assert.equal(signal?.aborted, true);
  const stalledBody = async () => ({ ok: true, json: () => new Promise(() => {}) }) as unknown as Response;
  assert.equal(await exportSourceVersions(notes, stalledBody, 10), undefined);
});
test("successful lookup and failures retain explicit freshness semantics", async () => {
  assert.deepEqual(await exportSourceVersions(notes, async () => Response.json({ documents: [{ id: "test", version: 2, status: "ready" }] })), { test: 2 });
  assert.equal(await exportSourceVersions(notes, async () => new Response("", { status: 503 })), undefined);
  assert.equal(await exportSourceVersions(notes, async () => { throw new Error("offline"); }), undefined);
});
