import { test } from "node:test";
import assert from "node:assert/strict";
import { monitorAiLimiter } from "./ai-limiter-health";
import { aiLimiterFromEnv, PROBE_SCRIPT, sharedAiLimiter } from "./ai-limiter";
import { AiError } from "./assessment-ai";

test("health coalesces probes, caches failures, recovers and never acquires", async () => {
  let now = 0, probes = 0, failing = true;
  const monitor = monitorAiLimiter({
    mode: "redis-rest",
    async acquire() { throw new Error("Must not acquire"); },
    async probe() { probes++; if (failing) throw new Error("private failure"); },
  }, () => now);
  const results = await Promise.all(Array.from({ length: 20 }, () => monitor.health()));
  assert.ok(results.every(r => !r.available));
  assert.equal(probes, 1);
  failing = false;
  assert.equal((await monitor.health()).available, false);
  now = 5000;
  const recovered = await monitor.health();
  assert.equal(recovered.available, true);
  assert.equal(recovered.metrics.probeFailures, 1);
  assert.equal(recovered.metrics.acquisitions, 0);
  assert.equal(probes, 2);
  assert.ok(!JSON.stringify(results).includes("private"));
});

test("aggregate metrics count admission, rejection, failure, latency and release failure", async () => {
  let now = 0, calls = 0;
  const monitor = monitorAiLimiter({
    async probe() {},
    async acquire() {
      now += 12;
      if (++calls === 2) throw new AiError(429, "limited");
      if (calls === 3) throw new Error("private");
      return async () => { throw new Error("private"); };
    },
  }, () => now);
  const release = await monitor.limiter.acquire("private-identity");
  await assert.rejects(release());
  await assert.rejects(monitor.limiter.acquire("private-identity"));
  await assert.rejects(monitor.limiter.acquire("private-identity"));
  assert.deepEqual((await monitor.health()).metrics, {
    probeChecks: 1, probeFailures: 0, acquisitions: 3, admitted: 1,
    rejections: 1, acquisitionFailures: 1, acquisitionLatencyMsTotal: 36,
    acquisitionLatencyMsMax: 12, releaseFailures: 1,
  });
});

test("shared probe sends only read commands; malformed responses fail safely", async () => {
  assert.ok(!/ZADD|ZREM|HSET|HINCRBY|DEL|EXPIRE/.test(PROBE_SCRIPT));
  for (const result of [1, 0, "1", undefined]) {
    const limiter = sharedAiLimiter({ url: "https://test.invalid", token: "synthetic", namespace: "test" },
      (async (_url, init) => {
        assert.deepEqual(JSON.parse(String(init?.body)),
          ["EVAL", PROBE_SCRIPT, 2, "cc-ai:{test}:leases", "cc-ai:{test}:window"]);
        return Response.json({ result });
      }) as typeof fetch);
    if (result === 1) await limiter.probe!();
    else await assert.rejects(limiter.probe!(), (e: unknown) => e instanceof AiError && e.status === 503);
  }
  assert.equal((await monitorAiLimiter(aiLimiterFromEnv({})).health()).available, true);
  assert.equal((await monitorAiLimiter(aiLimiterFromEnv({ CC_AI_LIMITER: "invalid" })).health()).available, false);
});
