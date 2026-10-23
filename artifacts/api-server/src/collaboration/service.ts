import { createHash, randomUUID } from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";
import type { Identity } from "../auth/middleware";
import { publicUser } from "../auth/service";
import { AiError } from "../assessment-ai";
import { contentSchema, transition, type Content } from "./contract";
import { readObject, removeObject } from "../knowledge/storage";
import { processWord } from "../reports/process";
import { reportModel } from "./reports";
import { storePrivate } from "./files";

type Database = Pick<PoolClient, "query">;
export async function transaction<T>(fn: (c: PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const result = await fn(c); await c.query("COMMIT"); return result; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}
export async function current(c: Database, identity: Identity) {
  // Lock account/session against permission revocation for the duration of writes.
  const r = (await c.query(`SELECT a.* FROM cc_accounts a JOIN cc_account_sessions s ON s.user_id=a.id
    WHERE a.id=$1 AND s.token_hash=$2 AND s.expires_at>now() AND a.active AND NOT a.must_change_password
    FOR SHARE OF a,s`, [identity.user.id, identity.tokenHash])).rows[0];
  if (!r) throw new AiError(403, "Your account or session changed. Sign in again.");
  const user = publicUser(r);
  if (!user.permissions.includes("view")) throw new AiError(403, "Assessment access is disabled.");
  return user;
}
export async function access(c: Database, identity: Identity, assessmentId: string) {
  const user = await current(c, identity);
  // All members, including administrators, need explicit access to content.
  const a = (await c.query(`SELECT a.*,m.access FROM cc_shared_assessments a
    JOIN cc_assessment_members m ON m.assessment_id=a.id WHERE a.id=$1 AND m.user_id=$2
    FOR SHARE OF a,m`, [assessmentId, user.id])).rows[0];
  if (!a) throw new AiError(404, "Shared assessment not found or access removed.");
  return { user, assessment: a };
}
export async function entity(c: Database, identity: Identity, id: string) {
  const row = (await c.query("SELECT * FROM cc_assessment_entities WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (!row) throw new AiError(404, "Assessment item not found.");
  return { row, ...await access(c, identity, row.assessment_id) };
}
export function expected(row: any, version: number) {
  if (row.version !== version) throw new AiError(409, "This item changed. Keep your draft, reload the latest revision and compare before saving.");
}
export function editable(user: any, assessment: any, row: any) {
  const developer = assessment.access === "edit" && ["Developer", "Admin"].includes(user.role) && user.permissions.includes("classify");
  const reviewer = assessment.access === "review" && ["Reviewer", "Admin"].includes(user.role) && row.reviewer_id === user.id && row.state === "Submitted";
  if (!developer && !reviewer) throw new AiError(403, "Editing requires an authorized editor or the assigned reviewer.");
  return { developer, reviewer };
}
export async function event(c: Database, identity: Identity, row: any, action: string, comment = "") {
  // Snapshot only the recipient, never source/content. Delivery is independent of this save.
  const recipient = action === "request-changes" ? row.submitter_id
    : action === "submit" || action === "reviewer assigned" ? row.reviewer_id : null;
  await c.query("INSERT INTO cc_assessment_events(assessment_id,entity_id,actor_id,action,version,comment,recipient_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [row.assessment_id, row.id, identity.user.id, action, row.version, comment, recipient]);
}
export async function revision(c: Database, identity: Identity, row: any, origin: string) {
  await c.query("INSERT INTO cc_assessment_revisions(entity_id,version,content,sources,actor_id,origin) VALUES($1,$2,$3,$4,$5,$6)",
    [row.id, row.version, JSON.stringify(row.content), JSON.stringify(row.sources), identity.user.id, origin]);
}
export async function save(identity: Identity, id: string, version: number, content: Content) {
  return transaction(async c => {
    const { row, user, assessment } = await entity(c, identity, id);
    expected(row, version);
    const { reviewer } = editable(user, assessment, row);
    const parsed = contentSchema.parse(content);
    if (reviewer && Object.keys(parsed).some(k => k !== "narrative" && JSON.stringify((parsed as any)[k]) !== JSON.stringify(row.content[k]))) {
      throw new AiError(403, "Reviewers can edit the narrative; request changes for other assessment fields.");
    }
    const updated = (await c.query(`UPDATE cc_assessment_entities SET content=$2,version=version+1,
      state=$3,updated_at=now() WHERE id=$1 RETURNING *`,
    [id, JSON.stringify(parsed), reviewer ? "Submitted" : "Draft"])).rows[0];
    await revision(c, identity, updated, reviewer ? "reviewer narrative" : "manual override");
    await event(c, identity, updated, "edited");
    return updated;
  });
}
export async function action(identity: Identity, id: string, body: { expectedVersion: number; action: string; comment: string; requestId: string }) {
  let reportPath: string | undefined;
  try { return await transaction(async c => {
    const { row, user, assessment } = await entity(c, identity, id);
    if (body.action === "submit") {
      if (assessment.access !== "edit" || !["Admin", "Developer"].includes(user.role) || !user.permissions.includes("classify")) throw new AiError(403, "Only authorized developers can submit.");
    } else if (assessment.access !== "review" || !["Reviewer", "Admin"].includes(user.role)) throw new AiError(403, "Reviewer access required.");
    const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const previous = (await c.query("SELECT * FROM cc_assessment_actions WHERE entity_id=$1 AND actor_id=$2 AND request_id=$3", [id, user.id, body.requestId])).rows[0];
    if (previous) {
      if (previous.request_hash !== hash) throw new AiError(409, "This request identifier was already used for a different action.");
      return previous.result;
    }
    expected(row, body.expectedVersion);
    if (body.action === "submit") {
      if (!row.content.classification || !row.content.classificationExplanation.trim()) throw new AiError(400, "Add a classification and explanation before submitting.");
      const assigned = (await c.query(`SELECT a.* FROM cc_accounts a JOIN cc_assessment_members m ON m.user_id=a.id
        WHERE m.assessment_id=$1 AND a.id=$2 AND m.access='review' AND a.active FOR SHARE OF a,m`, [row.assessment_id, row.reviewer_id])).rows[0];
      if (!assigned || !["Reviewer", "Admin"].includes(assigned.role) || !publicUser(assigned).permissions.includes("view")) throw new AiError(409, "Assign an active authorized reviewer.");
    }
    let state: string;
    try { state = transition(row.state, body.action, user.id, row.submitter_id, row.reviewer_id); }
    catch (e) { throw new AiError(409, (e as Error).message); }
    if (state === "Changes requested" && !body.comment.trim()) throw new AiError(400, "Explain the requested changes.");
    const updated = (await c.query(`UPDATE cc_assessment_entities SET state=$2,submitter_id=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [id, state, body.action === "submit" ? user.id : row.submitter_id])).rows[0];
    await revision(c, identity, updated, body.action);
    await event(c, identity, updated, body.action, body.comment);
    if (state === "Approved") {
      const template = (await c.query(`SELECT t.id,t.version,v.object_path FROM cc_company_templates t
        JOIN cc_company_template_versions v ON v.template_id=t.id AND v.version=t.version
        WHERE t.active AND t.previewed FOR SHARE OF t`, [])).rows[0];
      if (!template) throw new AiError(409, "An administrator must preview and select a company DOCX default before approval.");
      const snapshot = { ...updated, system: assessment.system, targetRelease: assessment.target_release,
        approvedBy: user.username, approvedAt: new Date().toISOString() };
      const report = await processWord({ mode: "render", bytes: (await readObject(template.object_path)).toString("base64"), entities: [reportModel(snapshot)] });
      reportPath = await storePrivate("approved-reports", report);
      await c.query(`INSERT INTO cc_assessment_approvals(id,entity_id,version,approver_id,snapshot,template_id,template_version,template_path,report_path)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), id, updated.version, user.id, JSON.stringify(snapshot),
        template.id, template.version, template.object_path, reportPath]);
    }
    await c.query("INSERT INTO cc_assessment_actions(entity_id,actor_id,request_id,request_hash,result) VALUES($1,$2,$3,$4,$5)",
      [id, user.id, body.requestId, hash, JSON.stringify(updated)]);
    return updated;
  }); } catch (e) { if (reportPath) await removeObject(reportPath).catch(() => undefined); throw e; }
}
