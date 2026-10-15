import test from "node:test";
import assert from "node:assert/strict";
import { aiConfig, explain, AiError, SYSTEM_PROMPT } from "./assessment-ai";

const env = {
  CC_AI_ENABLED: "true", CC_AI_PROVIDER: "deere-gateway", CC_AI_MODEL: "approved-model",
  CC_AI_AUTH_MODE: "local", AI_GATEWAY_BASE_URL: "https://ai-gateway.deere.com",
  AI_GATEWAY_ISSUER: "https://sso-dev.johndeere.com/oauth2/ausx8znnnrQpD7x0f0h7",
  AI_GATEWAY_REGISTRATION_ID: "test-registration", AI_GATEWAY_CLIENT_ID: "test-client",
  AI_GATEWAY_CLIENT_SECRET: "synthetic-client-secret", AI_GATEWAY_PROTOCOL: "openai-chat",
  AI_GATEWAY_ROUTE: "/openai/chat/completions",
};
const summary = { synthetic: true } as any;
const token = (value = "synthetic-token", expires_in: unknown = 300) =>
  Response.json({ access_token: value, token_type: "Bearer", expires_in });
const model = (text = "Grounded explanation [1].") =>
  Response.json({ choices: [{ finish_reason: "stop", message: { content: text } }] });
const isToken = (url: unknown) => String(url).endsWith("/v1/token");

test("Deere configuration is separate from inbound auth and rejects unapproved routing", () => {
  assert.equal(aiConfig(env)!.authMode, "local");
  for (const key of Object.keys(env).filter(k => k.startsWith("AI_GATEWAY_"))) {
    assert.throws(() => aiConfig({ ...env, [key]: undefined }), AiError);
  }
  for (const patch of [
    { AI_GATEWAY_BASE_URL: "http://ai-gateway.deere.com" },
    { AI_GATEWAY_BASE_URL: "https://ai-gateway.deere.com.evil.test" },
    { AI_GATEWAY_BASE_URL: "https://user:pass@ai-gateway.deere.com" },
    { AI_GATEWAY_ISSUER: "https://evil.test/oauth2" },
    { AI_GATEWAY_ROUTE: "//evil.test" }, { AI_GATEWAY_PROTOCOL: "anthropic" },
    { CC_AI_AUTH_MODE: "gateway" }, { AI_GATEWAY_REGISTRATION_ID: "id\r\nbad" },
  ]) assert.throws(() => aiConfig({ ...env, ...patch }), AiError);
  assert.ok(aiConfig({ ...env, AI_GATEWAY_ISSUER: "https://sso.johndeere.com/oauth2/aushh24tmyH9xSbQ21t7" }));
});

test("Direct OAuth omits scope; model headers and prompt remain bounded; concurrent calls reuse token", async () => {
  const config = aiConfig(env)!;
  let auth = 0, models = 0;
  const request: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    if (isToken(url)) {
      auth++;
      const form = new URLSearchParams(String(init?.body));
      assert.deepEqual([...form.keys()].sort(), ["client_id", "client_secret", "grant_type"]);
      assert.equal(form.get("grant_type"), "client_credentials");
      assert.equal(form.get("client_secret"), env.AI_GATEWAY_CLIENT_SECRET);
      return token();
    }
    models++;
    assert.equal(url, "https://ai-gateway.deere.com/openai/chat/completions");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer synthetic-token");
    assert.equal(headers.get("deere-ai-gateway-registration-id"), "test-registration");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, env.CC_AI_MODEL);
    assert.equal(body.max_tokens, 800);
    assert.equal(body.messages[0].content, SYSTEM_PROMPT);
    assert.deepEqual(JSON.parse(body.messages[1].content), summary);
    return model();
  };
  await Promise.all(Array.from({ length: 8 }, () => explain(config, summary, request)));
  await explain(config, summary, request);
  assert.equal(auth, 1);
  assert.equal(models, 9);
});

test("validated expiry applies safety margin and does not reuse stale tokens", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const config = aiConfig(env)!;
  let auth = 0;
  const request: typeof fetch = async url => isToken(url) ? (auth++, token()) : model();
  await explain(config, summary, request);
  t.mock.timers.tick(269_000);
  await explain(config, summary, request);
  assert.equal(auth, 1);
  t.mock.timers.tick(1001);
  await explain(config, summary, request);
  assert.equal(auth, 2);
});

test("authentication rejection retries only once and concurrent rejection shares refresh", async () => {
  const config = aiConfig(env)!;
  let auth = 0, models = 0;
  const request: typeof fetch = async (url, init) => {
    if (isToken(url)) return token(`token-${++auth}`);
    models++;
    return new Headers(init?.headers).get("authorization") === "Bearer token-1"
      ? new Response(null, { status: 401 }) : model();
  };
  await Promise.all([explain(config, summary, request), explain(config, summary, request)]);
  assert.equal(auth, 2);
  assert.equal(models, 4);
  for (const status of [401, 403]) {
    let calls = 0;
    await assert.rejects(explain(aiConfig(env)!, summary, async url => {
      calls++;
      return isToken(url) ? token(`token-${calls}`) : new Response("private-body", { status });
    }), (e: any) => e.status === 503 && !e.message.includes("private-body"));
    assert.equal(calls, 4);
  }
});

test("invalid token responses, transport errors, redirects and quota failures fail closed without leakage", async () => {
  for (const expiry of [undefined, "300", 0, -1, 100000, null]) {
    let calls = 0;
    await assert.rejects(explain(aiConfig(env)!, summary, async () => {
      calls++; return Response.json({ access_token: "token", token_type: "Bearer", expires_in: expiry });
    }), AiError);
    assert.equal(calls, 1);
  }
  for (const status of [302, 401, 403, 429, 500]) {
    for (const atToken of [true, false]) {
      let calls = 0;
      await assert.rejects(explain(aiConfig(env)!, summary, async url => {
        calls++;
        if (!atToken && isToken(url)) return token();
        return new Response(env.AI_GATEWAY_CLIENT_SECRET, { status });
      }), (e: any) => e.status === (status === 429 ? 429 : 503)
        && !e.message.includes(env.AI_GATEWAY_CLIENT_SECRET));
      assert.equal(calls, atToken ? 1 : [401, 403].includes(status) ? 4 : 2);
    }
  }
  for (const name of ["TimeoutError", "AbortError", "Error"]) {
    for (const atToken of [true, false]) {
      await assert.rejects(explain(aiConfig(env)!, summary, async url => {
        if (!atToken && isToken(url)) return token();
        const error = new Error(env.AI_GATEWAY_CLIENT_SECRET); error.name = name; throw error;
      }), (e: any) => e.status === 503 && !e.message.includes(env.AI_GATEWAY_CLIENT_SECRET));
    }
  }
});

test("oversized and secret-echo responses are rejected; failed refresh can recover", async () => {
  for (const text of ["synthetic-token", env.AI_GATEWAY_CLIENT_SECRET, "x".repeat(65_000)]) {
    await assert.rejects(explain(aiConfig(env)!, summary, async url => isToken(url) ? token() : model(text)), AiError);
  }
  await assert.rejects(explain(aiConfig(env)!, summary, async () => new Response("x".repeat(33_000))), AiError);
  const config = aiConfig(env)!;
  await assert.rejects(explain(config, summary, async () => { throw new Error("private"); }), AiError);
  assert.equal((await explain(config, summary, async url => isToken(url) ? token() : model())).provider, "deere-gateway");
});
