import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { StartWordTemplateUploadBody, UpdateWordTemplateBody, DeleteWordTemplateBody, PreviewWordTemplateBody, RenderWordReportsBody } from "@workspace/api-zod";
import { requireSession, requirePermission } from "../auth/middleware";
import { AiError } from "../assessment-ai";
import { storageConfigured } from "../knowledge/storage";
import { reference, example, fields } from "../reports/contract.mjs";
import { processWord } from "../reports/process";
import { requestLimit } from "../request-limits";
import { fresh, owned, locked, view, version, startUpload, finishUpload, templateBytes, recheckTemplate } from "../reports/service";

export const reportTemplateRouter = Router();
reportTemplateRouter.use(requireSession);
reportTemplateRouter.use(requestLimit("personal-templates", 120, true));
const expensiveReports = requestLimit("personal-report-render", 20, true);
// Includes sample generation, upload validation, previews and rendering.
reportTemplateRouter.use((req, res, next) => {
  if (req.method !== "GET" || req.path === "/sample") { expensiveReports(req, res, next); return; }
  next();
});
const wrap = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) {
    if (res.destroyed) return;
    res.status(e instanceof AiError ? e.status : e instanceof z.ZodError ? 400 : 503)
      .json({ message: e instanceof AiError ? e.message : e instanceof z.ZodError ? "Invalid report request. Check the fields, limits and template version." : "Private Word reports are unavailable. Retry or contact your administrator; assessment data is unchanged." });
  }
};
const id = (v: unknown) => z.string().uuid().parse(v);
function signal(res: Response) {
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  return controller.signal;
}
function download(res: Response, bytes: Buffer, filename: string) {
  res.setHeader("Content-Type", filename.endsWith(".zip") ? "application/zip" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(bytes);
}
reportTemplateRouter.get("/", wrap(async (req, res) => {
  // Export-only reviewers can list their own retained templates, never another owner's.
  if (!req.identity!.user.permissions.some(p => p === "export" || p === "templates.manage")) throw new AiError(403, "Export or template management permission required.");
  const rows = (await pool.query("SELECT * FROM cc_report_templates WHERE owner_id=$1 AND status='ready' ORDER BY created_at DESC", [req.identity!.user.id])).rows;
  const companies = (await pool.query("SELECT * FROM cc_company_templates WHERE previewed ORDER BY active DESC,created_at DESC")).rows;
  res.json({ templates: [...companies.map(r => ({ ...view(r), name: `${r.name} (company)`, company: true })), ...rows.map(view)],
    activeId: companies.find(r => r.active)?.id ?? rows.find(r => r.active)?.id ?? null, configured: storageConfigured() });
}));
reportTemplateRouter.get("/reference", (_req, res) => { res.json(reference); });
reportTemplateRouter.get("/sample", requirePermission("export"), wrap(async (req, res) => {
  const bytes = await processWord({ mode: "sample" }, signal(res));
  await fresh(req.identity!, "export");
  download(res, bytes, "clean-core-sample-template.docx");
}));
reportTemplateRouter.post("/uploads", requirePermission("templates.manage"), wrap(async (req, res) => {
  const body = StartWordTemplateUploadBody.strict().parse(req.body);
  if (!body.name.trim() || !/^[^/\\\x00-\x1f]+\.docx$/i.test(body.filename) || (!!body.replaceId !== !!body.expectedVersion)) throw new AiError(400, "Provide a name and .docx filename; replacement requires the current version.");
  res.json(await startUpload(req.identity!, { ...body, name: body.name.trim() }));
}));
reportTemplateRouter.post("/uploads/:id/process", requirePermission("templates.manage"), wrap(async (req, res) => {
  res.json(await finishUpload(req.identity!, id(req.params.id), signal(res)));
}));
reportTemplateRouter.patch("/:id", requirePermission("templates.manage"), wrap(async (req, res) => {
  const body = UpdateWordTemplateBody.strict().parse(req.body);
  res.json(await locked(req.identity!, "templates.manage", async c => {
    const row = await owned(c, req.identity!, id(req.params.id)); version(row, body.expectedVersion);
    if (row.status !== "ready" || (body.active && !row.previewed)) throw new AiError(409, "Download and inspect a populated preview before activating this template.");
    if (body.name !== undefined && !body.name.trim()) throw new AiError(400, "Template name cannot be blank.");
    if (body.active) await c.query("UPDATE cc_report_templates SET active=false WHERE owner_id=$1", [req.identity!.user.id]);
    return view((await c.query("UPDATE cc_report_templates SET name=$2,active=$3 WHERE id=$1 RETURNING *", [row.id, body.name?.trim() ?? row.name, body.active ?? row.active])).rows[0]);
  }));
}));
reportTemplateRouter.delete("/:id", requirePermission("templates.manage"), wrap(async (req, res) => {
  const body = DeleteWordTemplateBody.strict().parse(req.body);
  await locked(req.identity!, "templates.manage", async c => {
    const row = await owned(c, req.identity!, id(req.params.id)); version(row, body.expectedVersion);
    await c.query("INSERT INTO cc_report_template_garbage(object_path,delete_after) VALUES($1,now()+interval '10 minutes') ON CONFLICT DO NOTHING", [row.object_path]);
    await c.query("DELETE FROM cc_report_templates WHERE id=$1", [row.id]);
  });
  res.sendStatus(204);
}));
reportTemplateRouter.post("/preview", requirePermission("export"), wrap(async (req, res) => {
  const body = PreviewWordTemplateBody.strict().parse(req.body);
  const selected = body.templateId === "sample" ? null : await templateBytes(req.identity!, id(body.templateId));
  if (selected && body.expectedVersion !== undefined) version(selected.row, body.expectedVersion);
  const bytes = await processWord({ mode: "render", bytes: selected?.bytes.toString("base64"), entities: [example] }, signal(res));
  await locked(req.identity!, "export", async c => {
    if (selected) {
      version(await recheckTemplate(c, req.identity!, selected.row), selected.row.version);
      if (!selected.row.company) await c.query("UPDATE cc_report_templates SET previewed=true WHERE id=$1", [selected.row.id]);
    }
    download(res, bytes, "example-only-populated-preview.docx");
  });
}));
reportTemplateRouter.post("/render", requirePermission("export"), wrap(async (req, res) => {
  const body = RenderWordReportsBody.strict().parse(req.body);
  // Flat literal values only. No expressions or user-defined object properties reach the renderer.
  const entities = body.entities.map(raw => {
    const entity: Record<string, unknown> = {};
    for (const field of fields) {
      const value = (raw as any)[field] ?? "Not provided";
      if (typeof value !== "string" || value.length > 40_000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new AiError(400, "A report field exceeds 40,000 characters or contains invalid control characters.");
      entity[field] = value;
    }
    for (const key of ["findings", "recommendations"] as const) {
      entity[key] = (raw[key]?.length ? raw[key] : [{ text: "Not provided", ...(key === "findings" ? { severity: "Not provided" } : {}) }]).map(row => {
        for (const value of Object.values(row)) if (typeof value !== "string" || value.length > 10_000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new AiError(400, "A repeated report row is too long or contains invalid characters.");
        return key === "findings" ? { text: row.text, severity: (row as any).severity } : { text: row.text };
      });
    }
    return entity;
  });
  if (JSON.stringify(entities).length > 2_000_000) throw new AiError(413, "Report data exceeds 2 MB. Select fewer entities.");
  const selected = body.templateId === "sample" ? null : await templateBytes(req.identity!, id(body.templateId));
  if (selected && !selected.row.previewed) throw new AiError(409, "Preview this template before exporting.");
  const bytes = await processWord({ mode: "render", bytes: selected?.bytes.toString("base64"), entities }, signal(res));
  await locked(req.identity!, "export", async c => {
    if (selected) version(await recheckTemplate(c, req.identity!, selected.row), selected.row.version);
    const count = new Set(entities.map(x => x.entity_id)).size;
    download(res, bytes, count === 1 ? "clean-core-report.docx" : `clean-core-${count}-reports.zip`);
  });
}));
