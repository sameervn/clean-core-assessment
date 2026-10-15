import { createHash, randomUUID } from "node:crypto";
import { AiError } from "./assessment-ai";

export interface AiLimiter {
  acquire(subject: string): Promise<() => Promise<void>>;
  mode?: "local" | "redis-rest" | "invalid";
  probe?(): Promise<void>;
}
const limited = () => new AiError(429, "AI request limit reached. Wait one minute before trying again.");
const unavailable = () => new AiError(503, "AI usage limiter unavailable. Ask your administrator to check shared limiter configuration.");

export function localAiLimiter(now = Date.now): AiLimiter {
  let active = 0, start = 0, total = 0;
  const users = new Map<string, number>();
  return {
    mode: "local",
    async probe() {},
    async acquire(subject) {
      if (now() - start >= 60_000) { start = now(); total = 0; users.clear(); }
      if (active >= 2 || total >= 20 || (users.get(subject) || 0) >= 5) throw limited();
      active++; total++; users.set(subject, (users.get(subject) || 0) + 1);
      let released = false;
      return async () => { if (!released) { released = true; active--; } };
    },
  };
}

// One Redis hash slot; server time avoids clock disagreement between replicas.
// A 60-second lease exceeds the provider's 20-second timeout plus HTTP overhead.
export const ACQUIRE_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local start = tonumber(redis.call('HGET', KEYS[2], 'start') or '0')
if now - start >= 60000 then
  redis.call('DEL', KEYS[2])
  redis.call('HSET', KEYS[2], 'start', now)
end
local total = tonumber(redis.call('HGET', KEYS[2], 'total') or '0')
local user = tonumber(redis.call('HGET', KEYS[2], ARGV[1]) or '0')
if redis.call('ZCARD', KEYS[1]) >= 2 or total >= 20 or user >= 5 then return 0 end
redis.call('HINCRBY', KEYS[2], 'total', 1)
redis.call('HINCRBY', KEYS[2], ARGV[1], 1)
redis.call('PEXPIRE', KEYS[2], 120000)
redis.call('ZADD', KEYS[1], now + 60000, ARGV[2])
redis.call('PEXPIRE', KEYS[1], 120000)
return 1`;

type SharedConfig = { url: string; token: string; namespace: string };
// Read-only: exercise the REST adapter, EVAL, server clock and both key types.
// Never reserve a lease, clean expired entries, or modify/reset request budgets.
export const PROBE_SCRIPT = `
redis.call('TIME')
redis.call('HGET', KEYS[2], 'start')
redis.call('ZCARD', KEYS[1])
return 1`;
export function sharedAiLimiter(config: SharedConfig, request: typeof fetch = fetch): AiLimiter {
  const prefix = `cc-ai:{${config.namespace}}`;
  async function command(args: Array<string | number>): Promise<number> {
    try {
      const response = await request(config.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(2_000),
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!response.ok) throw new Error();
      // Read a bounded response; never surface remote errors or log credentials.
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      let raw = "";
      const decoder = new TextDecoder();
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024) { await reader.cancel(); throw new Error(); }
        raw += decoder.decode(value, { stream: true });
      }
      const data = JSON.parse(raw + decoder.decode());
      if (data.error || (data.result !== 0 && data.result !== 1)) throw new Error();
      return data.result;
    } catch { throw unavailable(); }
  }
  return {
    mode: "redis-rest",
    async probe() {
      if (await command(["EVAL", PROBE_SCRIPT, 2, `${prefix}:leases`, `${prefix}:window`]) !== 1) throw unavailable();
    },
    async acquire(subject) {
      const id = randomUUID();
      const user = createHash("sha256").update(subject).digest("hex");
      const admitted = await command(["EVAL", ACQUIRE_SCRIPT, 2, `${prefix}:leases`, `${prefix}:window`, user, id]);
      if (!admitted) throw limited();
      let released = false;
      return async () => {
        if (released) return;
        await command(["ZREM", `${prefix}:leases`, id]);
        released = true;
      };
    },
  };
}

export function aiLimiterFromEnv(env: Record<string, string | undefined> = process.env): AiLimiter {
  if (!env.CC_AI_LIMITER || env.CC_AI_LIMITER === "local") return localAiLimiter();
  try {
    if (env.CC_AI_LIMITER !== "redis-rest") throw new Error();
    const url = new URL(env.CC_AI_LIMITER_URL || "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || !env.CC_AI_LIMITER_TOKEN || !/^[a-zA-Z0-9_-]{1,80}$/.test(env.CC_AI_LIMITER_NAMESPACE || "")) throw new Error();
    return sharedAiLimiter({ url: url.toString(), token: env.CC_AI_LIMITER_TOKEN, namespace: env.CC_AI_LIMITER_NAMESPACE! });
  } catch {
    // Invalid opt-in must never silently fall back to a per-process budget.
    return { mode: "invalid", async probe() { throw unavailable(); }, async acquire() { throw unavailable(); } };
  }
}
