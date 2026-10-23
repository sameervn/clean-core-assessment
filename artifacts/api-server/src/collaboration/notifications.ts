import type { PoolClient } from "@workspace/db";
import { logger } from "../lib/logger";
import { transaction } from "./service";

export const notificationMessages: Record<string, string> = {
  "reviewer assigned": "A review has been assigned to you.",
  submit: "An assessment item is ready for your review.",
  "request-changes": "Changes have been requested on your submitted item.",
};

// Both delivery and reading require current membership and the relevant role.
export const notificationAccess = `
  JOIN cc_assessment_entities item ON item.id=e.entity_id
  JOIN cc_assessment_members m ON m.assessment_id=e.assessment_id AND m.user_id=e.recipient_id
  JOIN cc_accounts a ON a.id=m.user_id
  WHERE a.active AND NOT a.must_change_password
    AND (a.role='Admin' OR COALESCE((a.overrides->>'view')::boolean,true))
    AND ((e.action IN ('reviewer assigned','submit') AND m.access='review'
      AND a.role IN ('Admin','Reviewer') AND item.reviewer_id=a.id)
      OR (e.action='request-changes' AND m.access='edit'
      AND a.role IN ('Admin','Developer') AND item.submitter_id=a.id))`;

export async function deliverNotifications(run = transaction) {
  return run(async (c: PoolClient) => {
    // A bounded, locked batch allows concurrent workers; rollback retries all failed work.
    const events = (await c.query(`SELECT id FROM cc_assessment_events
      WHERE recipient_id IS NOT NULL AND NOT notification_processed
      ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`)).rows;
    if (!events.length) return;
    const ids = events.map(e => e.id);
    await c.query(`INSERT INTO cc_review_notifications(event_id,user_id)
      SELECT e.id,e.recipient_id FROM cc_assessment_events e
      JOIN cc_review_notification_preferences p ON p.user_id=e.recipient_id
        AND p.enabled AND e.created_at>=p.enabled_since
      ${notificationAccess}
      AND e.id=ANY($1::bigint[]) AND e.actor_id<>e.recipient_id
      ON CONFLICT DO NOTHING`, [ids]);
    await c.query("UPDATE cc_assessment_events SET notification_processed=true WHERE id=ANY($1::bigint[])", [ids]);
  });
}

// Retention starts at the first explicit mark-read, not at the audit event date.
export const notificationRetentionDays = 90;
export const notificationCleanupBatchSize = 100;

export async function cleanupNotifications(run = transaction) {
  return run(async (c: PoolClient) => {
    // Bound database time as well as row count. A timeout rolls back this pass.
    await c.query("SET LOCAL lock_timeout = '1s'");
    await c.query("SET LOCAL statement_timeout = '5s'");
    const result = await c.query(`WITH expired AS (
      SELECT n.event_id,n.user_id FROM cc_review_notifications n
      JOIN cc_assessment_events e ON e.id=n.event_id
      WHERE n.read_at < now() - ($1::integer * interval '1 day')
        AND e.notification_processed
      ORDER BY n.read_at,n.event_id,n.user_id
      LIMIT $2 FOR UPDATE OF n SKIP LOCKED
    )
    DELETE FROM cc_review_notifications n USING expired x
    WHERE n.event_id=x.event_id AND n.user_id=x.user_id`,
    [notificationRetentionDays, notificationCleanupBatchSize]);
    // Never remove audit events or reset their processed markers: doing so replays alerts.
    return result.rowCount ?? 0;
  });
}

export function startNotificationDelivery() {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      try { await deliverNotifications(); }
      catch { logger.warn("Review notification delivery failed; saved work is unaffected. Will retry."); }
      // Separate transactions let cleanup retry independently of failed delivery.
      try { await cleanupNotifications(); }
      catch { logger.warn("Review notification cleanup failed; saved work is unaffected. Will retry."); }
    }
    finally { busy = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), 5_000);
  timer.unref();
  return timer;
}

export async function notificationPreference(c: Pick<PoolClient, "query">, userId: string) {
  return { enabled: (await c.query("SELECT enabled FROM cc_review_notification_preferences WHERE user_id=$1", [userId])).rows[0]?.enabled ?? false };
}

// Keep messages an allowlist rather than copying event comments or entity names.
export async function listNotifications(
  c: Pick<PoolClient, "query">,
  userId: string,
  { cursor, filter = "all" }: { cursor?: string; filter?: "all" | "unread" } = {},
) {
  // Fetch one extra matching row to distinguish a full last page from more results.
  // Use the immutable unique ID, not an offset or a mutable read timestamp.
  const rows = (await c.query(`SELECT e.id::text AS id,e.assessment_id,e.entity_id,e.action,
    e.created_at,n.read_at FROM cc_review_notifications n
    JOIN cc_assessment_events e ON e.id=n.event_id AND e.recipient_id=n.user_id
    ${notificationAccess} AND n.user_id=$1
    AND ($2::bigint IS NULL OR e.id<$2::bigint)
    AND ($3::boolean=false OR n.read_at IS NULL)
    ORDER BY e.id DESC LIMIT 101`, [userId, cursor ?? null, filter === "unread"])).rows;
  const page = rows.slice(0, 100);
  return {
    notifications: page.map(r => ({ id: r.id, assessmentId: r.assessment_id, entityId: r.entity_id,
      message: notificationMessages[r.action], createdAt: new Date(r.created_at).toISOString(), read: r.read_at !== null })),
    nextCursor: rows.length > 100 ? page[page.length - 1].id as string : null,
  };
}
