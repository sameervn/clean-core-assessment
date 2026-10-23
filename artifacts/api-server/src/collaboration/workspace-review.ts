import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Identity } from "../auth/middleware";
import { publicUser } from "../auth/service";
import { AiError } from "../assessment-ai";
import { contentSchema } from "./contract";
import { access, current, event, expected, revision, transaction } from "./service";

export const workspaceRecordSchema = z.object({
  key: z.string().min(1).max(1000), kind: z.enum(["object", "interface"]),
  name: z.string().min(1).max(500), content: contentSchema,
  evidence: z.record(z.string(), z.unknown()),
}).strict();
export const workspaceReviewSchema = z.object({
  importKey: z.string().min(1).max(200), name: z.string().trim().min(1).max(160),
  system: z.string().min(1).max(100), targetRelease: z.literal("S4HANA_2025"),
  record: workspaceRecordSchema, expectedVersion: z.number().int().positive().nullable(),
  reviewerId: z.string().min(1).max(200), shareWithReviewer: z.boolean(),
  requestId: z.string().uuid(),
}).strict();

function developer(user: Awaited<ReturnType<typeof current>>) {
  if (!["Admin", "Developer"].includes(user.role) || !user.permissions.includes("classify")) {
    throw new AiError(403, "Authorized developer permission required.");
  }
}
/** JSONB key order is not stable. Compare structured snapshots, not serialized key order. */
export function equivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>, bb = b as Record<string, unknown>;
  return Object.keys(aa).length === Object.keys(bb).length && Object.keys(aa).every(k => Object.hasOwn(bb, k) && equivalent(aa[k], bb[k]));
}

export async function workspaceReviewContext(identity: Identity, importKey: string, key: string) {
  return transaction(async c => {
    const user = await current(c, identity); developer(user);
    const a = (await c.query("SELECT * FROM cc_shared_assessments WHERE owner_id=$1 AND import_key=$2", [user.id, importKey])).rows[0];
    if (a) {
      const { assessment } = await access(c, identity, a.id);
      if (assessment.access !== "edit") throw new AiError(403, "Assessment edit membership required.");
    }
    const record = a ? (await c.query("SELECT * FROM cc_assessment_entities WHERE assessment_id=$1 AND entity_key=$2", [a.id, key])).rows[0] ?? null : null;
    const reviewers = (await c.query(`SELECT a.*,m.access AS membership FROM cc_accounts a
      LEFT JOIN cc_assessment_members m ON m.user_id=a.id AND m.assessment_id=$1
      WHERE a.active AND a.role IN ('Reviewer','Admin') AND a.id<>$2 ORDER BY a.username`, [a?.id ?? null, user.id])).rows
      .filter(r => publicUser(r).permissions.includes("view"))
      .map(r => ({ id: r.id, username: r.username, member: r.membership === "review", eligible: !r.membership || r.membership === "review" }));
    return { assessment: a ?? null, entity: record, reviewers };
  });
}

