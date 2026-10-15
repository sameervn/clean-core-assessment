import { pool } from "@workspace/db";
import { AiError } from "../assessment-ai";
import type { Identity } from "../auth/middleware";
import { freshUser, libraryTransaction } from "./service";
import { listCleanupObjects, removeCleanupObject, storageConfigured, type CleanupObject } from "./storage";

export const CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;
export function orphanEligible(object: CleanupObject, referenced: boolean, now: number) {
  // Version tokens are opaque: GCS generations, S3 VersionIds, Azure ETags
  // and local UUIDs. The adapter performs the native conditional deletion.
  const pinned = typeof object.generation === "string"
    && object.generation.trim().length > 0 && object.generation.length <= 1024
    && !/[\u0000-\u001f\u007f]/.test(object.generation)
    && !["null", "undefined"].includes(object.generation);
  return !referenced && pinned
    && Number.isFinite(object.updatedAt) && object.updatedAt < now - CLEANUP_GRACE_MS;
}
const defaults = { list: listCleanupObjects, remove: removeCleanupObject };

/** All reference checks and deletes run under the same exclusive lock as upload commits.
 * Storage errors are counted, never treated as proof that a file is gone. */
export async function runCleanup(dryRun = true, identity?: Identity, scheduled = false, storage = defaults, transaction = libraryTransaction) {
  return transaction(async c => {
    if (identity && (await freshUser(identity, c)).role !== "Admin") throw new AiError(403, "Administrator access required.");
    const state = (await c.query("SELECT * FROM cc_knowledge_cleanup WHERE singleton=true FOR UPDATE")).rows[0];
    if (!state) throw new AiError(503, "Apply the knowledge migration before cleanup.");
    if (scheduled && state.last_run && Date.now() - new Date(state.last_run).getTime() < 3_600_000) return null;
    const now = Date.now();
    const report = { dryRun, startedAt: new Date(now).toISOString(), expiredUploads: 0, scanned: 0,
      candidates: 0, deleted: 0, protected: 0, failures: 0, hasMore: false };
    // Expire registrations first, even if no file was ever uploaded. Processing is
    // deliberately excluded; its normal recovery path must finish before expiry.
    const expired = await c.query(`SELECT id FROM cc_knowledge WHERE status IN ('awaiting-upload','failed')
      AND updated_at < $1 AND (object_path IS NULL OR object_path NOT LIKE '%-sealed')
      ORDER BY updated_at,id LIMIT 25`, [new Date(now - CLEANUP_GRACE_MS)]);
    report.expiredUploads = expired.rows.length;
    const expiredIds = expired.rows.map(row => row.id);
    if (!dryRun && expiredIds.length) await c.query(`UPDATE cc_knowledge SET status='deleted',object_path=NULL,
      error=NULL,updated_at=now() WHERE id=ANY($1::uuid[])`, [expiredIds]);
    // A dry run walks the same next page, but never advances the persisted cursor.
    const page = await storage.list(state.cursor ?? undefined);
    report.hasMore = !!page.cursor || expired.rows.length === 25;
    for (const object of page.objects) {
      report.scanned++;
      const references = await c.query("SELECT id FROM cc_knowledge WHERE object_path=$1", [object.path]);
      const referenced = references.rows.some(row => !dryRun || !expiredIds.includes(row.id));
      if (!orphanEligible(object, referenced, now)) { report.protected++; continue; }
      report.candidates++;
      if (!dryRun) {
        try { await storage.remove(object); report.deleted++; }
        catch { report.failures++; }
      }
    }
    if (!dryRun) await c.query(`UPDATE cc_knowledge_cleanup SET cursor=$1,last_run=now(),report=$2 WHERE singleton=true`,
      [page.cursor, JSON.stringify(report)]);
    return report;
  });
}
export async function cleanupStatus() {
  const row = (await pool.query("SELECT report FROM cc_knowledge_cleanup WHERE singleton=true")).rows[0];
  if (!row) throw new AiError(503, "Apply the knowledge migration before cleanup.");
  return { report: row.report ?? null };
}
export function startCleanupJob(onFailure: () => void) {
  let running = false;
  const tick = () => {
    if (running || !storageConfigured()) return;
    running = true;
    void runCleanup(false, undefined, true).catch(onFailure).finally(() => { running = false; });
  };
  // Start after optional schema initialization; failures are retried next tick.
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return timer;
}
