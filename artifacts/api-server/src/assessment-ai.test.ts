import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import express from "express";
import { aiConfig, gatewayIdentity, explain, AiError, SYSTEM_PROMPT } from "./assessment-ai";
import { createAiRouter as createProductionAiRouter } from "./routes/assessment-ai";
import { consentToken, type Payload } from "./knowledge/retrieval";
import { aiLimiterFromEnv, type AiLimiter } from "./ai-limiter";
import { ExplainAssessmentBody, GetAiLimiterHealthResponse } from "@workspace/api-zod";
import { buildCleanCoreAssessment, buildCleanCoreDemoEvidence } from "./clean-core-assessment";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = {
  CC_AI_AUTH_MODE: "gateway",
  CC_AI_ENABLED: "true", CC_AI_PROVIDER: "openai", CC_AI_MODEL: "test-model",
  CC_AI_API_KEY: "synthetic-test-key-not-a-credential",
  CC_AI_GATEWAY_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
  CC_AI_GATEWAY_ISSUER: "test-issuer", CC_AI_GATEWAY_AUDIENCE: "test-audience",
};
const config = aiConfig(env)!;
const summary = { kind: "object" as const, classification: "B" as const, recommendation: "released-api", confidence: "high" as const, targetRelease: "S4HANA_2025" };
process.env.SESSION_SECRET = "synthetic-consent-unit-test-secret";
const payloadFor = (value: any): Payload => ({ summary: value, mode: "allow-fallback", references: [], disclosure: "General-model fallback." });
function consented(body: unknown, assertion?: string) {
  let user = "test-subject";
  try { user = JSON.parse(Buffer.from(assertion!.split(".")[1], "base64url").toString()).sub; } catch { /* invalid identity tested separately */ }
  return { summary: body, mode: "allow-fallback", token: consentToken(`${user}:${config.provider}:${config.model}:${config.url}`, payloadFor(body), "0") };
}
// Inject only the storage boundary; real consent, provider and limiter logic remain exercised.
function createAiRouter(configuration: Parameters<typeof createProductionAiRouter>[0], request?: typeof fetch, limiter?: AiLimiter) {
  const router = express.Router();
  const user: any = { id: "synthetic", role: "Admin", permissions: ["ai.generate", "knowledge.read"], mustChangePassword: false };
  router.use((req, _res, next) => { req.identity = { user, csrf: "", tokenHash: "" }; next(); });
  router.use(createProductionAiRouter(configuration, request, limiter, {
    transaction: async fn => fn(null as any), freshUser: async () => user,
    retrieve: async value => ({ payload: payloadFor(value), epoch: "0", canGenerate: true,
      diagnostics: { terms: [], targetRelease: "S4HANA_2025", requiredTermMatches: 0, candidateLimit: 24, matchingPassages: 0, applicableCharacters: 0, requiredCharacters: 150, candidates: [] } }),
  }));
  return router;
}
function token(overrides = {}, header = { alg: "RS256" }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: config.issuer, aud: config.audience, sub: "test-subject", iat: now, exp: now + 60, ...overrides };
  const data = [header, payload].map(v => Buffer.from(JSON.stringify(v)).toString("base64url")).join(".");
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}
function response(text = "Review the released API contract with your architect.") {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: text } }] }));
}
test("authenticated health outage alerts without an acquisition or provider call", async () => {
  let probes = 0, acquisitions = 0, providerCalls = 0;
  const app = express();
  app.use(createAiRouter(config, (async () => { providerCalls++; return response(); }) as typeof fetch, {
    mode: "redis-rest",
    async probe() { probes++; throw new Error("private-remote-error"); },
    async acquire() { acquisitions++; return async () => {}; },
  }));
  const server = app.listen(0, "127.0.0.1");
  if (!server.listening) await new Promise<void>(r => server.once("listening", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/limiter-health`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal(probes, 0);
    const result = await fetch(url, { headers: { "x-cc-ai-assertion": token() } });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    const body = GetAiLimiterHealthResponse.parse(await result.json());
    assert.equal(body.available, false);
    assert.equal(body.metrics.probeFailures, 1);
    assert.ok(!JSON.stringify(body).includes("private"));
    assert.equal(probes, 1);
    assert.equal(acquisitions, 0);
    assert.equal(providerCalls, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  }
});
test("configuration is off by default and fails closed without gateway or valid destination", () => {
  assert.equal(aiConfig({}), null);
  assert.equal(aiConfig({ ...env, CC_AI_ENABLED: "TRUE" }), null);
  for (const patch of [
    { CC_AI_GATEWAY_PUBLIC_KEY: undefined }, { CC_AI_API_KEY: undefined },
    { CC_AI_ENDPOINT: "http://api.openai.com" }, { CC_AI_ENDPOINT: "https://localhost" },
    { CC_AI_ENDPOINT: "https://api.openai.com/evil" }, { CC_AI_ENDPOINT: "https://api.openai.com?key=bad" },
    { CC_AI_ENDPOINT: "https://user:pass@api.openai.com" }, { CC_AI_PROVIDER: "proxy" },
    { CC_AI_MODEL: "../wrong" },
  ]) assert.throws(() => aiConfig({ ...env, ...patch }), AiError);
  assert.throws(() => aiConfig({ ...env, CC_AI_PROVIDER: "azure" }), AiError);
});
test("gateway requires signed bounded RS256 claims; spoofed, expired and wrong audience rejected", () => {
  assert.equal(gatewayIdentity(token(), config), "test-subject");
  for (const value of [undefined, "admin@example.test", token({ exp: 1 }), token({ aud: "other" }), token({ iss: "other" }),
    token({ sub: "" }), token({ iat: 1 }), token({ nbf: Date.now() }), token({ exp: Date.now() }),
    token({}, { alg: "none" }), token().slice(0, -12) + "invalid"]) {
    assert.throws(() => gatewayIdentity(value, config), (e: unknown) => e instanceof AiError && e.status === 403);
  }
});
test("both provider formats use fixed destinations, separated instructions, bounded output and timeout", async () => {
  const azure = aiConfig({ ...env, CC_AI_PROVIDER: "azure", CC_AI_ENDPOINT: "https://test-resource.openai.azure.com", CC_AI_API_VERSION: "2024-10-21" })!;
  for (const cfg of [config, azure]) {
    const result = await explain(cfg, summary, (async (url, init) => {
      assert.equal(url, cfg.url);
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get(cfg.provider === "azure" ? "api-key" : "Authorization"), cfg.provider === "azure" ? cfg.key : `Bearer ${cfg.key}`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 800);
      assert.deepEqual(body.messages, [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(summary) }]);
      assert.equal(body.model, cfg.provider === "openai" ? cfg.model : undefined);
      return response();
    }) as typeof fetch);
    assert.equal(result.provider, cfg.provider);
    assert.ok(!JSON.stringify(result).includes(cfg.key));
  }
  assert.match(azure.url, /\/deployments\/test-model\/chat\/completions\?api-version=2024-10-21$/);
});
test("provider errors, malformed output, truncation, secrets and timeouts are sanitized", async () => {
  const failures: Array<() => Promise<Response>> = [
    async () => new Response(config.key, { status: 401 }),
    async () => new Response("private upstream error", { status: 429 }),
    async () => new Response("private upstream error", { status: 500 }),
    async () => new Response("not JSON"), async () => response(""),
    async () => response("x".repeat(6001)), async () => response(config.key),
    async () => new Response("x".repeat(65_000)),
    async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "truncated" } }] })),
    async () => { throw new DOMException("private upstream error", "TimeoutError"); },
  ];
  for (const failure of failures) {
    await assert.rejects(explain(config, summary, failure as typeof fetch), (error: unknown) => {
      assert.ok(error instanceof AiError);
      assert.ok(!error.message.includes(config.key) && !error.message.includes("private upstream error"));
      return true;
    });
  }
});
test("payload allowlist excludes uploaded data, names, notes, code, destinations and credentials", () => {
  for (const key of ["endpoint", "apiKey", "sourceCode", "evidence", "model", "prompt"]) {
    assert.equal(ExplainAssessmentBody.strict().safeParse({ ...summary, [key]: "untrusted" }).success, false);
  }
  assert.equal(ExplainAssessmentBody.safeParse({ ...summary, recommendation: "x".repeat(301) }).success, false);
});
test("explanations leave the deterministic engine result unchanged", async () => {
  const evidence = buildCleanCoreDemoEvidence("TEST", "S4HANA_2023");
  const assessment = buildCleanCoreAssessment({ system: "TEST", targetRelease: "S4HANA_2023", weighted: true, evidence });
  const before = JSON.stringify(assessment);
  await explain(config, summary, (async () => response()) as typeof fetch);
  assert.equal(JSON.stringify(assessment), before);
});
test("HTTP routes require verified identity and enforce user/global limits without provider calls on rejection", async () => {
  let calls = 0;
  const app = express();
  app.use(express.json({ limit: 2048 }));
  app.use("/ai", createAiRouter(config, (async () => { calls++; return response(); }) as typeof fetch));
  app.use("/disabled", createAiRouter(null));
  app.use("/missing", createAiRouter(new AiError(503, "Complete configuration.")));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const post = (body: unknown, assertion?: string) => fetch(`${base}/ai/explain`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(assertion ? { "x-cc-ai-assertion": assertion } : {}) }, body: JSON.stringify(consented(body, assertion)),
    });
    assert.equal(((await (await fetch(`${base}/disabled/status`)).json()) as any).state, "disabled");
    assert.equal(((await (await fetch(`${base}/missing/status`)).json()) as any).state, "not-configured");
    assert.equal(((await (await fetch(`${base}/ai/status`)).json()) as any).state, "unavailable");
    assert.equal((await post(summary)).status, 403);
    assert.equal((await post({ ...summary, endpoint: "https://evil.test" }, token())).status, 400);
    assert.equal(calls, 0);
    const status = await (await fetch(`${base}/ai/status`, { headers: { "x-cc-ai-assertion": token() } })).json() as any;
    assert.equal(status.state, "configured");
    assert.ok(!JSON.stringify(status).includes(config.key));
    for (let i = 0; i < 5; i++) assert.equal((await post(summary, token())).status, 200);
    assert.equal((await post(summary, token())).status, 429);
    assert.equal(calls, 5);
    for (let i = 0; i < 15; i++) assert.equal((await post(summary, token({ sub: `subject-${i}` }))).status, 200);
    assert.equal((await post(summary, token({ sub: "another" }))).status, 429);
    assert.equal(calls, 20);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("concurrency is bounded, released after failure, and provider failures change safe status", async () => {
  let release: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let started = 0;
  let bothStarted: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { bothStarted = resolve; });
  const app = express();
  app.use(express.json({ limit: 2048 }));
  app.use(createAiRouter(config, (async () => {
    started++;
    if (started === 2) bothStarted!();
    await waiting;
    return new Response("private-error-with-key", { status: 401 });
  }) as typeof fetch));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = { "Content-Type": "application/json", "x-cc-ai-assertion": token() };
  const post = () => fetch(`${base}/explain`, { method: "POST", headers, body: JSON.stringify(consented(summary)) });
  try {
    const first = post(), second = post();
    await ready;
    assert.equal((await post()).status, 429);
    assert.equal(started, 2);
    release!();
    for (const res of await Promise.all([first, second])) {
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.match(text, /authorization failed/);
      assert.ok(!text.includes("private-error-with-key"));
    }
    const status = await (await fetch(`${base}/status`, { headers })).json() as any;
    assert.equal(status.state, "unavailable");
    assert.equal((await post()).status, 503, "Failure released concurrency slot");
    assert.equal(started, 3);
  } finally { release!(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("limiter failure prevents provider calls and release failure never returns a successful draft", async () => {
  let providerCalls = 0, acquisitions = 0, releases = 0;
  const failingRelease: AiLimiter = {
    async acquire() {
      acquisitions++;
      return async () => { releases++; throw new Error("private limiter details"); };
    },
  };
  const app = express();
  app.use(express.json());
  const provider = (async () => { providerCalls++; return response(); }) as typeof fetch;
  app.use("/unavailable", createAiRouter(config, provider, aiLimiterFromEnv({ CC_AI_LIMITER: "redis-rest" })));
  app.use("/release-fails", createAiRouter(config, provider, failingRelease));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown = summary, identity = token()) => fetch(`${base}/${path}/explain`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-cc-ai-assertion": identity }, body: JSON.stringify(consented(body, identity)),
  });
  try {
    assert.equal((await post("unavailable")).status, 503);
    assert.equal(providerCalls, 0);
    assert.equal((await post("release-fails", summary, "spoofed")).status, 403);
    assert.equal((await post("release-fails", { ...summary, prompt: "no" })).status, 400);
    assert.equal(acquisitions, 0);
    const result = await post("release-fails");
    assert.equal(result.status, 503);
    assert.ok(!(await result.text()).includes("private limiter details"));
    assert.equal(providerCalls, 1);
    assert.equal(releases, 1);
    const status = await (await fetch(`${base}/release-fails/status`, { headers: { "x-cc-ai-assertion": token() } })).json() as any;
    assert.equal(status.state, "unavailable");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
  }
});
