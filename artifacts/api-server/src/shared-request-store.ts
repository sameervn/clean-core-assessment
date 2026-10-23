import { createHash } from "node:crypto";
import type { Options, Store } from "express-rate-limit";

// Separate from AI quotas. Both keys share one Redis Cluster slot per scope.
// Server time and one atomic script prevent clock skew and replica races.
export const REQUEST_INCREMENT_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now)
for _, k in ipairs(expired) do
  redis.call('HDEL', KEYS[1], k)
  redis.call('ZREM', KEYS[2], k)
end
local reset = tonumber(redis.call('ZSCORE', KEYS[2], ARGV[1]) or '0')
if reset == 0 then
  if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then
    local first = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
    return {2147483647, math.max(1, tonumber(first[2]) - now)}
  end
  reset = now + tonumber(ARGV[2])
  redis.call('ZADD', KEYS[2], reset, ARGV[1])
end
local hits = math.min(2147483647, tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0') + 1)
redis.call('HSET', KEYS[1], ARGV[1], hits)
redis.call('PEXPIRE', KEYS[1], ARGV[2])
redis.call('PEXPIRE', KEYS[2], ARGV[2])
return {hits, reset - now}`;

const PROBE_SCRIPT = `
redis.call('TIME')
redis.call('HLEN', KEYS[1])
redis.call('ZCARD', KEYS[2])
return 1`;
const RESET_SCRIPT = `redis.call('HDEL', KEYS[1], ARGV[1]); redis.call('ZREM', KEYS[2], ARGV[1]); return 1`;
const DECREMENT_SCRIPT = `
local n = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
if n > 0 then redis.call('HINCRBY', KEYS[1], ARGV[1], -1) end
return 1`;

export type RequestStoreConfig = { url: string; token: string; namespace: string };
const unavailable = () => new Error("Shared HTTP request limiter unavailable");

export function requestStoreConfig(env: Record<string, string | undefined>): RequestStoreConfig | undefined {
  if (!env.CC_HTTP_LIMITER || env.CC_HTTP_LIMITER === "local") return;
  try {
    if (env.CC_HTTP_LIMITER !== "redis-rest") throw unavailable();
    const url = new URL(env.CC_HTTP_LIMITER_URL || "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || !env.CC_HTTP_LIMITER_TOKEN || !/^[a-zA-Z0-9_-]{1,80}$/.test(env.CC_HTTP_LIMITER_NAMESPACE || "")) throw unavailable();
    return { url: url.toString(), token: env.CC_HTTP_LIMITER_TOKEN, namespace: env.CC_HTTP_LIMITER_NAMESPACE! };
  } catch { throw new Error("Invalid shared HTTP request limiter configuration"); }
}

export class SharedRequestStore implements Store {
  localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;
  constructor(private config: RequestStoreConfig, scope: string, private request: typeof fetch = fetch, private capacity = 10_000) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(scope) || !Number.isInteger(capacity) || capacity < 1 || capacity > 10_000) throw unavailable();
    this.prefix = `cc-http:{${config.namespace}:${scope}}`;
  }
  init(options: Options) { this.windowMs = options.windowMs; }
  private subject(key: string) { return createHash("sha256").update(key).digest("hex"); }
  private async command(script: string, args: Array<string | number> = []): Promise<unknown> {
    try {
      const response = await this.request(this.config.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(2_000),
        headers: { Authorization: `Bearer ${this.config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(["EVAL", script, 2, `${this.prefix}:hits`, `${this.prefix}:expiry`, ...args]),
      });
      if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
      const reader = response.body?.getReader();
      if (!reader) throw unavailable();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024) { await reader.cancel(); throw unavailable(); }
        chunks.push(value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!data || data.error) throw unavailable();
      return data.result;
    } catch { throw unavailable(); }
  }
  async increment(key: string) {
    const result = await this.command(REQUEST_INCREMENT_SCRIPT, [this.subject(key), this.windowMs, this.capacity]);
    if (!Array.isArray(result) || result.length !== 2 || !result.every(Number.isSafeInteger)
      || result[0] < 1 || result[0] > 2147483647 || result[1] < 1 || result[1] > this.windowMs) throw unavailable();
    return { totalHits: result[0] as number, resetTime: new Date(Date.now() + result[1]) };
  }
  async probe() { if (await this.command(PROBE_SCRIPT) !== 1) throw unavailable(); }
  async decrement(key: string) { if (await this.command(DECREMENT_SCRIPT, [this.subject(key)]) !== 1) throw unavailable(); }
  async resetKey(key: string) { if (await this.command(RESET_SCRIPT, [this.subject(key)]) !== 1) throw unavailable(); }
}
