import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, BookOpen, Download, FileText, Library, Loader2, RefreshCw, Search, ShieldCheck, Trash2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { YashLogo } from "@/components/yash-logo";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiJson, readApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { KnowledgeCleanup } from "@/components/knowledge-cleanup";
import {
  KNOWLEDGE_EXTENSIONS, KNOWLEDGE_RELEASES, formatBytes, parseTopics, putFileWithProgress, validateKnowledgeUpload,
  type KnowledgeDetail, type KnowledgeDocument, type KnowledgeList, type KnowledgeStatus,
} from "@/lib/knowledge";

const BASE = "/api/clean-core/knowledge";
type Perm = "knowledge.read" | "knowledge.upload" | "knowledge.manage-all";

function useKnowledgeAccess() {
  const auth = useAuth();
  const can = (p: Perm) => auth.can(p);
  const uid = auth.user ? String(auth.user.id) : "";
  return {
    read: can("knowledge.read"), upload: can("knowledge.upload"), manageAll: can("knowledge.manage-all"),
    owns: (d: KnowledgeDocument) => d.ownerId === uid,
  };
}

const STATUS: Record<KnowledgeStatus, { label: string; cls: string }> = {
  "awaiting-upload": { label: "Awaiting upload", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  processing: { label: "Processing", cls: "bg-sky-50 text-sky-800 ring-sky-200" },
  ready: { label: "Ready", cls: "bg-[#e8f8f4] text-[#0b3d36] ring-[#70d6c2]" },
  failed: { label: "Failed", cls: "bg-red-50 text-red-800 ring-red-200" },
};

function StatusPill({ status, id }: { status: KnowledgeStatus; id: string }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ${s.cls}`} data-testid={`status-document-${id}`}>
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}{s.label}
    </span>
  );
}

export default function KnowledgePage() {
  const { user } = useAuth();
  const access = useKnowledgeAccess();
  const [, navigate] = useLocation();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [uploadFor, setUploadFor] = useState<KnowledgeDocument | "new" | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const list = useQuery({
    queryKey: ["knowledge", "list", debounced],
    enabled: access.read,
    queryFn: () => apiJson<KnowledgeList>(`${BASE}${debounced ? `?q=${encodeURIComponent(debounced)}` : ""}`),
    refetchOnWindowFocus: "always",
    refetchInterval: (query) => query.state.data?.documents.some(d => d.status === "processing" || d.status === "awaiting-upload") ? 5000 : false,
  });

  if (!access.read) {
    return (
      <Shell onBack={() => navigate("/")}>
        <div className="mx-auto max-w-md py-20 text-center" data-testid="status-knowledge-denied">
          <ShieldCheck className="mx-auto h-8 w-8 text-slate-400" />
          <h1 className="mt-3 text-lg font-semibold">No knowledge base access</h1>
          <p className="mt-1 text-sm text-slate-600">Your account does not have the knowledge.read permission. Ask an administrator to grant it.</p>
        </div>
      </Shell>
    );
  }

  const docs = list.data?.documents ?? [];
  const err = list.error as (Error & { status?: number }) | null;

  return (
    <Shell onBack={() => navigate("/")} action={access.upload && list.data?.configured !== false ? (
      <Button size="sm" className="bg-[#081d33] hover:bg-[#0f2c4a]" onClick={() => setUploadFor("new")} data-testid="button-upload-document">
        <Upload className="mr-2 h-4 w-4" /> Add document
      </Button>
    ) : null}>
      <div className="border-b border-slate-200 bg-white/70 px-4 py-2.5 text-xs text-slate-600 md:px-8" data-testid="text-shared-notice">
        <span className="font-semibold text-[#081d33]">Shared library.</span> Every document here is visible to all accounts on this deployment with read access.
        {access.manageAll ? " You can manage all documents." : access.upload ? " You can add documents and manage the ones you own." : " Your access is read-only."}
      </div>

      {list.data && !list.data.configured && (
        <div className="mx-4 mt-4 flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 md:mx-8" data-testid="status-knowledge-unconfigured">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><p className="font-medium">Knowledge base is not configured</p><p>{list.data.message || "Storage for documents is not available on this deployment."}</p></div>
        </div>
      )}

      {user?.role === "Admin" && <KnowledgeCleanup />}
      <div className="grid gap-0 md:grid-cols-[minmax(300px,380px)_1fr]">
        <aside className="border-slate-200 p-4 md:min-h-[calc(100dvh-110px)] md:border-r md:p-6">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search titles, topics, text" className="bg-white pl-8" maxLength={200} data-testid="input-search-knowledge" />
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-slate-500">
            <span data-testid="text-document-count">{list.isSuccess ? `${docs.length} document${docs.length === 1 ? "" : "s"}` : " "}</span>
            {list.isFetching && !list.isLoading && <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> syncing</span>}
          </div>

          <div className="mt-3 space-y-2">
            {list.isLoading && [0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[74px] w-full" />)}
            {err && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="status-knowledge-error">
                <p className="font-medium">{err.status === 403 ? "Access denied" : "Could not load the library"}</p>
                <p className="mt-0.5 text-xs">{err.message}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => void list.refetch()} data-testid="button-retry-knowledge"><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry</Button>
              </div>
            )}
            {list.isSuccess && docs.length === 0 && (
              <div className="rounded-md border border-dashed border-slate-300 p-6 text-center" data-testid="status-knowledge-empty">
                <Library className="mx-auto h-6 w-6 text-slate-400" />
                <p className="mt-2 text-sm font-medium text-slate-700">{debounced ? "No matches" : "The library is empty"}</p>
                <p className="mt-0.5 text-xs text-slate-500">{debounced ? `Nothing matches "${debounced}".` : access.upload ? "Add SAP guides, release notes or internal standards." : "Nothing has been shared yet."}</p>
              </div>
            )}
            {docs.map(d => (
              <button key={d.id} onClick={() => setSelected(d.id)} data-testid={`card-document-${d.id}`}
                className={`block w-full rounded-md border bg-white p-3 text-left transition hover:border-[#081d33]/40 ${selected === d.id ? "border-[#081d33] shadow-[inset_3px_0_0_#70d6c2]" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-medium text-[#081d33]">{d.title}</p>
                  <StatusPill status={d.status} id={d.id} />
                </div>
                <p className="mt-1 truncate font-mono text-[10px] text-slate-500">{d.release} · v{d.version} · {d.filename}</p>
                {d.status === "failed" && d.error && <p className="mt-1 line-clamp-2 text-xs text-red-700">{d.error}</p>}
              </button>
            ))}
          </div>
        </aside>

        <section className="p-4 md:p-8">
          {selected
            ? <DocumentDetail key={selected} id={selected} onClose={() => setSelected(null)} onReplace={d => setUploadFor(d)} />
            : (
              <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center text-slate-500" data-testid="status-no-selection">
                <BookOpen className="h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm">Select a document to inspect its extracted passages.</p>
              </div>
            )}
        </section>
      </div>

      {uploadFor && <UploadDialog target={uploadFor} onClose={() => setUploadFor(null)} onDone={id => { setUploadFor(null); setSelected(id); }} />}
    </Shell>
  );
}

