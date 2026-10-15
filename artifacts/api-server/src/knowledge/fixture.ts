/** Synthetic provider test harness. Not imported by production entry point. */
import express from "express";
import cookieParser from "cookie-parser";
import { createAiRouter } from "../routes/assessment-ai";
import { readIdentity, mutationProtection, requirePermission } from "../auth/middleware";
import { accountRouter } from "../routes/accounts";
import { knowledgeRouter } from "../routes/knowledge";
export function knowledgeFixture(provider?: typeof fetch) {
  const app = express();
  app.use(cookieParser(), readIdentity);
  app.use("/api", mutationProtection);
  app.use(express.json({ limit: 2048 }));
  app.use("/api", accountRouter);
  app.use("/api/clean-core", requirePermission("view"));
  app.use("/api/clean-core/knowledge", knowledgeRouter);
  app.use("/api/clean-core/ai", createAiRouter({
    provider: "openai", model: "synthetic-test-provider", key: "synthetic-not-a-credential",
    url: "https://api.openai.com/v1/chat/completions", authMode: "local", issuer: "", audience: "",
  }, provider ?? (async (_url, init) => {
    const data = JSON.parse(String(init?.body));
    const payload = JSON.parse(data.messages[1].content), source = payload.references[0];
    const text = source
      ? `Synthetic test draft: inspect guidance [1] ${source.title}, version ${source.version}, ${source.section}. Validate applicability with an expert. Not a real model response.`
      : "Synthetic test draft: General-model fallback (not live research). No uploaded guidance supports this explanation.";
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: text } }] }));
  }) as typeof fetch));
  return app;
}
