import { Router, type RequestHandler } from "express";
import { pool } from "@workspace/db";
import { z } from "zod";
import { StartKnowledgeUploadBody, StartKnowledgeUploadResponse, RemoveKnowledgeDocumentBody, GetKnowledgeDocumentResponse, ListKnowledgeResponse, ProcessKnowledgeUploadResponse } from "@workspace/api-zod";
import { requirePermission, requireAdmin } from "../auth/middleware";
import { GetKnowledgeCleanupResponse, RunKnowledgeCleanupBody, RunKnowledgeCleanupResponse } from "@workspace/api-zod";
import { cleanupStatus, runCleanup } from "../knowledge/cleanup";
import { AiError } from "../assessment-ai";
import { canManage, documentView, findDocument, startUpload, processUpload, deleteDocument, freshUser, libraryTransaction } from "../knowledge/service";
import { readObject, storageConfigured } from "../knowledge/storage";

export const knowledgeRouter = Router();
knowledgeRouter.use(requirePermission("knowledge.read"));
const wrap = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await handler(req, res, next); }
  catch (error) {
    const e = error instanceof AiError ? error : error instanceof z.ZodError ? new AiError(400, "Invalid knowledge request.") : new AiError(503, "Knowledge storage is unavailable. Core assessment and exports still work.");
    res.status(e.status).json({ message: e.message });
  }
};
const idOf = (value: unknown) => z.string().uuid().parse(value);
knowledgeRouter.get("/cleanup", requireAdmin, wrap(async (_req, res) => {
  res.json(GetKnowledgeCleanupResponse.parse(await cleanupStatus()));
}));
knowledgeRouter.post("/cleanup", requireAdmin, wrap(async (req, res) => {
  const body = RunKnowledgeCleanupBody.strict().parse(req.body);
  res.json(RunKnowledgeCleanupResponse.parse(await runCleanup(body.dryRun, req.identity!)));
}));
knowledgeRouter.get("/", wrap(async (req, res) => {
  const q = z.string().max(200).parse(req.query.q ?? "");
  // Crashed workers recover to a visible retryable state, not eternal processing.
  await pool.query("UPDATE cc_knowledge SET status='failed',error='Processing interrupted. Retry this upload.',updated_at=now() WHERE status='processing' AND updated_at<now()-interval '2 minutes'");
  const rows = await pool.query(`SELECT d.* FROM cc_knowledge d WHERE status<>'deleted' AND
    ($1='' OR title ILIKE '%'||$1||'%' OR topics::text ILIKE '%'||$1||'%' OR
      EXISTS(SELECT 1 FROM cc_knowledge_chunks c WHERE c.document_id=d.id AND c.search @@ plainto_tsquery('english',$1)))
    ORDER BY created_at DESC LIMIT 500`, [q]);
  res.json(ListKnowledgeResponse.parse({ documents: rows.rows.map(documentView), configured: storageConfigured(),
    message: storageConfigured() ? "Shared with authenticated users of this deployment. Guidance does not change assessment scores."
      : "Private durable storage is not configured. Administrator: configure PRIVATE_OBJECT_DIR; see docs/knowledge-base.md." }));
}));
knowledgeRouter.post("/uploads", requirePermission("knowledge.upload"), wrap(async (req, res) => {
  const body = StartKnowledgeUploadBody.strict().parse(req.body);
  if (!body.title.trim() || !body.release.trim() || !/\.(pdf|docx|txt|md|markdown)$/i.test(body.filename)
    || /[\/\\\x00-\x1f]/.test(body.filename) || (body.replaceId && !body.expectedVersion)) throw new AiError(400, "Provide a title, release, supported filename and replacement version.");
  res.json(StartKnowledgeUploadResponse.parse(await startUpload(req.identity!, body)));
}));
knowledgeRouter.get("/:id", wrap(async (req, res) => {
  const row = await findDocument(idOf(req.params.id));
  const passages = await pool.query("SELECT section,text FROM cc_knowledge_chunks WHERE document_id=$1 ORDER BY ordinal", [row.id]);
  res.json(GetKnowledgeDocumentResponse.parse({ ...documentView(row), passages: passages.rows, canManage: canManage(req.identity!.user, row) }));
}));
knowledgeRouter.post("/:id/process", wrap(async (req, res) => {
  res.json(ProcessKnowledgeUploadResponse.parse(await processUpload(req.identity!, idOf(req.params.id))));
}));
knowledgeRouter.delete("/:id", wrap(async (req, res) => {
  const body = RemoveKnowledgeDocumentBody.strict().parse(req.body);
  await deleteDocument(req.identity!, idOf(req.params.id), body.expectedVersion);
  res.sendStatus(204);
}));
knowledgeRouter.get("/:id/file/:version", wrap(async (req, res) => {
  const id = idOf(req.params.id), version = z.coerce.number().int().positive().parse(req.params.version);
  // Serialize with replacement/deletion until bytes are authorized and sent.
  await libraryTransaction(async c => {
    const user = await freshUser(req.identity!, c);
    if (!user.permissions.includes("knowledge.read")) throw new AiError(403, "Knowledge read permission required.");
    const row = await findDocument(id, c);
    if (row.version !== version || row.status !== "ready") throw new AiError(410, "This source version is no longer available.");
    const bytes = await readObject(row.object_path);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  });
}));
