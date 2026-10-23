import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, Download, Eye, FolderCheck, Loader2, RefreshCw, Star, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { downloadFrom, saveBlob } from "@/lib/word-reports";
import { BASE, MAX_APPROVAL_BATCH, MAX_COMPANY_TEMPLATE_BYTES, listApprovals, listCompanyTemplates, setCompanyDefault, uploadCompanyTemplate } from "@/lib/shared-assessments";

function Err({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"><AlertTriangle className="h-4 w-4" /><span className="flex-1">{message}</span><Button size="sm" variant="outline" className="bg-white" onClick={onRetry}>Retry</Button></div>;
}

export function ApprovedAssessmentsFolder({ canExport: _workspaceExport }: { canExport?: boolean }) {
  const { toast } = useToast();
  const { can, user } = useAuth();
  const canExport = can("export");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | "object" | "interface">("all");
  const [filterSearch, setFilterSearch] = useState("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [refreshId, setRefreshId] = useState(0);
  const page = cursors.length - 1;
  const params = { limit: 50, cursor: cursors[page], search: filterSearch, kind, showSuperseded: showSuperseded ? "true" as const : "false" as const };
  const q = useQuery({
    queryKey: ["shared-approvals", user?.id, params, refreshId],
    queryFn: ({ signal }) => listApprovals(params, signal),
    // Do not silently move the first page while following its cursors.
    refetchOnWindowFocus: false, staleTime: 0,
  });
  useEffect(() => {
    const timer = setTimeout(() => { setFilterSearch(search.trim()); setCursors([undefined]); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => { setSel(new Set()); setCursors([undefined]); }, [user?.id]);
  const reset = () => { setCursors([undefined]); setRefreshId(n => n + 1); };
  const [busy, setBusy] = useState(false);
  const rows = q.data?.approvals || [];
  const toggle = (id: string) => setSel(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else if (n.size < MAX_APPROVAL_BATCH) n.add(id); return n; });
  const download = async () => {
    const ids = [...sel]; if (!ids.length || ids.length > MAX_APPROVAL_BATCH) return;
    setBusy(true);
    try {
      const { blob, filename } = await downloadFrom(`${BASE}/approvals/download`, { method: "POST", json: { ids } }, ids.length === 1 ? "approved-assessment.docx" : "approved-assessments.zip", { fallbackError: "Download failed" });
      saveBlob(blob, filename); toast({ title: ids.length === 1 ? "Approved report downloaded" : `${ids.length} approved reports downloaded`, description: "Rendered from the approved snapshot, not current edits." });
    } catch (e: any) { toast({ title: "Download failed", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <section className="rounded-lg border bg-card" data-testid="section-approved-folder">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <FolderCheck className="h-5 w-5 text-primary" />
        <div className="flex-1"><h3 className="font-semibold">Approved Assessments</h3><p className="text-xs text-muted-foreground">Immutable approved snapshots from shared assessments. Word output uses each approval's saved template.</p></div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Checkbox checked={showSuperseded} onCheckedChange={v => { setShowSuperseded(!!v); setCursors([undefined]); }} data-testid="checkbox-show-superseded" />Show superseded</label>
        <Button size="sm" variant="ghost" aria-label="Refresh newest approvals" onClick={reset} data-testid="button-refresh-approvals"><RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /></Button>
        <Button size="sm" disabled={!canExport || busy || sel.size === 0 || sel.size > MAX_APPROVAL_BATCH} onClick={() => void download()} data-testid="button-download-approvals">
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}{sel.size > 1 ? `Download ZIP (${sel.size})` : "Download Word"}
        </Button>
      </header>
      <div className="flex flex-wrap gap-2 border-b p-3">
        <Input aria-label="Search approved assessments" placeholder="Search name, assessment, approver, UTC date or version" maxLength={200} value={search} onChange={e => setSearch(e.target.value)} className="min-w-64 flex-1" />
        <select aria-label="Approved record type" value={kind} onChange={e => { setKind(e.target.value as typeof kind); setCursors([undefined]); }} className="rounded-md border bg-background px-3 text-sm">
          <option value="all">Objects and interfaces</option><option value="object">Objects</option><option value="interface">Interfaces</option>
        </select>
        {sel.size > 0 && <Button variant="ghost" size="sm" onClick={() => setSel(new Set())}>Clear {sel.size} selected</Button>}
      </div>
      <p className="border-b px-4 py-1.5 text-xs text-muted-foreground">Select up to {MAX_APPROVAL_BATCH} reports across pages (40 MB per download). Selections stay selected when filters change. Refresh to see new approvals.</p>
      {sel.size === MAX_APPROVAL_BATCH && <p role="status" className="border-b bg-amber-50 px-4 py-1.5 text-xs text-amber-900">Batch limit reached. Clear a selection to choose another report.</p>}
      <div className="max-h-80 overflow-y-auto">
        {q.isLoading && <div className="space-y-2 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>}
        {q.error && <div className="p-4"><Err message={(q.error as Error).message} onRetry={() => void q.refetch()} /></div>}
        {!q.isLoading && !q.error && rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground" data-testid="empty-approvals">No approved records match these filters. Try another search, show superseded approvals, or refresh for new approvals.</p>}
        {rows.map(a => (
          <label key={a.id} className={`flex cursor-pointer items-center gap-3 border-b px-4 py-2 text-sm transition-colors last:border-0 hover:bg-muted/40 ${a.superseded ? "opacity-60" : ""}`} data-testid={`row-approval-${a.id}`}>
            <Checkbox aria-label={`Select ${a.name} version ${a.version}`} checked={sel.has(a.id)} disabled={!sel.has(a.id) && sel.size >= MAX_APPROVAL_BATCH} onCheckedChange={() => toggle(a.id)} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{a.name} <span className="font-mono text-[10px] text-muted-foreground">{a.kind} · v{a.version}</span></span>
              <span className="block truncate text-xs text-muted-foreground">{a.assessment_name} · approved by {a.approver} · {new Date(a.approved_at).toLocaleString()}</span></span>
            <span className="hidden font-mono text-[10px] text-muted-foreground md:inline">{a.template_name ? `${a.template_name} v${a.template_version}` : "default template"}</span>
            {a.superseded && <Badge variant="outline" className="text-[10px]">superseded</Badge>}
          </label>
        ))}
      </div>
      <nav aria-label="Approved archive pages" className="flex items-center justify-between gap-3 border-t px-4 py-3">
        <Button size="sm" variant="outline" disabled={page === 0 || q.isFetching} onClick={() => setCursors(p => p.slice(0, -1))} data-testid="button-approvals-previous">Previous</Button>
        <span className="text-xs text-muted-foreground" aria-live="polite">Page {page + 1} · {rows.length} reports · {sel.size} selected</span>
        <Button size="sm" variant="outline" disabled={!q.data?.nextCursor || q.isFetching || !!q.error || search.trim() !== filterSearch} onClick={() => {
          if (q.data?.nextCursor) setCursors(p => [...p.slice(0, -1), q.data!.pageCursor ?? p[page], q.data!.nextCursor!]);
        }} data-testid="button-approvals-next">Next</Button>
      </nav>
    </section>
  );
}

export function CompanyTemplatesSection() {
  const { isAdmin, can } = useAuth(); const { toast } = useToast(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["company-templates"], queryFn: ({ signal }) => listCompanyTemplates(signal) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(""); const [replace, setReplace] = useState<{ id: string; expectedVersion: number; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["company-templates"] }); void qc.invalidateQueries({ queryKey: ["word-templates"] }); };
  const upload = async (file: File) => {
    if (!/\.docx$/i.test(file.name)) { toast({ title: "DOCX only", variant: "destructive" }); return; }
    if (file.size > MAX_COMPANY_TEMPLATE_BYTES) { toast({ title: "Template too large", description: "Company templates must be 4 MB or smaller.", variant: "destructive" }); return; }
    const n = (replace?.name || name).trim(); if (!n) { toast({ title: "Name required", variant: "destructive" }); return; }
    setBusy("upload");
    try { await uploadCompanyTemplate(file, n, replace ? { id: replace.id, expectedVersion: replace.expectedVersion } : undefined); setName(""); setReplace(null); refresh(); toast({ title: replace ? "New version uploaded" : "Company template uploaded", description: "Preview it before it can become the default. Previous versions are retained." }); }
    catch (e: any) { toast({ title: "Upload failed", description: e?.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const preview = async (id: string, expectedVersion: number) => {
    setBusy(`p-${id}`);
    try { const { blob, filename } = await downloadFrom(`${BASE}/company-templates/${encodeURIComponent(id)}/preview`, { method: "POST", json: { expectedVersion } }, "company-template-preview.docx", { fallbackError: "Preview failed" }); saveBlob(blob, filename); refresh(); }
    catch (e: any) { toast({ title: "Preview failed", description: e?.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const makeDefault = async (id: string, expectedVersion: number) => {
    setBusy(`d-${id}`);
    try { await setCompanyDefault(id, expectedVersion); refresh(); toast({ title: "Company default set" }); }
    catch (e: any) { toast({ title: "Not set as default", description: e?.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  return (
    <section className="rounded-lg border bg-card" data-testid="section-company-templates">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Building2 className="h-5 w-5 text-primary" />
        <div className="flex-1"><h3 className="font-semibold">Company Word templates</h3><p className="text-xs text-muted-foreground">Organisation-wide layouts. Only an Admin preview makes a template selectable. The company default is preselected for Word downloads; your private templates stay under Word report templates.</p></div>
      </header>
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2">
          <input ref={fileRef} type="file" accept=".docx" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} data-testid="input-company-template-file" />
          {replace ? <span className="text-xs">Replacing <strong>{replace.name}</strong> v{replace.expectedVersion} <button className="ml-1 underline" onClick={() => setReplace(null)}>cancel</button></span>
            : <Input value={name} onChange={e => setName(e.target.value)} placeholder="Template name" maxLength={100} className="h-8 w-56 bg-background" data-testid="input-company-template-name" />}
          <Button size="sm" disabled={busy === "upload" || (!replace && !name.trim())} onClick={() => fileRef.current?.click()} data-testid="button-upload-company-template">
            {busy === "upload" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}Choose DOCX (4 MB)
          </Button>
        </div>
      )}
      {q.isLoading && <div className="p-4"><Skeleton className="h-8 w-full" /></div>}
      {q.error && <div className="p-4"><Err message={(q.error as Error).message} onRetry={() => void q.refetch()} /></div>}
      {q.data && !q.data.configured && <p className="p-4 text-sm text-muted-foreground">Company template storage is not configured on this server.</p>}
      {q.data?.configured && q.data.templates.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground" data-testid="empty-company-templates">No company templates yet.{isAdmin ? " Upload one above." : ""}</p>}
      {q.data?.templates.map(t => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm last:border-0" data-testid={`row-company-template-${t.id}`}>
          <span className="min-w-0 flex-1 truncate font-medium">{t.name} <span className="font-mono text-[10px] text-muted-foreground">v{t.version}</span></span>
          {t.active && <Badge className="gap-1 text-[10px]"><Star className="h-3 w-3" />Company default</Badge>}
          {!t.previewed && <Badge variant="outline" className="text-[10px]">not previewed</Badge>}
          <Button size="sm" variant="ghost" disabled={!!busy || !can("export")} title={isAdmin ? "Preview (marks the template selectable)" : "Preview only; an Admin preview is required before it becomes selectable"} onClick={() => void preview(t.id, t.version)} data-testid={`button-preview-company-${t.id}`}>{busy === `p-${t.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}</Button>
          {isAdmin && <>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { setReplace({ id: t.id, expectedVersion: t.version, name: t.name }); setTimeout(() => fileRef.current?.click(), 0); }} data-testid={`button-replace-company-${t.id}`}>Replace</Button>
            {!t.active && <Button size="sm" variant="outline" disabled={!!busy || !t.previewed} title={!t.previewed ? "Preview first" : undefined} onClick={() => void makeDefault(t.id, t.version)} data-testid={`button-default-company-${t.id}`}>Set default</Button>}
          </>}
        </div>
      ))}
    </section>
  );
}
