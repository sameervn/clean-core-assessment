import { randomUUID } from "node:crypto";
import { pool, type PoolClient } from "@workspace/db";
import { AiError } from "../assessment-ai";
import { publicUser, type DbUser } from "../auth/service";
import { objectPath, uploadUrl, readObject, saveSealed, removeObject } from "./storage";
import { parseDocument } from "./parser";
import type { Identity } from "../auth/middleware";

export const LIBRARY_LOCK = 614072;
export function documentView(row: any) {
  return { id: row.id, ownerId: row.owner_id, title: row.title, release: row.release, topics: row.topics,
    filename: row.filename, version: row.version, status: row.status, error: row.error, createdAt: new Date(row.created_at).toISOString() };
}
export function canManage(user: Identity["user"], row: any) {
  return user.permissions.includes("knowledge.manage-all") || (user.permissions.includes("knowledge.upload") && String(user.id) === row.owner_id);
}
export async function freshUser(identity: Identity, client: Pick<PoolClient, "query"> = pool) {
  const result = await client.query(`SELECT a.* FROM cc_accounts a JOIN cc_account_sessions s ON s.user_id=a.id
    WHERE a.id=$1 AND s.token_hash=$2 AND s.expires_at>now() AND a.active=true AND a.must_change_password=false`, [identity.user.id, identity.tokenHash]);
  if (!result.rows[0]) throw new AiError(401, "Session expired. Sign in again.");
  return publicUser(result.rows[0] as DbUser);
}
export async function libraryTransaction<T>(fn: (client: PoolClient) => Promise<T>, shared = false) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(shared ? "SELECT pg_advisory_xact_lock_shared($1)" : "SELECT pg_advisory_xact_lock($1)", [LIBRARY_LOCK]);
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (error) { await c.query("ROLLBACK"); throw error; }
  finally { c.release(); }
}
export const libraryReadTransaction = <T>(fn: (client: PoolClient) => Promise<T>) => libraryTransaction(fn, true);
export async function findDocument(id: string, c: Pick<PoolClient, "query"> = pool) {
  const row = (await c.query("SELECT * FROM cc_knowledge WHERE id=$1 AND status<>'deleted'", [id])).rows[0];
  if (!row) throw new AiError(404, "Document is no longer available.");
  return row;
}
export async function startUpload(identity: Identity, input: any) {
  const id = randomUUID(), path = objectPath(id);
  const url = await uploadUrl(path);
  await libraryTransaction(async c => {
    const user = await freshUser(identity, c);
    if (!user.permissions.includes("knowledge.upload") || !user.permissions.includes("knowledge.read")) throw new AiError(403, "Knowledge upload and read permissions required.");
    if (input.replaceId) {
      const row = await findDocument(input.replaceId, c);
      if (!canManage(user, row)) throw new AiError(403, "You cannot replace this document.");
      if (row.version !== input.expectedVersion) throw new AiError(409, "Document changed. Refresh before replacing.");
    }
    const count = await c.query("SELECT count(*) FROM cc_knowledge WHERE status<>'deleted'");
    if (Number(count.rows[0].count) >= 500) throw new AiError(409, "Library limit reached (500 documents including pending uploads). Remove unused entries.");
    await c.query(`INSERT INTO cc_knowledge(id,owner_id,title,release,topics,filename,status,object_path,replace_id,expected_version,size)
      VALUES($1,$2,$3,$4,$5,$6,'awaiting-upload',$7,$8,$9,$10)`,
    [id, String(user.id), input.title, input.release, JSON.stringify(input.topics), input.filename, path, input.replaceId ?? null, input.expectedVersion ?? null, input.size]);
  });
  return { id, uploadUrl: url };
}
let activeParsers = 0;
export async function processUpload(identity: Identity, id: string) {
  if (activeParsers >= 2) throw new AiError(429, "Two documents are being processed. Retry shortly.");
  activeParsers++;
  let sealed: string | undefined;
  try {
    const row = await libraryTransaction(async c => {
      const user = await freshUser(identity, c), row = await findDocument(id, c);
      if (!canManage(user, row) || !user.permissions.includes("knowledge.read")) throw new AiError(403, "Document management permission required.");
      if (row.status !== "awaiting-upload" && row.status !== "failed") throw new AiError(409, "This upload is already processed or processing.");
      await c.query("UPDATE cc_knowledge SET status='processing',error=NULL,updated_at=now() WHERE id=$1", [id]);
      return row;
    });
    try {
      const bytes = await readObject(row.object_path);
      if (bytes.length !== row.size) throw new AiError(400, "Uploaded file size does not match registration.");
      const passages = await parseDocument(bytes, row.filename);
      sealed = objectPath(randomUUID()) + "-sealed";
      let previous: string | undefined;
      const result = await libraryTransaction(async c => {
        const user = await freshUser(identity, c);
        const pending = await findDocument(id, c);
        if (pending.status !== "processing" || !canManage(user, pending) || !user.permissions.includes("knowledge.read")) throw new AiError(403, "Upload authorization changed.");
        // Creation and adoption share cleanup's lock: no unreferenced in-flight sealed object.
        await saveSealed(sealed!, bytes);
        let target = pending;
        if (row.replace_id) {
          target = await findDocument(row.replace_id, c);
          if (!canManage(user, target)) throw new AiError(403, "Replacement permission revoked.");
          if (target.version !== row.expected_version) throw new AiError(409, "Document changed during upload. Upload the replacement again.");
          previous = target.object_path;
          await c.query("DELETE FROM cc_knowledge_chunks WHERE document_id=$1", [target.id]);
          await c.query("UPDATE cc_knowledge SET status='deleted',object_path=NULL WHERE id=$1", [id]);
        }
        await c.query(`UPDATE cc_knowledge SET title=$2,release=$3,topics=$4,filename=$5,version=$6,status='ready',error=NULL,object_path=$7,size=$8,updated_at=now() WHERE id=$1`,
          [target.id, row.title, row.release, JSON.stringify(row.topics), row.filename, row.replace_id ? target.version + 1 : target.version, sealed, row.size]);
        for (const [i, p] of passages.entries()) await c.query("INSERT INTO cc_knowledge_chunks(document_id,ordinal,section,text) VALUES($1,$2,$3,$4)", [target.id, i, p.section, p.text]);
        await c.query("UPDATE cc_knowledge_epoch SET revision=revision+1");
        return documentView(await findDocument(target.id, c));
      });
      sealed = undefined; // now owned by committed record
      // Deleted/replaced bytes never have a serving endpoint, even if object cleanup fails.
      await Promise.all([row.object_path, previous].filter(Boolean).map(p => removeObject(p).catch(() => undefined)));
      return result;
    } catch (error) {
      await pool.query("UPDATE cc_knowledge SET status='failed',error=$2,updated_at=now() WHERE id=$1 AND status='processing'",
        [id, error instanceof AiError ? error.message : "Document storage or parser failed. Check private storage configuration, then retry."]);
      throw error;
    }
  } finally {
    activeParsers--;
    if (sealed) await removeObject(sealed).catch(() => undefined);
  }
}
export async function deleteDocument(identity: Identity, id: string, version: number) {
  const path = await libraryTransaction(async c => {
    const user = await freshUser(identity, c), row = await findDocument(id, c);
    if (!canManage(user, row)) throw new AiError(403, "You cannot remove another user's document.");
    if (row.version !== version) throw new AiError(409, "Document changed. Refresh before removing.");
    await c.query("DELETE FROM cc_knowledge_chunks WHERE document_id=$1", [id]);
    await c.query("UPDATE cc_knowledge SET status='deleted',object_path=NULL,error=NULL,version=version+1,updated_at=now() WHERE id=$1", [id]);
    await c.query("UPDATE cc_knowledge_epoch SET revision=revision+1");
    return row.object_path;
  });
  if (path) await removeObject(path).catch(() => undefined);
}
