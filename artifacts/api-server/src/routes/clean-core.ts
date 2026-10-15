import { Router, type IRouter } from "express";
import multer from "multer";
import { z } from "zod/v4";
import { LoadCleanCoreDemoBody, RunCleanCoreAssessmentBody } from "@workspace/api-zod";
import {
  buildCleanCoreAssessment, buildCleanCoreDemoEvidence, buildEvidenceMetadata,
  parseCleanCoreEvidence, CLEAN_CORE_EVIDENCE_TYPES, CLEAN_CORE_MAX_NORMALIZED_BYTES,
  type CleanCoreEvidenceType, type CleanCoreEvidenceRow,
} from "../clean-core-assessment";
import { attestEvidenceValue, verifyEvidenceAttestation } from "../evidence-attestation";
import { aiRouter } from "./assessment-ai";
import { requirePermission } from "../auth/middleware";
import { knowledgeRouter } from "./knowledge";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16_000_000, files: 1, fields: 1, parts: 2, fieldSize: 100, fieldNameSize: 50, fieldArrayIndexLimit: 0 },
  fileFilter: (_req, file, done) => {
    if (!/\.(xml|json|csv|tsv|txt)$/i.test(file.originalname)) {
      done(new Error("Supported evidence formats are XML, JSON, CSV, TSV, and TXT."));
    } else done(null, true);
  },
});

// No shared workspace or uploaded files are retained on this service.
router.use("/clean-core", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.headers["sec-fetch-site"] === "cross-site") {
    res.status(403).json({ message: "Cross-site assessment requests are not allowed." });
    return;
  }
  next();
});
router.use("/clean-core", requirePermission("view"));
router.use("/clean-core/ai", aiRouter);
router.use("/clean-core/knowledge", knowledgeRouter);

const safeRow = z.record(z.string().max(100), z.union([
  z.string().max(20_000), z.number().finite(), z.boolean(),
])).refine(row => typeof row.objectName === "string" && row.objectName.trim().length > 0
  && row.objectName.length <= 500, "Every evidence row needs an objectName of 1–500 characters.");

function validateRows(rows: unknown): asserts rows is CleanCoreEvidenceRow[] {
  z.array(safeRow).min(1).max(20_000).parse(rows);
}

function validateOverridePattern(pattern?: string) {
  // Original engine interprets * as a wildcard. Bound wildcard work without
  // changing the original classification rules or normal pattern semantics.
  if (pattern && (pattern.match(/\*/g)?.length ?? 0) > 3) {
    throw new Error("Object override patterns may contain at most three wildcards.");
  }
}

function inputError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).slice(0, 5).join("; ");
  if (error instanceof SyntaxError) return "The file contains invalid JSON.";
  return error instanceof Error ? error.message : "The assessment request is invalid.";
}

router.post("/clean-core/evidence", requirePermission("evidence"), upload.single("file"), (req, res) => {
  try {
    if (!req.file) throw new Error("Choose an evidence file to upload.");
    const type = z.enum(CLEAN_CORE_EVIDENCE_TYPES).parse(req.body.type) as CleanCoreEvidenceType;
    const content = new TextDecoder("utf-8", { fatal: true }).decode(req.file.buffer);
    if (content.includes("\0")) throw new Error("Binary files are not supported. Upload a UTF-8 text export.");
    const rows = parseCleanCoreEvidence(type, content);
    validateRows(rows);
    const metadata = buildEvidenceMetadata(type, rows);
    const value = { type, rows, metadata };
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > CLEAN_CORE_MAX_NORMALIZED_BYTES) {
      res.status(413).json({ message: "Normalized evidence exceeds 16 MB. Split it by system or package." });
      return;
    }
    res.json({ ...value, fileName: req.file.originalname, count: rows.length, attestation: attestEvidenceValue(value) });
  } catch (error) {
    res.status(400).json({ message: inputError(error) });
  }
});

router.get("/clean-core/review-demo", (_req, res) => {
  const context = { system: "DEMO", targetRelease: "S4HANA_2025", weighted: true };
  const evidence = buildCleanCoreDemoEvidence(context.system, context.targetRelease).map(set => ({
    ...set, fileName: `Demo · ${set.type}.json`, count: set.rows.length, attestation: attestEvidenceValue(set),
  }));
  res.json({ evidence, assessment: buildCleanCoreAssessment({ ...context, evidence }) });
});
router.post("/clean-core/demo", requirePermission("evidence"), requirePermission("run"), (req, res) => {
  try {
    const context = LoadCleanCoreDemoBody.parse(req.body);
    if (!context.system.trim() || !context.targetRelease.trim()) throw new Error("System and target release are required.");
    const evidence = buildCleanCoreDemoEvidence(context.system, context.targetRelease).map(set => {
      const metadata = { ...set.metadata, importedAt: new Date().toISOString() };
      const value = { ...set, metadata };
      return { ...value, fileName: `Demo · ${set.type}.json`, count: set.rows.length, attestation: attestEvidenceValue(value) };
    });
    res.json({ evidence, assessment: buildCleanCoreAssessment({ ...context, evidence }) });
  } catch (error) {
    res.status(400).json({ message: inputError(error) });
  }
});

router.post("/clean-core/assessment", requirePermission("run"), (req, res) => {
  if (req.body?.classificationOverrides?.length && !req.identity!.user.permissions.includes("classify")) {
    res.status(403).json({ message: "Classification permission required." }); return;
  }
  try {
    const input = RunCleanCoreAssessmentBody.parse(req.body);
    if (!input.system.trim() || !input.targetRelease.trim()) throw new Error("System and target release are required.");
    if (Buffer.byteLength(JSON.stringify(input.evidence), "utf8") > CLEAN_CORE_MAX_NORMALIZED_BYTES) {
      res.status(413).json({ message: "Combined normalized evidence exceeds 16 MB. Split it by system or package." });
      return;
    }
    if (new Set(input.evidence.map(set => set.type)).size !== input.evidence.length) throw new Error("Only one evidence set per type is allowed.");
    if (input.evidence.reduce((sum, set) => sum + set.rows.length, 0) > 20_000) throw new Error("An assessment supports up to 20,000 evidence rows. Split it by system or package.");
    const evidence = input.evidence.map(set => {
      validateRows(set.rows);
      if (!/^[a-f0-9]{64}$/.test(set.attestation) ||
          !verifyEvidenceAttestation({ type: set.type, rows: set.rows, metadata: set.metadata }, set.attestation)) {
        throw new Error(`Evidence attestation failed for ${set.type}. Re-import the original file before running the assessment.`);
      }
      return { type: set.type, rows: set.rows, metadata: set.metadata };
    });
    for (const override of input.classificationOverrides ?? []) {
      if (!override.finding?.trim() && !override.category?.trim() && !override.objectPattern?.trim()) throw new Error("Each override requires a finding, category, or object pattern.");
      validateOverridePattern(override.objectPattern);
    }
    res.json(buildCleanCoreAssessment({ ...input, evidence }));
  } catch (error) {
    res.status(400).json({ message: inputError(error) });
  }
});

export default router;
