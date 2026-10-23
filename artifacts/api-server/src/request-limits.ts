import { rateLimit, ipKeyGenerator, type Store, type Options } from "express-rate-limit";
import type { RequestHandler } from "express";
import { requestStoreConfig, SharedRequestStore } from "./shared-request-store";

/** Fixed windows, bounded state, no background timers. Saturation fails closed
 * for NEW keys until a slot expires; never evict a live caller's budget. */
export class BoundedRequestStore implements Store {
  localKeys = true;
  private entries = new Map<string, { totalHits: number; resetTime: Date }>();
  private windowMs = 60_000;
  constructor(private capacity = 10_000, private now = Date.now) {}
  init(options: Options) { this.windowMs = options.windowMs; }
  async increment(key: string) {
    const now = this.now();
    let entry = this.entries.get(key);
    if (entry && entry.resetTime.getTime() <= now) { this.entries.delete(key); entry = undefined; }
    if (!entry) {
      if (this.entries.size >= this.capacity) {
        for (const [k, v] of this.entries) if (v.resetTime.getTime() <= now) this.entries.delete(k);
      }
      if (this.entries.size >= this.capacity) return { totalHits: Number.MAX_SAFE_INTEGER, resetTime: new Date(now + this.windowMs) };
      entry = { totalHits: 0, resetTime: new Date(now + this.windowMs) };
      this.entries.set(key, entry);
    }
    entry.totalHits = Math.min(Number.MAX_SAFE_INTEGER, entry.totalHits + 1);
    return { ...entry };
  }
  async decrement(key: string) { const entry = this.entries.get(key); if (entry) entry.totalHits = Math.max(0, entry.totalHits - 1); }
  async resetKey(key: string) { this.entries.delete(key); }
}

export function validateRequestLimits(env: Record<string, string | undefined> = process.env) {
  const config = requestStoreConfig(env);
  for (const key of ["CC_REPLICA_COUNT", "CC_API_WORKER_COUNT"]) {
    const count = Number(env[key] ?? "1");
    if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid ${key}`);
    if (count > 1 && !config) throw new Error("Multiple API processes/replicas require CC_HTTP_LIMITER=redis-rest");
  }
}

export function httpLimiterProbe(env: Record<string, string | undefined> = process.env) {
  const config = requestStoreConfig(env);
  return config ? new SharedRequestStore(config, "api").probe() : Promise.resolve();
}

export function requestLimit(scope: string, limit: number, account = false, windowMs = 60_000, store?: Store): RequestHandler {
  const config = store ? undefined : requestStoreConfig(process.env);
  const middleware = rateLimit({
    windowMs, limit, store: store ?? (config ? new SharedRequestStore(config, scope) : new BoundedRequestStore()),
    passOnStoreError: false,
    // Never use forwarded headers directly. Express defaults to trust proxy=false.
    keyGenerator: req => account && req.identity ? `account:${req.identity.user.id}` : ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? "unknown"),
    standardHeaders: "draft-8", legacyHeaders: false,
    message: { message: "Too many requests. Retry after the indicated delay." },
  });
  return (req, res, next) => middleware(req, res, error => {
    if (!error) { next(); return; }
    // No per-process fallback, retries of uncertain writes, or remote error text.
    res.setHeader("Retry-After", "1");
    res.status(503).json({ message: "Request limits temporarily unavailable. Try again shortly." });
  });
}
