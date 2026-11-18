import { withProjectDatabase } from "@workspace/db";
import { readyProjectScopes } from "./service";
import { deliverNotifications, cleanupNotifications } from "../collaboration/notifications";
import { cleanupReports } from "../reports/service";
import { runCleanup } from "../knowledge/cleanup";
import { storageConfigured } from "../knowledge/storage";
import { logger } from "../lib/logger";

/** Each project's cleanup sees only its own tables AND private file prefix. */
export function startProjectMaintenance() {
  let running = false;
  let lastCleanup = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    const cleanup = Date.now() - lastCleanup >= 60_000;
    try {
      const scopes = await readyProjectScopes();
      for (const scope of scopes) await withProjectDatabase(scope, async () => {
        try { await deliverNotifications(); await cleanupNotifications(); }
        catch { logger.warn({ projectId: scope.projectId }, "Project notification maintenance failed; saved work is unaffected."); }
        if (cleanup) {
          try { await cleanupReports(); }
          catch { logger.warn({ projectId: scope.projectId }, "Project report cleanup failed; will retry."); }
          if (storageConfigured()) {
            try { await runCleanup(false, undefined, true); }
            catch { logger.warn({ projectId: scope.projectId }, "Project knowledge cleanup failed; will retry."); }
          }
        }
      });
      if (cleanup) lastCleanup = Date.now();
    } catch { logger.warn("Project maintenance unavailable; will retry."); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 5_000);
  timer.unref();
  return timer;
}
