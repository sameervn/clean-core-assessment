import test from "node:test";
import assert from "node:assert/strict";
import { execFile, fork, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import express from "express";
import { requestStoreConfig, SharedRequestStore } from "./shared-request-store";
import { httpLimiterProbe, validateRequestLimits } from "./request-limits";

const exec = promisify(execFile);
const config = { url: "https://limiter.test", token: "synthetic-token", namespace: "unit" };
const sharedEnv = {
  CC_HTTP_LIMITER: "redis-rest", CC_HTTP_LIMITER_URL: config.url,
  CC_HTTP_LIMITER_TOKEN: config.token, CC_HTTP_LIMITER_NAMESPACE: config.namespace,
};
test("local default has no dependency; invalid shared opt-in and undeclared-safe scaling are rejected", async () => {
  assert.equal(requestStoreConfig({}), undefined);
  validateRequestLimits({});
  await httpLimiterProbe({});
  for (const env of [
    { CC_REPLICA_COUNT: "2" }, { CC_API_WORKER_COUNT: "2" }, { CC_REPLICA_COUNT: "0" },
    { CC_API_WORKER_COUNT: "1.5" }, { CC_HTTP_LIMITER: "typo" }, { CC_HTTP_LIMITER: "redis-rest" },
    { ...sharedEnv, CC_HTTP_LIMITER_URL: "http://unsafe.test" },
    { ...sharedEnv, CC_HTTP_LIMITER_URL: "https://user:private@unsafe.test" },
    { ...sharedEnv, CC_HTTP_LIMITER_URL: "https://unsafe.test/?private=1" },
    { ...sharedEnv, CC_HTTP_LIMITER_NAMESPACE: "{other-slot}" },
    { ...sharedEnv, CC_HTTP_LIMITER_TOKEN: "" },
  ]) assert.throws(() => validateRequestLimits(env));
  validateRequestLimits({ ...sharedEnv, CC_REPLICA_COUNT: "2", CC_API_WORKER_COUNT: "3" });
});

test("remote faults are sanitized, bounded, never retried and never fall back to local", async () => {
  for (const reply of [
    async () => { throw new Error("private-details"); },
    async () => new Response("private-details", { status: 403 }),
    async () => new Response("private-details"),
    async () => Response.json({ error: "private-details" }),
    async () => Response.json({ result: ["1", 100] }),
    async () => Response.json({ result: [1, -1] }),
    async () => Response.json({ result: [1, 60_001] }),
    async () => new Response("x".repeat(1025)),
  ]) {
    let calls = 0;
    const store = new SharedRequestStore(config, "api", (async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, "error");
      assert(init?.signal);
      assert(!String(init?.body).includes("raw-account-id"));
      return reply();
    }) as typeof fetch);
    await assert.rejects(store.increment("raw-account-id"), { message: "Shared HTTP request limiter unavailable" });
    assert.equal(calls, 1);
  }
});

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit"); child.kill(); await exited;
}

