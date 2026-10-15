import { useEffect, useRef, useState } from "react";
import type { AssessmentAiStatus, AssessmentExplanationInput, AssessmentExplanation, KnowledgePreview } from "@workspace/api-client-react";
import { apiFetch, readApiError } from "@/lib/api";
import { explanationReviewState, summaryFingerprint, type AcceptedExplanation } from "@/lib/ai-narratives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KnowledgeSources } from "./knowledge-sources";
import { KnowledgeRetrievalDiagnostics } from "./knowledge-retrieval-diagnostics";
import { useAuth } from "@/lib/auth";

function useAiStatus() {
  const [status, setStatus] = useState<AssessmentAiStatus>({ state: "unavailable", message: "Checking AI availability…" });
  useEffect(() => {
    const abort = new AbortController();
    apiFetch("/api/clean-core/ai/status", { signal: abort.signal }).then(async res => {
      if (!res.ok) throw new Error();
      setStatus(await res.json());
    }).catch(() => { if (!abort.signal.aborted) setStatus({ state: "unavailable", message: "AI status unavailable. Assessments and notes still work." }); });
    return () => abort.abort();
  }, []);
  return status;
}

export function AssessmentAiSettings() {
  const status = useAiStatus();
  return <Card>
    <CardHeader><CardTitle>Assessment AI (optional)</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p><strong className="capitalize">{status.state.replace("-", " ")}</strong>{status.provider && ` · ${status.provider} / ${status.model}`}</p>
      <p>{status.message}</p>
      <p>AI only drafts explanations on request. It never changes scores, classifications, overrides, baselines or original recommendations. Review the exact summary before sending it.</p>
      <details><summary className="cursor-pointer font-medium">Administrator setup instructions</summary>
        <p className="mt-2">On the backend only, configure CC_AI_PROVIDER (openai or azure), CC_AI_MODEL, CC_AI_ENDPOINT, CC_AI_API_VERSION (Azure), and inject CC_AI_API_KEY from your secret manager. Keep CC_AI_ENABLED=false until access controls are verified.</p>
        <p className="mt-2">By default the backend authorizes AI requests from the signed-in local account: the user needs the ai.generate permission, and limits apply per verified user ID. Gateway assertion mode is optional, must be configured explicitly, and never trusts identity headers sent by the browser. AI monitoring is Admin only. Restart the backend after changes.</p>
        <p className="mt-2">Deployment operators: see docs/client-ai.md for the complete settings table, placeholder examples, gateway contract, key rotation, quotas and data safeguards. No credential is entered or stored here.</p>
      </details>
    </CardContent>
  </Card>;
}

