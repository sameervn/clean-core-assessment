import { AiError } from "./assessment-ai";
import type { AiLimiter } from "./ai-limiter";

// Fixed aggregate fields only: never retain subjects, errors, request data or labels.
export function monitorAiLimiter(limiter: AiLimiter, now = () => performance.now()) {
  const metrics = {
    probeChecks: 0, probeFailures: 0, acquisitions: 0, admitted: 0,
    rejections: 0, acquisitionFailures: 0, acquisitionLatencyMsTotal: 0,
    acquisitionLatencyMsMax: 0, releaseFailures: 0,
  };
  let cached: { available: boolean; checkedAt: string } | undefined;
  let expires = 0;
  let pending: Promise<void> | undefined;
  const observed: AiLimiter = {
    async acquire(subject) {
      const start = now();
      metrics.acquisitions++;
      try {
        const release = await limiter.acquire(subject);
        metrics.admitted++;
        return async () => {
          try { await release(); }
          catch (error) { metrics.releaseFailures++; throw error; }
        };
      } catch (error) {
        if (error instanceof AiError && error.status === 429) metrics.rejections++;
        else metrics.acquisitionFailures++;
        throw error;
      } finally {
        const elapsed = Math.max(0, now() - start);
        metrics.acquisitionLatencyMsTotal += elapsed;
        metrics.acquisitionLatencyMsMax = Math.max(metrics.acquisitionLatencyMsMax, elapsed);
      }
    },
  };
  return {
    limiter: observed,
    async health() {
      // Bound monitoring traffic per replica; coalesce concurrent scrapes.
      if (!cached || now() >= expires) {
        pending ??= (async () => {
          metrics.probeChecks++;
          let available = false;
          try {
            if (!limiter.probe) throw new Error("No probe");
            await limiter.probe();
            available = true;
          } catch { metrics.probeFailures++; }
          cached = { available, checkedAt: new Date().toISOString() };
          expires = now() + 5_000;
        })().finally(() => { pending = undefined; });
        await pending;
      }
      return { mode: limiter.mode ?? "invalid", ...cached!, cacheTtlMs: 5000, metrics: { ...metrics } };
    },
  };
}