// Mandatory CI command sets CC_HTTP_REQUIRE_REDIS_TESTS=1. Actual Lua is executed
// against disposable Redis, through a real HTTP adapter and two OS processes.
test("two API processes share ingress/account/upload/static limits, expiry, bounded state and outage recovery", { timeout: 45_000 }, async t => {
  const serverBin = process.env.REDIS_SERVER_BIN || "redis-server";
  const cliBin = process.env.REDIS_CLI_BIN || "redis-cli";
  try { await exec(serverBin, ["--version"]); await exec(cliBin, ["--version"]); }
  catch {
    if (process.env.CC_HTTP_REQUIRE_REDIS_TESTS === "1") throw new Error("Redis integration binaries required");
    t.skip("Install Redis binaries or run test:http-limiter:required in CI"); return;
  }
  const dir = await mkdtemp(join(tmpdir(), "cc-http-limit-"));
  const socket = join(dir, "redis.sock");
  const redis = spawn(serverBin, ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"], { stdio: "ignore" });
  const command = async (args: Array<string | number>) => JSON.parse((await exec(cliBin, ["-s", socket, "--json", ...args.map(String)])).stdout);
  let mode: "ok" | "down" | "malformed" | "disconnect" | "timeout" | "redirect" = "ok";
  let requests = 0, redirects = 0;
  const bridge = express();
  bridge.use(express.json());
  bridge.post("/", async (req, res) => {
    requests++;
    assert.equal(req.headers.authorization, "Bearer synthetic-token");
    if (mode === "down") { res.sendStatus(503); return; }
    if (mode === "malformed") { res.json({ result: "private-error" }); return; }
    if (mode === "disconnect") { req.socket.destroy(); return; }
    if (mode === "timeout") return;
    if (mode === "redirect") { res.redirect(307, "/destination"); return; }
    try { res.json({ result: await command(req.body) }); }
    catch { res.sendStatus(503); }
  });
  bridge.post("/destination", (_req, res) => { redirects++; res.json({ result: [1, 100] }); });
  const http = bridge.listen(0, "127.0.0.1");
  const workers: ChildProcess[] = [];
  try {
    for (let attempt = 0; ; attempt++) {
      try { await command(["PING"]); break; }
      catch (error) { if (attempt > 100) throw error; await new Promise(r => setTimeout(r, 20)); }
    }
    if (!http.listening) await once(http, "listening");
    const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
    const bases = await Promise.all([0, 1].map(async () => {
      const child = fork(resolve("scripts/fixtures/request-limit-worker.ts"), [], {
        execArgv: ["--import", "tsx"],
        env: { PATH: process.env.PATH, TEST_LIMITER_URL: url },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      workers.push(child);
      let stderr = "";
      child.stderr?.on("data", data => { stderr += String(data); });
      return new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Worker startup timed out")), 10_000);
        child.once("message", (message: any) => { clearTimeout(timeout); resolve(message.url); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error(stderr || "Worker exited before startup")); });
        child.once("error", reject);
      });
    }));
    const get = (i: number, path: string, init?: RequestInit) => fetch(bases[i % 2] + path, init);
    const counters = () => Promise.all(bases.map(async base =>
      (await fetch(base + "/counters")).json() as Promise<{ identities: number; bodies: number }>));
    // Concurrent increments from two processes cannot multiply the six-call budget.
    const allowed = await Promise.all(Array.from({ length: 6 }, (_, i) => get(i, "/api/work", {
      headers: { "X-Forwarded-For": `192.0.2.${i}`, Forwarded: `for=192.0.2.${i}` },
    })));
    assert(allowed.every(r => r.status === 200));
    for (let i = 0; i < 2; i++) {
      const denied = await get(i, "/api/upload", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.19", Forwarded: "for=203.0.113.20" },
        body: "invalid json",
      });
      assert.equal(denied.status, 429);
      assert(Number(denied.headers.get("retry-after")) > 0);
      assert(denied.headers.get("ratelimit"));
      assert.equal((await get(i, "/health")).status, 200);
      assert.equal((await get(i, "/ready")).status, 200);
    }
    assert.equal((await counters()).reduce((sum, value) => sum + value.identities, 0), 6);
    assert.equal((await counters()).reduce((sum, value) => sum + value.bodies, 0), 0);
    // Only disposable test Redis is cleared between scenarios.
    await command(["FLUSHDB"]);
    assert.equal((await get(0, "/api/account")).status, 200);
    assert.equal((await get(1, "/api/account")).status, 200);
    assert.equal((await get(0, "/api/account", { headers: { "X-Forwarded-For": "198.51.100.4" } })).status, 429);
    assert.equal((await get(1, "/api/account", { headers: { "x-test-account": "two" } })).status, 200);
    await command(["FLUSHDB"]);
    for (let i = 0; i < 2; i++) assert.equal((await get(i, "/api/upload", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    })).status, 200);
    const before = await counters();
    assert.equal((await get(0, "/api/upload", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "invalid",
    })).status, 429);
    assert.deepEqual(await counters(), before);
    assert.equal((await get(0, "/static/asset.js")).status, 200);
    assert.equal((await get(1, "/static/spa")).status, 200);
    assert.equal((await get(0, "/static/asset.js")).status, 429);
    assert.equal((await get(0, "/expiry")).status, 200);
    assert.equal((await get(1, "/expiry")).status, 429);
    await new Promise(r => setTimeout(r, 450));
    assert.equal((await get(1, "/expiry")).status, 200);

    const store = new SharedRequestStore({ url, token: "synthetic-token", namespace: "capacity" }, "test", fetch, 2);
    store.init({ windowMs: 1000 } as any);
    assert.equal((await store.increment("raw-one")).totalHits, 1);
    assert.equal((await store.increment("raw-two")).totalHits, 1);
    assert.equal((await store.increment("new")).totalHits, 2147483647);
    assert.equal((await store.increment("raw-one")).totalHits, 2);
    const hits = `${store.prefix}:hits`, expiry = `${store.prefix}:expiry`;
    assert.equal(await command(["HLEN", hits]), 2);
    assert(!JSON.stringify(await command(["HGETALL", hits])).includes("raw-one"));
    const snapshot = await command(["HGETALL", hits]);
    await store.probe();
    assert.deepEqual(await command(["HGETALL", hits]), snapshot);
    assert(await command(["PTTL", hits]) > 0);
    // Expire just one subject while the other remains live: cleanup must free
    // its slot without evicting/resetting the still-active caller.
    const members: string[] = await command(["ZRANGE", expiry, 0, -1]);
    await command(["ZADD", expiry, 0, members[0]]);
    assert.equal((await store.increment("replacement")).totalHits, 1);
    assert.equal(await command(["HLEN", hits]), 2);
    assert.equal(await command(["ZCARD", expiry]), 2);
    await new Promise(r => setTimeout(r, 1050));
    assert.equal(await command(["EXISTS", hits, expiry]), 0);
    assert.equal((await store.increment("new")).totalHits, 1);

    const frozen = await counters();
    for (mode of ["down", "malformed", "disconnect", "timeout", "redirect"] as const) {
      for (let i = 0; i < 2; i++) {
        const n = requests;
        const response = await get(i, "/api/upload", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "invalid",
        });
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("retry-after"), "1");
        assert(!((await response.text()).includes("private")));
        assert.equal(requests, n + 1, "uncertain increments are never retried");
        assert.equal((await get(i, "/health")).status, 200);
      }
    }
    assert.equal(redirects, 0);
    assert.deepEqual(await counters(), frozen);
    mode = "down";
    assert.equal((await get(0, "/ready")).status, 503);
    mode = "ok";
    assert.equal((await get(1, "/ready")).status, 200);
    assert.equal((await get(1, "/api/work")).status, 200);
    await stop(redis);
    for (let i = 0; i < 2; i++) {
      assert.equal((await get(i, "/api/work")).status, 503);
      assert.equal((await get(i, "/health")).status, 200);
      assert.equal((await get(i, "/ready")).status, 503);
    }
  } finally {
    await Promise.all(workers.map(stop));
    await stop(redis);
    http.closeAllConnections();
    await new Promise<void>(r => http.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
