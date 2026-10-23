import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, CheckCircle2, Download, Eye, FileText, Loader2, Pencil, RefreshCw, ShieldCheck, Star, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { YashLogo } from "@/components/yash-logo";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  deleteTemplate, downloadFrom, fetchReference, fetchTemplates, isAbort, patchTemplate, saveBlob, uploadTemplate,
  type ReportTemplate,
} from "@/lib/word-reports";

export const MAX_TEMPLATE_BYTES = 4_000_000;

function Shell({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  return (
    <div className="min-h-[100dvh] bg-[#f3f6f9]">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-8">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-workspace"><ArrowLeft className="mr-1.5 h-4 w-4" /> Workspace</Button>
        <YashLogo />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-[#081d33]">Word report templates</h1>
          <p className="hidden font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:block">Layouts for object &amp; interface reports</p>
        </div>
      </header>
      {children}
    </div>
  );
}

export default function ReportTemplatesPage() {
  const auth = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canManage = (auth.can as (p: string) => boolean)("templates.manage");
  const canExport = auth.can("export");
  const [upload, setUpload] = useState<{ replace?: ReportTemplate } | null>(null);
  const [rename, setRename] = useState<ReportTemplate | null>(null);
  const [remove, setRemove] = useState<ReportTemplate | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(true);
  const downloads = useRef(new Set<AbortController>());
  const keyBase = ["report-templates", auth.signature] as const;
  useEffect(() => {
    mounted.current = true;
    const active = downloads.current;
    return () => {
      mounted.current = false;
      active.forEach(a => a.abort());
      // Account-owned data must not survive in the persistent QueryClient.
      void qc.cancelQueries({ queryKey: ["report-templates"] });
      qc.removeQueries({ queryKey: ["report-templates"] });
    };
  }, [qc]);

  const list = useQuery({ queryKey: [...keyBase, "list"], queryFn: ({ signal }) => fetchTemplates(signal), enabled: canManage, refetchOnWindowFocus: "always" });
  const reference = useQuery({ queryKey: [...keyBase, "reference"], queryFn: ({ signal }) => fetchReference(signal), enabled: canManage });
  const refresh = () => qc.invalidateQueries({ queryKey: keyBase });

  const fail = (title: string, e: any) => {
    if (isAbort(e) || !mounted.current) return;
    toast({ title, description: e?.status === 403 ? "The server denied this action. Your permissions may have changed." : e?.status === 409 ? "This template changed elsewhere. The list was refreshed — try again." : e?.message, variant: "destructive" });
    if (e?.status === 409) void refresh();
  };

  const download = async (key: string, path: string, json: unknown, name: string, after?: () => void) => {
    const ac = new AbortController(); downloads.current.add(ac); setBusy(key);
    try {
      const { blob, filename } = await downloadFrom(path, json === undefined ? { method: "GET" } : { method: "POST", json }, name, { signal: ac.signal, fallbackError: "Download failed" });
      if (!mounted.current || ac.signal.aborted) return; // stale account/route: drop the file
      saveBlob(blob, filename); after?.();
    } catch (e) { fail("Download failed", e); }
    finally { downloads.current.delete(ac); if (mounted.current) setBusy(null); }
  };

  const makeDefault = async (t: ReportTemplate) => {
    setBusy(`default-${t.id}`);
    try { await patchTemplate(t.id, { active: true, expectedVersion: t.version }); toast({ title: "Default template set", description: `${t.name} v${t.version} is now used by default.` }); await refresh(); }
    catch (e) { fail("Could not set default", e); }
    finally { if (mounted.current) setBusy(null); }
  };

  if (!canManage) {
    return (
      <Shell onBack={() => navigate("/")}>
        <div className="mx-auto max-w-md py-20 text-center" data-testid="status-templates-denied">
          <ShieldCheck className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-3 text-lg font-semibold">Template management is restricted</h2>
          <p className="mt-1 text-sm text-slate-600">{auth.user?.username} does not have the “Manage report templates” permission. Ask an administrator.</p>
        </div>
      </Shell>
    );
  }

  // Company templates are managed in the Export Center; private routes never act on them.
  const templates = (list.data?.templates ?? []).filter(t => !t.company);
  return (
    <Shell onBack={() => navigate("/")}>
      <main className="mx-auto grid max-w-6xl gap-6 p-4 md:p-8 lg:grid-cols-[1fr_340px]">
        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-[#081d33]">Templates</h2>
              <p className="text-sm text-slate-600">Upload .docx layouts. A template must be previewed before it can become the default.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!canExport || busy === "sample"} onClick={() => void download("sample", "/api/report-templates/sample", undefined, "clean-core-sample-template.docx")} data-testid="button-download-sample">
                {busy === "sample" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}Sample template
              </Button>
              <Button size="sm" onClick={() => setUpload({})} data-testid="button-upload-template"><Upload className="mr-1.5 h-4 w-4" />Upload template</Button>
            </div>
          </div>
          {list.data && !list.data.configured && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="status-templates-unconfigured">Template storage is not configured on the server. Uploads are unavailable until an administrator configures it.</p>}
          {list.data && list.data.configured && !templates.some(t => t.active) && templates.length > 0 && <p className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700" data-testid="status-no-default">No private default template. Users must choose a template explicitly when exporting.</p>}

          {list.isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
          ) : list.isError ? (
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-white p-4 text-sm text-destructive" data-testid="status-templates-error">
              {(list.error as Error).message}<Button size="sm" variant="outline" onClick={() => void list.refetch()} data-testid="button-retry-templates"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button>
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center" data-testid="status-templates-empty">
              <FileText className="mx-auto h-8 w-8 text-[#00467f]/50" />
              <h3 className="mt-3 font-semibold text-[#081d33]">No templates yet</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">Download the sample, restyle it in Word using the placeholders on the right, then upload it here.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {templates.map(t => (
                <li key={t.id} className={`rounded-lg border bg-white p-4 ${t.active ? "border-[#00467f]/40 ring-1 ring-[#00467f]/20" : "border-slate-200"}`} data-testid={`card-template-${t.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium text-[#081d33]"><FileText className="h-4 w-4 text-[#00467f]" /><span className="truncate" data-testid={`text-template-name-${t.id}`}>{t.name}</span></p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="font-mono text-[10px]">v{t.version}</Badge>
                        {t.active && <Badge className="bg-[#00467f] text-[10px]"><Star className="mr-1 h-3 w-3" />Default</Badge>}
                        {t.previewed ? <Badge variant="outline" className="border-emerald-300 text-[10px] text-emerald-800"><CheckCircle2 className="mr-1 h-3 w-3" />Previewed</Badge>
                          : <Badge variant="outline" className="border-amber-300 text-[10px] text-amber-800">Preview required</Badge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" disabled={!canExport || busy === `preview-${t.id}`} onClick={() => void download(`preview-${t.id}`, "/api/report-templates/preview", { templateId: t.id, expectedVersion: t.version }, `${t.name}-preview.docx`, () => void refresh())} data-testid={`button-preview-${t.id}`}>
                        {busy === `preview-${t.id}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />}Preview
                      </Button>
                      {!t.active && <Button size="sm" variant="outline" disabled={!t.previewed || !!busy} title={t.previewed ? undefined : "Download a preview first"} onClick={() => void makeDefault(t)} data-testid={`button-default-${t.id}`}><Star className="mr-1.5 h-3.5 w-3.5" />Make default</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setRename(t)} data-testid={`button-rename-${t.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setUpload({ replace: t })} data-testid={`button-replace-${t.id}`}><Upload className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRemove(t)} data-testid={`button-delete-${t.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm lg:sticky lg:top-6 lg:self-start" data-testid="panel-template-reference">
          <h3 className="flex items-center gap-2 font-semibold text-[#081d33]"><BookOpen className="h-4 w-4" />Placeholder reference</h3>
          {reference.isLoading ? <Skeleton className="h-48 w-full" /> : reference.isError ? (
            <p className="text-destructive">{(reference.error as Error).message} <button className="underline" onClick={() => void reference.refetch()} data-testid="button-retry-reference">Retry</button></p>
          ) : reference.data && (
            <>
              <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-2 font-mono text-[11px] text-slate-700">{reference.data.syntax}</p>
              <Ref title="Report fields" items={reference.data.fields} />
              <Ref title="Finding rows" items={reference.data.rowFields.findings} />
              <Ref title="Recommendation rows" items={reference.data.rowFields.recommendations} />
              <div><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Limits</p>
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">{reference.data.limits.map(l => <li key={l}>{l}</li>)}</ul></div>
            </>
          )}
        </aside>
      </main>

      {upload && <UploadDialog replace={upload.replace} onClose={() => setUpload(null)} onDone={() => void refresh()} onError={fail} />}
      {rename && <RenameDialog template={rename} onClose={() => setRename(null)} onDone={() => void refresh()} onError={fail} />}
      <AlertDialog open={!!remove} onOpenChange={o => { if (!o) setRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{remove?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>{remove?.active ? "This is the default template. After deletion users must choose a template explicitly." : "This template will no longer be available for exports."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete" onClick={() => {
              const t = remove!; setRemove(null);
              deleteTemplate(t.id, t.version).then(() => { toast({ title: "Template deleted" }); void refresh(); }).catch(e => fail("Could not delete", e));
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}

function Ref({ title, items }: { title: string; items: string[] }) {
  return (
    <div><p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="flex flex-wrap gap-1">{items.map(f => <code key={f} className="rounded bg-[#00467f]/5 px-1.5 py-0.5 font-mono text-[11px] text-[#00467f]">{f}</code>)}</div></div>
  );
}

function UploadDialog({ replace, onClose, onDone, onError }: { replace?: ReportTemplate; onClose: () => void; onDone: () => void; onError: (t: string, e: unknown) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(replace?.name ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => { ac.current?.abort(); }, []);
  const submit = async () => {
    if (!file || !name.trim()) return;
    if (!file.name.toLowerCase().endsWith(".docx")) { setError("Templates must be .docx files."); return; }
    if (file.size > MAX_TEMPLATE_BYTES) { setError("Templates must be 4 MB or smaller."); return; }
    const c = new AbortController(); ac.current = c; setBusy(true); setError(null);
    try {
      const t = await uploadTemplate(file, { name: name.trim(), replaceId: replace?.id, expectedVersion: replace?.version }, c.signal);
      toast({ title: replace ? "Template replaced" : "Template uploaded", description: `${t.name} v${t.version} — download a preview before making it the default.` });
      onDone(); onClose();
    } catch (e: any) {
      if (isAbort(e)) return;
      if (e?.status === 403 || e?.status === 409) { onError("Upload failed", e); onClose(); return; }
      setError(e?.message || "Upload failed.");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={o => { if (!o) { ac.current?.abort(); onClose(); } }}>
      <DialogContent data-testid="dialog-upload-template">
        <DialogHeader>
          <DialogTitle>{replace ? `Replace “${replace.name}”` : "Upload template"}</DialogTitle>
          <DialogDescription>{replace ? `Creates v${replace.version + 1}. The new version must be previewed again before it can be default.` : "The file is validated against the placeholder reference before it is saved."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="tpl-name">Name</Label><Input id="tpl-name" value={name} maxLength={120} onChange={e => setName(e.target.value)} data-testid="input-template-name" /></div>
          <div className="space-y-1.5"><Label htmlFor="tpl-file">Word file (.docx, max 4 MB)</Label><Input id="tpl-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="input-template-file" /></div>
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive" role="alert" data-testid="text-upload-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { ac.current?.abort(); onClose(); }} data-testid="button-cancel-upload">Cancel</Button>
          <Button disabled={busy || !file || !name.trim()} onClick={() => void submit()} data-testid="button-submit-upload">{busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" />Validating…</> : replace ? "Replace" : "Upload"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ template, onClose, onDone, onError }: { template: ReportTemplate; onClose: () => void; onDone: () => void; onError: (t: string, e: unknown) => void }) {
  const [name, setName] = useState(template.name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await patchTemplate(template.id, { name: name.trim(), expectedVersion: template.version }); onDone(); onClose(); }
    catch (e) { onError("Could not rename", e); setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent data-testid="dialog-rename-template">
        <DialogHeader><DialogTitle>Rename template</DialogTitle><DialogDescription>Only the display name changes.</DialogDescription></DialogHeader>
        <Input value={name} maxLength={120} onChange={e => setName(e.target.value)} data-testid="input-rename-template" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-rename">Cancel</Button>
          <Button disabled={busy || !name.trim() || name.trim() === template.name} onClick={() => void save()} data-testid="button-save-rename">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
