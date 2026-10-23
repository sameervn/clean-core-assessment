import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { approvalPage } from "./collaboration/archive";

test("archive keysets reach beyond 5000, preserve microseconds, filter before paging, and survive new approvals", {
  skip: process.env.CC_TEST_COLLABORATION !== "true", timeout: 120_000,
}, async () => {
  const c = await pool.connect();
  const owner = "archive-fixture";
  const assessment = randomUUID(), object = randomUUID(), iface = randomUUID();
  try {
    await c.query("BEGIN");
    // Transaction-local shadow tables exercise real PostgreSQL ordering and joins
    // without modifying any user's assessments or requiring storage/report generation.
    await c.query(`
      CREATE TEMP TABLE cc_assessment_approvals(id uuid,entity_id uuid,version integer,approved_at timestamptz,approver_id text,template_id uuid,template_version integer) ON COMMIT DROP;
      CREATE TEMP TABLE cc_assessment_entities(id uuid,kind text,name text,assessment_id uuid,state text,version integer) ON COMMIT DROP;
      CREATE TEMP TABLE cc_shared_assessments(id uuid,name text) ON COMMIT DROP;
      CREATE TEMP TABLE cc_assessment_members(assessment_id uuid,user_id text) ON COMMIT DROP;
      CREATE TEMP TABLE cc_accounts(id text,username text) ON COMMIT DROP;
      CREATE TEMP TABLE cc_company_template_versions(template_id uuid,version integer,name text) ON COMMIT DROP;
    `);
    await c.query("INSERT INTO cc_accounts VALUES($1,'Archive reviewer')", [owner]);
    await c.query("INSERT INTO cc_shared_assessments VALUES($1,'Archive assessment')", [assessment]);
    await c.query("INSERT INTO cc_assessment_members VALUES($1,$2)", [assessment, owner]);
    await c.query("INSERT INTO cc_assessment_entities VALUES($1,'object','Z_100%_literal',$3,'Approved',1),($2,'interface','IF_ARCHIVE',$3,'Draft',2)", [object, iface, assessment]);
    await c.query(`INSERT INTO cc_assessment_approvals(id,entity_id,version,approved_at,approver_id)
      SELECT md5(i::text)::uuid,CASE WHEN i%2=0 THEN $1::uuid ELSE $2::uuid END,1,
      '2026-01-01T00:00:00.000000Z'::timestamptz + (i/3)*interval '1 microsecond',$3
      FROM generate_series(1,5105) i`, [object, iface, owner]);
    const query = { limit: "100", showSuperseded: "true" };
    const expected = (await c.query("SELECT id FROM cc_assessment_approvals ORDER BY approved_at DESC,id DESC")).rows.map(r => r.id);
    const first = await approvalPage(c, owner, query);
    assert.equal(first.approvals.length, 100);
    assert(first.pageCursor && first.nextCursor);
    assert(first.approvals.some(a => a.superseded));
    // Approvals arrive between page requests, including a tie at the newest timestamp.
    const newest = randomUUID(), tied = randomUUID();
    await c.query(`INSERT INTO cc_assessment_approvals(id,entity_id,version,approved_at,approver_id) VALUES
      ($1,$3,1,'2026-01-02',$4),($2,$3,1,'2026-01-01T00:00:00.001701Z',$4)`, [newest, tied, object, owner]);
    const ids = first.approvals.map(a => a.id);
    let next: string | null = first.nextCursor;
    while (next) {
      const page = await approvalPage(c, owner, { ...query, cursor: next });
      ids.push(...page.approvals.map(a => a.id)); next = page.nextCursor;
    }
    assert.equal(new Set(ids).size, ids.length, "no repeated approval on later pages");
    assert.deepEqual(ids.filter(id => id !== tied), expected, "no old approval skipped, including beyond 5000");
    assert(!ids.includes(newest));
    const back = await approvalPage(c, owner, { ...query, cursor: first.pageCursor });
    // New rows above the anchor cannot shift backward navigation.
    assert(!back.approvals.some(a => a.id === newest));
    assert.equal((await approvalPage(c, owner, query)).approvals[0].id, newest);
    for (const term of ["Z_100%_literal", "Archive assessment", "Archive reviewer", "2026-01-01", "1"]) {
      const filtered = await approvalPage(c, owner, { ...query, search: term, kind: "object" });
      assert(filtered.approvals.length > 0);
      assert(filtered.approvals.every(a => a.kind === "object"));
    }
    assert.equal((await approvalPage(c, owner, { ...query, search: "100%_not-a-wildcard" })).approvals.length, 0);
    assert((await approvalPage(c, owner, { kind: "object" })).approvals.every(a => !a.superseded));
    assert.equal((await approvalPage(c, owner, { kind: "interface" })).approvals.length, 0);
    assert((await approvalPage(c, owner, { ...query, kind: "interface" })).approvals.every(a => a.superseded));
    await assert.rejects(approvalPage(c, owner, { ...query, cursor: first.nextCursor, kind: "interface" }));
    await assert.rejects(approvalPage(c, "outsider", { ...query, cursor: first.nextCursor }));
    for (const invalid of [{ limit: "101" }, { limit: "0" }, { kind: "other" }, { cursor: "garbage" }, { showSuperseded: "yes" }, { search: "a".repeat(201) }])
      await assert.rejects(approvalPage(c, owner, invalid));
    assert.equal((await approvalPage(c, "outsider", query)).approvals.length, 0);
    await c.query("DELETE FROM cc_assessment_members WHERE user_id=$1", [owner]);
    const revoked = await approvalPage(c, owner, { ...query, cursor: first.nextCursor });
    assert.equal(revoked.approvals.length, 0);
    assert.equal(revoked.nextCursor, null);
  } finally {
    await c.query("ROLLBACK"); c.release(); await pool.end();
  }
});
