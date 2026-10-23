import { Router, type RequestHandler, type Response } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import PizZip from "pizzip";
import { pool } from "@workspace/db";
import { requireSession } from "../auth/middleware";
import { AiError } from "../assessment-ai";
import { access, current, transaction } from "../collaboration/service";
import { storePrivate } from "../collaboration/files";
import { readObject, removeObject, storageConfigured } from "../knowledge/storage";
import { processWord } from "../reports/process";
import { example } from "../reports/contract.mjs";
import { approvalPage } from "../collaboration/archive";
import { requestLimit } from "../request-limits";

export const assessmentExportsRouter = Router();
assessmentExportsRouter.use(requireSession);
assessmentExportsRouter.use("/company-templates", requestLimit("company-templates", 60, true));
assessmentExportsRouter.post("/company-templates", requestLimit("company-template-upload", 10, true));
assessmentExportsRouter.post("/company-templates/:id/preview", requestLimit("company-template-preview", 10, true));
assessmentExportsRouter.post("/approvals/download", requestLimit("approvals-download", 20, true));
const uuid = (v: unknown) => z.string().uuid().parse(v);
const wrap = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) { if (!res.destroyed) res.status(e instanceof AiError ? e.status : e instanceof z.ZodError ? 400 : 503).json({
    message: e instanceof AiError ? e.message : e instanceof z.ZodError ? "Invalid export or template request." : "Export unavailable. No approved snapshot has been changed.",
  }); }
};
function download(res: Response, bytes: Buffer, name: string) {
  res.setHeader("Content-Type", name.endsWith(".zip") ? "application/zip" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(bytes);
}
function abortSignal(res: Response) {
  const c = new AbortController(); res.once("close", () => c.abort()); return c.signal;
}
assessmentExportsRouter.get("/company-templates", wrap(async (req, res) => {
  await current(pool, req.identity!);
  res.json({ templates: (await pool.query("SELECT id,name,version,previewed,active FROM cc_company_templates ORDER BY created_at DESC")).rows, configured: storageConfigured() });
}));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4_000_000, files: 1, fields: 4 } });
assessmentExportsRouter.post("/company-templates", wrap(async (req, _res, next) => {
  const user = await current(pool, req.identity!);
  if (user.role !== "Admin") throw new AiError(403, "Only administrators manage company templates.");
  next();
}), upload.single("file"), wrap(async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(120), replaceId: z.string().uuid().optional(), expectedVersion: z.coerce.number().int().positive().optional() }).strict().parse(req.body);
  if (!req.file || !req.file.originalname.toLowerCase().endsWith(".docx") || (!!body.replaceId !== !!body.expectedVersion)) throw new AiError(400, "Upload one DOCX and provide the current version for replacement.");
  if (!Buffer.isBuffer(req.file.buffer) || !req.file.buffer.length || req.file.buffer.length > 4_000_000) throw new AiError(400, "Template must be binary file data of 1 byte to 4 MB.");
  await processWord({ mode: "validate", bytes: req.file.buffer.toString("base64") }, abortSignal(res));
  const objectPath = await storePrivate("company-templates", req.file.buffer);
  try {
    res.json(await transaction(async c => {
      const user = await current(c, req.identity!);
      if (user.role !== "Admin") throw new AiError(403, "Administrator access was removed.");
      await c.query("SELECT pg_advisory_xact_lock(88001)");
      let id = randomUUID(), version = 1;
      if (body.replaceId) {
        const previous = (await c.query("SELECT * FROM cc_company_templates WHERE id=$1 FOR UPDATE", [body.replaceId])).rows[0];
        if (!previous || previous.version !== body.expectedVersion) throw new AiError(409, "Template changed. Refresh before replacing it.");
        id = previous.id; version = previous.version + 1;
        await c.query("UPDATE cc_company_templates SET name=$2,version=$3,previewed=false,active=false WHERE id=$1", [id, body.name, version]);
      } else {
        if (Number((await c.query("SELECT count(*) FROM cc_company_templates")).rows[0].count) >= 50) throw new AiError(409, "Company template limit reached. Replace an existing template.");
        await c.query("INSERT INTO cc_company_templates(id,name,version,created_by) VALUES($1,$2,1,$3)", [id, body.name, user.id]);
      }
      await c.query("INSERT INTO cc_company_template_versions(template_id,version,object_path,name) VALUES($1,$2,$3,$4)", [id, version, objectPath, body.name]);
      return { id, name: body.name, version, previewed: false, active: false };
    }));
  } catch (e) { await removeObject(objectPath).catch(() => undefined); throw e; }
}));
assessmentExportsRouter.post("/company-templates/:id/preview", wrap(async (req, res) => {
  const body = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
  await transaction(async c => {
    const user = await current(c, req.identity!);
    if (!user.permissions.includes("export")) throw new AiError(403, "Export permission required.");
    const row = (await c.query(`SELECT t.*,v.object_path FROM cc_company_templates t JOIN cc_company_template_versions v
      ON v.template_id=t.id AND v.version=t.version WHERE t.id=$1 FOR UPDATE OF t`, [uuid(req.params.id)])).rows[0];
    if (!row || row.version !== body.expectedVersion) throw new AiError(409, "Refresh the template version.");
    const bytes = await processWord({ mode: "render", bytes: (await readObject(row.object_path)).toString("base64"), entities: [example] }, abortSignal(res));
    if (user.role === "Admin") await c.query("UPDATE cc_company_templates SET previewed=true WHERE id=$1", [row.id]);
    download(res, bytes, "company-template-example-preview.docx");
  });
}));
assessmentExportsRouter.put("/company-templates/:id/default", wrap(async (req, res) => {
  const body = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
  await transaction(async c => {
    const user = await current(c, req.identity!);
    if (user.role !== "Admin") throw new AiError(403, "Administrator access required.");
    await c.query("SELECT pg_advisory_xact_lock(88001)");
    const row = (await c.query("SELECT * FROM cc_company_templates WHERE id=$1 FOR UPDATE", [uuid(req.params.id)])).rows[0];
    if (!row || row.version !== body.expectedVersion || !row.previewed) throw new AiError(409, "Preview the current template version before selecting it.");
    await c.query("UPDATE cc_company_templates SET active=false WHERE active");
    await c.query("UPDATE cc_company_templates SET active=true WHERE id=$1", [row.id]);
  });
  res.json({ ok: true });
}));
assessmentExportsRouter.get("/approvals/list", wrap(async (req, res) => {
  await current(pool, req.identity!);
  res.setHeader("Cache-Control", "no-store");
  res.json(await approvalPage(pool, req.identity!.user.id, req.query));
}));
assessmentExportsRouter.post("/approvals/download", wrap(async (req, res) => {
  const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).strict().parse(req.body);
  await transaction(async c => {
    const user = await current(c, req.identity!);
    if (!user.permissions.includes("export")) throw new AiError(403, "Export permission required.");
    const ids = [...new Set(body.ids)];
    const rows = (await c.query(`SELECT p.*,e.assessment_id,e.name,e.kind FROM cc_assessment_approvals p
      JOIN cc_assessment_entities e ON e.id=p.entity_id WHERE p.id=ANY($1::uuid[])`, [ids])).rows;
    if (rows.length !== ids.length) throw new AiError(404, "Approval not found.");
    for (const assessmentId of new Set(rows.map(r => r.assessment_id))) await access(c, req.identity!, assessmentId);
    const zip = new PizZip(); let total = 0; let single: Buffer | undefined;
    for (const row of rows) {
      if (!row.report_path) throw new AiError(409, "This approval has no sealed report. Request a new review cycle.");
      const bytes = await readObject(row.report_path);
      total += bytes.length;
      if (total > 40_000_000) throw new AiError(413, "Approved batch exceeds 40 MB. Select fewer reports.");
      single = bytes;
      zip.file(`${row.kind}-${row.name.replace(/[^a-z0-9._-]/gi, "_").slice(0, 60)}-v${row.version}-${row.id}.docx`, bytes);
    }
    download(res, rows.length === 1 ? single! : zip.generate({ type: "nodebuffer", compression: "DEFLATE" }), rows.length === 1 ? "approved-assessment.docx" : "approved-assessments.zip");
  });
}));
