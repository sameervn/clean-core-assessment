import "@workspace/db/runtime-env";
import app from "./app";
import { logger } from "./lib/logger";
import { bootstrapAdmin } from "./auth/service";
import { startKnowledgeInitialization } from "./knowledge/schema";
import { startCleanupJob } from "./knowledge/cleanup";
import { initializeReports } from "./reports/schema";
import { cleanupReports } from "./reports/service";
import { pool } from "@workspace/db";
import { markStopping, validateRuntime } from "./runtime";

const rawPort = process.env["PORT"] ?? "8080";

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}
validateRuntime();
await bootstrapAdmin();
if (process.env.CC_SCHEMA_BOOTSTRAP !== "false") await initializeReports();
const reportCleanup = () => void cleanupReports().catch(() => logger.warn("Private report template cleanup failed; will retry."));
reportCleanup();
const reportTimer = setInterval(reportCleanup, 60_000);
reportTimer.unref();
let knowledgeTimer: ReturnType<typeof setInterval> | undefined;
const server = app.listen(port, "0.0.0.0", () => {

  logger.info({ port }, "Server listening");
  if (process.env.CC_SCHEMA_BOOTSTRAP !== "false") startKnowledgeInitialization(() => logger.warn("Knowledge schema unavailable. Apply the knowledge migration with an authorized deployment role; core assessment remains available."));
  knowledgeTimer = startCleanupJob(() => logger.warn("Knowledge cleanup failed; no success report recorded. Check database and private storage access."));
});
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  markStopping();
  clearInterval(reportTimer); clearInterval(knowledgeTimer);
  logger.info("Shutdown requested; draining requests");
  const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 25_000);
  deadline.unref();
  server.close(() => {
    void pool.end().then(() => { clearTimeout(deadline); process.exit(0); });
  });
  server.closeIdleConnections();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
