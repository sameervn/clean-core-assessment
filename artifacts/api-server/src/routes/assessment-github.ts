import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireSession } from "../auth/middleware";
import { AiError } from "../assessment-ai";
import { analyzeSource, files, githubConfig, source } from "../collaboration/github";
import { current, editable, entity, event, expected, revision, transaction } from "../collaboration/service";
import { readObject, removeObject } from "../knowledge/storage";
import { storePrivate } from "../collaboration/files";
import { guidanceDisclosure } from "../knowledge/retrieval";

async function groundedProposal(sources: Array<{ path: string; code: string }>, identity: NonNullable<Express.Request["identity"]>) {
  const user = await current(pool, identity);
  if (!user.permissions.includes("knowledge.read")) throw new AiError(403, "Read knowledge permission is required for source evaluation.");
  // Read uploaded guidance first. Repository text never becomes SQL, commands or instructions.
  const references = (await pool.query(`SELECT d.id,d.title,d.version,d.release,c.section,c.text,
    CASE WHEN d.release='S4HANA_2025' THEN 'target-release' WHEN lower(d.release)='general' THEN 'general' ELSE 'other-release' END AS applicability
    FROM cc_knowledge_chunks c JOIN cc_knowledge d ON d.id=c.document_id
    WHERE d.status='ready' AND c.search @@ to_tsquery('english','released | table | write | contract | extension')
    ORDER BY CASE WHEN d.release='S4HANA_2025' THEN 0 WHEN lower(d.release)='general' THEN 1 ELSE 2 END,d.id,c.ordinal LIMIT 4`)).rows;
  const guidance = guidanceDisclosure(references as any, "knowledge-only");
  return { ...analyzeSource(sources), references, guidance: guidance.disclosure };
}

export const assessmentGithubRouter = Router();
assessmentGithubRouter.use(requireSession);
const wrap = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) { res.status(e instanceof AiError ? e.status : e instanceof z.ZodError ? 400 : 503).json({
    message: e instanceof AiError ? e.message : e instanceof z.ZodError ? "Invalid repository or source request." : "Source assessment unavailable. No draft was discarded.",
  }); }
};
async function connected(identity: NonNullable<Express.Request["identity"]>) {
  const config = githubConfig();
  if (!config) throw new AiError(503, "Administrator must configure a read-only GitHub token and approved repositories.");
  const user = await current(pool, identity);
  if (!["Admin", "Developer"].includes(user.role) || !user.permissions.includes("evidence")) throw new AiError(403, "Source ingestion requires Developer evidence permission.");
  const connection = await pool.query("SELECT user_id FROM cc_github_connections WHERE user_id=$1", [user.id]);
  if (!connection.rowCount) throw new AiError(409, "Connect the configured GitHub access first.");
  return config;
}
assessmentGithubRouter.get("/github/status", wrap(async (req, res) => {
  await current(pool, req.identity!);
  const config = githubConfig();
  res.json({ configured: !!config, connected: !!config && !!(await pool.query("SELECT user_id FROM cc_github_connections WHERE user_id=$1", [req.identity!.user.id])).rowCount, repositories: config?.repositories ?? [] });
}));
assessmentGithubRouter.post("/github/connect", wrap(async (req, res) => {
  const user = await current(pool, req.identity!);
  if (!["Admin", "Developer"].includes(user.role) || !user.permissions.includes("evidence")) throw new AiError(403, "Developer evidence permission required.");
  const config = githubConfig();
  if (!config) throw new AiError(503, "Administrator must configure a read-only GitHub token and approved repositories.");
  await pool.query("INSERT INTO cc_github_connections(user_id) VALUES($1) ON CONFLICT DO NOTHING", [user.id]);
  res.json({ configured: true, connected: true, repositories: config.repositories });
}));
assessmentGithubRouter.delete("/github/connect", wrap(async (req, res) => {
  await current(pool, req.identity!);
  await pool.query("DELETE FROM cc_github_connections WHERE user_id=$1", [req.identity!.user.id]);
  res.json({ connected: false });
}));
assessmentGithubRouter.get("/github/files", wrap(async (req, res) => {
  const query = z.object({ repository: z.string().max(200), ref: z.string().min(1).max(200) }).parse(req.query);
  res.json(await files(query.repository, query.ref, await connected(req.identity!)));
}));
assessmentGithubRouter.post("/entities/:id/source", wrap(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const body = z.object({ expectedVersion: z.number().int().positive(), repository: z.string().max(200),
    commit: z.string().regex(/^[0-9a-f]{40}$/), path: z.string().min(1).max(1000) }).strict().parse(req.body);
  const config = await connected(req.identity!);
  await transaction(async c => {
    const { row, user, assessment } = await entity(c, req.identity!, id);
    if (!editable(user, assessment, row).developer) throw new AiError(403, "Only an editor can map source.");
    expected(row, body.expectedVersion);
  });
  const fetched = await source(body.repository, body.commit, body.path, config);
  const proposal = await groundedProposal([{ path: body.path, code: fetched.code }], req.identity!);
  const objectPath = await storePrivate("source", fetched.bytes);
  try {
    const updated = await transaction(async c => {
      await connected(req.identity!); // permission/connection changes during fetch fail closed
      const { row, user, assessment } = await entity(c, req.identity!, id);
      if (!editable(user, assessment, row).developer) throw new AiError(403, "Only an editor can map source.");
      expected(row, body.expectedVersion);
      const sources = row.sources.filter((s: any) => s.repository !== body.repository || s.path !== body.path);
      if (sources.length >= 10) throw new AiError(400, "At most ten source files per item.");
      sources.push({ repository: body.repository, commit: body.commit, path: body.path, sha256: fetched.sha256, blob: fetched.blob, objectPath });
      const updated = (await c.query("UPDATE cc_assessment_entities SET sources=$2,version=version+1,state='Draft',updated_at=now() WHERE id=$1 RETURNING *", [id, JSON.stringify(sources)])).rows[0];
      await revision(c, req.identity!, updated, "GitHub source snapshot");
      await event(c, req.identity!, updated, "source mapped");
      return updated;
    });
    res.json({ entity: updated, proposal });
  } catch (e) { await removeObject(objectPath).catch(() => undefined); throw e; }
}));
assessmentGithubRouter.get("/entities/:id/source/:index", wrap(async (req, res) => {
  await transaction(async c => {
    const { row } = await entity(c, req.identity!, z.string().uuid().parse(req.params.id));
    const selected = row.sources[z.coerce.number().int().min(0).max(9).parse(req.params.index)];
    if (!selected) throw new AiError(404, "Source snapshot not found.");
    res.json({ source: selected, code: (await readObject(selected.objectPath)).toString("utf8") });
  });
}));
assessmentGithubRouter.post("/entities/:id/evaluate", wrap(async (req, res) => {
  const body = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
  await transaction(async c => {
    const { row } = await entity(c, req.identity!, z.string().uuid().parse(req.params.id));
    expected(row, body.expectedVersion);
    if (!row.sources.length) throw new AiError(400, "Map source files before evaluation.");
    const sources = await Promise.all(row.sources.map(async (s: any) => ({ path: s.path, code: (await readObject(s.objectPath)).toString("utf8") })));
    res.json({ proposal: await groundedProposal(sources, req.identity!) });
  });
}));
