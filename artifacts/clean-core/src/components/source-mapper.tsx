import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, GitBranch, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { githubFiles, githubStatus, stateKey } from "@/lib/shared-assessments";
import { MAX_SOURCE_PATHS, matchSourceFiles } from "@/lib/source-match";

export interface MappingSelection { repository: string; commit: string; paths: string[] }
export interface MappingPreparation { acknowledgements: string[]; notes: string[] }

const credentialError = (e: any) => e?.status === 401 || e?.status === 424 || /token|credential|expired|revoked|bad credentials/i.test(String(e?.message || ""));

/** Choose GitHub files for one record; nothing is attached without explicit confirmation. */
export function SourceMapper({ name, objectType, state, recordVersion, existingSources, blockedReason, prepare, commit, extra }: {
  name: string; objectType?: unknown; state?: string | null; recordVersion?: number | null; existingSources: unknown[] | null | undefined;
  blockedReason?: string | null; prepare?: () => Promise<MappingPreparation>; commit: (m: MappingSelection) => Promise<void>; extra?: ReactNode;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const status = useQuery({ queryKey: ["shared-github", user?.id], queryFn: ({ signal }) => githubStatus(signal), enabled: open && !!user });
  const [repo, setRepo] = useState("");
  const [ref, setRef] = useState("main");
  const [req, setReq] = useState<{ repo: string; ref: string; attempt: number } | null>(null);
  const files = useQuery({
    queryKey: ["github-files", user?.id, req?.repo, req?.ref, req?.attempt],
    queryFn: ({ signal }) => githubFiles(req!.repo, req!.ref, signal),
    enabled: !!req, retry: false, staleTime: 0, gcTime: 60_000,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [prep, setPrep] = useState<{ loading: boolean; error?: string; data?: MappingPreparation }>({ loading: false });
  const [acks, setAcks] = useState<Record<number, boolean>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const match = useMemo(() => files.data ? matchSourceFiles(files.data.files, { name, type: objectType }) : null, [files.data, name, objectType]);
  const loadFiles = () => {
    setSelected([]); setError(null);
    setReq({ repo, ref: ref.trim(), attempt: (req?.attempt ?? 0) + 1 });
  };
  // Preselect only the single exact group; ambiguity always needs an explicit choice.
  const seedKey = files.data && match ? JSON.stringify([req?.repo, req?.ref, req?.attempt, files.data.commit, match.target, match.type]) : null;
  useEffect(() => {
    setSelected(match && match.status === "exact" ? match.groups[0].paths : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);
  const [frozen, setFrozen] = useState<(MappingSelection & { version: number | null; state: string }) | null>(null);
  const stale = !!frozen && (frozen.version !== (recordVersion ?? null) || frozen.state !== (state || ""));
  const toggle = (p: string) => setSelected(s => s.includes(p) ? s.filter(x => x !== p) : s.length >= MAX_SOURCE_PATHS ? s : [...s, p]);
  const sources = (Array.isArray(existingSources) ? existingSources : []) as any[];
  const others = sources.filter(s => !(s?.repository === req?.repo && selected.includes(s?.path))).length;
  const overLimit = others + selected.length > MAX_SOURCE_PATHS;
  const sealed = ["submitted", "approved"].includes(stateKey(state || ""));

  const openConfirm = async () => {
    if (!files.data || !req || blockedReason || selected.length === 0) return;
    setFrozen({ repository: req.repo, commit: files.data.commit, paths: [...selected], version: recordVersion ?? null, state: state || "" });
    setConfirming(true); setAcks({}); setConfirmed(false); setError(null);
    if (!prepare) { setPrep({ loading: false, data: { acknowledgements: [], notes: [] } }); return; }
    setPrep({ loading: true });
    try { setPrep({ loading: false, data: await prepare() }); }
    catch (e: any) { setPrep({ loading: false, error: e?.message || "Could not check who can read this record." }); }
  };
  const allAcked = !stale && !blockedReason && !!prep.data && prep.data.acknowledgements.every((_, n) => acks[n]) && confirmed;
  const run = async () => {
    const chosen = frozen;
    if (!chosen || !allAcked || busy || blockedReason || stale) return;
    setBusy(true); setError(null);
    try {
      await commit({ repository: chosen.repository, commit: chosen.commit, paths: chosen.paths });
      setConfirming(false); setSelected([]); setOpen(false); setFrozen(null);
      toast({ title: "Source mapped", description: `${chosen.paths.length} file${chosen.paths.length === 1 ? "" : "s"} attached at ${chosen.commit.slice(0, 7)}. Narrative and classification unchanged.` });
    } catch (e: any) {
      setError(e?.status === 409 ? "The record changed since you opened it. Nothing was mapped; refresh and confirm again."
        : credentialError(e) ? "GitHub rejected the saved credential (expired or revoked). Replace the token in GitHub Connections, then retry."
        : `${e?.message || "Mapping failed"}. Nothing was mapped.`);
    } finally { setBusy(false); }
  };

  const filesError = files.error as any;
  const shownFiles = (files.data?.files || []).filter(f => !filter || f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 300);

  return (
    <div className="min-w-0 space-y-2" data-testid="source-mapper">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant={open ? "secondary" : "outline"} className="h-8" disabled={!!blockedReason} onClick={() => setOpen(v => !v)} data-testid="button-open-source-mapper">
          <GitBranch className="mr-1.5 h-3.5 w-3.5" />{sources.length ? "Re-map GitHub source" : "Map GitHub source"}
        </Button>
        <Button size="sm" variant="link" className="h-8 text-xs" onClick={() => navigate("/shared-assessments?tab=github")} data-testid="button-project-source-import">Import source across project</Button>
        {extra}
      </div>
      {blockedReason && <p className="text-[11px] text-muted-foreground" role="status" data-testid="text-mapping-blocked">{blockedReason}</p>}
      {open && !blockedReason && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs">
          {status.isLoading ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking GitHub connections</p>
            : status.error ? <p role="alert" className="text-destructive">{(status.error as Error).message} <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void status.refetch()} data-testid="button-retry-github-status">Retry</Button></p>
            : !status.data?.configured ? <p data-testid="text-github-unavailable">Secure GitHub credential storage is unavailable on this server. Saved sources remain viewable.</p>
            : !status.data.connected ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="text-github-not-connected">
                <span className="flex-1">No usable GitHub connection. Connect a repository with a read-only token first.</span>
                <Button size="sm" className="h-7" onClick={() => navigate("/shared-assessments?tab=github")} data-testid="button-setup-github">Set up GitHub connection</Button>
              </div>
            ) : <>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
                <select aria-label="Repository" value={repo} onChange={e => { setRepo(e.target.value); setReq(null); setSelected([]); }} className="h-8 min-w-0 max-w-full rounded-md border bg-background px-2 font-mono text-[11px]" data-testid="select-github-repo">
                  <option value="">Choose repository</option>
                  {status.data.repositories.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <Input aria-label="Branch, tag or commit" value={ref} onChange={e => { setRef(e.target.value); setReq(null); setSelected([]); }} placeholder="Branch, tag or commit" className="h-8 font-mono text-[11px]" data-testid="input-github-ref" />
                <Button size="sm" variant="outline" className="h-8" disabled={!repo || !ref.trim() || files.isFetching} onClick={loadFiles} data-testid="button-load-files">{files.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Find files"}</Button>
              </div>
              {files.isFetching && <p className="flex items-center gap-2 text-muted-foreground" role="status" data-testid="status-files-loading"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading file list from GitHub</p>}
              {filesError && !files.isFetching && (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive" data-testid="status-files-error">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="flex-1">{credentialError(filesError) ? "GitHub rejected the saved credential; it may be expired or revoked." : filesError.message}</span>
                  {credentialError(filesError) && <Button size="sm" variant="outline" className="h-7" onClick={() => navigate("/shared-assessments?tab=github")} data-testid="button-replace-credential">Replace token</Button>}
                  <Button size="sm" variant="outline" className="h-7" onClick={() => void files.refetch()} data-testid="button-retry-files">Retry</Button>
                </div>
              )}
              {files.data && match && !files.isFetching && <>
                <p className="font-mono text-[10px] text-muted-foreground">Commit {files.data.commit.slice(0, 12)} · {files.data.files.length} files</p>
                <div className={`rounded border p-2 ${match.status === "exact" ? "border-emerald-300 bg-emerald-50/60" : match.status === "ambiguous" ? "border-amber-300 bg-amber-50/60" : "border-dashed"}`} data-testid={`status-match-${match.status}`}>
                  {match.status === "exact" && <p><strong>Exact match</strong> for <span className="font-mono">{match.target}</span>: main file plus {match.groups[0].related.length} related. Review the selection below, then confirm.</p>}
                  {match.status === "ambiguous" && <p><strong>Several candidates</strong> for <span className="font-mono">{match.target}</span>. Choose one group explicitly.</p>}
                  {match.status === "unmatched" && <p><strong>No file named</strong> <span className="font-mono">{match.target}</span>{match.type ? ` (${match.type})` : ""}. Select files manually below or check the branch.</p>}
                  {match.status === "invalid" && <p>This record has no object name to match. Select files manually.</p>}
                  {match.groups.length > 0 && <ul className="mt-1.5 space-y-1">{match.groups.map((g, n) => (
                    <li key={g.id}><button type="button" onClick={() => setSelected(g.paths)} className={`w-full rounded border bg-background px-2 py-1 text-left transition-colors hover:border-primary/50 ${g.paths.every(p => selected.includes(p)) && g.paths.length === selected.length ? "border-primary ring-1 ring-primary/30" : ""}`} data-testid={`button-match-group-${n}`}>
                      <span className="block font-mono text-[10px]">{g.folder || "(root)"} · {g.type || "untyped"} · {g.main ? "main + " : "no main file, "}{g.related.length} related{g.truncated ? " (first 10)" : ""}</span>
                    </button></li>
                  ))}</ul>}
                </div>
                <div className="relative"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Manual selection: filter files" className="h-8 pl-7 text-[11px]" data-testid="input-filter-files" /></div>
                <ul className="max-h-48 overflow-y-auto rounded border bg-background">
                  {shownFiles.map(fl => (
                    <li key={fl.path}><label className="flex cursor-pointer items-center gap-2 px-2 py-1 hover:bg-muted/50">
                      <input type="checkbox" checked={selected.includes(fl.path)} disabled={!selected.includes(fl.path) && selected.length >= MAX_SOURCE_PATHS} onChange={() => toggle(fl.path)} data-testid={`checkbox-file-${fl.path}`} />
                      <span className="truncate font-mono text-[10px]">{fl.path}</span>
                    </label></li>
                  ))}
                  {shownFiles.length === 0 && <li className="p-2 text-center text-muted-foreground">No files match.</li>}
                </ul>
                {(files.data.files.filter(f => !filter || f.path.toLowerCase().includes(filter.toLowerCase())).length > 300) &&
                  <p className="text-[10px] text-muted-foreground">Showing the first 300 matching paths. Narrow the filter to find additional files.</p>}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span data-testid="text-selected-count">{selected.length}/{MAX_SOURCE_PATHS} selected{sources.length ? ` · ${others} other saved` : ""}</span>
                  <Button size="sm" className="h-8" disabled={selected.length === 0 || overLimit} onClick={() => void openConfirm()} data-testid="button-review-mapping">Review mapping</Button>
                </div>
                {overLimit && <p role="alert" className="text-destructive">A record keeps at most {MAX_SOURCE_PATHS} source files. Deselect files to continue.</p>}
              </>}
            </>}
        </div>
      )}
      <Dialog open={confirming} onOpenChange={o => { if (!o && !busy) setConfirming(false); }}>
        <DialogContent className="max-w-lg" data-testid="dialog-confirm-mapping">
          <DialogHeader>
            <DialogTitle>Map {frozen?.paths.length ?? 0} file{frozen?.paths.length === 1 ? "" : "s"} to {name}?</DialogTitle>
            <DialogDescription>From <span className="font-mono">{frozen?.repository}</span> at immutable commit <span className="font-mono">{frozen?.commit.slice(0, 12)}</span>.</DialogDescription>
          </DialogHeader>
          {(stale || blockedReason) && <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-950" data-testid="status-mapping-stale">{blockedReason || "This record changed (version or state) after you opened this confirmation. Cancel and review again."}</p>}
          <ul className="max-h-32 overflow-y-auto rounded border bg-muted/30 p-2 font-mono text-[10px]">{(frozen?.paths || []).map(p => <li key={p} className="truncate">{p}</li>)}</ul>
          <div className={`rounded border p-2 text-xs ${sealed ? "border-amber-400 bg-amber-50 text-amber-950" : "bg-muted/30"}`} data-testid="text-mapping-state-warning">
            Mapping saves a new version in <strong>Draft</strong>.{sealed ? ` This record is currently ${state}; it returns to Draft and must be sent for approval again.` : " Submitted or Approved records return to Draft."} Previously approved exports remain unchanged. Narrative, classification and other content are not changed and no proposal is applied.
          </div>
          {prep.loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking who can read this record</p>}
          {prep.error && <p role="alert" className="text-xs text-destructive">{prep.error} <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void openConfirm()}>Retry</Button></p>}
          {prep.data?.notes.map((n, k) => <p key={k} className="text-xs text-muted-foreground">{n}</p>)}
          {prep.data?.acknowledgements.map((a, k) => (
            <label key={k} className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50/60 p-2 text-xs"><input type="checkbox" checked={!!acks[k]} onChange={e => setAcks(s => ({ ...s, [k]: e.target.checked }))} data-testid={`checkbox-mapping-ack-${k}`} /><span>{a}</span></label>
          ))}
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} data-testid="checkbox-confirm-mapping" /><span>I confirm these files are the source for this record.</span></label>
          {error && <p role="alert" className="text-xs text-destructive" data-testid="status-mapping-error">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)} data-testid="button-cancel-mapping">Cancel</Button>
            <Button disabled={!allAcked || busy} onClick={() => void run()} data-testid="button-confirm-map">{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirm mapping</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
