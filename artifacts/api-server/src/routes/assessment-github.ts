import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { requestLimitOptions, requestLimitFailure } from "../request-limits";
import { z } from "zod";
import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { CheckSharedGithubBody, CheckSharedGithubResponse, ConnectSharedGithubBody, SharedGithubStatusResponse,
  StartProjectSourceImportBody, GetProjectSourceImportResponse, ListProjectSourceImportsResponse } from "@workspace/api-zod";
import { requireSession } from "../auth/middleware";
import { AiError } from "../assessment-ai";
import { analyzeSource, checkGithubRepository, files } from "../collaboration/github";
import { githubConnectionInput, normalizeRepository } from "../collaboration/github-credentials";
import { githubConnectionStatus, saveGithubConnection, savedGithubConfig } from "../collaboration/github-store";
import { current, entity, expected, transaction } from "../collaboration/service";
import { readObject } from "../knowledge/storage";
import { mapGithubSources } from "../collaboration/source-mapping";
import { uploadSourceFile } from "../collaboration/source-upload";
import { guidanceDisclosure } from "../knowledge/retrieval";
import { cancelSourceImport, getSourceImport, listSourceImports, previewSourceImport, startSourceImport } from "../collaboration/project-source-import";

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
assessmentGithubRouter.use(["/github", "/entities/:id/source", "/entities/:id/source-upload", "/entities/:id/evaluate"],
  rateLimit(requestLimitOptions("assessment-github", 120, true)), requestLimitFailure);
assessmentGithubRouter.use(requireSession);
assessmentGithubRouter.post("/github/connect",
  rateLimit(requestLimitOptions("github-credential-save", 10, true, 15 * 60_000)), requestLimitFailure);
assessmentGithubRouter.post("/github/check",
  rateLimit(requestLimitOptions("github-connection-check", 10, true, 60_000)), requestLimitFailure);
const wrap = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) { res.status(e instanceof AiError ? e.status : e instanceof z.ZodError ? 400 : 503).json({
    message: e instanceof AiError ? e.message : e instanceof z.ZodError ? "Invalid repository or source request." : "Source assessment unavailable. No draft was discarded.",
  }); }
};
assessmentGithubRouter.get("/github/status", wrap(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(SharedGithubStatusResponse.parse(await githubConnectionStatus(req.identity!)));
}));
assessmentGithubRouter.post("/github/check", wrap(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const { repository: raw } = CheckSharedGithubBody.strict().parse(req.body);
  const repository = normalizeRepository(raw);
  const config = await savedGithubConfig(req.identity!, repository);
  await checkGithubRepository(repository, config);
  res.json(CheckSharedGithubResponse.parse({ repository, checkedAt: new Date().toISOString() }));
}));
assessmentGithubRouter.post("/github/connect", wrap(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const input = githubConnectionInput.parse(ConnectSharedGithubBody.strict().parse(req.body));
  await saveGithubConnection(req.identity!, input);
  res.json(SharedGithubStatusResponse.parse(await githubConnectionStatus(req.identity!)));
}));
assessmentGithubRouter.delete("/github/connect", wrap(async (req, res) => {
  await current(pool, req.identity!);
  const query = z.object({ repository: z.string().max(200).transform(normalizeRepository).optional() }).strict().parse(req.query);
  if (query.repository) await pool.query("DELETE FROM cc_github_credentials WHERE user_id=$1 AND repository=$2", [req.identity!.user.id, query.repository]);
  else await pool.query("DELETE FROM cc_github_credentials WHERE user_id=$1", [req.identity!.user.id]);
  res.setHeader("Cache-Control", "no-store");
  res.json(SharedGithubStatusResponse.parse(await githubConnectionStatus(req.identity!)));
}));
assessmentGithubRouter.get("/github/files", wrap(async (req, res) => {
  const query = z.object({ repository: z.string().max(200).transform(normalizeRepository), ref: z.string().min(1).max(200) }).parse(req.query);
  res.json(await files(query.repository, query.ref, await savedGithubConfig(req.identity!, query.repository)));
}));
assessmentGithubRouter.get("/github/imports", wrap(async (req, res) => {
  res.json(ListProjectSourceImportsResponse.parse(await listSourceImports(req.identity!)));
}));
assessmentGithubRouter.post("/github/imports",
  rateLimit(requestLimitOptions("github-import-preview", 5, true, 60_000)), requestLimitFailure,
  wrap(async (req, res) => {
    res.json(GetProjectSourceImportResponse.parse(await previewSourceImport(req.identity!, req.body)));
  }));
assessmentGithubRouter.get("/github/imports/:id", wrap(async (req, res) => {
  res.json(GetProjectSourceImportResponse.parse(await getSourceImport(req.identity!, z.string().uuid().parse(req.params.id))));
}));
assessmentGithubRouter.post("/github/imports/:id", wrap(async (req, res) => {
  const body = StartProjectSourceImportBody.strict().parse(req.body);
  if (body.confirmed !== true) throw new AiError(400, "Explicit source import confirmation is required.");
  res.json(GetProjectSourceImportResponse.parse(await startSourceImport(req.identity!, z.string().uuid().parse(req.params.id))));
}));
assessmentGithubRouter.delete("/github/imports/:id", wrap(async (req, res) => {
  res.json(GetProjectSourceImportResponse.parse(await cancelSourceImport(req.identity!, z.string().uuid().parse(req.params.id))));
}));
assessmentGithubRouter.post("/entities/:id/source", wrap(async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  res.json(await mapGithubSources(req.identity!, id, req.body));
}));
assessmentGithubRouter.post("/entities/:id/source-upload",
  rateLimit(requestLimitOptions("assessment-source-upload", 30, true, 60_000)), requestLimitFailure,
  wrap(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const id = z.string().uuid().parse(req.params.id);
    res.json(await uploadSourceFile(req.identity!, id, req.body));
  }));
assessmentGithubRouter.get("/entities/:id/source/:index", wrap(async (req, res) => {
  await transaction(async c => {
    const { row } = await entity(c, req.identity!, z.string().uuid().parse(req.params.id));
    const query = z.object({ version: z.coerce.number().int().positive().optional() }).strict().parse(req.query);
    if (query.version !== undefined) expected(row, query.version);
    const selected = row.sources[z.coerce.number().int().min(0).max(9).parse(req.params.index)];
    if (!selected) throw new AiError(404, "Source snapshot not found.");
    const bytes = await readObject(selected.objectPath);
    if (createHash("sha256").update(bytes).digest("hex") !== selected.sha256) throw new AiError(503, "Saved source integrity check failed. No assessment was changed.");
    res.json({ source: selected, code: bytes.toString("utf8") });
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
