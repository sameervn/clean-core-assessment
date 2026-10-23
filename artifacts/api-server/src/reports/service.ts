import { randomUUID } from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";
import { publicUser } from "../auth/service";
import type { Identity } from "../auth/middleware";
import type { Permission } from "../auth/permissions";
import { AiError } from "../assessment-ai";
import { uploadUrl, readObject, saveSealed, removeObject, storageConfigured } from "../knowledge/storage";
import { processWord } from "./process";

// Deliberately separate metadata, lock, object namespace, and deletion criteria from knowledge.
function path(id: string) {
  if (!storageConfigured()) throw new AiError(503, "Private template storage is not configured. Ask your administrator to configure PRIVATE_OBJECT_DIR.");
  return `${process.env.PRIVATE_OBJECT_DIR!.replace(/\/$/, "")}/report-templates/${id}`;
}
export async function fresh(identity: Identity, permission: Permission, c: Pick<PoolClient, "query"> = pool) {
  const row = (await c.query(`SELECT a.* FROM cc_accounts a JOIN cc_account_sessions s ON a.id=s.user_id
    WHERE s.token_hash=$1 AND a.id=$2 AND s.expires_at>now() AND a.active AND NOT a.must_change_password`,
  [identity.tokenHash, identity.user.id])).rows[0];
  if (!row || !publicUser(row).permissions.includes(permission)) throw new AiError(403, `Permission required: ${permission}.`);
}
export async function owned(c: Pick<PoolClient, "query">, identity: Identity, id: string) {
  const row = (await c.query("SELECT * FROM cc_report_templates WHERE id=$1 AND owner_id=$2", [id, identity.user.id])).rows[0];
  if (!row) throw new AiError(404, "Personal template not found. Refresh the template list.");
  return row;
}
export async function locked<T>(identity: Identity, permission: Permission, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,79))", [identity.user.id]);
    await fresh(identity, permission, c);
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
export const view = (r: any) => ({ id: r.id, name: r.name, version: r.version, active: r.active, previewed: r.previewed });
export function version(row: any, expected: number | undefined) {
  if (row.version !== expected) throw new AiError(409, "Template changed. Refresh and preview the latest version.");
}
export async function startUpload(identity: Identity, body: { name: string; filename: string; replaceId?: string; expectedVersion?: number }) {
  const id = randomUUID(), objectPath = path(`${identity.user.id}/${id}-upload`);
  return locked(identity, "templates.manage", async c => {
    if (body.replaceId) version(await owned(c, identity, body.replaceId), body.expectedVersion);
    // Expired direct uploads are removed only after the signed write URL has expired.
    const expired = (await c.query("SELECT * FROM cc_report_templates WHERE owner_id=$1 AND status='pending' AND created_at<now()-interval '1 day'", [identity.user.id])).rows;
    for (const row of expired) {
      await removeObject(row.object_path);
      await c.query("DELETE FROM cc_report_templates WHERE id=$1", [row.id]);
    }
    const count = (await c.query("SELECT count(*) FROM cc_report_templates WHERE owner_id=$1", [identity.user.id])).rows[0].count;
    if (Number(count) >= 20) throw new AiError(409, "Personal template limit reached (20 including pending uploads). Delete unused templates or retry after expired uploads are removed.");
    const url = await uploadUrl(objectPath);
    await c.query("INSERT INTO cc_report_templates(id,owner_id,name,status,object_path,replace_id,expected_version) VALUES($1,$2,$3,'pending',$4,$5,$6)",
      [id, identity.user.id, body.name, objectPath, body.replaceId ?? null, body.expectedVersion ?? null]);
    return { id, uploadUrl: url };
  });
}
export async function finishUpload(identity: Identity, id: string, signal: AbortSignal) {
  const row = await owned(pool, identity, id);
  await fresh(identity, "templates.manage");
  if (row.status !== "pending") throw new AiError(409, "Upload already processed.");
  const bytes = await readObject(row.object_path);
  await processWord({ bytes: bytes.toString("base64"), mode: "validate" }, signal);
  const sealed = path(`${identity.user.id}/${randomUUID()}-sealed`);
  await saveSealed(sealed, bytes);
  try {
    return await locked(identity, "templates.manage", async c => {
      const pending = await owned(c, identity, id);
      if (pending.status !== "pending") throw new AiError(409, "Upload already processed.");
      let target = pending;
      if (pending.replace_id) {
        target = await owned(c, identity, pending.replace_id);
        version(target, pending.expected_version);
        // Replacement retains its identifier but requires another preview/activation.
      }
      const result = await c.query(`UPDATE cc_report_templates SET name=$2,status='ready',object_path=$3,
        version=$4,previewed=false,active=false,replace_id=NULL,expected_version=NULL WHERE id=$1 RETURNING *`,
      [target.id, pending.name, sealed, target.version + (pending.replace_id ? 1 : 0)]);
      if (pending.replace_id) await c.query("UPDATE cc_report_templates SET status='obsolete' WHERE id=$1", [pending.id]);
      // Staged/old files aren't served by any route. Queue retained paths for safe deletion.
      await c.query("INSERT INTO cc_report_template_garbage(object_path,delete_after) VALUES($1,now()+interval '10 minutes') ON CONFLICT DO NOTHING", [pending.object_path]);
      if (pending.replace_id) {
        await c.query("INSERT INTO cc_report_template_garbage(object_path,delete_after) VALUES($1,now()) ON CONFLICT DO NOTHING", [target.object_path]);
        await c.query("DELETE FROM cc_report_templates WHERE id=$1", [pending.id]);
      }
      return view(result.rows[0]);
    });
  } catch (e) { await removeObject(sealed).catch(() => undefined); throw e; }
}
export async function templateBytes(identity: Identity, id: string) {
  const company = (await pool.query(`SELECT t.*,v.object_path FROM cc_company_templates t
    JOIN cc_company_template_versions v ON v.template_id=t.id AND v.version=t.version WHERE t.id=$1`, [id])).rows[0];
  if (company) {
    await fresh(identity, "export");
    return { row: { ...company, company: true }, bytes: await readObject(company.object_path) };
  }
  const row = await owned(pool, identity, id);
  if (row.status !== "ready") throw new AiError(409, "Template is not validated. Upload and validate it first.");
  return { row, bytes: await readObject(row.object_path) };
}
export async function recheckTemplate(c: Pick<PoolClient, "query">, identity: Identity, row: any) {
  if (!row.company) return owned(c, identity, row.id);
  const current = (await c.query("SELECT * FROM cc_company_templates WHERE id=$1 FOR SHARE", [row.id])).rows[0];
  if (!current) throw new AiError(404, "Company template unavailable.");
  return current;
}
export async function cleanupReports() {
  const rows = (await pool.query("SELECT object_path FROM cc_report_template_garbage WHERE delete_after<now() LIMIT 50")).rows;
  for (const row of rows) {
    await removeObject(row.object_path);
    await pool.query("DELETE FROM cc_report_template_garbage WHERE object_path=$1", [row.object_path]);
  }
}
