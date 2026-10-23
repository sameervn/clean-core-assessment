import { Router, type RequestHandler } from "express";
import { requestLimit } from "../request-limits";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "@workspace/db";
import { GetReviewNotificationPreferencesResponse, UpdateReviewNotificationPreferencesBody, ListReviewNotificationsQueryParams, ListReviewNotificationsResponse } from "@workspace/api-zod";
import { requireSession } from "../auth/middleware";
import { AiError } from "../assessment-ai";
import { contentSchema } from "../collaboration/contract";
import { access, action, current, entity, event, expected, revision, save, transaction } from "../collaboration/service";
import { listNotifications, notificationAccess, notificationPreference } from "../collaboration/notifications";
import { prepareWorkspaceReview, workspaceReviewContext, workspaceReviewSchema } from "../collaboration/workspace-review";

export const collaborationRouter = Router();
collaborationRouter.use(requireSession);
const uuid = (v: unknown) => z.string().uuid().parse(v);
const wrap = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    res.status(e instanceof AiError ? e.status : e instanceof z.ZodError ? 400 : 503)
      .json({ message: e instanceof AiError ? e.message : e instanceof z.ZodError ? "Invalid assessment request. Check all fields and limits." : "Shared assessment storage unavailable. Your draft has not been discarded." });
  }
};
collaborationRouter.get("/notifications/preferences", wrap(async (req, res) => {
  res.json(GetReviewNotificationPreferencesResponse.parse(await transaction(async c => {
    const user = await current(c, req.identity!);
    return notificationPreference(c, user.id);
  })));
}));
collaborationRouter.put("/notifications/preferences", wrap(async (req, res) => {
  const body = UpdateReviewNotificationPreferencesBody.strict().parse(req.body);
  res.json(GetReviewNotificationPreferencesResponse.parse(await transaction(async c => {
    const user = await current(c, req.identity!);
    await c.query(`INSERT INTO cc_review_notification_preferences(user_id,enabled) VALUES($1,$2)
      ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,
      enabled_since=CASE WHEN excluded.enabled AND NOT cc_review_notification_preferences.enabled
        THEN now() ELSE cc_review_notification_preferences.enabled_since END`, [user.id, body.enabled]);
    return notificationPreference(c, user.id);
  })));
}));
collaborationRouter.get("/notifications", wrap(async (req, res) => {
  // Orval coerces query strings; reject arrays/objects rather than accepting a
  // one-element array as a cursor.
  z.string().optional().parse(req.query.cursor);
  const query = ListReviewNotificationsQueryParams.strict().parse(req.query);
  if (query.cursor && BigInt(query.cursor) > 9223372036854775807n) {
    throw new AiError(400, "Invalid notification cursor.");
  }
  res.json(ListReviewNotificationsResponse.parse(await transaction(async c => {
    const user = await current(c, req.identity!);
    return listNotifications(c, user.id, query);
  })));
}));
collaborationRouter.put("/notifications/:notificationId/read", wrap(async (req, res) => {
  const id = z.string().regex(/^[1-9][0-9]{0,18}$/).parse(req.params.notificationId);
  await transaction(async c => {
    const user = await current(c, req.identity!);
    const result = await c.query(`UPDATE cc_review_notifications n SET read_at=COALESCE(read_at,now())
      WHERE n.user_id=$1 AND n.event_id=$2 AND EXISTS(
        SELECT 1 FROM cc_assessment_events e ${notificationAccess}
        AND e.id=n.event_id AND e.recipient_id=n.user_id) RETURNING event_id`, [user.id, id]);
    if (!result.rowCount) throw new AiError(404, "Notification no longer available.");
  });
  res.json({ ok: true });
}));
collaborationRouter.get("/", wrap(async (req, res) => {
  res.json(await transaction(async c => {
    const user = await current(c, req.identity!);
    return { assessments: (await c.query(`SELECT a.*,m.access,(SELECT count(*) FROM cc_assessment_entities e WHERE e.assessment_id=a.id) AS count
      FROM cc_shared_assessments a JOIN cc_assessment_members m ON m.assessment_id=a.id WHERE m.user_id=$1 ORDER BY a.created_at DESC`, [user.id])).rows };
  }));
}));
const publishSchema = z.object({
  importKey: z.string().min(1).max(200), name: z.string().trim().min(1).max(160),
  system: z.string().min(1).max(100), targetRelease: z.literal("S4HANA_2025"),
  entities: z.array(z.object({
    key: z.string().min(1).max(1000), kind: z.enum(["object", "interface"]),
    name: z.string().min(1).max(500), content: contentSchema,
    evidence: z.record(z.string(), z.unknown()),
  }).strict()).min(1).max(5000),
}).strict();
collaborationRouter.post("/", wrap(async (req, res) => {
  const body = publishSchema.parse(req.body);
  if (Buffer.byteLength(JSON.stringify(body)) > 8_000_000) throw new AiError(413, "Publish at most 8 MB at a time.");
  if (new Set(body.entities.map(e => `${e.kind}:${e.key}`)).size !== body.entities.length) throw new AiError(400, "Duplicate object/interface identities.");
  res.json(await transaction(async c => {
    const user = await current(c, req.identity!);
    if (!["Admin", "Developer"].includes(user.role) || !user.permissions.includes("classify")) throw new AiError(403, "Developer publishing permission required.");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,88))", [user.id]);
    const previous = (await c.query("SELECT * FROM cc_shared_assessments WHERE owner_id=$1 AND import_key=$2", [user.id, body.importKey])).rows[0];
    const id = previous?.id ?? randomUUID();
    if (previous) {
      const result = await access(c, req.identity!, id);
      if (result.assessment.access !== "edit") throw new AiError(403, "Assessment edit membership required.");
    }
    const assessment = previous ?? (await c.query("INSERT INTO cc_shared_assessments(id,owner_id,import_key,name,system,target_release) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [id, user.id, body.importKey, body.name, body.system, body.targetRelease])).rows[0];
    if (!previous) await c.query("INSERT INTO cc_assessment_members VALUES($1,$2,'edit')", [id, user.id]);
    for (const input of body.entities) {
      // A direct submission may already have published a subset. Never overwrite its reviewed content.
      if ((await c.query("SELECT id FROM cc_assessment_entities WHERE assessment_id=$1 AND entity_key=$2 AND kind=$3", [id, input.key, input.kind])).rowCount) continue;
      const row = (await c.query(`INSERT INTO cc_assessment_entities(id,assessment_id,entity_key,kind,name,content,evidence)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [randomUUID(), id, input.key, input.kind, input.name, JSON.stringify(input.content),
        JSON.stringify({ origin: "Browser workspace import; supplied by publisher, not independently verified", snapshot: input.evidence })])).rows[0];
      await revision(c, req.identity!, row, "browser import");
      await event(c, req.identity!, row, "published");
    }
    return { assessment, existing: !!previous };
  }));
}));
collaborationRouter.get("/workspace-review", wrap(async (req, res) => {
  const query = z.object({ importKey: z.string().min(1).max(200), key: z.string().min(1).max(1000) }).parse(req.query);
  res.json(await workspaceReviewContext(req.identity!, query.importKey, query.key));
}));
collaborationRouter.post("/workspace-review", wrap(async (req, res) => {
  const body = workspaceReviewSchema.parse(req.body);
  if (Buffer.byteLength(JSON.stringify(body)) > 8_000_000) throw new AiError(413, "Publish at most 8 MB at a time.");
  res.json(await prepareWorkspaceReview(req.identity!, body));
}));
// Administrators discover identity/owner metadata to grant access, never content by implication.
collaborationRouter.get("/administration", wrap(async (req, res) => {
  res.json(await transaction(async c => {
    const user = await current(c, req.identity!);
    if (user.role !== "Admin") throw new AiError(403, "Administrator access required.");
    return {
      assessments: (await c.query("SELECT id,name,owner_id FROM cc_shared_assessments ORDER BY created_at DESC")).rows,
      users: (await c.query("SELECT id,username,role FROM cc_accounts WHERE active ORDER BY username")).rows,
    };
  }));
}));
collaborationRouter.put("/:id/members", wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const body = z.object({ userId: z.string().min(1).max(200), access: z.enum(["read", "edit", "review"]).nullable() }).strict().parse(req.body);
  await transaction(async c => {
    const user = await current(c, req.identity!);
    if (user.role !== "Admin") throw new AiError(403, "Only administrators manage shared access.");
    const a = (await c.query("SELECT * FROM cc_shared_assessments WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!a) throw new AiError(404, "Assessment not found.");
    const target = (await c.query("SELECT * FROM cc_accounts WHERE id=$1 AND active FOR SHARE", [body.userId])).rows[0];
    if (!target) throw new AiError(400, "Select an active account.");
    if (body.access === "edit" && !["Admin", "Developer"].includes(target.role) || body.access === "review" && !["Admin", "Reviewer"].includes(target.role)) throw new AiError(400, "Access must match the account role.");
    if (body.access) await c.query("INSERT INTO cc_assessment_members VALUES($1,$2,$3) ON CONFLICT(assessment_id,user_id) DO UPDATE SET access=excluded.access", [id, body.userId, body.access]);
    else await c.query("DELETE FROM cc_assessment_members WHERE assessment_id=$1 AND user_id=$2", [id, body.userId]);
    await c.query("INSERT INTO cc_assessment_events(assessment_id,actor_id,action,comment) VALUES($1,$2,'membership',$3)", [id, user.id, `${body.userId}: ${body.access ?? "removed"}`]);
  });
  res.json({ ok: true });
}));
collaborationRouter.get("/:id", wrap(async (req, res) => {
  res.json(await transaction(async c => {
    const { assessment } = await access(c, req.identity!, uuid(req.params.id));
    return { assessment,
      entities: (await c.query("SELECT * FROM cc_assessment_entities WHERE assessment_id=$1 ORDER BY kind,name", [assessment.id])).rows,
      members: (await c.query("SELECT m.user_id,m.access,a.username,a.role FROM cc_assessment_members m JOIN cc_accounts a ON a.id=m.user_id WHERE assessment_id=$1", [assessment.id])).rows,
      events: (await c.query("SELECT e.*,a.username FROM cc_assessment_events e JOIN cc_accounts a ON a.id=e.actor_id WHERE assessment_id=$1 ORDER BY id DESC LIMIT 500", [assessment.id])).rows,
    };
  }));
}));
collaborationRouter.put("/entities/:id", wrap(async (req, res) => {
  const body = z.object({ expectedVersion: z.number().int().positive(), content: contentSchema }).strict().parse(req.body);
  res.json({ entity: await save(req.identity!, uuid(req.params.id), body.expectedVersion, body.content) });
}));
collaborationRouter.post("/entities/:id/actions", requestLimit("review-actions", 20, true), wrap(async (req, res) => {
  const body = z.object({ expectedVersion: z.number().int().positive(), action: z.enum(["submit", "approve", "request-changes"]), comment: z.string().max(20_000).default(""), requestId: z.string().uuid() }).strict().parse(req.body);
  res.json({ entity: await action(req.identity!, uuid(req.params.id), body) });
}));
collaborationRouter.put("/entities/:id/reviewer", wrap(async (req, res) => {
  const body = z.object({ expectedVersion: z.number().int().positive(), reviewerId: z.string().min(1).max(200) }).strict().parse(req.body);
  res.json(await transaction(async c => {
    const { row, user } = await entity(c, req.identity!, uuid(req.params.id));
    if (user.role !== "Admin") throw new AiError(403, "Only administrators assign reviewers.");
    expected(row, body.expectedVersion);
    if (row.reviewer_id === body.reviewerId) return { entity: row };
    const reviewer = (await c.query(`SELECT a.* FROM cc_accounts a JOIN cc_assessment_members m ON a.id=m.user_id
      WHERE m.assessment_id=$1 AND m.user_id=$2 AND m.access='review' AND a.active FOR SHARE OF a,m`, [row.assessment_id, body.reviewerId])).rows[0];
    if (!reviewer || !["Reviewer", "Admin"].includes(reviewer.role) || body.reviewerId === row.submitter_id) throw new AiError(400, "Select a separate active reviewer member.");
    const updated = (await c.query("UPDATE cc_assessment_entities SET reviewer_id=$2,version=version+1,state=CASE WHEN state='Approved' THEN 'Draft' ELSE state END,updated_at=now() WHERE id=$1 RETURNING *", [row.id, body.reviewerId])).rows[0];
    await revision(c, req.identity!, updated, "review assignment");
    await event(c, req.identity!, updated, "reviewer assigned");
    return { entity: updated };
  }));
}));
