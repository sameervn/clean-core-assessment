import { Router, static as staticFiles, type Express } from "express";
import { resolve, extname } from "node:path";
import { pool } from "@workspace/db";
import { probeStorage } from "./knowledge/storage";
import { aiLimiterFromEnv } from "./ai-limiter";
import { requestLimit, httpLimiterProbe, validateRequestLimits } from "./request-limits";

let stopping = false;
export function markStopping() { stopping = true; }
const limiter = aiLimiterFromEnv();
export const probes = Router();
probes.get("/health", (_req, res) => { res.json({ status: "ok" }); });
let activeCheck: Promise<void> | undefined;
async function check() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    await client.query("SELECT 1");
    await client.query("COMMIT");
  } catch (e) { client.release(true); throw e; }
  client.release();
  await probeStorage();
  await httpLimiterProbe();
  if (process.env.CC_AI_ENABLED === "true") await limiter.probe?.();
}
probes.get("/ready", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (stopping) { res.status(503).json({ status: "unavailable" }); return; }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Coalesce simultaneous probes; do not accumulate dependency work on timeout.
    activeCheck ??= check().finally(() => { activeCheck = undefined; });
    await Promise.race([activeCheck, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), 4500); })]);
    res.status(stopping ? 503 : 200).json({ status: stopping ? "unavailable" : "ready" });
  } catch { res.status(503).json({ status: "unavailable" }); }
  finally { clearTimeout(timer); }
});
export function productionFrontend(app: Express) {
  if (!process.env.CC_STATIC_DIR) return;
  const directory = resolve(process.env.CC_STATIC_DIR);
  app.use(requestLimit("static", 600));
  app.use(staticFiles(directory, { index: false }));
  app.get("/{*path}", (req, res, next) => {
    if (extname(req.path) || !req.accepts("html")) { next(); return; }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(resolve(directory, "index.html"));
  });
}
export function validateRuntime() {
  validateRequestLimits();
  const replicas = Number(process.env.CC_REPLICA_COUNT ?? "1");
  const workers = Number(process.env.CC_API_WORKER_COUNT ?? "1");
  if (!Number.isInteger(replicas) || replicas < 1) throw new Error("Invalid replica count");
  if ((replicas > 1 || workers > 1) && process.env.CC_KNOWLEDGE_STORAGE === "local") throw new Error("Local storage supports one process/replica only");
  if ((replicas > 1 || workers > 1) && process.env.CC_AI_ENABLED === "true" && process.env.CC_AI_LIMITER !== "redis-rest") throw new Error("Multiple AI processes/replicas require Redis REST limiter");
}