export function AssessmentAiExplanation({ summary, accepted, onAccept, onRemove, canGenerate = false, canAccept = false, canRemove = false }: {
  summary: AssessmentExplanationInput; accepted?: AcceptedExplanation;
  onAccept: (draft: AcceptedExplanation) => Promise<boolean> | void; onRemove: () => void;
  canGenerate?: boolean; canAccept?: boolean; canRemove?: boolean;
}) {
  const { can } = useAuth();
  const status = useAiStatus();
  const [preview, setPreview] = useState(false);
  const [knowledgePreview, setKnowledgePreview] = useState<KnowledgePreview | null>(null);
  const [mode, setMode] = useState<"knowledge-only" | "allow-fallback">("knowledge-only");
  const [draft, setDraft] = useState<(AssessmentExplanation & { summaryFingerprint: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const discard = () => { request.current?.abort(); request.current = null; setBusy(false); setDraft(null); setPreview(false); setKnowledgePreview(null); setError(""); };
  const summaryKey = summaryFingerprint(summary);
  useEffect(() => { discard(); }, [summaryKey]);
  const loadPreview = async () => {
    request.current?.abort();
    const abort = new AbortController(); request.current = abort;
    setPreview(true); setBusy(true); setError(""); setKnowledgePreview(null); setDraft(null);
    try {
      const res = await apiFetch("/api/clean-core/ai/preview", {
        method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ summary, mode }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Knowledge preview unavailable"));
      const result = await res.json();
      if (request.current === abort && !abort.signal.aborted) setKnowledgePreview(result);
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Preview failed."); }
    finally { if (request.current === abort) setBusy(false); }
  };
  const generate = async () => {
    if (!knowledgePreview) return;
    const fingerprint = summaryFingerprint(summary);
    const abort = new AbortController();
    request.current = abort;
    setBusy(true); setError("");
    try {
      const res = await apiFetch("/api/clean-core/ai/explain", {
        method: "POST", signal: abort.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, mode, token: knowledgePreview.token }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "AI unavailable"));
      const result = await res.json();
      if (request.current === abort && !abort.signal.aborted) setDraft({ ...result, summaryFingerprint: fingerprint });
    } catch (e) {
      if (request.current === abort && !abort.signal.aborted) setError(e instanceof Error ? e.message : "AI unavailable. Notes are unchanged.");
    } finally { if (request.current === abort) setBusy(false); }
  };
  return <section className="space-y-3 rounded-md border p-3 text-sm" aria-label="AI explanation">
    <h4 className="font-semibold">AI explanation — optional, separate from expert notes</h4>
    {accepted && <div className="space-y-2">
      <p className="text-xs text-muted-foreground">AI-generated · {accepted.provider} / {accepted.model} · accepted {accepted.acceptedAt}. Not an authoritative assessment.</p>
      {explanationReviewState(accepted, summary) === "needs-review" && <p role="status" className="rounded border border-amber-500/50 bg-amber-500/10 p-2">
        <strong>Needs review</strong> — the assessment summary has changed since this explanation was generated. The accepted text is preserved; review it or generate a replacement.
      </p>}
      {explanationReviewState(accepted, summary) === "unknown" && <p role="status" className="rounded border p-2 text-muted-foreground">
        <strong>Review status unknown</strong> — this older explanation has no saved summary fingerprint. Its text is preserved, but freshness cannot be verified.
      </p>}
      <p className="whitespace-pre-wrap break-words">{accepted.text}</p>
      <p>{accepted.knowledgeDisclosure}</p>
      <KnowledgeSources sources={accepted.sources} />
      <Button variant="outline" size="sm" disabled={!canRemove} onClick={onRemove}>Remove accepted AI explanation</Button>
    </div>}
    <p className="text-xs">{status.message}</p>
    {!canGenerate && <p className="text-xs text-muted-foreground">Generating AI drafts is not enabled for your account.</p>}
    <label className="block">Knowledge policy
      <select className="ml-2 rounded border bg-background p-1" value={mode} disabled={busy} onChange={e => { discard(); setMode(e.target.value as typeof mode); }}>
        <option value="knowledge-only">Knowledge base only</option>
        <option value="allow-fallback">Permit labeled general-model fallback</option>
      </select>
    </label>
    <p className="text-xs text-muted-foreground">Uploaded guidance is consulted first. This is not a live internet search service.</p>
    {!preview && <Button variant="outline" size="sm" disabled={status.state !== "configured" || !canGenerate} onClick={() => void loadPreview()}>Preview AI request</Button>}
    {preview && <>
      <p>This exact assessment summary and bounded uploaded excerpts will be sent to {status.provider} / {status.model} only after consent. Document excerpts may contain client information. Raw files and expert notes are excluded. Provider policies apply; confirm only if your organization permits transmission.</p>
      {knowledgePreview && <>
        <p role="status">{knowledgePreview.payload.disclosure}</p>
        {can("knowledge.manage-all") && mode === "knowledge-only" && !knowledgePreview.canGenerate && knowledgePreview.diagnostics &&
          <KnowledgeRetrievalDiagnostics diagnostics={knowledgePreview.diagnostics} />}
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{JSON.stringify(knowledgePreview.payload, null, 2)}</pre>
      </>}
      {!draft && <Button size="sm" disabled={busy || !canGenerate || !knowledgePreview?.canGenerate} onClick={generate}>{busy ? "Working…" : "I consent — generate explanation"}</Button>}
      {!busy && !draft && <Button variant="outline" size="sm" onClick={() => void loadPreview()}>Refresh preview</Button>}
      {draft && <div className="space-y-2"><strong>AI-generated draft — verify before accepting</strong>
        <p className="whitespace-pre-wrap break-words">{draft.text}</p>
        <p>{draft.knowledgeDisclosure}</p>
        <KnowledgeSources sources={draft.sources} />
        <Button size="sm" disabled={!canAccept} onClick={async () => { const ok = await onAccept({ ...draft, acceptedAt: new Date().toISOString() }); if (ok !== false) discard(); }}>
          {accepted ? "Replace accepted AI explanation" : "Accept AI explanation"}
        </Button>
        <p className="text-xs">Accepting saves this separately. Your expert notes remain unchanged.</p>
      </div>}
      <Button size="sm" variant="outline" className="ml-2" onClick={discard}>{busy ? "Cancel" : "Discard"}</Button>
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
