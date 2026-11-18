import { randomUUID } from "node:crypto";
import { pool, projectDatabaseScope, type PoolClient } from "@workspace/db";
import { PreviewProjectSourceImportBody } from "@workspace/api-zod";
import type { Identity } from "../auth/middleware";
import { AiError } from "../assessment-ai";
import { logger } from "../lib/logger";
import { access, current, transaction } from "./service";
import { files } from "./github";
import { githubEditor, savedGithubConfig } from "./github-store";
import { normalizeRepository } from "./github-credentials";
import { mapGithubSources, sameGithubSources } from "./source-mapping";
import { bulkMatch } from "./project-source-match";

export const IMPORT_LIMIT = 200;
const MAX_DURATION = 10 * 60_000;
const LEASE = 120_000;
type Entry = {
  id: string; assessmentId: string; assessmentName: string; name: string; kind: string; version: number;
  state: string; paths: string[]; status: "ready" | "deferred" | "ambiguous" | "unmatched" | "unchanged" | "imported" | "failed" | "cancelled";
  message: string;
};
type Job = {
  id: string; user_id: string; repository: string; ref: string; folder: string; commit: string;
  credential_version: string; listing: Awaited<ReturnType<typeof files>>; entries: Entry[];
  status: "preview" | "running" | "completed" | "cancelled" | "interrupted";
  message: string; created_at: Date; heartbeat_at: Date;
};
const output = (job: Job) => ({
  id: job.id, repository: job.repository, ref: job.ref, folder: job.folder, commit: job.commit,
  entries: job.entries.map(e => e.status === "ready" && ["interrupted", "cancelled"].includes(job.status)
    ? { ...e, status: "cancelled" as const, message: "Not processed. Create a new preview to continue." } : e),
  status: job.status, message: job.message, createdAt: job.created_at.toISOString(), limit: IMPORT_LIMIT,
});
const active = new Set<string>();
const key = (id: string) => `${projectDatabaseScope()?.projectId ?? "legacy"}:${id}`;
const scopeRequired = () => {
  if (!projectDatabaseScope()) throw new AiError(400, "Select a project before importing source.");
};
async function authorize(c: PoolClient, identity: Identity, job: Job, write = false) {
  if (job.user_id !== String(identity.user.id)) throw new AiError(404, "Source import not found.");
  await current(c, identity);
  if (write) await githubEditor(identity, c);
  for (const assessmentId of new Set(job.entries.map(e => e.assessmentId))) {
    const { user, assessment } = await access(c, identity, assessmentId);
    if (write && (assessment.access !== "edit" || !["Admin", "Developer"].includes(user.role) || !user.permissions.includes("classify")))
      throw new AiError(403, "Assessment edit and classification permissions are required.");
  }
}
async function load(c: PoolClient, identity: Identity, id: string, write = false): Promise<Job> {
  scopeRequired();
  // Lock only this account's job; the search path is already the verified project namespace.
  const job = (await c.query<Job>("SELECT * FROM cc_github_imports WHERE id=$1 AND user_id=$2 FOR UPDATE", [id, identity.user.id])).rows[0];
  if (!job) throw new AiError(404, "Source import not found.");
  await authorize(c, identity, job, write);
  if (job.status === "running" && Date.now() - job.heartbeat_at.getTime() > LEASE) {
    job.status = "interrupted";
    job.message = "Import stopped responding. Saved snapshots were retained; create a new preview to continue safely.";
    await c.query("UPDATE cc_github_imports SET status=$2,message=$3 WHERE id=$1", [id, job.status, job.message]);
  }
  return job;
}
export async function previewSourceImport(identity: Identity, input: unknown, request: typeof fetch = fetch) {
  scopeRequired();
  const body = PreviewProjectSourceImportBody.strict().parse(input);
  const repository = normalizeRepository(body.repository);
  const ref = body.ref.trim();
  const folder = body.folder.trim().replace(/^\/+|\/+$/g, "");
  if (!ref || folder.split("/").some(p => p === "." || p === "..") || /[\\\0]/.test(folder))
    throw new AiError(400, "Use a repository-relative folder without traversal segments.");
  const config = await savedGithubConfig(identity, repository);
  const listing = await files(repository, ref, config, request, true);
  const selected = listing.files.filter(f => !folder || f.path.startsWith(`${folder}/`));
  if (folder && !selected.length) throw new AiError(404, "No supported source files were found inside this folder.");
  return transaction(async c => {
    const user = await githubEditor(identity, c);
    if (!user.permissions.includes("classify")) throw new AiError(403, "Classification permission is required to import source.");
    const latest = await savedGithubConfig(identity, repository, c);
    if (latest.credentialVersion !== config.credentialVersion) throw new AiError(409, "Connection changed. Preview again.");
    const rows = (await c.query(`SELECT e.*,a.name AS assessment_name FROM cc_assessment_entities e
      JOIN cc_shared_assessments a ON a.id=e.assessment_id JOIN cc_assessment_members m ON m.assessment_id=a.id
      WHERE m.user_id=$1 AND m.access='edit' ORDER BY a.id,e.id LIMIT 5001`, [user.id])).rows;
    if (rows.length > 5000) throw new AiError(413, "This project exceeds the 5,000 record preview limit. Use individual assessment mapping.");
    if (!rows.length) throw new AiError(400, "No editable shared assessment records in this project. Share your assessment first.");
    let ready = 0;
    const entries: Entry[] = rows.map(row => {
      const evidence = row.evidence?.snapshot ?? row.evidence ?? {};
      const technicalName = typeof evidence.objectName === "string" && evidence.objectName.trim() ? evidence.objectName : row.name;
      const match = bulkMatch(selected, technicalName, evidence.objectType ?? evidence.type ?? evidence.repositoryObjectType);
      let status: Entry["status"] = match.status;
      let message = match.message;
      if (status === "ready" && sameGithubSources(row.sources, repository, listing.commit, match.paths)) {
        status = "unchanged"; message = "Already saved at this commit; no new revision needed.";
      } else if (status === "ready" && ++ready > IMPORT_LIMIT) {
        status = "deferred"; message = "Run limit reached. Create another preview after this run.";
      }
      return { id: row.id, assessmentId: row.assessment_id, assessmentName: row.assessment_name,
        name: row.name, kind: row.kind, version: row.version, state: row.state, paths: match.paths, status, message };
    });
    const id = randomUUID();
    const job = (await c.query<Job>(`INSERT INTO cc_github_imports
      (id,user_id,repository,ref,folder,commit,credential_version,listing,entries) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, user.id, repository, ref, folder, listing.commit, config.credentialVersion, JSON.stringify({ ...listing, files: selected }), JSON.stringify(entries)])).rows[0];
    return output(job);
  });
}
export async function getSourceImport(identity: Identity, id: string) {
  return transaction(async c => output(await load(c, identity, id)));
}
export async function listSourceImports(identity: Identity) {
  scopeRequired();
  return transaction(async c => {
    await current(c, identity);
    const ids = (await c.query("SELECT id FROM cc_github_imports WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10", [identity.user.id])).rows;
    const results = [];
    for (const { id } of ids) {
      try { results.push(output(await load(c, identity, id))); }
      catch (e) { if (!(e instanceof AiError) || ![403, 404].includes(e.status)) throw e; }
    }
    return results;
  });
}
export async function cancelSourceImport(identity: Identity, id: string) {
  return transaction(async c => {
    const job = await load(c, identity, id, true);
    if (["preview", "running"].includes(job.status)) {
      job.status = "cancelled";
      job.message = "Cancelled. Already committed source snapshots were retained.";
      // Do not replace worker entry progress from a stale copy: the worker saves individual entries under the same lock.
      job.entries = job.entries.map(e => e.status === "ready" ? { ...e, status: "cancelled", message: "Cancelled before saving." } : e);
      await c.query("UPDATE cc_github_imports SET status=$2,message=$3,entries=$4 WHERE id=$1",
        [id, job.status, job.message, JSON.stringify(job.entries)]);
    }
    return output(job);
  });
}
export async function startSourceImport(identity: Identity, id: string, request: typeof fetch = fetch) {
  const result = await transaction(async c => {
    // Serialize admission within a project; process cap also bounds imports across projects.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended(current_schema(),125))");
    const job = await load(c, identity, id, true);
    if (job.status !== "preview") return { job, start: false };
    if (Date.now() - job.created_at.getTime() > 30 * 60_000) throw new AiError(409, "Preview expired. Create a new preview.");
    if (!job.entries.some(e => e.status === "ready")) throw new AiError(400, "No unambiguous new source matches to import.");
    const config = await savedGithubConfig(identity, job.repository, c);
    if (config.credentialVersion !== job.credential_version) throw new AiError(409, "GitHub connection changed. Preview again.");
    const running = await c.query("SELECT id FROM cc_github_imports WHERE status='running' AND heartbeat_at>now()-interval '120 seconds'");
    if (running.rowCount! >= 2 || active.size >= 2) throw new AiError(429, "Two imports are already active. Retry after one finishes.");
    const own = await c.query("SELECT id FROM cc_github_imports WHERE user_id=$1 AND status='running' AND heartbeat_at>now()-interval '120 seconds'", [identity.user.id]);
    if (own.rowCount) throw new AiError(409, "You already have an active import in this project.");
    job.status = "running";
    await c.query("UPDATE cc_github_imports SET status='running',heartbeat_at=now() WHERE id=$1", [id]);
    return { job, start: true };
  });
  if (result.start) {
    active.add(key(id));
    // AsyncLocalStorage propagates the verified project scope to this background task.
    // Only the starting session can read GitHub; no credentials are written into a job.
    void runSourceImport(identity, result.job, request).catch(error => {
      logger.error({ importId: id, errorType: error instanceof Error ? error.name : "unknown" }, "Source import interrupted");
    }).finally(() => active.delete(key(id)));
  }
  return output(result.job);
}

async function runSourceImport(identity: Identity, job: Job, request: typeof fetch) {
  const started = Date.now();
  // Immutable commit/tree reads are reused, never blob bodies or credentials.
  const treeCache = new Map<string, string>();
  const boundedRequest: typeof fetch = async (url, init) => {
    if (Date.now() - started > MAX_DURATION) throw new AiError(409, "Import time limit reached. Preview again to continue.");
    await pool.query("UPDATE cc_github_imports SET heartbeat_at=now() WHERE id=$1 AND status='running'", [job.id]);
    const path = String(url);
    const cacheable = path.includes("/commits/") || path.includes("/git/trees/");
    if (cacheable && treeCache.has(path)) return new Response(treeCache.get(path), { headers: { "Content-Type": "application/json" } });
    const response = await request(url, init);
    if (cacheable && response.ok) {
      // files() enforces a 2 MB response budget; do not read unbounded data in this cache.
      const reader = response.body?.getReader();
      if (!reader) throw new AiError(503, "Empty repository listing.");
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.length;
        if (size > 2_000_000) { await reader.cancel(); throw new AiError(413, "Repository listing exceeds 2 MB."); }
        chunks.push(chunk.value);
      }
      const text = Buffer.concat(chunks).toString("utf8");
      treeCache.set(path, text);
      return new Response(text, { headers: { "Content-Type": "application/json" } });
    }
    return response;
  };
  const ensureRunning = async (c: PoolClient) => {
    // Same row lock as cancellation. Cancellation never allows an in-flight object to publish afterward.
    const latest = (await c.query<Job>("SELECT * FROM cc_github_imports WHERE id=$1 FOR UPDATE", [job.id])).rows[0];
    if (latest?.status !== "running" || Date.now() - started > MAX_DURATION) throw new AiError(409, "Import stopped before this record was saved.");
    const config = await savedGithubConfig(identity, job.repository, c);
    if (config.credentialVersion !== job.credential_version) throw new AiError(409, "GitHub connection changed. Create a new preview.");
  };
  try {
    for (const entry of job.entries.filter(e => e.status === "ready")) {
      const canContinue = await transaction(async c => {
        const latest = await load(c, identity, job.id, true);
        if (latest.status !== "running") return false;
        await ensureRunning(c);
        return true;
      });
      if (!canContinue) return;
      let outcome: Entry;
      try {
        const result = await mapGithubSources(identity, entry.id, {
          repository: job.repository, commit: job.commit, paths: entry.paths, expectedVersion: entry.version,
        }, boundedRequest, ensureRunning);
        outcome = { ...entry, version: result.entity.version, state: result.entity.state,
          status: result.entity.version === entry.version ? "unchanged" : "imported",
          message: result.entity.version === entry.version ? "Already saved; no revision added." : `Saved version ${result.entity.version} as Draft. Narrative and classification unchanged.` };
      } catch (error) {
        outcome = { ...entry, status: "failed", message: error instanceof AiError ? error.message : "Source could not be saved. Existing record was retained." };
      }
      await transaction(async c => {
        const latest = (await c.query<Job>("SELECT * FROM cc_github_imports WHERE id=$1 FOR UPDATE", [job.id])).rows[0];
        if (!latest) return;
        // Even if cancellation just won the lock, report a committed object's true result.
        latest.entries = latest.entries.map(e => e.id === entry.id ? outcome : e);
        await c.query("UPDATE cc_github_imports SET entries=$2,heartbeat_at=now() WHERE id=$1", [job.id, JSON.stringify(latest.entries)]);
      });
    }
    await pool.query("UPDATE cc_github_imports SET status='completed',message='Finished. Review per-record outcomes; create a new preview for deferred or failed records.',heartbeat_at=now() WHERE id=$1 AND status='running'", [job.id]);
  } catch {
    await pool.query(`UPDATE cc_github_imports SET status='interrupted',
      message='Import interrupted by a time limit, access change or storage failure. Saved snapshots were retained. Create a new preview to continue.',
      heartbeat_at=now() WHERE id=$1 AND status='running'`, [job.id]);
  }
}
