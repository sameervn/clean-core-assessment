import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, FileText, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  MAX_RENDER_ENTITIES, SAMPLE_TEMPLATE_ID, buildEntityModels, resolveSelection, downloadFrom, fetchTemplates, isAbort, saveBlob,
  type EntitySelection, type TemplateList,
} from "@/lib/word-reports";

type Phase = "idle" | "preparing" | "rendering" | "downloading";

/** Button + confirmation dialog. Templates are fetched fresh every time the dialog opens. */
export function WordExportButton({ ctx, selection, label = "Export Word", size = "sm", variant = "outline", scopeLabel, testId = "button-export-word" }: {
  ctx: any; selection: EntitySelection[]; label?: string; size?: "sm" | "default"; variant?: "outline" | "default" | "secondary"; scopeLabel?: string; testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const count = ctx.assessment ? resolveSelection(ctx.assessment, selection).entities.length : 0;
  return (
    <>
      <Button size={size} variant={variant} disabled={!ctx.perms.export || selection.length === 0} onClick={() => setOpen(true)} data-testid={testId}
        title={!ctx.perms.export ? "Needs the export permission" : undefined}>
        <FileText className="mr-1.5 h-4 w-4" />{label}{count > 1 ? ` (${count})` : ""}
      </Button>
      {open && <WordExportDialog ctx={ctx} selection={selection} scopeLabel={scopeLabel} onClose={() => setOpen(false)} />}
    </>
  );
}

function WordExportDialog({ ctx, selection, scopeLabel, onClose }: { ctx: any; selection: EntitySelection[]; scopeLabel?: string; onClose: () => void }) {
  const { toast } = useToast();
  const resolved = resolveSelection(ctx.assessment, selection);
  const unique = resolved.entities;
  const missing = resolved.missing;
  const count = unique.length;
  const tooMany = count > MAX_RENDER_ENTITIES;
  const [list, setList] = useState<TemplateList | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const load = () => {
    const ac = new AbortController();
    setList(null); setListError(null);
    fetchTemplates(ac.signal).then(data => {
      if (!mounted.current) return;
      setList(data);
      // Only a valid, previewed active template is preselected; never fall back silently to the sample.
      const active = data.templates.find(t => t.id === data.activeId);
      // Keep an explicit, still-valid choice across retries; otherwise only the real default. Never the sample implicitly.
      setTemplateId(prev => prev === SAMPLE_TEMPLATE_ID || data.templates.some(t => t.id === prev) ? prev : active ? active.id : "");
    }).catch(e => { if (!isAbort(e) && mounted.current) setListError(e?.status === 403 ? "Your account is not permitted to export Word reports." : e?.message || "Could not load templates."); });
    return ac;
  };
  useEffect(() => {
    mounted.current = true;
    const ac = load();
    return () => { mounted.current = false; ac.abort(); abortRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = phase !== "idle";
  const [previewing, setPreviewing] = useState(false);
  const previewSample = async () => {
    const ac = new AbortController(); abortRef.current?.abort(); abortRef.current = ac; setPreviewing(true); setError(null);
    try {
      const { blob, filename } = await downloadFrom("/api/report-templates/preview", { method: "POST", json: { templateId: SAMPLE_TEMPLATE_ID } }, "sample-template-preview.docx", { signal: ac.signal, fallbackError: "Preview failed" });
      if (mounted.current && !ac.signal.aborted) saveBlob(blob, filename);
    } catch (e: any) {
      if (mounted.current && !isAbort(e)) setError(e?.status === 403 ? "The server denied the preview. Your permissions may have changed." : e?.message || "Preview failed.");
    } finally { if (abortRef.current === ac) abortRef.current = null; if (mounted.current) setPreviewing(false); }
  };
  const selectedIsValid = templateId === SAMPLE_TEMPLATE_ID || !!list?.templates.some(t => t.id === templateId);

  const run = async () => {
    if (!selectedIsValid || tooMany || count === 0 || missing.length) return;
    const ac = new AbortController(); abortRef.current = ac;
    setError(null); setPhase("preparing"); setProgress(null);
    try {
      const entities = await buildEntityModels(ctx.assessment, selection, ctx.narratives, ctx.aiNarratives, ctx.evidence);
      if (ac.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      setPhase("rendering");
      const name = count === 1 ? `${entities[0].entity_name.replace(/[^\w.-]+/g, "_").slice(0, 60)}.docx` : `clean-core-reports-${ctx.assessment.system}.zip`;
      const { blob, filename } = await downloadFrom("/api/report-templates/render", { method: "POST", json: { templateId, entities } }, name, {
        signal: ac.signal, fallbackError: "Report generation failed",
        onProgress: f => { if (mounted.current) { setPhase("downloading"); setProgress(f); } },
      });
      if (!mounted.current || ac.signal.aborted) return;
      saveBlob(blob, filename);
      toast({ title: count === 1 ? "Word report downloaded" : `${count} Word reports downloaded`, description: templateId === SAMPLE_TEMPLATE_ID ? "Generated with the built-in sample template." : filename });
      onClose();
    } catch (e: any) {
      if (!mounted.current) return;
      if (isAbort(e)) { toast({ title: "Export cancelled", description: "No file was downloaded." }); setPhase("idle"); return; }
      setError(e?.status === 403 ? "The server denied this export. Your permissions may have changed." : e?.message || "Report generation failed.");
      setPhase("idle");
    } finally { if (abortRef.current === ac) abortRef.current = null; }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-export-word">
        <DialogHeader>
          <DialogTitle>Export Word {count === 1 ? "report" : "reports"}</DialogTitle>
          <DialogDescription>
            {count === 1 ? "One .docx file" : `${count} reports in one ZIP`}{scopeLabel ? ` · ${scopeLabel}` : ""}. Generation is all-or-nothing: if any report fails, nothing is downloaded.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="flex items-center gap-2"><Badge data-testid="text-export-count">{count} {count === 1 ? "item" : "unique items"}</Badge>
            {resolved.duplicates > 0 && <span className="text-xs text-muted-foreground">{resolved.duplicates} repeated selection(s) counted once</span>}</div>
          {missing.length > 0 && <p className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive" role="alert" data-testid="status-export-missing"><AlertTriangle className="h-4 w-4 shrink-0" />{missing.length} selected item(s) are no longer in the current assessment ({missing.slice(0, 3).join(", ")}{missing.length > 3 ? "…" : ""}). Clear or refresh your selection, then export again.</p>}
          {tooMany && <p className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive" data-testid="status-export-too-many"><AlertTriangle className="h-4 w-4 shrink-0" />At most {MAX_RENDER_ENTITIES} reports per export. Narrow your selection.</p>}
          <div className="space-y-1.5">
            <p className="font-medium">Template</p>
            {listError ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive"><span>{listError}</span><Button size="sm" variant="outline" onClick={() => load()} data-testid="button-retry-templates"><RefreshCw className="h-3.5 w-3.5" /></Button></div>
            ) : !list ? (
              <div className="h-9 animate-pulse rounded-md bg-muted" data-testid="status-loading-templates" />
            ) : (
              <>
                <Select value={templateId} onValueChange={setTemplateId} disabled={busy}>
                  <SelectTrigger data-testid="select-template"><SelectValue placeholder="Choose a template" /></SelectTrigger>
                  <SelectContent>
                    {list.templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name} · v{t.version}{t.active ? " (default)" : ""}</SelectItem>)}
                    <SelectItem value={SAMPLE_TEMPLATE_ID}>Built-in sample template (not your organisation's)</SelectItem>
                  </SelectContent>
                </Select>
                {!list.activeId && <p className="text-xs text-amber-700" data-testid="status-no-default-template">No default template is configured{list.templates.length ? "" : " or uploaded"}. Choose one explicitly — the sample is never used automatically.</p>}
                {templateId === SAMPLE_TEMPLATE_ID && (
                  <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                    <span>The sample template is generic. Download a populated preview to see its layout.</span>
                    <Button size="sm" variant="outline" disabled={busy || previewing} onClick={() => void previewSample()} data-testid="button-preview-sample">
                      {previewing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1 h-3.5 w-3.5" />}Preview
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
          {busy && (
            <div className="space-y-1.5" data-testid="status-export-progress">
              <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />
                {phase === "preparing" ? "Preparing report data…" : phase === "rendering" ? `Generating ${count === 1 ? "document" : `${count} documents`} on the server…` : "Downloading…"}</p>
              <Progress value={progress === null ? (phase === "preparing" ? 15 : 55) : 55 + progress * 45} />
            </div>
          )}
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive" role="alert" data-testid="text-export-error">{error}</p>}
        </div>
        <DialogFooter>
          {busy
            ? <Button variant="outline" onClick={() => abortRef.current?.abort()} data-testid="button-cancel-export">Cancel generation</Button>
            : <Button variant="outline" onClick={onClose} data-testid="button-close-export">Close</Button>}
          <Button onClick={() => void run()} disabled={busy || !selectedIsValid || tooMany || !list || missing.length > 0 || count === 0} data-testid="button-confirm-export">
            {busy ? "Working…" : count === 1 ? "Generate report" : `Generate ${count} reports`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
