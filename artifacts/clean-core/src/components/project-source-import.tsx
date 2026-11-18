import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, ExternalLink, FolderGit2, History, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { getActiveProjectId } from "@/lib/api";
import {
  cancelSourceImport, getSourceImport, listSourceImports, previewSourceImport, startSourceImport,
  type ProjectSourceEntry, type ProjectSourceImport,
} from "@/lib/shared-assessments";

type EntryStatus = ProjectSourceEntry["status"];
const STATUS_ORDER: EntryStatus[] = ["ready", "imported", "unchanged", "deferred", "ambiguous", "unmatched", "failed", "cancelled"];
const STATUS_META: Record<EntryStatus, { label: string; cls: string; hint: string }> = {
  ready: { label: "Ready", cls: "bg-primary/10 text-primary border-primary/30", hint: "Will be attached when you start" },
  imported: { label: "Imported", cls: "bg-emerald-50 text-emerald-800 border-emerald-300", hint: "New Draft revision saved" },
  unchanged: { label: "Unchanged", cls: "bg-muted text-muted-foreground border-border", hint: "Same immutable sources; no revision" },
  deferred: { label: "Deferred", cls: "bg-sky-50 text-sky-800 border-sky-300", hint: "Over the run limit; run a new preview" },
  ambiguous: { label: "Ambiguous", cls: "bg-amber-50 text-amber-900 border-amber-300", hint: "Several candidates; map manually" },
  unmatched: { label: "Unmatched", cls: "bg-orange-50 text-orange-900 border-orange-300", hint: "No matching file; map manually" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive border-destructive/30", hint: "Nothing saved for this record" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground border-border", hint: "Not processed" },
};
const RUN_LABEL: Record<ProjectSourceImport["status"], string> = {
  preview: "Preview, not started", running: "Running", completed: "Completed", cancelled: "Cancelled", interrupted: "Interrupted",
};
const MANUAL = new Set<EntryStatus>(["ambiguous", "unmatched", "deferred", "failed", "cancelled"]);

const safe = (e: unknown, fb: string) =>
  ((e instanceof Error && e.message) || fb).replace(/github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+/g, "[redacted]");
const fmt = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "Unknown date" : d.toLocaleString(); };
const countBy = (entries: ProjectSourceEntry[]) => {
  const c = Object.fromEntries(STATUS_ORDER.map(s => [s, 0])) as Record<EntryStatus, number>;
  for (const e of entries) c[e.status] = (c[e.status] ?? 0) + 1;
  return c;
};

/** Outer wrapper: all state is reset whenever the account or project changes. */
export function ProjectSourceImport({ repositories, usable }: { repositories: string[]; usable: boolean }) {
  const { user } = useAuth();
  const project = getActiveProjectId();
  if (!user || !project) return null;
  return <ImportPanel key={`${user.id}:${project}`} userId={String(user.id)} project={project} repositories={repositories} usable={usable} />;
}

