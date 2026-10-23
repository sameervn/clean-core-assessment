import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";
import { initializeCollaboration } from "./collaboration/schema";
import {
  cleanupNotifications, deliverNotifications,
  notificationCleanupBatchSize, notificationRetentionDays,
} from "./collaboration/notifications";

test("read notification retention is bounded, restart-safe and concurrent with delivery", {
  skip: process.env.CC_TEST_COLLABORATION !== "true", timeout: 60_000,
}, async () => {
  // Isolate all fixtures, including the schema migration, from real inboxes.
  const schema = `notification_retention_${randomUUID().replaceAll("-", "")}`;
  const clients: PoolClient[] = [];
  const connect = async () => {
    const c = await pool.connect();
    clients.push(c);
    await c.query(`SET search_path TO "${schema}"`);
    return c;
  };
  const runWith = (c: PoolClient) => async <T>(fn: (db: PoolClient) => Promise<T>) => {
    await c.query("BEGIN");
    try {
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    }
  };
  const owner = randomUUID(), recipient = randomUUID();
  const assessment = randomUUID(), entity = randomUUID();
  try {
    const c = await connect();
    await c.query(`CREATE SCHEMA "${schema}"`);
    await c.query(`CREATE TABLE cc_accounts (
      id text PRIMARY KEY, active boolean DEFAULT true,
      must_change_password boolean DEFAULT false, role text, overrides jsonb DEFAULT '{}'
    )`);
    await initializeCollaboration(c);
    // Migration must also be safe to repeat on an existing installation.
    await initializeCollaboration(c);
    await c.query("INSERT INTO cc_accounts(id,role) VALUES($1,'Developer'),($2,'Reviewer')", [owner, recipient]);
    await c.query(`INSERT INTO cc_shared_assessments(id,owner_id,import_key,name,system,target_release)
      VALUES($1,$2,'retention','retention','test','S4HANA_2025')`, [assessment, owner]);
    await c.query(`INSERT INTO cc_assessment_entities(id,assessment_id,entity_key,kind,name,evidence,content,reviewer_id)
      VALUES($1,$2,'retention','object','retention','{}','{}',$3)`, [entity, assessment, recipient]);
    await c.query("INSERT INTO cc_assessment_members VALUES($1,$2,'review')", [assessment, recipient]);
    await c.query(`INSERT INTO cc_review_notification_preferences(user_id,enabled,enabled_since)
      VALUES($1,true,now()-interval '1 year')`, [recipient]);
    const seed = async (readDays: number | null, processed = true, eventDays = 180) => {
      const { rows: [event] } = await c.query(`INSERT INTO cc_assessment_events
        (entity_id,assessment_id,actor_id,recipient_id,action,notification_processed,created_at)
        VALUES($1,$2,$3,$4,'submit',$5,now()-($6::integer*interval '1 day')) RETURNING id`,
      [entity, assessment, owner, recipient, processed, eventDays]);
      await c.query(`INSERT INTO cc_review_notifications(event_id,user_id,read_at)
        VALUES($1,$2,CASE WHEN $3::integer IS NULL THEN NULL ELSE now()-($3::integer*interval '1 day') END)`,
      [event.id, recipient, readDays]);
      return event.id as string;
    };
    const exists = async (id: string) => (await c.query(
      "SELECT 1 FROM cc_review_notifications WHERE event_id=$1", [id])).rowCount === 1;
    const expired: string[] = [];
    for (let i = 0; i < 205; i++) expired.push(await seed(notificationRetentionDays + 1));
    const unread = await seed(null);
    const recentRead = await seed(0);
    const insideWindow = await seed(notificationRetentionDays - 1);
    const notProcessed = await seed(notificationRetentionDays + 1, false);
    assert.equal(notificationRetentionDays, 90);
    assert.equal(notificationCleanupBatchSize, 100);
    const run = runWith(c);
    const before = (await c.query("SELECT count(*)::integer AS n FROM cc_review_notifications")).rows[0].n;
    await assert.rejects(cleanupNotifications(async fn => run(async db => {
      assert.equal(await fn(db), notificationCleanupBatchSize);
      throw new Error("Simulated crash before commit");
    })), /Simulated crash/);
    assert.equal((await c.query("SELECT count(*)::integer AS n FROM cc_review_notifications")).rows[0].n, before,
      "a failed cleanup rolls all deletions back");

    const locked = await connect(), parallel = await connect();
    await locked.query("BEGIN");
    await locked.query("SELECT 1 FROM cc_review_notifications WHERE event_id=$1 FOR UPDATE", [expired[0]]);
    const counts = await Promise.all([
      cleanupNotifications(run), cleanupNotifications(runWith(parallel)),
    ]);
    assert.deepEqual(counts, [100, 100], "each worker has its own strict row limit");
    assert.ok(await exists(expired[0]), "locked notification is skipped rather than blocking");
    await locked.query("ROLLBACK");
    assert.equal(await cleanupNotifications(run), 5, "the next pass resumes without a cursor");
    assert.equal(await cleanupNotifications(run), 0);
    for (const id of [unread, recentRead, insideWindow, notProcessed]) {
      assert.ok(await exists(id), "unread, recent and unprocessed entries survive");
    }
    assert.equal((await c.query(`SELECT count(*)::integer AS n FROM cc_assessment_events
      WHERE id=ANY($1::bigint[]) AND notification_processed`, [expired])).rows[0].n, expired.length,
    "cleanup preserves every audit event and its processed marker");

    // now() is fixed inside a transaction: exactly 90 days is not yet eligible.
    let boundary = "";
    await run(async db => {
      boundary = await seed(notificationRetentionDays);
      assert.equal(await cleanupNotifications(async fn => fn(db)), 0);
      assert.ok(await exists(boundary), "strict cutoff retains the exact boundary");
    });

    // Hold an uncommitted delivery while cleanup runs on another connection.
    const { rows: [pending] } = await c.query(`INSERT INTO cc_assessment_events
      (entity_id,assessment_id,actor_id,recipient_id,action)
      VALUES($1,$2,$3,$4,'submit') RETURNING id`, [entity, assessment, owner, recipient]);
    await locked.query("BEGIN");
    await deliverNotifications(async fn => fn(locked));
    await cleanupNotifications(run);
    assert.equal((await c.query("SELECT 1 FROM cc_review_notifications WHERE event_id=$1", [pending.id])).rowCount, 0,
      "uncommitted delivery is invisible to cleanup");
    await locked.query("COMMIT");
    assert.ok(await exists(pending.id), "concurrent delivery commits an unread notification");
    assert.equal((await c.query("SELECT read_at FROM cc_review_notifications WHERE event_id=$1", [pending.id])).rows[0].read_at, null);

    // A new connection and repeated initialization represent stateless restart.
    const restarted = await connect();
    await initializeCollaboration(restarted);
    await Promise.all([deliverNotifications(runWith(restarted)), cleanupNotifications(run)]);
    await deliverNotifications(runWith(restarted));
    assert.equal((await c.query("SELECT 1 FROM cc_review_notifications WHERE event_id=ANY($1::bigint[])", [expired])).rowCount, 0,
      "deleted notifications cannot be recreated on restart or concurrent delivery");
    for (const id of [unread, recentRead, insideWindow, pending.id]) assert.ok(await exists(id));
    assert.equal((await c.query("SELECT count(*)::integer AS n FROM cc_assessment_events")).rows[0].n, before + 2,
      "only notification rows, never audit history, are deleted");
  } finally {
    for (const c of clients) {
      await c.query("ROLLBACK");
      await c.query("RESET search_path");
    }
    if (clients[0]) await clients[0].query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    for (const c of clients) c.release();
    await pool.end();
  }
});
