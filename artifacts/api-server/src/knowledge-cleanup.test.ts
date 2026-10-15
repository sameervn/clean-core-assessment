import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";
import { CLEANUP_GRACE_MS, orphanEligible, runCleanup } from "./knowledge/cleanup";
import { libraryTransaction } from "./knowledge/service";

test("cleanup fails closed for referenced, recent, unknown-age or unpinned objects", () => {
  const now = Date.now(), object = { path: "/private/knowledge/test-sealed", generation: "123", updatedAt: now - CLEANUP_GRACE_MS - 1 };
  assert.equal(orphanEligible(object, false, now), true);
  assert.equal(orphanEligible(object, true, now), false);
  assert.equal(orphanEligible({ ...object, updatedAt: now }, false, now), false);
  assert.equal(orphanEligible({ ...object, updatedAt: NaN }, false, now), false);
  assert.equal(orphanEligible({ ...object, generation: "" }, false, now), false);
  for (const generation of ["   ", "null", "undefined", "bad\nversion", "x".repeat(1025)]) {
    assert.equal(orphanEligible({ ...object, generation }, false, now), false);
  }
  for (const generation of ['"0x8DA123ABC"', "S3-version_AbC.123", randomUUID()]) {
    assert.equal(orphanEligible({ ...object, generation }, false, now), true);
    assert.equal(orphanEligible({ ...object, generation }, true, now), false);
    assert.equal(orphanEligible({ ...object, generation, updatedAt: now }, false, now), false);
  }
});

test("PostgreSQL cleanup: expiry, dry run, retry, batching and concurrent processing", { skip: process.env.CC_TEST_KNOWLEDGE !== "true" }, async () => {
  // Isolated schema: never enumerate real storage or expire deployment records.
  const schema = `cleanup_test_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE SCHEMA ${schema}`);
  const transaction = <T>(fn: (c: PoolClient) => Promise<T>) => libraryTransaction(async c => {
    await c.query(`SET LOCAL search_path TO ${schema}`);
    return fn(c);
  });
  const old = new Date(Date.now() - 2 * CLEANUP_GRACE_MS);
  try {
    await transaction(async c => {
      await c.query(`CREATE TABLE cc_knowledge(id uuid PRIMARY KEY,status text,object_path text,error text,updated_at timestamptz);
        CREATE TABLE cc_knowledge_cleanup(singleton boolean PRIMARY KEY,cursor text,last_run timestamptz,report jsonb);
        INSERT INTO cc_knowledge_cleanup(singleton) VALUES(true)`);
      for (const [status, path] of [["ready", "active-sealed"], ["processing", "processing"], ["awaiting-upload", "abandoned"], ["failed", "failed"]]) {
        await c.query("INSERT INTO cc_knowledge VALUES($1,$2,$3,NULL,$4)", [randomUUID(), status, path, old]);
      }
      await c.query("INSERT INTO cc_knowledge VALUES($1,'awaiting-upload','recent',NULL,now())", [randomUUID()]);
    });
    const objects = ["active-sealed", "processing", "abandoned", "failed", "recent", "orphan-sealed", "retry-sealed"]
      .map(path => ({ path, generation: "1", updatedAt: old.getTime() }));
    const deleted: string[] = [];
    let fail = true;
    const storage = {
      list: async () => ({ objects, cursor: null }),
      remove: async (o: { path: string }) => {
        if (o.path === "retry-sealed" && fail) throw Error("storage unavailable");
        deleted.push(o.path);
      },
    };
    const preview = await runCleanup(true, undefined, false, storage, transaction);
    assert.equal(preview?.expiredUploads, 2);
    assert.equal(preview?.candidates, 4);
    assert.equal(deleted.length, 0);
    assert.equal((await transaction(c => c.query("SELECT count(*) FROM cc_knowledge WHERE status='deleted'"))).rows[0].count, "0");
    const actual = await runCleanup(false, undefined, false, storage, transaction);
    assert.equal(actual?.deleted, 3);
    assert.equal(actual?.failures, 1);
    assert(!deleted.includes("active-sealed"));
    assert(!deleted.includes("processing"));
    assert(!deleted.includes("recent"));
    fail = false;
    await runCleanup(false, undefined, false, storage, transaction);
    assert(deleted.includes("retry-sealed"));
    assert.equal(await runCleanup(false, undefined, true, storage, transaction), null);

    // Processing commits a reference while holding the library lock. Cleanup
    // started concurrently must wait and see the committed reference.
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const started = new Promise<void>(r => { entered = r; });
    const processing = transaction(async c => {
      await c.query("INSERT INTO cc_knowledge VALUES($1,'ready','inflight-sealed',NULL,$2)", [randomUUID(), old]);
      entered(); await gate;
    });
    await started;
    let listed = false;
    const concurrent = runCleanup(false, undefined, false, {
      list: async () => { listed = true; return { objects: [{ path: "inflight-sealed", generation: "1", updatedAt: old.getTime() }], cursor: null }; },
      remove: async () => { assert.fail("committed in-flight file must not be deleted"); },
    }, transaction);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(listed, false);
    release(); await processing;
    assert.equal((await concurrent)?.protected, 1);

    // Two workers cannot both delete a registration being adopted or expire
    // more than the batch cap; scheduled workers share persisted throttling.
    await transaction(async c => {
      await c.query("UPDATE cc_knowledge_cleanup SET last_run=NULL");
      for (let i = 0; i < 30; i++) await c.query("INSERT INTO cc_knowledge VALUES($1,'failed',NULL,NULL,$2)", [randomUUID(), old]);
    });
    const empty = { list: async () => ({ objects: [], cursor: "next-page" }), remove: storage.remove };
    const pair = await Promise.all([
      runCleanup(false, undefined, true, empty, transaction),
      runCleanup(false, undefined, true, empty, transaction),
    ]);
    assert.equal(pair.filter(Boolean).length, 1);
    assert.equal(pair.find(Boolean)?.expiredUploads, 25);
    assert.equal((await transaction(c => c.query("SELECT cursor FROM cc_knowledge_cleanup"))).rows[0].cursor, "next-page");
    // Enumeration failures roll back expiry and preserve the scan cursor.
    await assert.rejects(runCleanup(false, undefined, false, {
      ...empty, list: async () => { throw Error("listing failed"); },
    }, transaction), /listing failed/);
    assert.equal((await transaction(c => c.query("SELECT count(*) FROM cc_knowledge WHERE status='failed'"))).rows[0].count, "5");
  } finally {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  }
});