function ImportPanel({ userId, project, repositories, usable }: { userId: string; project: string; repositories: string[]; usable: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("main");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState<null | "preview" | "start" | "cancel">(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [filter, setFilter] = useState<EntryStatus | "all">("all");
  const inflight = useRef(false);

  const listKey = ["shared-source-imports", userId, project] as const;
  const recent = useQuery({ queryKey: listKey, queryFn: ({ signal }) => listSourceImports(signal), refetchOnWindowFocus: true });

  // Reload recovery: pick up an active run, otherwise the most recent.
  useEffect(() => {
    if (selectedId || !recent.data?.length) return;
    const active = recent.data.find(r => r.status === "running") ?? recent.data[0];
    setSelectedId(active.id);
  }, [recent.data, selectedId]);

  const run = useQuery({
    queryKey: ["shared-source-import", userId, project, selectedId],
    queryFn: ({ signal }) => getSourceImport(selectedId!, signal),
    enabled: !!selectedId,
    refetchInterval: q => (q.state.data?.status === "running" ? 2000 : false),
    retry: 1,
  });
  const current = run.data ?? null;
  const counts = useMemo(() => countBy(current?.entries ?? []), [current]);
  const selectionFor = useRef<string | null>(null);
  useEffect(() => {
    if (!current || selectionFor.current === current.id) return;
    selectionFor.current = current.id;
    setRepo(current.repository); setRef(current.ref); setFolder(current.folder);
  }, [current]);

  // Invalidate shared assessment data when committed progress changes or a run ends.
  const lastSeen = useRef<string>("");
  useEffect(() => {
    if (!current) return;
    const sig = `${current.id}:${current.status}:${counts.imported}`;
    if (lastSeen.current && lastSeen.current !== sig && lastSeen.current.startsWith(`${current.id}:`)) {
      void qc.invalidateQueries({ queryKey: ["shared-assessments"] });
      void qc.invalidateQueries({ queryKey: ["shared-assessment"] });
      if (current.status !== "running") void qc.invalidateQueries({ queryKey: ["shared-source-imports", userId, project] });
    }
    lastSeen.current = sig;
  }, [current, counts.imported, qc, userId, project]);

  const setRun = (r: ProjectSourceImport) => {
    qc.setQueryData(["shared-source-import", userId, project, r.id], r);
    setSelectedId(r.id);
    void qc.invalidateQueries({ queryKey: ["shared-source-imports", userId, project] });
  };
  const guarded = async (kind: "preview" | "start" | "cancel", fn: () => Promise<void>) => {
    if (inflight.current) return;
    inflight.current = true; setBusy(kind); setError(null);
    try { await fn(); } catch (e) { setError(safe(e, "Request failed.")); } finally { inflight.current = false; setBusy(null); }
  };

  const preview = (e: FormEvent) => {
    e.preventDefault();
    if (!repo || !ref.trim()) return;
    void guarded("preview", async () => {
      const r = await previewSourceImport({ repository: repo, ref: ref.trim(), folder: folder.trim().replace(/^\/+|\/+$/g, "") });
      setConfirmed(false); setFilter("all"); setRun(r);
    });
  };
  const start = () => current && confirmed && void guarded("start", async () => {
    const r = await startSourceImport(current.id);
    setConfirmed(false); setRun(r);
    toast({ title: "Import started", description: "Progress updates every 2 seconds. You can leave and return." });
  });
  const cancel = () => current && void guarded("cancel", async () => {
    const r = await cancelSourceImport(current.id);
    if (r) setRun(r); else await run.refetch();
    void qc.invalidateQueries({ queryKey: ["shared-assessments"] });
    void qc.invalidateQueries({ queryKey: ["shared-assessment"] });
    toast({ title: "Cancellation requested", description: "Records already committed keep their new revision." });
  });

  const entries = (current?.entries ?? []).filter(e => filter === "all" || e.status === filter);
  const total = current?.entries.length ?? 0;
  const processed = current ? total - counts.ready : 0;
  const pct = total ? Math.round((processed / total) * 100) : 0;
  const running = current?.status === "running";

  return (
    <section className="overflow-hidden rounded-lg border bg-card" data-testid="section-project-source-import">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/40 px-5 py-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold"><FolderGit2 className="h-4 w-4 text-primary" />Project source import</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Match one repository folder against every shared assessment you can edit in this project. Preview first; nothing changes until you confirm.</p>
        </div>
        <Button size="sm" variant="ghost" disabled={recent.isFetching} onClick={() => { void recent.refetch(); if (selectedId) void run.refetch(); }} data-testid="button-refresh-imports">
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${recent.isFetching ? "animate-spin" : ""}`} />Reload
        </Button>
      </div>

      <details className="border-b px-5 py-3 text-xs" data-testid="text-import-scope">
        <summary className="cursor-pointer font-medium">What an import does and does not do</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
          <li>Scope: all shared assessments you can edit in the currently selected project only. A browser-only workspace assessment must be shared first.</li>
          <li>Limits per run: at most 200 records, 10 files per record, 10 minutes. Records beyond the limit are Deferred; run a new preview to continue deferred or failed records.</li>
          <li>Records whose immutable sources are identical stay Unchanged and get no extra revision.</li>
          <li>Changed sources save a new Draft revision. Submitted or Approved records return to Draft and must be resubmitted. Narrative and classification are never changed.</li>
          <li>Attached source is visible to all members of the assessment. No GitHub writes and no AI are involved.</li>
        </ul>
      </details>

      {!usable ? (
        <p className="px-5 py-4 text-sm text-muted-foreground" data-testid="text-import-no-repos">Connect a repository above to run a project import.</p>
      ) : (
        <form onSubmit={preview} className="grid gap-3 border-b px-5 py-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] sm:items-end" data-testid="form-import-preview">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="imp-repo">Repository</Label>
            <select id="imp-repo" value={repo} onChange={e => setRepo(e.target.value)} disabled={running} className="h-9 w-full min-w-0 rounded-md border bg-background px-2 font-mono text-xs" data-testid="select-import-repo">
              <option value="">Choose repository</option>
              {repositories.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-ref">Branch, tag or commit</Label>
            <Input id="imp-ref" value={ref} onChange={e => setRef(e.target.value)} maxLength={200} disabled={running} className="h-9 font-mono text-xs" data-testid="input-import-ref" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="imp-folder">Folder <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="imp-folder" value={folder} onChange={e => setFolder(e.target.value)} maxLength={500} placeholder="Repository root" disabled={running} className="h-9 font-mono text-xs" data-testid="input-import-folder" />
          </div>
          <Button type="submit" className="h-9" disabled={!repo || !ref.trim() || !!busy || running} data-testid="button-import-preview">
            {busy === "preview" ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Previewing</> : "Preview"}
          </Button>
        </form>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-destructive/5 px-5 py-3 text-sm text-destructive" data-testid="text-import-error">
          <AlertTriangle className="h-4 w-4" /><span className="flex-1">{error}</span>
          <Button size="sm" variant="outline" onClick={() => setError(null)} data-testid="button-import-dismiss-error">Dismiss</Button>
        </div>
      )}

      {selectedId && run.isLoading ? (
        <div className="space-y-2 px-5 py-4"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-16 w-full" /></div>
      ) : selectedId && run.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-sm text-destructive" data-testid="status-import-run-error">
          <span>Could not load this run. {safe(run.error, "")}</span>
          <Button size="sm" variant="outline" onClick={() => void run.refetch()} data-testid="button-retry-import-run">Retry</Button>
        </div>
      ) : current ? (
        <div className="space-y-4 px-5 py-4" data-testid={`card-import-${current.id}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className="break-all font-mono text-sm font-medium" data-testid="text-import-provenance">{current.repository}@{current.ref}:{current.folder || "/"}</p>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">commit {current.commit.slice(0, 12)} · {fmt(current.createdAt)} · limit {current.limit} records</p>
            </div>
            <span className={`rounded border px-2 py-0.5 text-xs font-medium ${running ? "border-primary/40 bg-primary/10 text-primary" : current.status === "completed" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : current.status === "preview" ? "border-border bg-muted" : "border-amber-300 bg-amber-50 text-amber-900"}`} data-testid="status-import-run">
              {running && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}{RUN_LABEL[current.status]}
            </span>
          </div>
          {current.message && <p className="text-xs text-muted-foreground" data-testid="text-import-message">{current.message}</p>}

          {current.status !== "preview" && total > 0 && (
            <div className="space-y-1" data-testid="status-import-progress">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full origin-left bg-primary transition-transform duration-500" style={{ transform: `scaleX(${pct / 100})` }} /></div>
              <p className="text-[11px] text-muted-foreground">{processed} of {total} records processed</p>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
            <button type="button" onClick={() => setFilter("all")} className={`rounded border px-2 py-1 text-xs ${filter === "all" ? "border-foreground/40 bg-foreground/5 font-medium" : ""}`} data-testid="filter-import-all">All {total}</button>
            {STATUS_ORDER.filter(s => counts[s] > 0).map(s => (
              <button key={s} type="button" title={STATUS_META[s].hint} onClick={() => setFilter(s)} className={`rounded border px-2 py-1 text-xs ${STATUS_META[s].cls} ${filter === s ? "ring-2 ring-offset-1 ring-foreground/20" : ""}`} data-testid={`filter-import-${s}`}>
                {STATUS_META[s].label} <span className="font-mono">{counts[s]}</span>
              </button>
            ))}
          </div>

          {total === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground" data-testid="empty-import-entries">No editable shared assessment records in this project. Share a workspace assessment first, then preview again.</p>
          ) : (
            <ul className="max-h-[28rem] divide-y overflow-y-auto rounded-md border" data-testid="list-import-entries">
              {entries.map(en => (
                <li key={`${en.assessmentId}:${en.id}`} className="grid gap-1.5 px-3 py-2.5 text-xs sm:grid-cols-[minmax(0,1fr)_auto]" data-testid={`row-import-entry-${en.id}`}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_META[en.status].cls}`}>{STATUS_META[en.status].label}</span>
                      <span className="break-all font-mono font-medium">{en.name}</span>
                      <span className="text-muted-foreground">{en.kind} · v{en.version} · {en.state}</span>
                    </p>
                    <p className="mt-0.5 truncate text-muted-foreground">{en.assessmentName}</p>
                    {en.paths.length > 0 && <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">{en.paths.map(p => <li key={p} className="break-all">{p}</li>)}</ul>}
                    {en.message && <p className={`mt-1 ${en.status === "failed" ? "text-destructive" : "text-muted-foreground"}`} data-testid={`text-import-entry-message-${en.id}`}>{en.message}</p>}
                  </div>
                  <div className="sm:self-start">
                    <Button size="sm" variant={MANUAL.has(en.status) ? "outline" : "ghost"} className="h-7 text-xs" onClick={() => navigate(`/shared-assessments?id=${encodeURIComponent(en.assessmentId)}&entity=${encodeURIComponent(en.id)}`)} data-testid={`button-open-entry-${en.id}`}>
                      {MANUAL.has(en.status) ? "Map manually" : "Open"}<ExternalLink className="ml-1 h-3 w-3" />
                    </Button>
                  </div>
                </li>
              ))}
              {entries.length === 0 && <li className="p-3 text-center text-xs text-muted-foreground">No records with this status.</li>}
            </ul>
          )}

          {current.status === "preview" && counts.ready > 0 && (
            <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50/60 p-3 text-xs text-amber-950" data-testid="panel-import-confirm">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} data-testid="checkbox-import-confirm" />
                <span>I confirm the {counts.ready} Ready record{counts.ready === 1 ? "" : "s"} should receive these files from commit <span className="font-mono">{current.commit.slice(0, 12)}</span>. Changed records return to Draft (Submitted and Approved must be resubmitted), and the source becomes visible to every member of each assessment.</span>
              </label>
              <div className="flex justify-end">
                <Button size="sm" disabled={!confirmed || !!busy} onClick={start} data-testid="button-import-start">
                  {busy === "start" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}Start import
                </Button>
              </div>
            </div>
          )}
          {current.status === "preview" && counts.ready === 0 && total > 0 && (
            <p className="text-xs text-muted-foreground">Nothing is ready to import. Use manual mapping for the remaining records or try another branch or folder.</p>
          )}
          {running && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Cancelling keeps records already committed.</span>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={!!busy} onClick={cancel} data-testid="button-import-cancel">
                {busy === "cancel" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Square className="mr-1.5 h-3.5 w-3.5" />}Cancel run
              </Button>
            </div>
          )}
          {["completed", "cancelled", "interrupted"].includes(current.status) && (counts.deferred + counts.failed + counts.cancelled) > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="text-import-continue">{counts.deferred + counts.failed + counts.cancelled} record(s) still need source. Run a new preview with the same selection to continue.</p>
          )}
        </div>
      ) : !recent.isLoading && !recent.isError ? (
        <p className="px-5 py-6 text-center text-sm text-muted-foreground" data-testid="empty-imports">No project imports yet. Choose a repository and preview.</p>
      ) : null}

      <div className="border-t px-5 py-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground"><History className="h-3.5 w-3.5" />Your recent runs in this project</p>
        {recent.isLoading ? <Skeleton className="h-8 w-full" />
          : recent.isError ? (
            <p role="alert" className="flex items-center gap-2 text-xs text-destructive">Could not load recent runs. <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => void recent.refetch()} data-testid="button-retry-imports">Retry</Button></p>
          ) : recent.data?.length ? (
            <ul className="flex flex-wrap gap-1.5" data-testid="list-recent-imports">
              {recent.data.map(r => (
                <li key={r.id}>
                  <button type="button" onClick={() => { setSelectedId(r.id); setConfirmed(false); setFilter("all"); }} className={`rounded border px-2 py-1 text-left text-[11px] transition-colors hover:border-primary/50 ${r.id === selectedId ? "border-primary ring-1 ring-primary/30" : ""}`} data-testid={`button-recent-import-${r.id}`}>
                    <span className="font-mono">{r.repository}@{r.ref}</span> · {RUN_LABEL[r.status]} · {fmt(r.createdAt)}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">None yet.</p>}
      </div>
    </section>
  );
}
