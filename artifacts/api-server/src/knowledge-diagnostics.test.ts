import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { retrieve } from "./knowledge/retrieval";
import { createAiRouter } from "./routes/assessment-ai";
import { PreviewAssessmentExplanationResponse } from "@workspace/api-zod";

const summary = { kind: "object" as const, classification: "B" as const, recommendation: "released-api", confidence: "high" as const, targetRelease: "S4HANA_2025" };
const row = (id: string, text = "released api", release = summary.targetRelease) => ({
  id, title: "Synthetic guidance", version: 1, release, section: "Section 1", text, matching_passages: "30",
});
const storage = (rows: ReturnType<typeof row>[]) => ({
  query: async (sql: string) => ({ rows: sql.includes("cc_knowledge_epoch") ? [{ revision: "1" }] : rows }),
}) as any;

test("diagnostics explain coverage and caps without altering selected evidence", async () => {
  const result = await retrieve(summary, "knowledge-only", storage([
    row("a", "released only"), row("b"), row("b"), row("b"), row("c"), row("d"), row("e"),
  ]));
  assert.deepEqual(result.diagnostics.terms, ["released", "api"]);
  assert.deepEqual(result.diagnostics.candidates.map(c => c.reason), [
    "insufficient-coverage", "selected", "selected", "document-limit", "selected", "selected", "excerpt-limit",
  ]);
  assert.deepEqual(result.payload.references.map(r => r.id), ["b", "b", "c", "d"]);
  assert.equal(result.diagnostics.matchingPassages, 30);
  assert.equal(result.diagnostics.applicableCharacters, 48);
  assert.equal(result.canGenerate, false);
  assert(!("diagnostics" in result.payload));
});

test("no terms, no matches and historical-only evidence explain insufficient guidance", async () => {
  const empty = await retrieve({ ...summary, recommendation: "the and" }, "knowledge-only", storage([]));
  assert.deepEqual(empty.diagnostics.terms, []);
  assert.equal(empty.diagnostics.matchingPassages, 0);
  const missing = await retrieve(summary, "knowledge-only", storage([]));
  assert.deepEqual(missing.diagnostics.candidates, []);
  const historical = await retrieve(summary, "knowledge-only", storage([row("old", "released api ".repeat(20), "S4HANA_2023")]));
  assert.equal(historical.diagnostics.candidates[0].reason, "selected");
  assert.equal(historical.diagnostics.applicableCharacters, 0);
  assert.equal(historical.canGenerate, false);
});

test("preview diagnostics are manager-only, insufficient-only, no-store and never sent to a provider", async () => {
  process.env.SESSION_SECRET = "synthetic-diagnostics-test-secret";
  const user: any = { id: "synthetic", role: "Admin", permissions: ["ai.generate", "knowledge.read", "knowledge.manage-all"], mustChangePassword: false };
  let currentPermissions = [...user.permissions], sufficient = false, providerCalls = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.identity = { user, csrf: "", tokenHash: "" }; next(); });
  app.use(createAiRouter({
    provider: "openai", model: "synthetic", key: "synthetic", url: "https://example.invalid",
    authMode: "local", issuer: "", audience: "",
  }, async () => { providerCalls++; throw new Error("Must not call provider"); }, undefined, {
    transaction: async fn => fn(storage([])),
    freshUser: async () => ({ ...user, permissions: currentPermissions }),
    retrieve: async (input, mode) => ({ ...await retrieve(input, mode, storage([])), canGenerate: sufficient || mode === "allow-fallback" }),
  }));
  const server = app.listen(0);
  try {
    const address = server.address() as { port: number };
    const preview = async (mode = "knowledge-only") => fetch(`http://127.0.0.1:${address.port}/preview`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary, mode }),
    });
    const manager = await preview();
    assert.equal(manager.status, 200);
    assert.equal(manager.headers.get("cache-control"), "no-store");
    const data = PreviewAssessmentExplanationResponse.parse(await manager.json());
    assert.deepEqual(data.diagnostics?.terms, ["released", "api"]);
    assert(!("diagnostics" in data.payload));
    assert.equal(PreviewAssessmentExplanationResponse.parse(await (await preview("allow-fallback")).json()).diagnostics, undefined);
    sufficient = true;
    assert.equal(PreviewAssessmentExplanationResponse.parse(await (await preview()).json()).diagnostics, undefined);
    sufficient = false;
    currentPermissions = ["knowledge.read", "ai.generate", "knowledge.upload"];
    assert.equal(PreviewAssessmentExplanationResponse.parse(await (await preview()).json()).diagnostics, undefined);
    currentPermissions = ["knowledge.read", "knowledge.manage-all"];
    assert.equal((await preview()).status, 403);
    currentPermissions = ["ai.generate", "knowledge.manage-all"];
    assert.equal((await preview()).status, 403);
    assert.equal(providerCalls, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