/** Save only the explicitly selected snapshot. Submission remains the existing versioned action. */
export async function prepareWorkspaceReview(identity: Identity, body: z.infer<typeof workspaceReviewSchema>) {
  return transaction(async c => {
    const user = await current(c, identity); developer(user);
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,88))", [user.id]);
    let assessment = (await c.query("SELECT * FROM cc_shared_assessments WHERE owner_id=$1 AND import_key=$2", [user.id, body.importKey])).rows[0];
    if (assessment) {
      const result = await access(c, identity, assessment.id);
      if (result.assessment.access !== "edit") throw new AiError(403, "Assessment edit membership required.");
    } else {
      assessment = (await c.query(`INSERT INTO cc_shared_assessments(id,owner_id,import_key,name,system,target_release)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [randomUUID(), user.id, body.importKey, body.name, body.system, body.targetRelease])).rows[0];
      await c.query("INSERT INTO cc_assessment_members VALUES($1,$2,'edit')", [assessment.id, user.id]);
    }
    let row = (await c.query("SELECT * FROM cc_assessment_entities WHERE assessment_id=$1 AND entity_key=$2 FOR UPDATE", [assessment.id, body.record.key])).rows[0];
    const hash = createHash("sha256").update(JSON.stringify({ operation: "prepare-workspace-review", ...body })).digest("hex");
    if (row) {
      const previous = (await c.query("SELECT * FROM cc_assessment_actions WHERE entity_id=$1 AND actor_id=$2 AND request_id=$3", [row.id, user.id, body.requestId])).rows[0];
      if (previous) {
        if (previous.request_hash !== hash) throw new AiError(409, "This request identifier was already used for a different snapshot.");
        return { assessment, entity: previous.result };
      }
      if (body.expectedVersion === null) throw new AiError(409, "A shared copy already exists. Refresh and compare before sending.");
      expected(row, body.expectedVersion);
    }
    const reviewer = (await c.query("SELECT * FROM cc_accounts WHERE id=$1 AND active FOR SHARE", [body.reviewerId])).rows[0];
    if (!reviewer || reviewer.id === user.id || !["Admin", "Reviewer"].includes(reviewer.role) || !publicUser(reviewer).permissions.includes("view")) {
      throw new AiError(400, "Choose a separate active authorized reviewer.");
    }
    const membership = (await c.query("SELECT access FROM cc_assessment_members WHERE assessment_id=$1 AND user_id=$2 FOR SHARE", [assessment.id, reviewer.id])).rows[0];
    if (membership && membership.access !== "review") throw new AiError(403, "An administrator must change this account's existing membership.");
    if (!membership) {
      // Narrow owner-only invitation, not a general membership editor. Explicit consent covers all shared records.
      if (!body.shareWithReviewer) throw new AiError(409, "Confirm sharing this assessment with the selected reviewer.");
      await c.query("INSERT INTO cc_assessment_members VALUES($1,$2,'review')", [assessment.id, reviewer.id]);
      await c.query("INSERT INTO cc_assessment_events(assessment_id,actor_id,action,comment) VALUES($1,$2,'membership',$3)",
        [assessment.id, user.id, `${reviewer.id}: review (owner invitation)`]);
    }
    const same = row && row.kind === body.record.kind && row.name === body.record.name &&
      equivalent(row.content, body.record.content) && equivalent(row.evidence?.snapshot, body.record.evidence) && row.reviewer_id === reviewer.id;
    const reviewerChanged = !row || row.reviewer_id !== reviewer.id;
    if (row && !same) {
      if (!["Draft", "Changes requested"].includes(row.state)) throw new AiError(409, "This revision is submitted or approved. Open the shared record to revise it explicitly.");
      row = (await c.query(`UPDATE cc_assessment_entities SET name=$2,content=$3,evidence=$4,reviewer_id=$5,
        state='Draft',version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [row.id, body.record.name, JSON.stringify(body.record.content), JSON.stringify({ origin: "Browser workspace import; supplied by publisher, not independently verified", snapshot: body.record.evidence }), reviewer.id])).rows[0];
      await revision(c, identity, row, "selected workspace snapshot");
      await event(c, identity, row, "edited");
    } else if (!row) {
      if (body.expectedVersion !== null) throw new AiError(409, "The shared record changed. Refresh before retrying.");
      const count = (await c.query("SELECT count(*)::integer AS count FROM cc_assessment_entities WHERE assessment_id=$1", [assessment.id])).rows[0].count;
      if (count >= 5000) throw new AiError(400, "A shared assessment accepts at most 5,000 records.");
      row = (await c.query(`INSERT INTO cc_assessment_entities(id,assessment_id,entity_key,kind,name,content,evidence,reviewer_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [randomUUID(), assessment.id, body.record.key, body.record.kind, body.record.name,
        JSON.stringify(body.record.content), JSON.stringify({ origin: "Browser workspace import; supplied by publisher, not independently verified", snapshot: body.record.evidence }), reviewer.id])).rows[0];
      await revision(c, identity, row, "browser import");
      await event(c, identity, row, "published");
    }
    if (reviewerChanged) await event(c, identity, row, "reviewer assigned");
    await c.query("INSERT INTO cc_assessment_actions(entity_id,actor_id,request_id,request_hash,result) VALUES($1,$2,$3,$4,$5)",
      [row.id, user.id, body.requestId, hash, JSON.stringify(row)]);
    return { assessment, entity: row };
  });
}
