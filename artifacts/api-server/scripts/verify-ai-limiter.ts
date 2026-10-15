/**
 * Opt-in, destructive-to-staging-only compatibility gate. Never imports routes
 * or calls an AI provider. The failover hook is owned by the client's operator.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { aiLimiterFromEnv, sharedAiLimiter } from "../src/ai-limiter";
import { AiError } from "../src/assessment-ai";

const status = (code: number) => (error: unknown) => error instanceof AiError && error.status === code;
const requireValue = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required staging setting: ${name}`);
  return value;
};
function httpsEndpoint(name: string) {
  const value = requireValue(name);
  const url = new URL(value);
  assert.ok(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash,
    `${name} must be a credential-free HTTPS command endpoint`);
  return url.toString();
}

async function main() {
  assert.equal(requireValue("CC_AI_VERIFY_STAGING_ONLY"), "yes",
    "Explicit dedicated-staging acknowledgement required");
  assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, "0", "TLS verification must remain enabled");
  const url = httpsEndpoint("CC_AI_VERIFY_URL");
  const token = requireValue("CC_AI_VERIFY_TOKEN");
  const redirectUrl = httpsEndpoint("CC_AI_VERIFY_REDIRECT_URL");
  const failoverHook = requireValue("CC_AI_VERIFY_FAILOVER_HOOK");
  const namespace = `ci-${randomUUID()}`;
  const config = { url, token, namespace };
  const a = aiLimiterFromEnv({
    CC_AI_LIMITER: "redis-rest", CC_AI_LIMITER_URL: url,
    CC_AI_LIMITER_TOKEN: token, CC_AI_LIMITER_NAMESPACE: namespace,
  });
  const b = sharedAiLimiter(config);
  const releases: Array<() => Promise<void>> = [];
  const started = Date.now();
  try {
    // Success proves authentication, EVAL, its internal ACL commands and the
    // exact numeric result envelope understood by the production client.
    const first = await a.acquire("synthetic-held-a");
    releases.push(first);
    const second = await b.acquire("synthetic-held-b");
    releases.push(second);
    await assert.rejects(a.acquire("synthetic-overflow"), status(429));
    console.log("PASS authenticated EVAL, response shape and shared concurrency");

    await assert.rejects(sharedAiLimiter({ ...config, token: `invalid-${randomUUID()}` })
      .acquire("synthetic-invalid-auth"), status(503));
    // Read-only probes of random, deliberately forbidden namespaces. Never
    // address production keys, enumerate keys, flush a DB or broaden the ACL.
    for (const key of [`cc-ai:{denied-${randomUUID()}}:window`, `unrelated-test:${randomUUID()}`]) {
      const response = await fetch(url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(2000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(["EVAL", "return redis.call('HGET', KEYS[1], 'total')", 1, key]),
      });
      const body = await response.text();
      assert.ok(body.length <= 4096, "Oversized ACL probe response");
      // A transport/auth error is not proof that key ACLs work.
      assert.ok(response.status === 200 || response.status === 403, "ACL probe did not reach command authorization");
      const data = JSON.parse(body);
      assert.ok(typeof data.error === "string" && /NOPERM|permission|not allowed|forbidden/i.test(data.error),
        "Service must explicitly reject out-of-namespace EVAL access");
    }
    console.log("PASS invalid authentication and namespace ACL denial");

    // The operator provides a controlled HTTPS redirect endpoint. Never send
    // the service credential to it, and never follow it.
    const probe = await fetch(redirectUrl, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(2000),
      headers: { "Content-Type": "application/json" }, body: "[]",
    });
    assert.ok([301, 302, 303, 307, 308].includes(probe.status), "Redirect fixture must actually redirect");
    await probe.body?.cancel();
    await assert.rejects(sharedAiLimiter({ ...config, url: redirectUrl, token: "synthetic-redirect-token" })
      .acquire("synthetic-redirect"), status(503));
    console.log("PASS verified HTTPS and redirect rejection");

    // The hook must actively promote/restart the dedicated staging writer,
    // wait for it to recover, and return nonzero if the operation failed.
    // Do not print hook output (client tooling may contain credentials).
    try {
      await promisify(execFile)(failoverHook, [], { timeout: 30_000, maxBuffer: 64 * 1024 });
    } catch { throw new Error("Staging failover hook failed or exceeded 30 seconds"); }
    assert.ok(Date.now() - started < 45_000, "Failover exceeded safe lease/window assertion interval");
    await assert.rejects(b.acquire("synthetic-after-failover"), status(429));
    await first();
    const replacement = await b.acquire("synthetic-replacement");
    releases.push(replacement);
    await assert.rejects(a.acquire("synthetic-still-full"), status(429));
    await replacement(); await second();
    // Three reservations are already charged, so exactly seventeen remain.
    for (let i = 0; i < 17; i++) await (await (i % 2 ? a : b).acquire(`synthetic-budget-${i}`))();
    assert.ok(Date.now() - started < 55_000, "Verification crossed the budget window");
    await assert.rejects(a.acquire("synthetic-global-cap"), status(429));
    console.log("PASS failover preserves leases and global counters; releases recover capacity");

    // Separate isolated window for per-subject caps.
    const userLimiter = sharedAiLimiter({ ...config, namespace: `ci-${randomUUID()}` });
    for (let i = 0; i < 5; i++) await (await userLimiter.acquire("synthetic-user"))();
    await assert.rejects(userLimiter.acquire("synthetic-user"), status(429));
    console.log("PASS subject cap; staging compatibility verification complete");
  } finally {
    await Promise.allSettled(releases.map(release => release()));
    // No cleanup privilege required: limiter keys expire after 120 seconds.
  }
}

main().catch(() => {
  // Deliberately avoid logging URLs, REST response bodies, credentials or hook
  // errors. PASS markers identify the last completed stage.
  console.error("FAIL staging limiter verification. Check required settings, staging service and the last PASS stage; no checks were skipped.");
  process.exitCode = 1;
});
