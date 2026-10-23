import express, { type Express, type ErrorRequestHandler } from "express";
import multer from "multer";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import cookieParser from "cookie-parser";
import { readIdentity, mutationProtection } from "./auth/middleware";
import { accountRouter } from "./routes/accounts";
import { reportTemplateRouter } from "./routes/report-templates";
import { collaborationRouter } from "./routes/collaboration";
import { assessmentGithubRouter } from "./routes/assessment-github";
import { assessmentExportsRouter } from "./routes/assessment-exports";
import { probes, productionFrontend } from "./runtime";
import { uploadRouter } from "./knowledge/upload-token";
import { requestLimit } from "./request-limits";
import { boundRequest } from "./input-bounds";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.startsWith("/api/storage-upload/") ? "/api/storage-upload/[redacted]" : req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
// Do not trust arbitrary X-Forwarded-For/Forwarded headers. A reverse proxy
// shares a conservative IP budget; per-account limits still isolate users.
app.set("trust proxy", false);
app.use(probes);
app.use("/api", probes);
// Before cookies, identity DB lookup, raw upload parsing and JSON/multipart.
app.use("/api", requestLimit("api", 600));
app.use("/api/storage-upload", requestLimit("upload", 30));
app.use("/api/clean-core/evidence", requestLimit("evidence", 20));
// This route uses a short-lived, path-bound capability, not cookie authority.
app.use("/api/storage-upload", uploadRouter);
app.use(cookieParser());
app.use("/api", (req, res, next) => {
  if (req.path === "/healthz") { next(); return; }
  readIdentity(req, res, next);
});
app.use("/api", mutationProtection);
app.use("/api/auth", express.json({ limit: 4096 }), boundRequest);
app.use("/api/admin", express.json({ limit: 8192 }), boundRequest);
app.use("/api", accountRouter);
app.use("/api/report-templates", express.json({ limit: 2_100_000 }), boundRequest, reportTemplateRouter);
// Apply the smaller AI body limit before the assessment's evidence parser.
app.use("/api/clean-core/ai", express.json({ limit: 2048 }));
app.use(express.json({ limit: 18_000_000 }));
app.use(boundRequest);
app.use("/api/shared-assessments", assessmentGithubRouter, assessmentExportsRouter, collaborationRouter);

app.use("/api", router);
app.use("/api", (_req, res) => { res.status(404).json({ message: "API route not found." }); });
productionFrontend(app);

const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  const tooLarge = error?.type === "entity.too.large" || (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE");
  const invalidUpload = error instanceof multer.MulterError;
  res.status(tooLarge ? 413 : 400).json({
    message: tooLarge ? "Upload/request is too large. Evidence files must be 16 MB or smaller."
      : invalidUpload ? "Invalid upload: send one file and one evidence type."
      : error?.type === "entity.parse.failed" ? "Invalid JSON request."
      : "Unable to process this request. Check the file format and try again.",
  });
};
app.use(handleError);

export default app;