function Shell({ children, onBack, action }: { children: React.ReactNode; onBack: () => void; action?: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-[#f3f6f9]">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-8">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-workspace"><ArrowLeft className="mr-1.5 h-4 w-4" /> Workspace</Button>
        <YashLogo />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-[#081d33]">Knowledge base</h1>
          <p className="hidden font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:block">Reference library for assessments</p>
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

function DocumentDetail({ id, onClose, onReplace }: { id: string; onClose: () => void; onReplace: (d: KnowledgeDocument) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const detail = useQuery({
    queryKey: ["knowledge", "detail", id],
    queryFn: () => apiJson<KnowledgeDetail>(`${BASE}/${encodeURIComponent(id)}`),
    refetchOnWindowFocus: "always",
    refetchInterval: (query) => query.state.data?.status === "processing" ? 5000 : false,
  });

  if (detail.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-40 w-full" /></div>;
  if (detail.error || !detail.data) {
    const e = detail.error as (Error & { status?: number }) | null;
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid="status-detail-error">
        <p className="font-medium">{e?.status === 404 ? "Document no longer exists" : e?.status === 403 ? "Access denied" : "Could not load document"}</p>
        <p className="text-xs">{e?.message}</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void detail.refetch()} data-testid="button-retry-detail">Retry</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    );
  }
  const d = detail.data;
  const f = filter.trim().toLowerCase();
  const passages = f ? d.passages.filter(p => p.text.toLowerCase().includes(f) || p.section.toLowerCase().includes(f)) : d.passages;

  const download = async () => {
    try {
      const res = await apiFetch(`${BASE}/${encodeURIComponent(d.id)}/file/${d.version}`);
      if (!res.ok) throw new Error(await readApiError(res, "Download failed"));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = d.filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      if (e?.name !== "AbortError") toast({ title: "Download failed", description: e?.message, variant: "destructive" });
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`${BASE}/${encodeURIComponent(d.id)}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: d.version }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Delete failed"));
      toast({ title: "Document deleted", description: d.title });
      await qc.invalidateQueries({ queryKey: ["knowledge", "list"] });
      onClose();
    } catch (e: any) {
      toast({ title: "Not deleted", description: e?.message, variant: "destructive" });
      void detail.refetch();
    } finally { setBusy(false); setConfirmDelete(false); }
  };

  return (
    <article data-testid={`detail-document-${d.id}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-[#081d33]" data-testid="text-document-title">{d.title}</h2>
          <p className="mt-1 font-mono text-[11px] text-slate-500">{d.release} · version {d.version} · {d.filename} · added {new Date(d.createdAt).toLocaleString()}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusPill status={d.status} id={`detail-${d.id}`} />
            {d.topics.map(t => <span key={t} className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[11px] text-slate-700">{t}</span>)}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void download()} disabled={d.status === "awaiting-upload"} data-testid="button-download-document"><Download className="mr-1.5 h-4 w-4" /> Original</Button>
          {d.canManage && <Button size="sm" variant="outline" onClick={() => onReplace(d)} data-testid="button-replace-document"><RefreshCw className="mr-1.5 h-4 w-4" /> {d.status === "failed" ? "Retry with new upload" : "Replace"}</Button>}
          {d.canManage && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)} data-testid="button-delete-document"><Trash2 className="h-4 w-4" /></Button>}
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="button-close-detail"><X className="h-4 w-4" /></Button>
        </div>
      </div>

      {d.status === "failed" && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="text-processing-error">
          <p className="font-medium">Processing failed</p><p className="text-xs">{d.error || "No reason was reported."}{d.canManage ? " Upload a corrected file with Retry." : ""}</p>
        </div>
      )}
      {d.status === "processing" && <p className="mt-4 flex items-center gap-2 text-sm text-sky-800" data-testid="text-processing"><Loader2 className="h-4 w-4 animate-spin" /> Extracting text. This can take up to 20 seconds; the page refreshes automatically.</p>}
      {d.status === "awaiting-upload" && <p className="mt-4 text-sm text-amber-800">The file transfer for this document never completed.{d.canManage ? " Use Replace to upload it again, or delete it." : ""}</p>}

      {d.status === "ready" && (
        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-mono text-[11px] uppercase tracking-wider text-slate-500">Extracted passages · {passages.length}{f ? ` of ${d.passages.length}` : ""}</h3>
            <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter passages" className="h-8 max-w-[220px] bg-white" data-testid="input-filter-passages" />
          </div>
          <ol className="mt-3 space-y-3">
            {passages.map((p, i) => (
              <li key={i} className="rounded-md border border-slate-200 bg-white p-4" data-testid={`passage-${i}`}>
                <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[#0b3d36]"><FileText className="h-3 w-3" /> {p.section || "Unlabelled section"}</p>
                {/* Rendered as plain text only — never as HTML. */}
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{p.text}</p>
              </li>
            ))}
            {passages.length === 0 && <li className="text-sm text-slate-500">{f ? "No passages match this filter." : "No text was extracted from this document."}</li>}
          </ol>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{d.title}"?</AlertDialogTitle>
            <AlertDialogDescription>This removes the document and all its versions from the shared library for every account. It cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} className="bg-destructive hover:bg-destructive/90" onClick={e => { e.preventDefault(); void remove(); }} data-testid="button-confirm-delete">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

type Phase = { kind: "form" } | { kind: "confirm" } | { kind: "uploading"; pct: number } | { kind: "processing" } | { kind: "error"; stage: string; message: string };

function UploadDialog({ target, onClose, onDone }: { target: KnowledgeDocument | "new"; onClose: () => void; onDone: (id: string) => void }) {
  const replacing = target !== "new" ? target : null;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState(replacing?.title ?? "");
  const [release, setRelease] = useState(replacing?.release ?? "S4HANA_2025");
  const [topics, setTopics] = useState(replacing?.topics.join(", ") ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const topicList = parseTopics(topics);
  const validation = validateKnowledgeUpload({ title, release, topics: topicList, file });
  const working = phase.kind === "uploading" || phase.kind === "processing";

  const run = async () => {
    if (!file || validation) return;
    const ac = new AbortController();
    abortRef.current = ac;
    let stage = "Registering upload";
    try {
      const body: Record<string, unknown> = { title: title.trim(), release: release.trim(), topics: topicList, filename: file.name, size: file.size };
      if (replacing) { body.replaceId = replacing.id; body.expectedVersion = replacing.version; }
      const { id, uploadUrl } = await apiJson<{ id: string; uploadUrl: string }>(`${BASE}/uploads`, { method: "POST", json: body, signal: ac.signal });
      stage = "Transferring file";
      setPhase({ kind: "uploading", pct: 0 });
      await putFileWithProgress(uploadUrl, file, pct => setPhase({ kind: "uploading", pct }), ac.signal);
      stage = "Processing";
      setPhase({ kind: "processing" });
      const doc = await apiJson<KnowledgeDocument>(`${BASE}/${encodeURIComponent(id)}/process`, { method: "POST", json: {}, signal: ac.signal });
      await qc.invalidateQueries({ queryKey: ["knowledge"] });
      if (doc.status === "failed") {
        setPhase({ kind: "error", stage: "Processing", message: doc.error || "The file could not be processed." });
        return;
      }
      toast({ title: replacing ? "Document replaced" : "Document added", description: doc.status === "ready" ? doc.title : `${doc.title} is still processing.` });
      onDone(doc.id);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      void qc.invalidateQueries({ queryKey: ["knowledge"] });
      setPhase({ kind: "error", stage, message: e?.message || "Unknown error" });
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o && !working) onClose(); }}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={e => { if (working) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{replacing ? `Replace "${replacing.title}"` : "Add to knowledge base"}</DialogTitle>
          <DialogDescription>
            {replacing ? `Version ${replacing.version} stays current until the new file processes successfully.` : "Shared with every account on this deployment."} PDF, DOCX, TXT or MD, up to 8 MB.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="kb-title">Title</Label>
            <Input id="kb-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} disabled={working} data-testid="input-document-title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="kb-release">Release</Label>
              <Input id="kb-release" list="kb-releases" value={release} onChange={e => setRelease(e.target.value)} maxLength={50} disabled={working} data-testid="input-document-release" />
              <datalist id="kb-releases">{KNOWLEDGE_RELEASES.map(r => <option key={r} value={r} />)}</datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor="kb-topics">Topics <span className="font-normal text-slate-500">({topicList.length}/8)</span></Label>
              <Input id="kb-topics" value={topics} onChange={e => setTopics(e.target.value)} placeholder="BAdI, RAP, ..." disabled={working} data-testid="input-document-topics" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="kb-file">File</Label>
            <Input id="kb-file" type="file" accept={KNOWLEDGE_EXTENSIONS.join(",")} disabled={working} onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="input-document-file" />
            {file && <p className="font-mono text-[11px] text-slate-500">{file.name} · {formatBytes(file.size)}</p>}
          </div>
          {validation && (title || file) && <p className="text-xs text-red-700" data-testid="text-upload-validation">{validation}</p>}

          {phase.kind === "uploading" && <div className="space-y-1" data-testid="status-upload-progress"><Progress value={phase.pct} /><p className="text-xs text-slate-600">Transferring file · {phase.pct}%</p></div>}
          {phase.kind === "processing" && <p className="flex items-center gap-2 text-xs text-sky-800" data-testid="status-upload-processing"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing. This can take up to 20 seconds.</p>}
          {phase.kind === "error" && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="status-upload-error">
              <p className="font-medium">{phase.stage} failed</p><p className="text-xs">{phase.message}</p>
              {replacing && <p className="mt-1 text-xs">Version {replacing.version} remains current.</p>}
            </div>
          )}
          {phase.kind === "confirm" && replacing && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="status-confirm-replace">
              Replace version {replacing.version} of "{replacing.title}" for every account once processing succeeds?
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { abortRef.current?.abort(); onClose(); }} data-testid="button-cancel-upload">{working ? "Cancel transfer" : "Close"}</Button>
          {phase.kind === "confirm"
            ? <Button className="bg-[#081d33]" onClick={() => void run()} data-testid="button-confirm-replace">Yes, replace</Button>
            : <Button className="bg-[#081d33] hover:bg-[#0f2c4a]" disabled={!!validation || working} data-testid="button-submit-upload"
                onClick={() => replacing ? setPhase({ kind: "confirm" }) : void run()}>
                {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{phase.kind === "error" ? "Try again" : replacing ? "Replace" : "Upload"}
              </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
