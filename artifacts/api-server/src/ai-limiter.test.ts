import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import express from "express";
import { aiLimiterFromEnv, localAiLimiter, sharedAiLimiter } from "./ai-limiter";
import { aiConfig, AiError } from "./assessment-ai";
import { createAiRouter } from "./routes/assessment-ai";

const exec = promisify(execFile);
const rejected = (status: number) => (error: unknown) => error instanceof AiError && error.status === status;
test("local default needs no service; resets rate window and releases once", async () => {
  let now = 100_000;
  const limiter = localAiLimiter(() => now);
  const release = await limiter.acquire("one");
  await release(); await release();
  for (let i = 0; i < 4; i++) await (await limiter.acquire("one"))();
  await assert.rejects(limiter.acquire("one"), rejected(429));
  now += 60_000;
  await (await limiter.acquire("one"))();
  await (await aiLimiterFromEnv({}).acquire("no-service"))();
});

test("shared opt-in configuration and service failures fail closed", async () => {
  for (const env of [
    { CC_AI_LIMITER: "typo" }, { CC_AI_LIMITER: "redis-rest" },
    { CC_AI_LIMITER: "redis-rest", CC_AI_LIMITER_URL: "http://unsafe.test", CC_AI_LIMITER_TOKEN: "test", CC_AI_LIMITER_NAMESPACE: "test" },
  ]) await assert.rejects(aiLimiterFromEnv(env).acquire("subject"), rejected(503));
  for (const reply of [
    async () => { throw new DOMException("secret", "TimeoutError"); },
    async () => new Response("secret", { status: 401 }),
    async () => new Response("not json"),
    async () => Response.json({ result: "1" }),
    async () => Response.json({ error: "secret" }),
    async () => new Response("x".repeat(1025)),
  ]) {
    const limiter = sharedAiLimiter({ url: "https://limiter.test", token: "test", namespace: "test" }, reply as typeof fetch);
    await assert.rejects(limiter.acquire("subject"), error => {
      assert.ok(rejected(503)(error));
      assert.ok(!(error as Error).message.includes("secret"));
      return true;
    });
  }
});

test("shared release failure is surfaced; wire payload excludes raw identity", async () => {
  let calls = 0;
  const limiter = sharedAiLimiter({ url: "https://limiter.test", token: "test", namespace: "test" }, (async (_url, init) => {
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    assert.ok(!String(init?.body).includes("raw-subject"));
    if (++calls === 1) return Response.json({ result: 1 });
    throw new Error("private service failure");
  }) as typeof fetch);
  const release = await limiter.acquire("raw-subject");
  await assert.rejects(release(), rejected(503));
});

