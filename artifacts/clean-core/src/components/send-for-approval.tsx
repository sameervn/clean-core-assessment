import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { isInterfaceItem } from "@/lib/word-reports";
import { buildPublishEntity, entityAction, getWorkspaceReview, importKeyFor, loadDraft, prepareWorkspaceReview, sameSnapshot, stateKey } from "@/lib/shared-assessments";

/** One selected local snapshot, one shared identity, and the existing server transition. */
export function SendForApproval({ ctx, item, kind, unsaved }: { ctx: any; item: any; kind: "object" | "interface"; unsaved: boolean }) {
  const { user, can } = useAuth();
  const allowed = !ctx.readOnly && !!user && ["Developer", "Admin"].includes(user.role) && can("classify");
  if (!allowed) return null;
  return <Submission ctx={ctx} item={item} kind={kind} unsaved={unsaved} />;
}

function Submission({ ctx, item, kind, unsaved }: { ctx: any; item: any; kind: "object" | "interface"; unsaved: boolean }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const record = useMemo(() => {
    const merged = { ...item, ...(ctx.assessment.integrations || []).find((i: any) => i.id === item.id) };
    return buildPublishEntity(merged, isInterfaceItem(merged) ? "interface" : "object", ctx.narratives[item.id]);
  }, [item, ctx.assessment, ctx.narratives]);
  const identity = useQuery({ queryKey: ["workspace-review-identity", ctx.assessment.provenance], queryFn: () => importKeyFor(ctx.assessment), staleTime: Infinity });
  const queryKey = ["workspace-review", user!.id, identity.data, record.key];
  const context = useQuery({
    queryKey, queryFn: ({ signal }) => getWorkspaceReview(identity.data!, record.key, signal),
    enabled: !!identity.data, refetchInterval: 20_000, refetchOnWindowFocus: true,
  });
  const [expanded, setExpanded] = useState(false);
  const [reviewerId, setReviewerId] = useState("");
  const [share, setShare] = useState(false);
  const [replaceVersion, setReplaceVersion] = useState<number | null>(null);
  const [name, setName] = useState(`${ctx.system} assessment`);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const lock = useRef(false);
  const attempt = useRef<{ key: string; requestId: string } | null>(null);
  const preparation = useRef<{ key: string; requestId: string } | null>(null);
  const entity = context.data?.entity;
  const state = entity ? stateKey(entity.state) : "local";
  const sealed = state === "submitted" || state === "approved";
  const differs = !!entity && (!sameSnapshot(entity.content, record.content) || !sameSnapshot(entity.evidence?.snapshot, record.evidence) || entity.name !== record.name || entity.kind !== record.kind);
  const reviewers = context.data?.reviewers || [];
  const reviewer = reviewers.find(r => r.id === (reviewerId || entity?.reviewer_id));
  const selectedReviewer = reviewer?.id || "";
  useEffect(() => { setShare(false); setReplaceVersion(null); }, [selectedReviewer, entity?.version]);
  const localSaveFailed = ctx.saveState === "error" || ctx.saveConflict || ctx.newerWorkspace;
  const sharedDraft = entity && loadDraft(user!.id, entity.id);
  const disabled = unsaved || !!sharedDraft || localSaveFailed || !!busy;

  const submit = async () => {
    if (lock.current || disabled || sealed || !context.data || !identity.data || !selectedReviewer) return;
    lock.current = true; setBusy("Saving selected snapshot"); setError(null); setSuccess(false);
    // The immutable values below identify precisely the revision the user chose.
    const chosen = { importKey: identity.data, name: name.trim(), system: ctx.system, targetRelease: "S4HANA_2025" as const,
      record, expectedVersion: entity?.version ?? null, reviewerId: selectedReviewer, shareWithReviewer: share };
    try {
      if (differs && replaceVersion !== entity?.version) throw new Error("Compare the shared draft and confirm replacement first.");
      await ctx.persistForReview();
      const preparationKey = JSON.stringify(chosen);
      if (preparation.current?.key !== preparationKey) preparation.current = { key: preparationKey, requestId: crypto.randomUUID() };
      const prepared = await prepareWorkspaceReview({ ...chosen, requestId: preparation.current.requestId });
      // A lost response may have already completed this exact snapshot. Never resubmit it.
      if (!["Submitted", "Approved"].includes(prepared.entity.state)) {
        setBusy("Sending for approval");
        const key = `${prepared.entity.id}:${prepared.entity.version}`;
        if (attempt.current?.key !== key) attempt.current = { key, requestId: crypto.randomUUID() };
        await entityAction(prepared.entity.id, { expectedVersion: prepared.entity.version, action: "submit", comment: "", requestId: attempt.current.requestId });
      }
      setSuccess(true); setExpanded(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey }),
        qc.invalidateQueries({ queryKey: ["shared-assessments"] }),
        qc.invalidateQueries({ queryKey: ["shared-assessment", prepared.assessment.id] }),
      ]);
      ctx.toast({ title: "Sent for approval", description: "The selected saved revision is now in the shared review workflow." });
    } catch (e: any) {
      setError(`${e?.message || "Submission failed"}. Your browser work is unchanged. Refresh review status, compare any newer revision, then retry.`);
      void context.refetch();
    } finally { setBusy(""); lock.current = false; }
  };

  return <section className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs" data-testid={`review-${kind}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong data-testid="status-local-review">{busy || (context.isLoading ? "Loading review status…" : entity?.state || "Browser-local · not shared")}</strong>
      {!sealed && <Button size="sm" disabled={disabled || !context.data} onClick={() => { setExpanded(v => !v); setSuccess(false); }} data-testid={`button-send-approval-${kind}`}><Send className="mr-1 h-3.5 w-3.5" />Send for approval</Button>}
    </div>
    {sealed && <p>{state === "approved" ? "Approved" : "Awaiting reviewer"} · shared version {entity?.version}. {differs && "Your local snapshot differs; it has not been submitted. Open the shared record to compare and revise explicitly."}</p>}
    {success && <p role="status" className="text-emerald-700">Saved snapshot sent for approval. Any newer unsaved edits are not included. No local content was discarded.</p>}
    {unsaved && <p role="status">Save or discard your narrative and classification edits before sending. Unsaved edits are not submitted.</p>}
    {sharedDraft && <p role="status">An unfinished shared-record edit is kept in this browser. Open the shared review record to save or discard that draft before sending.</p>}
    {localSaveFailed && <p role="alert">Resolve the workspace save error or newer-workspace warning first. Your local work has not been sent.</p>}
    {(identity.error || context.error) && <p role="alert">{(identity.error || context.error)?.message}<Button variant="link" size="sm" onClick={() => { void identity.refetch(); void context.refetch(); }}>Retry status</Button></p>}
    {error && <p role="alert" className="text-destructive" data-testid="status-submit-error">{error}</p>}
    {expanded && !sealed && <div className="space-y-3 border-t pt-3">
      <p>Save and send only <strong>{record.name}</strong>. Other browser-local objects and interfaces are not published. Personal notes are optional.</p>
      {!context.data?.assessment && <label className="block">Shared assessment name<Input maxLength={160} value={name} disabled={!!busy} onChange={e => setName(e.target.value)} /></label>}
      <label className="block">Reviewer
        <select className="mt-1 w-full rounded-md border bg-background p-2" value={selectedReviewer} disabled={!!busy} onChange={e => setReviewerId(e.target.value)} data-testid="select-approval-reviewer">
          <option value="">Choose an independent reviewer</option>
          {reviewers.map(r => <option key={r.id} value={r.id} disabled={!r.eligible}>{r.username}{r.member ? " · member" : !r.eligible ? " · administrator must change access" : ""}</option>)}
        </select>
      </label>
      {!reviewers.some(r => r.eligible) && <p>An administrator must create an active Reviewer account with assessment access before you can send this record.</p>}
      {reviewer && !reviewer.member && <label className="flex items-start gap-2"><input type="checkbox" checked={share} disabled={!!busy} onChange={e => setShare(e.target.checked)} data-testid="checkbox-share-reviewer" /><span>Grant this reviewer review access to this shared assessment, including records already shared here and any added later. No other browser-local records are shared now.</span></label>}
      {differs && <div className="space-y-2 rounded border border-amber-300 p-2">
        <p>The shared draft differs from this browser snapshot. Compare before replacing version {entity?.version}. Shared narrative: {entity?.content.narrative || "(empty)"}; classification: {entity?.content.classification}.</p>
        <details><summary className="cursor-pointer">Compare all shared and local assessment fields</summary><pre className="max-h-52 overflow-auto whitespace-pre-wrap text-[10px]">{JSON.stringify({ shared: entity?.content, local: record.content, sharedEvidence: entity?.evidence?.snapshot, localEvidence: record.evidence }, null, 2)}</pre></details>
        <label className="flex items-start gap-2"><input type="checkbox" checked={replaceVersion === entity?.version} disabled={!!busy} onChange={e => setReplaceVersion(e.target.checked ? entity!.version : null)} /><span>Replace this shared draft with my current saved local snapshot and send it.</span></label>
      </div>}
      <Button size="sm" disabled={disabled || !selectedReviewer || !name.trim() || (!!reviewer && !reviewer.member && !share) || (differs && replaceVersion !== entity?.version)} onClick={() => void submit()} data-testid="button-confirm-send-approval">{busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{busy || "Save selected record and send"}</Button>
    </div>}
    {context.data?.assessment && <Button variant="link" size="sm" className="h-auto p-0 text-xs" disabled={!!busy} onClick={() => {
      if (unsaved && !window.confirm("There are unsaved detail edits. Stay here to save them, or leave without submitting them?")) return;
      navigate(`/shared-assessments?id=${encodeURIComponent(context.data!.assessment!.id)}${entity ? `&entity=${encodeURIComponent(entity.id)}` : ""}`);
    }} data-testid="button-open-review-record">Open shared review record</Button>}
    {entity && <Button variant="link" size="sm" className="ml-3 h-auto p-0 text-xs" disabled={!!busy} onClick={() => void context.refetch()}>Refresh review status</Button>}
  </section>;
}
