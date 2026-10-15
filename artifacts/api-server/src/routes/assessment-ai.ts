import { Router, type Request } from "express";
import { ExplainAssessmentBody, GetAiLimiterHealthResponse, PreviewAssessmentExplanationBody, PreviewAssessmentExplanationResponse } from "@workspace/api-zod";
import { aiConfig, gatewayIdentity, explain, AiError, type AiConfig } from "../assessment-ai";
import { aiLimiterFromEnv, type AiLimiter } from "../ai-limiter";
import { monitorAiLimiter } from "../ai-limiter-health";
import { retrieve, consentToken, validateConsent } from "../knowledge/retrieval";
import { libraryReadTransaction, freshUser } from "../knowledge/service";

const configResult = (() => { try { return aiConfig(); } catch (error) { return error as AiError; } })();
const defaultKnowledge = { transaction: libraryReadTransaction, freshUser, retrieve };
export function createAiRouter(configuration: AiConfig | AiError | null, request: typeof fetch = fetch, limiter: AiLimiter = aiLimiterFromEnv(), knowledge = defaultKnowledge) {
const configResult = configuration;
const aiRouter = Router();
const monitoring = monitorAiLimiter(limiter);
function identity(req: Request, config: AiConfig, monitoring = false) {
  if (config.authMode === "local") {
    const user = req.identity?.user;
    if (!user || user.mustChangePassword) throw new AiError(401, "Sign in to continue.");
    if (monitoring ? user.role !== "Admin" : !user.permissions.includes("ai.generate")) throw new AiError(403, "AI permission required.");
    return user.id;
  }
  // Explicit gateway mode adds its existing assertion boundary to local app authorization.
  if (req.identity && (monitoring ? req.identity.user.role !== "Admin" : !req.identity.user.permissions.includes("ai.generate")))
    throw new AiError(403, "AI permission required.");
  return gatewayIdentity(req.headers["x-cc-ai-assertion"], config);
}
aiRouter.get("/limiter-health", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!configResult || configResult instanceof AiError) {
    res.status(503).json({ message: "AI is disabled or not configured." }); return;
  }
   try { identity(req, configResult, true); }
  catch { res.status(401).json({ message: "A valid gateway assertion is required." }); return; }
  const health = await monitoring.health();
  res.status(health.available ? 200 : 503).json(GetAiLimiterHealthResponse.parse(health));
});
let unavailableUntil = 0;
aiRouter.get("/status", (req, res) => {
  if (configResult instanceof AiError) { res.json({ state: "not-configured", message: configResult.message }); return; }
  if (!configResult) { res.json({ state: "disabled", message: "AI is disabled. Deterministic assessment and expert notes remain available." }); return; }
  try {
    identity(req, configResult);
    res.json({ state: Date.now() < unavailableUntil ? "unavailable" : "configured", provider: configResult.provider, model: configResult.model,
      message: Date.now() < unavailableUntil ? "AI provider or usage limiter recently failed. Retry after one minute; check administrator settings if it persists." : "Ready for explicitly consented explanations. No data is sent until you confirm." });
  } catch { res.json({ state: "unavailable", message: "AI access is unavailable for this account. Contact your administrator." }); }
});
aiRouter.post("/explain", async (req, res) => {
  try {
    if (configResult instanceof AiError) throw configResult;
    if (!configResult) throw new AiError(503, "AI is disabled. Ask your administrator to configure it.");
    const user = identity(req, configResult);
    // Strict allowlist: destinations, credentials, arbitrary evidence and prompts are rejected.
    const parsed = ExplainAssessmentBody.safeParse(req.body);
    if (!parsed.success) throw new AiError(400, "Send only the bounded assessment summary shown in the consent preview.");
    if (Object.keys(req.body).some(k => !["summary", "mode", "token"].includes(k))
      || Object.keys(req.body.summary ?? {}).some(k => !["kind", "classification", "recommendation", "confidence", "targetRelease"].includes(k)))
      throw new AiError(400, "Send only the consented request fields.");
    const result = await knowledge.transaction(async c => {
    if (!req.identity) throw new AiError(401, "Sign in to continue.");
    const currentUser = await knowledge.freshUser(req.identity, c);
    if (!currentUser.permissions.includes("knowledge.read") || !currentUser.permissions.includes("ai.generate")) throw new AiError(403, "Knowledge read and AI permissions are required.");
    const retrieved = await knowledge.retrieve(parsed.data.summary, parsed.data.mode, c);
    validateConsent(parsed.data.token, `${user}:${configResult.provider}:${configResult.model}:${configResult.url}`, retrieved.payload, retrieved.epoch);
    if (!retrieved.canGenerate) throw new AiError(409, "Insufficient uploaded guidance. Add guidance or explicitly permit general-model fallback.");
    let release: () => Promise<void>;
    try { release = await monitoring.limiter.acquire(user); }
    catch (error) { if (!(error instanceof AiError) || error.status !== 429) unavailableUntil = Date.now() + 60_000; throw error; }
    let result;
    try { result = await explain(configResult, retrieved.payload, request); }
    catch (error) { unavailableUntil = Date.now() + 60_000; throw error; }
    finally {
      try { await release(); }
      catch (error) { unavailableUntil = Date.now() + 60_000; throw error; }
    }
    unavailableUntil = 0;
    return { ...result, sources: retrieved.payload.references.map(({ text: _text, ...source }) => source),
      knowledgeMode: parsed.data.mode, knowledgeDisclosure: retrieved.payload.disclosure };
    });
    res.json(result);
  } catch (error) {
    const safe = error instanceof AiError ? error : new AiError(503, "AI unavailable. Ask your administrator to check configuration.");
    if (safe.status === 429) res.setHeader("Retry-After", "60");
    res.status(safe.status).json({ message: safe.message });
  }
});
aiRouter.post("/preview", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (configResult instanceof AiError) throw configResult;
    if (!configResult) throw new AiError(503, "AI is disabled. Knowledge search and assessment remain available.");
    const user = identity(req, configResult);
    const parsed = PreviewAssessmentExplanationBody.strict().parse(req.body);
    const preview = await knowledge.transaction(async c => {
      if (!req.identity) throw new AiError(401, "Sign in to continue.");
      const account = await knowledge.freshUser(req.identity, c);
      if (!account.permissions.includes("knowledge.read") || !account.permissions.includes("ai.generate")) throw new AiError(403, "Knowledge read and AI permissions are required.");
      const value = await knowledge.retrieve(parsed.summary, parsed.mode, c);
      return { payload: value.payload, canGenerate: value.canGenerate, token: consentToken(`${user}:${configResult.provider}:${configResult.model}:${configResult.url}`, value.payload, value.epoch),
        ...(parsed.mode === "knowledge-only" && !value.canGenerate && account.permissions.includes("knowledge.manage-all")
          ? { diagnostics: value.diagnostics } : {}) };
    });
    res.json(PreviewAssessmentExplanationResponse.parse(preview));
  } catch (error) {
    const safe = error instanceof AiError ? error : new AiError(400, "Unable to preview guidance. Check the summary or ask your administrator to check knowledge storage.");
    res.status(safe.status).json({ message: safe.message });
  }
});
return aiRouter;
}
export const aiRouter = createAiRouter(configResult);