// Runs the actual Lua against Redis, not a JS reimplementation of its decisions.
// CI can provide the two binary paths; no runtime package/service is required.
test("Redis atomically shares user/global budgets, concurrency and expiring leases across clients", async t => {
  const serverBin = process.env.REDIS_SERVER_BIN || "redis-server";
  const cliBin = process.env.REDIS_CLI_BIN || "redis-cli";
  try { await exec(serverBin, ["--version"]); await exec(cliBin, ["--version"]); }
  catch {
    if (process.env.CC_AI_REQUIRE_REDIS_TESTS === "1") {
      throw new Error("Required Redis integration binaries missing: install redis-server and redis-cli.");
    }
    t.skip("Redis binaries not installed; set REDIS_SERVER_BIN and REDIS_CLI_BIN to run integration coverage."); return;
  }
  const dir = await mkdtemp(join(tmpdir(), "cc-ai-limiter-"));
  const socket = join(dir, "redis.sock");
  const child = spawn(serverBin, ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  const command = async (args: Array<string | number>) => {
    const { stdout } = await exec(cliBin, ["-s", socket, "--json", ...args.map(String)]);
    return JSON.parse(stdout);
  };
  const bridge = express();
  bridge.use(express.json());
  bridge.post("/", async (req, res) => {
    if (req.headers.authorization !== "Bearer synthetic-limiter-token") { res.sendStatus(401); return; }
    try { res.json({ result: await command(req.body) }); }
    catch { res.sendStatus(503); }
  });
  const http = bridge.listen(0, "127.0.0.1");
  try {
    for (let i = 0; ; i++) {
      try { await command(["PING"]); break; }
      catch (error) { if (i > 100) throw error; await new Promise(r => setTimeout(r, 20)); }
    }
    if (!http.listening) await new Promise<void>(r => http.once("listening", r));
    const config = { url: `http://127.0.0.1:${(http.address() as { port: number }).port}`, token: "synthetic-limiter-token", namespace: "integration" };
    const a = sharedAiLimiter(config), b = sharedAiLimiter(config);
    await a.probe!();
    assert.equal(await command(["EXISTS", "cc-ai:{integration}:leases", "cc-ai:{integration}:window"]), 0);
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const providerConfig = aiConfig({
      CC_AI_ENABLED: "true", CC_AI_PROVIDER: "openai", CC_AI_MODEL: "test",
      CC_AI_API_KEY: "synthetic-provider-key",
      CC_AI_GATEWAY_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(),
      CC_AI_GATEWAY_ISSUER: "test", CC_AI_GATEWAY_AUDIENCE: "test",
    })!;
    let providerCalls = 0;
    const replicas = [a, b].map(limiter => {
      const app = express();
      app.use(express.json());
      app.use(createAiRouter(providerConfig, (async () => {
        providerCalls++;
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Test draft" } }] });
      }) as typeof fetch, limiter));
      return app.listen(0, "127.0.0.1");
    });
    try {
      await Promise.all(replicas.map(replica => replica.listening ? Promise.resolve() : new Promise<void>(r => replica.once("listening", r))));
      const post = (replica: number, subject: string) => {
        const now = Math.floor(Date.now() / 1000);
        const jwt = [{ alg: "RS256" }, { iss: "test", aud: "test", sub: subject, iat: now, exp: now + 60 }]
          .map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
        const assertion = `${jwt}.${sign("RSA-SHA256", Buffer.from(jwt), privateKey).toString("base64url")}`;
        return fetch(`http://127.0.0.1:${(replicas[replica].address() as { port: number }).port}/explain`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-cc-ai-assertion": assertion },
          body: JSON.stringify({ kind: "object", classification: "B", recommendation: "released-api", confidence: "high" }),
        });
      };
      for (let i = 0; i < 5; i++) assert.equal((await post(i % 2, "same-user")).status, 200);
      for (let i = 0; i < 2; i++) {
        const denied = await post(i, "same-user");
        assert.equal(denied.status, 429);
        assert.equal(denied.headers.get("Retry-After"), "60");
      }
      assert.equal(providerCalls, 5);
      for (let i = 0; i < 15; i++) assert.equal((await post(i % 2, `other-${i}`)).status, 200);
      for (let i = 0; i < 2; i++) assert.equal((await post(i, "new-user")).status, 429);
      assert.equal(providerCalls, 20);
    } finally {
      await Promise.all(replicas.map(replica => {
        replica.closeAllConnections();
        return new Promise<void>(r => replica.close(() => r()));
      }));
    }
    // Reset only the window timestamp to test rollover without a minute-long sleep.
    await command(["HSET", "cc-ai:{integration}:window", "start", 0]);
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).acquire(`parallel-${i}`)));
    const accepted = attempts.filter(r => r.status === "fulfilled");
    assert.equal(accepted.length, 2);
    for (const result of attempts) if (result.status === "rejected") assert.ok(rejected(429)(result.reason));
    const releases = accepted.map(r => (r as PromiseFulfilledResult<() => Promise<void>>).value);
    await releases[0](); await releases[0]();
    const next = await b.acquire("after-release");
    await assert.rejects(a.acquire("still-two-active"), rejected(429));
    await next(); await releases[1]();
    // A dead replica leaves a lease; expiration must recover its slot.
    const staleRelease = await a.acquire("dead-replica");
    const ids = await command(["ZRANGE", "cc-ai:{integration}:leases", 0, -1]);
    await command(["ZADD", "cc-ai:{integration}:leases", 0, ids[0]]);
    const one = await a.acquire("recovered-one"), two = await b.acquire("recovered-two");
    await staleRelease();
    await assert.rejects(a.acquire("stale-release-cannot-free-new-lease"), rejected(429));
    await one(); await two();
    const window = await command(["HGETALL", "cc-ai:{integration}:window"]);
    const leasesBefore = await command(["ZRANGE", "cc-ai:{integration}:leases", 0, -1, "WITHSCORES"]);
    await b.probe!();
    assert.deepEqual(await command(["HGETALL", "cc-ai:{integration}:window"]), window);
    assert.deepEqual(await command(["ZRANGE", "cc-ai:{integration}:leases", 0, -1, "WITHSCORES"]), leasesBefore);
    assert.ok(!JSON.stringify(window).includes("same-user"));
    assert.ok(await command(["PTTL", "cc-ai:{integration}:window"]) > 0);
    child.kill();
    await new Promise<void>(r => child.once("exit", () => r()));
    await assert.rejects(a.acquire("outage"), rejected(503));
    await assert.rejects(b.acquire("outage"), rejected(503));
  } finally {
    child.kill();
    http.closeAllConnections();
    await new Promise<void>(r => http.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
