import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { getSource, isUploadSource } from "@/lib/shared-assessments";

const MAX_CHARS = 200_000;
const MAX_LINES = 4_000;

export interface SourceHolder { id: string; version: number; sources?: unknown[] | null }

/** Read-only viewer of saved source snapshots. Uses only server snapshots; never GitHub credentials. */
export function SourceViewer({ entity }: { entity: SourceHolder }) {
  const { user } = useAuth();
  const sources = (Array.isArray(entity.sources) ? entity.sources : []) as any[];
  const [index, setIndex] = useState(0);
  useEffect(() => { setIndex(0); }, [entity.id, entity.version]);
  const i = index < sources.length ? index : 0;
  // Key isolates user + entity + version + index; the signal aborts superseded reads.
  const q = useQuery({
    queryKey: ["shared-source", user?.id, entity.id, entity.version, i],
    queryFn: ({ signal }) => getSource(entity.id, i, signal, entity.version),
    enabled: sources.length > 0 && !!user, staleTime: 60_000, retry: false,
  });
  if (sources.length === 0) {
    return <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground" data-testid="empty-source">No source attached yet. Map files from GitHub or upload a .txt/.abap file.</p>;
  }
  const s = sources[i] || {};
  const code = q.data?.code ?? "";
  const lines = code.slice(0, MAX_CHARS).split("\n");
  const shown = lines.slice(0, MAX_LINES);
  const truncated = code.length > MAX_CHARS || lines.length > MAX_LINES;
  return (
    <div className="min-w-0 max-w-full space-y-2" data-testid="source-viewer">
      <div className="flex flex-wrap items-center gap-2">
        <FileCode className="h-4 w-4 text-muted-foreground" />
        <label className="sr-only" htmlFor={`source-file-${entity.id}`}>Source file</label>
        <select id={`source-file-${entity.id}`} value={i} onChange={e => setIndex(Number(e.target.value))} disabled={sources.length < 2}
          className="h-8 w-0 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px]" data-testid="select-source-file">
          {sources.map((src: any, n: number) => <option key={n} value={n}>{`${isUploadSource(src) ? "[Upload] " : "[GitHub] "}${String(src?.path ?? `File ${n + 1}`)}`}</option>)}
        </select>
        <span className="font-mono text-[10px] text-muted-foreground">{i + 1}/{sources.length}</span>
      </div>
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]" data-testid="text-source-provenance">
        {isUploadSource(s) ? <>
          <dt className="text-muted-foreground">Origin</dt><dd data-testid="text-source-origin">Uploaded file (no repository or commit)</dd>
          <dt className="text-muted-foreground">File</dt><dd className="break-all font-mono">{String(s.path ?? "")}</dd>
          <dt className="text-muted-foreground">SHA-256</dt><dd className="break-all font-mono" data-testid="text-source-sha256">{String(s.sha256 ?? "")}</dd>
          <dt className="text-muted-foreground">Size</dt><dd className="font-mono">{Number.isFinite(Number(s.byteLength)) ? `${Number(s.byteLength).toLocaleString()} bytes` : ""}</dd>
          <dt className="text-muted-foreground">Uploaded</dt><dd className="font-mono">{Number.isFinite(Date.parse(String(s.uploadedAt ?? ""))) ? new Date(String(s.uploadedAt)).toLocaleString() : String(s.uploadedAt ?? "")}</dd>
          <dt className="text-muted-foreground">Uploader ID</dt><dd className="break-all font-mono" data-testid="text-source-uploader">{String(s.uploadedBy ?? "")}</dd>
        </> : <>
          <dt className="text-muted-foreground">Origin</dt><dd data-testid="text-source-origin">GitHub</dd>
          <dt className="text-muted-foreground">Repository</dt><dd className="break-all font-mono">{String(s.repository ?? "")}</dd>
          <dt className="text-muted-foreground">Path</dt><dd className="break-all font-mono">{String(s.path ?? "")}</dd>
          <dt className="text-muted-foreground">Commit</dt><dd className="break-all font-mono" title={String(s.commit ?? "")}>{String(s.commit ?? "").slice(0, 12)}</dd>
        </>}
      </dl>
      {q.isLoading ? <Skeleton className="h-48 w-full" data-testid="status-source-loading" /> : q.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="status-source-error">
          <AlertTriangle className="h-4 w-4" /><span className="flex-1">{(q.error as any)?.status === 409 ? "The record changed while loading. Refresh to see the current source." : (q.error as Error).message || "Could not load the saved source."}</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => void q.refetch()} data-testid="button-retry-source">Retry</Button>
        </div>
      ) : (
        <>
          <div className="max-h-[420px] min-w-0 max-w-full overflow-auto rounded-md bg-[#081d33] text-slate-100">
            <pre className="min-w-max p-0 font-mono text-[11px] leading-[1.55]" data-testid="text-source-code">
              {shown.map((l, n) => <div key={n} className="flex"><span className="sticky left-0 w-11 shrink-0 select-none bg-[#081d33] pr-3 text-right text-slate-500">{n + 1}</span><span className="pr-4">{l || " "}</span></div>)}
            </pre>
          </div>
          {truncated && <p className="text-[10px] text-muted-foreground" data-testid="text-source-truncated">Display limited to the first {MAX_LINES.toLocaleString()} lines / {MAX_CHARS.toLocaleString()} characters. The saved snapshot is complete.</p>}
        </>
      )}
    </div>
  );
}
