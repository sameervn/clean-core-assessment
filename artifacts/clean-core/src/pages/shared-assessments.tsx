import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowLeft, Download, Check, CheckCircle2, ChevronRight, Code2, FileCode, GitBranch, History, Inbox, Loader2,
  Lock, Pencil, RefreshCw, Search, Send, ShieldCheck, Undo2, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { YashLogo } from "@/components/yash-logo";
import { ReviewNotifications } from "@/components/review-notifications";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  CLASSIFICATIONS, DISPOSITIONS, FIELD_LABELS, TEXT_FIELDS, clearDraft, entityAction, evaluateSource, getAdministration, getShared, getSource,
  githubConnect, githubDisconnect, githubFiles, githubStatus, isEditor, listShared, loadDraft, mapSource, normalizeContent, putContent,
  putMember, putReviewer, sameId, saveDraft, stateKey, type Access, type ApiErr, type Proposal, type SharedContent, type SharedDetail, type SharedEntity,
} from "@/lib/shared-assessments";
import { COMPLEXITY_SIZES, UNASSESSED } from "@/lib/complexity-size";
import { downloadSharedCsv, downloadSharedExcel, downloadSharedJson, downloadSharedPdf, downloadSharedPowerPoint } from "@/lib/shared-exports";
import { saveBlob } from "@/lib/word-reports";

const POLL_MS = 20_000;
const NONE = "__none";
const detailKey = (id: string) => ["shared-assessment", id];

function Shell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const [, navigate] = useLocation();
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#f3f6f9]">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-8">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="button-back-workspace"><ArrowLeft className="mr-1.5 h-4 w-4" /> Workspace</Button>
        <YashLogo />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-[#081d33]">Shared assessments</h1>
          <p className="hidden font-mono text-[10px] uppercase tracking-wider text-slate-500 sm:block">Server-held review copies · browser workspace untouched</p>
        </div>
        {right}
      </header>
      {children}
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const k = stateKey(state);
  const cls = k === "approved" ? "border-emerald-300 bg-emerald-50 text-emerald-800"
    : k === "submitted" ? "border-sky-300 bg-sky-50 text-sky-800"
    : k.includes("change") ? "border-amber-300 bg-amber-50 text-amber-900"
    : "border-slate-300 bg-slate-50 text-slate-700";
  return <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wide ${cls}`} data-testid={`status-entity-${k}`}>{state || "draft"}</Badge>;
}

const fmtDate = (v: unknown) => { const t = Date.parse(String(v ?? "")); return Number.isFinite(t) ? new Date(t).toLocaleString() : ""; };

export default function SharedAssessmentsPage() {
  const { isAdmin } = useAuth();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const selectedId = params.get("id");
  const [tab, setTab] = useState<"assessments" | "inbox" | "admin" | "github">(params.get("tab") === "inbox" ? "inbox" : "assessments");
  const list = useQuery({ queryKey: ["shared-assessments"], queryFn: ({ signal }) => listShared(signal), refetchInterval: POLL_MS, refetchOnWindowFocus: true });
  const tabs: Array<[typeof tab, string, any]> = [["assessments", "Assessments", ShieldCheck], ["inbox", "Reviewer inbox", Inbox], ["github", "Source (GitHub)", GitBranch], ...(isAdmin ? [["admin", "Administration", Users] as [typeof tab, string, any]] : [])];
  return (
    <Shell right={<Button variant="outline" size="sm" onClick={() => void list.refetch()} data-testid="button-refresh-shared"><RefreshCw className={`h-4 w-4 md:mr-1.5 ${list.isFetching ? "animate-spin" : ""}`} /><span className="hidden md:inline">Refresh</span></Button>}>
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 md:px-8">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} data-testid={`tab-shared-${id}`}
            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${tab === id ? "border-[#003f84] font-medium text-[#081d33]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </nav>
      <main className="flex-1 p-4 md:p-6">
        {tab === "assessments" && <AssessmentsView list={list} selectedId={selectedId} onSelect={id => navigate(id ? `/shared-assessments?id=${encodeURIComponent(id)}` : "/shared-assessments")} />}
        {tab === "inbox" && <InboxView ids={(list.data?.assessments || []).filter(a => a.access).map(a => a.id)} onOpen={(aid, eid) => { setTab("assessments"); navigate(`/shared-assessments?id=${encodeURIComponent(aid)}${eid ? `&entity=${encodeURIComponent(eid)}` : ""}`); }} />}
        {tab === "github" && <GithubView />}
        {tab === "admin" && isAdmin && <AdminView />}
      </main>
    </Shell>
  );
}

function SharedDownloads({ detail }: { detail: SharedDetail }) {
  const { can, authorize } = useAuth(); const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!can("export")) return null;
  const run = async (kind: string, fn: (d: SharedDetail) => unknown) => {
    setBusy(kind);
    try {
      await authorize("export");
      const latest = await getShared(detail.assessment.id);
      await fn(latest);
      toast({ title: `${kind} downloaded`, description: "Latest saved server content with each record's state. Unsaved edits are not included." });
    }
    catch (e: any) { toast({ title: `${kind} export failed`, description: e?.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  return (
    <div className="flex items-center gap-1 rounded-md border border-slate-200 px-1" title="Current server content, not sealed approvals">
      <Download className="ml-1 h-3.5 w-3.5 text-slate-400" />
      {([["CSV", downloadSharedCsv], ["JSON", downloadSharedJson], ["Excel", downloadSharedExcel], ["PDF", downloadSharedPdf], ["PowerPoint", downloadSharedPowerPoint]] as const).map(([k, fn]) => (
        <Button key={k} size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => void run(k, fn)} data-testid={`button-shared-download-${k.toLowerCase()}`}>{busy === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : k}</Button>
      ))}
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" data-testid="status-shared-error">
      <AlertTriangle className="h-4 w-4 shrink-0" /><span className="flex-1">{message}</span>
      {onRetry && <Button size="sm" variant="outline" className="bg-white" onClick={onRetry} data-testid="button-retry">Retry</Button>}
    </div>
  );
}

function AssessmentsView({ list, selectedId, onSelect }: { list: any; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const rows = list.data?.assessments || [];
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <aside className="space-y-2">
        <p className="px-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">{rows.length} shared assessment{rows.length === 1 ? "" : "s"}</p>
        {list.isLoading && [0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        {list.error && <ErrorBox message={(list.error as Error).message} onRetry={() => void list.refetch()} />}
        {!list.isLoading && !list.error && rows.length === 0 && (
          <div className="rounded-md border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600" data-testid="empty-shared">
            <p className="font-medium text-slate-800">Nothing shared with you yet</p>
            <p className="mt-1 text-xs">Publish from your workspace header, or ask an administrator to add you as a member.</p>
          </div>
        )}
        {rows.map((a: any) => (
          <button key={a.id} onClick={() => onSelect(a.id)} data-testid={`card-shared-${a.id}`}
            className={`group w-full rounded-md border bg-white px-3 py-2.5 text-left transition-all hover:border-[#003f84]/40 hover:shadow-sm ${selectedId === a.id ? "border-[#003f84] ring-1 ring-[#003f84]/20" : "border-slate-200"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-[#081d33]">{a.name}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5" />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase text-slate-500">
              <span>{a.system}</span><span>{String(a.target_release || "").replace("S4HANA_", "S/4 ")}</span><span>{a.count} records</span>
              <span className={`rounded px-1 ${a.access === "edit" ? "bg-[#003f84] text-white" : a.access ? "bg-slate-200 text-slate-700" : "bg-amber-100 text-amber-900"}`}>{a.access || "no access"}</span>
            </div>
          </button>
        ))}
      </aside>
      <section className="min-w-0">
        {selectedId ? <AssessmentDetail id={selectedId} /> : (
          <div className="flex h-full min-h-[300px] items-center justify-center rounded-md border border-dashed border-slate-300 bg-white/60 text-sm text-slate-500">Select a shared assessment</div>
        )}
      </section>
    </div>
  );
}

function useDetail(id: string) {
  return useQuery({ queryKey: detailKey(id), queryFn: ({ signal }) => getShared(id, signal), refetchInterval: POLL_MS, refetchOnWindowFocus: true });
}

function patchEntity(qc: ReturnType<typeof useQueryClient>, assessmentId: string, entity: SharedEntity) {
  qc.setQueryData<SharedDetail>(detailKey(assessmentId), old => old ? { ...old, entities: old.entities.map(e => e.id === entity.id ? entity : e) } : old);
  void qc.invalidateQueries({ queryKey: detailKey(assessmentId), refetchType: "none" });
}

function AssessmentDetail({ id }: { id: string }) {
  const detail = useDetail(id);
  const search = useSearch();
  const requestedEntity = new URLSearchParams(search).get("entity");
  const [q, setQ] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [entityId, setEntityId] = useState<string | null>(null);
  useEffect(() => { setEntityId(requestedEntity); }, [id, requestedEntity]);
  const entities = detail.data?.entities || [];
  const states = useMemo(() => [...new Set(entities.map(e => stateKey(e.state)))], [entities]);
  const shown = entities.filter(e => (stateFilter === "all" || stateKey(e.state) === stateFilter) && (!q || `${e.name} ${e.entity_key}`.toLowerCase().includes(q.toLowerCase())));
  if (detail.isLoading) return <div className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (detail.error) return <ErrorBox message={(detail.error as ApiErr).status === 403 ? "You are not a member of this assessment. Administrators also need explicit membership to read content." : (detail.error as Error).message} onRetry={() => void detail.refetch()} />;
  const data = detail.data!;
  const selected = entities.find(e => e.id === entityId) || null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-[#081d33]" data-testid="text-shared-name">{data.assessment.name}</h2>
          <p className="font-mono text-[11px] text-slate-500">{data.assessment.system} · {String(data.assessment.target_release).replace("S4HANA_", "S/4HANA ")} · your access: <strong>{data.assessment.access || "none"}</strong> · {data.members?.length ?? 0} members</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SharedDownloads detail={data} />
          <div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter records" className="h-9 w-48 pl-8" data-testid="input-filter-entities" /></div>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-9 w-36" data-testid="select-state-filter"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All states</SelectItem>{states.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className={`grid gap-3 ${selected ? "xl:grid-cols-[minmax(280px,380px)_1fr]" : ""}`}>
        <div className="max-h-[calc(100dvh-260px)] overflow-y-auto rounded-md border border-slate-200 bg-white">
          {shown.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No records match.</p>}
          {shown.map(e => (
            <button key={e.id} onClick={() => setEntityId(e.id)} data-testid={`row-entity-${e.id}`}
              className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-slate-50 ${entityId === e.id ? "bg-[#003f84]/5" : ""}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded font-mono text-[11px] font-semibold ${e.content?.classification ? "bg-[#081d33] text-white" : "bg-slate-100 text-slate-400"}`}>{e.content?.classification || "–"}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-800">{e.name}</span><span className="block truncate font-mono text-[10px] text-slate-500">{e.kind} · v{e.version} · {e.content?.complexitySize || UNASSESSED}</span></span>
              <StateBadge state={e.state} />
            </button>
          ))}
        </div>
        {selected && <EntityPanel key={selected.id} detail={data} entity={selected} onClose={() => setEntityId(null)} />}
      </div>
    </div>
  );
}

/** requestIds survive navigation within the tab so an exact retry reuses the same id. */
const pendingRequests = new Map<string, string>();
function requestIdFor(key: string) {
  let id = pendingRequests.get(key);
  if (!id) { id = crypto.randomUUID(); pendingRequests.set(key, id); }
  return id;
}

function EntityPanel({ detail, entity, onClose }: { detail: SharedDetail; entity: SharedEntity; onClose: () => void }) {
  const { user, isAdmin, can } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const uid = user!.id;
  const editor = isEditor(detail.assessment) && ["Admin", "Developer"].includes(user!.role) && can("classify");
  const submitted = stateKey(entity.state) === "submitted";
  const assignedReviewer = sameId(entity.reviewer_id, uid);
  const reviewerNarrativeOnly = !editor && assignedReviewer && submitted;
  const canEdit = editor || reviewerNarrativeOnly;

  const initialDraft = useMemo(() => loadDraft(uid, entity.id), [uid, entity.id]);
  const [editing, setEditing] = useState(!!initialDraft);
  const [form, setForm] = useState<SharedContent>(() => initialDraft?.content ?? normalizeContent(entity.content));
  const [baseVersion, setBaseVersion] = useState(initialDraft?.baseVersion ?? entity.version);
  const [saveError, setSaveError] = useState<string | null>(initialDraft?.error ?? null);
  const [conflict, setConflict] = useState(!!initialDraft?.conflict);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [draftStorageFailed, setDraftStorageFailed] = useState(false);

  useEffect(() => {
    if (editing) setDraftStorageFailed(!saveDraft(uid, entity.id, { baseVersion, content: form, error: saveError ?? undefined, conflict, savedAt: new Date().toISOString() }));
  }, [editing, form, baseVersion, saveError, conflict, uid, entity.id]);
  useEffect(() => {
    if (!editing || !draftStorageFailed) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing, draftStorageFailed]);

  const view = editing ? form : normalizeContent(entity.content);
  const serverAhead = editing && entity.version !== baseVersion;
  const fieldEditable = (f: keyof SharedContent) => editing && (editor || (reviewerNarrativeOnly && f === "narrative"));
  const set = (f: keyof SharedContent, v: any) => setForm(prev => ({ ...prev, [f]: v }));

  const startEdit = (seed?: Partial<SharedContent>) => {
    setForm({ ...normalizeContent(entity.content), ...seed }); setBaseVersion(entity.version); setSaveError(null); setConflict(false); setEditing(true);
  };
  const cancel = () => { clearDraft(uid, entity.id); setEditing(false); setSaveError(null); setConflict(false); };
  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      const payload = reviewerNarrativeOnly ? { ...normalizeContent(entity.content), narrative: form.narrative } : form;
      const { entity: next } = await putContent(entity.id, baseVersion, payload);
      clearDraft(uid, entity.id); setEditing(false); setConflict(false);
      patchEntity(qc, detail.assessment.id, next);
      setJustSaved(true); window.setTimeout(() => setJustSaved(false), 1600);
    } catch (e: any) {
      const isConflict = e?.status === 409;
      setConflict(isConflict);
      setSaveError(isConflict ? "Someone saved a newer version. Your draft is kept in this browser and was not overwritten." : e?.message || "Save failed. Your draft is kept in this browser.");
      if (isConflict) void qc.invalidateQueries({ queryKey: detailKey(detail.assessment.id) });
    } finally { setSaving(false); }
  };

  const [comment, setComment] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const act = async (action: "submit" | "approve" | "request-changes") => {
    if (acting || editing) return;
    const key = `${uid}:${entity.id}:${action}:${entity.version}:${comment}`;
    setActing(action);
    try {
      const { entity: next } = await entityAction(entity.id, { expectedVersion: entity.version, action, comment, requestId: requestIdFor(key) });
      pendingRequests.delete(key); setComment("");
      patchEntity(qc, detail.assessment.id, next);
      void qc.invalidateQueries({ queryKey: detailKey(detail.assessment.id) });
      toast({ title: action === "submit" ? "Submitted for review" : action === "approve" ? "Approved" : "Changes requested" });
    } catch (e: any) {
      if (e?.status === 409) { pendingRequests.delete(key); void qc.invalidateQueries({ queryKey: detailKey(detail.assessment.id) }); }
      toast({ title: "Action not applied", description: e?.status === 409 ? (action === "approve" ? `${e?.message || "Conflict"}. Approval needs the record's latest version and a previewed company default Word template.` : "The record changed. Review the latest version and retry.") : `${e?.message || "Request failed"}. Retrying reuses the same request id.`, variant: "destructive" });
    } finally { setActing(null); }
  };

  const events = (detail.events || []).filter((ev: any) => !ev.entity_id || sameId(ev.entity_id, entity.id));
  const nameOf = (id: unknown) => { const m = (detail.members || []).find((x: any) => sameId(x.user_id ?? x.id, id)); return m?.username || (id === null || id === undefined ? "—" : `user ${id}`); };

  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white" data-testid={`panel-entity-${entity.id}`}>
      {editing && draftStorageFailed && <div role="alert" className="border-b border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        Browser storage could not retain this draft. It remains in memory for this tab; download it before closing or reloading.
        <Button size="sm" variant="outline" className="ml-2" onClick={() => saveBlob(new Blob([JSON.stringify({ entityId: entity.id, baseVersion, content: form }, null, 2)], { type: "application/json" }), "assessment-draft.json")}>Download draft</Button>
      </div>}
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h3 className="truncate font-semibold text-[#081d33]">{entity.name}</h3><StateBadge state={entity.state} /></div>
          <p className="mt-0.5 font-mono text-[10px] text-slate-500">{entity.entity_key} · version {entity.version}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-xs text-emerald-700 transition-opacity duration-500 ${justSaved ? "opacity-100" : "opacity-0"}`}><Check className="h-3.5 w-3.5" />Saved</span>
          {!editing && canEdit && <Button size="sm" onClick={() => startEdit()} data-testid="button-edit-entity"><Pencil className="mr-1.5 h-3.5 w-3.5" />{reviewerNarrativeOnly ? "Edit narrative" : "Edit"}</Button>}
          {editing && <>
            <Button size="sm" variant="outline" onClick={cancel} disabled={saving} data-testid="button-cancel-edit"><Undo2 className="mr-1.5 h-3.5 w-3.5" />Cancel</Button>
            <Button size="sm" onClick={() => void save()} disabled={saving} data-testid="button-save-entity">{saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}Save</Button>
          </>}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} aria-label="Close" data-testid="button-close-entity"><X className="h-4 w-4" /></Button>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs md:grid-cols-4" data-testid="provenance-entity">
        <div><dt className="text-slate-500">Submitter</dt><dd className="font-medium">{nameOf(entity.submitter_id)}</dd></div>
        <div><dt className="text-slate-500">Reviewer</dt><dd className="font-medium">{nameOf(entity.reviewer_id)}{assignedReviewer && " (you)"}</dd></div>
        <div><dt className="text-slate-500">Content origin</dt><dd className="font-medium">Published from browser workspace; edits server-versioned</dd></div>
        <div><dt className="text-slate-500">Your rights</dt><dd className="font-medium">{editor ? "Editor: all content fields" : reviewerNarrativeOnly ? "Assigned reviewer: narrative only" : "Read only"}</dd></div>
      </dl>

      {(saveError || serverAhead) && (
        <div role="alert" className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950" data-testid="status-draft-conflict">
          <AlertTriangle className="h-4 w-4" />
          <span className="flex-1">{saveError || `Server now has version ${entity.version}; your draft is based on version ${baseVersion}.`}</span>
          {(conflict || serverAhead) && <>
            <Button size="sm" variant="outline" className="h-7 bg-white" onClick={() => { setBaseVersion(entity.version); setConflict(false); setSaveError(null); }} data-testid="button-rebase-draft">Keep my draft over v{entity.version}</Button>
            <Button size="sm" variant="outline" className="h-7 bg-white" onClick={cancel} data-testid="button-discard-draft">Discard draft</Button>
          </>}
        </div>
      )}

      <div className="grid gap-4 p-4 2xl:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <EnumField label={FIELD_LABELS.classification} value={view.classification} options={CLASSIFICATIONS} editable={fieldEditable("classification")} onChange={v => set("classification", v)} testId="classification" />
            <EnumField label={FIELD_LABELS.disposition} value={view.disposition} options={DISPOSITIONS} editable={fieldEditable("disposition")} onChange={v => set("disposition", v)} testId="disposition" />
            <EnumField label={FIELD_LABELS.complexitySize} value={view.complexitySize} options={COMPLEXITY_SIZES} editable={fieldEditable("complexitySize")} onChange={v => set("complexitySize", v)} testId="complexity" emptyLabel={UNASSESSED} />
          </div>
          {TEXT_FIELDS.map(f => (
            <TextField key={f} label={FIELD_LABELS[f]} value={view[f]} editable={fieldEditable(f)} onChange={v => set(f, v)} testId={f} />
          ))}
        </div>

        <aside className="space-y-4">
          <section className="rounded-md border border-slate-200 p-3">
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">Review workflow</h4>
            <Textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Comment (recorded in history)" className="min-h-[60px] text-sm" data-testid="input-action-comment" />
            <div className="mt-2 flex flex-wrap gap-2">
              {editor && ["draft", "changes-requested"].includes(stateKey(entity.state)) && <Button size="sm" disabled={!!acting || editing} onClick={() => void act("submit")} data-testid="button-submit-entity">{acting === "submit" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}Send for approval</Button>}
              {assignedReviewer && submitted && <>
                <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800" disabled={!!acting || editing} onClick={() => void act("approve")} data-testid="button-approve-entity">{acting === "approve" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Approve</Button>
                <Button size="sm" variant="outline" disabled={!!acting || editing || !comment.trim()} onClick={() => void act("request-changes")} data-testid="button-request-changes">Request changes</Button>
              </>}
            </div>
            {assignedReviewer && submitted && <p className="mt-2 rounded bg-slate-50 p-2 text-[11px] text-slate-600" data-testid="text-reviewer-guidance">As reviewer you can edit only the narrative. To change classification or any other field, use Request changes with a comment; the editor revises and resubmits.</p>}
            {editing && <p className="mt-2 text-[11px] text-slate-500">Save or cancel your edit before workflow actions.</p>}
            {!editor && !assignedReviewer && <p className="mt-2 text-[11px] text-slate-500">No workflow actions available for your membership.</p>}
          </section>
          {isAdmin && <ReviewerAssign entity={entity} assessmentId={detail.assessment.id} />}
          <SourcesSection entity={entity} />
          {editor && <GithubMapping entity={entity} assessmentId={detail.assessment.id} onProposal={setProposal} />}
          {proposal && (
            <section className="rounded-md border border-sky-200 bg-sky-50/60 p-3 text-xs" data-testid="card-proposal">
              <h4 className="mb-1 font-semibold text-sky-950">Deterministic source proposal (not applied)</h4>
              <p className="text-sky-900">{proposal.notice}</p>
              <p className="mt-2"><strong>Classification:</strong> {proposal.classification ?? "none"}</p>
              <p className="whitespace-pre-wrap"><strong>Explanation:</strong> {proposal.classificationExplanation || "—"}</p>
              <p className="whitespace-pre-wrap"><strong>Recommendation:</strong> {proposal.recommendation || "—"}</p>
              {proposal.guidance && <p className="mt-2 rounded border border-sky-200 bg-white/70 p-2 text-[11px] text-sky-950" data-testid="text-proposal-guidance">{proposal.guidance}</p>}
              {!!proposal.references?.length && (
                <div className="mt-2"><p className="font-semibold text-sky-950">Guidance passages used</p>
                  <ul className="mt-1 space-y-1.5">{proposal.references.map((r, i) => (
                    <li key={r.id ?? i} className="rounded bg-white/70 p-1.5" data-testid={`text-proposal-reference-${i}`}>
                      <p className="font-medium">{r.title || "Untitled"}{r.version !== undefined && <span className="font-mono text-[10px] text-slate-500"> v{r.version}</span>}{r.section && <span className="text-slate-500"> · {r.section}</span>}{r.release && <span className="font-mono text-[10px] text-slate-500"> · {r.release}</span>}</p>
                      {r.text && <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-[11px] text-slate-700">{r.text}</p>}
                    </li>))}</ul>
                </div>
              )}
              {proposal.evidence?.length > 0 && <ul className="mt-2 space-y-1 font-mono text-[10px]">{proposal.evidence.slice(0, 20).map((ev, i) => <li key={i} className="truncate">{ev.path}:{ev.line} {ev.text}</li>)}</ul>}
              <div className="mt-2 flex gap-2">
                <Button size="sm" className="h-7" disabled={editing} onClick={() => { startEdit({ classification: proposal.classification, classificationExplanation: proposal.classificationExplanation, recommendation: proposal.recommendation }); setProposal(null); }} data-testid="button-accept-proposal">Accept into edit form</Button>
                <Button size="sm" variant="outline" className="h-7 bg-white" onClick={() => setProposal(null)} data-testid="button-dismiss-proposal">Dismiss</Button>
              </div>
              <p className="mt-1 text-[10px] text-sky-800">Accepting only pre-fills three fields; nothing is saved until you press Save.</p>
            </section>
          )}
          <section className="rounded-md border border-slate-200 p-3">
            <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500"><History className="h-3.5 w-3.5" />Comments &amp; history</h4>
            {events.length === 0 ? <p className="text-xs text-slate-500">No history yet.</p> : (
              <ol className="max-h-72 space-y-2 overflow-y-auto">
                {events.map((ev: any, i: number) => (
                  <li key={ev.id ?? i} className="border-l-2 border-slate-200 pl-2 text-xs">
                    <p><strong>{ev.username || ev.actor || nameOf(ev.actor_id ?? ev.user_id)}</strong> <span className="text-slate-600">{ev.action || ev.kind || ev.type}</span>{ev.version !== undefined && <span className="font-mono text-slate-400"> v{ev.version}</span>}</p>
                    {ev.comment && <p className="mt-0.5 whitespace-pre-wrap text-slate-700">{ev.comment}</p>}
                    <p className="font-mono text-[10px] text-slate-400">{fmtDate(ev.created_at ?? ev.at)}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <details className="rounded-md border border-slate-200 p-3">
            <summary className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500"><Lock className="h-3.5 w-3.5" />Original evidence (immutable)</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-50 p-2 font-mono text-[10px] leading-relaxed text-slate-700" data-testid="text-entity-evidence">{JSON.stringify(entity.evidence, null, 2)}</pre>
          </details>
        </aside>
      </div>
    </article>
  );
}

function EnumField<T extends string>({ label, value, options, editable, onChange, testId, emptyLabel = "Not set" }: { label: string; value: T | null; options: readonly T[]; editable: boolean; onChange: (v: T | null) => void; testId: string; emptyLabel?: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-slate-500">{label}</p>
      {editable ? (
        <Select value={value ?? NONE} onValueChange={v => onChange(v === NONE ? null : v as T)}>
          <SelectTrigger className="h-9" data-testid={`select-${testId}`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={NONE}>{emptyLabel}</SelectItem>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      ) : <p className="flex h-9 items-center rounded-md border border-transparent bg-slate-50 px-3 text-sm" data-testid={`text-${testId}`}>{value ?? <span className="text-slate-400">{emptyLabel}</span>}</p>}
    </div>
  );
}

function TextField({ label, value, editable, onChange, testId }: { label: string; value: string; editable: boolean; onChange: (v: string) => void; testId: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-slate-500">{label}</p>
      {editable
        ? <Textarea value={value} onChange={e => onChange(e.target.value)} className="min-h-[72px] text-sm transition-shadow focus:shadow-sm" data-testid={`input-${testId}`} />
        : <p className={`whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 text-sm ${value ? "text-slate-800" : "text-slate-400"}`} data-testid={`text-${testId}`}>{value || "Not provided"}</p>}
    </div>
  );
}

function ReviewerAssign({ entity, assessmentId }: { entity: SharedEntity; assessmentId: string }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const admin = useQuery({ queryKey: ["shared-admin"], queryFn: ({ signal }) => getAdministration(signal) });
  const [busy, setBusy] = useState(false);
  const assign = async (v: string) => {
    setBusy(true);
    try { const { entity: next } = await putReviewer(entity.id, entity.version, v === NONE ? null : v); patchEntity(qc, assessmentId, next); toast({ title: "Reviewer updated" }); }
    catch (e: any) { toast({ title: "Reviewer not changed", description: e?.status === 409 ? "The record changed; try again." : e?.message, variant: "destructive" }); void qc.invalidateQueries({ queryKey: detailKey(assessmentId) }); }
    finally { setBusy(false); }
  };
  return (
    <section className="rounded-md border border-slate-200 p-3">
      <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-500">Assigned reviewer (admin)</h4>
      <Select value={entity.reviewer_id == null ? NONE : String(entity.reviewer_id)} onValueChange={v => void assign(v)} disabled={busy || !admin.data}>
        <SelectTrigger className="h-9" data-testid="select-reviewer"><SelectValue placeholder="Loading users" /></SelectTrigger>
        <SelectContent><SelectItem value={NONE}>Unassigned</SelectItem>{(admin.data?.users || []).map(u => <SelectItem key={u.id} value={String(u.id)}>{u.username} · {u.role}</SelectItem>)}</SelectContent>
      </Select>
      <p className="mt-1 text-[10px] text-slate-500">The reviewer also needs review membership on this assessment.</p>
    </section>
  );
}

function SourcesSection({ entity }: { entity: SharedEntity }) {
  const [open, setOpen] = useState<number | null>(null);
  const src = useQuery({ queryKey: ["shared-source", entity.id, open, entity.version], queryFn: ({ signal }) => getSource(entity.id, open!, signal), enabled: open !== null });
  const sources = Array.isArray(entity.sources) ? entity.sources : [];
  return (
    <section className="rounded-md border border-slate-200 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500"><FileCode className="h-3.5 w-3.5" />Mapped source</h4>
      {sources.length === 0 ? <p className="text-xs text-slate-500">No source mapped.</p> : (
        <ul className="space-y-1">{sources.map((s: any, i: number) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-mono text-[10px]" title={`${s.repository}@${s.commit}:${s.path}`}>{s.repository}:{s.path} @{String(s.commit || "").slice(0, 7)}</span>
            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setOpen(i)} data-testid={`button-view-source-${i}`}><Code2 className="h-3.5 w-3.5" /></Button>
          </li>
        ))}</ul>
      )}
      <Dialog open={open !== null} onOpenChange={o => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle className="font-mono text-sm">{open !== null ? `${sources[open]?.path}` : ""}</DialogTitle><DialogDescription>{open !== null ? `${sources[open]?.repository} at commit ${sources[open]?.commit}` : ""}</DialogDescription></DialogHeader>
          {src.isLoading ? <Skeleton className="h-64 w-full" /> : src.error ? <ErrorBox message={(src.error as Error).message} onRetry={() => void src.refetch()} /> :
            <pre className="max-h-[60vh] overflow-auto rounded bg-[#081d33] p-3 font-mono text-[11px] leading-relaxed text-slate-100" data-testid="text-source-code">{src.data?.code}</pre>}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function GithubMapping({ entity, assessmentId, onProposal }: { entity: SharedEntity; assessmentId: string; onProposal: (p: Proposal) => void }) {
  const qc = useQueryClient(); const { toast } = useToast();
  const status = useQuery({ queryKey: ["shared-github"], queryFn: ({ signal }) => githubStatus(signal) });
  const [repo, setRepo] = useState(""); const [ref, setRef] = useState("main"); const [filter, setFilter] = useState("");
  const [files, setFiles] = useState<{ commit: string; files: Array<{ path: string; size: number }> } | null>(null);
  const [loading, setLoading] = useState(false); const [picked, setPicked] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const loadFiles = async () => {
    setLoading(true); setFiles(null);
    try { setFiles(await githubFiles(repo, ref)); } catch (e: any) { toast({ title: "Could not list files", description: e?.message, variant: "destructive" }); }
    finally { setLoading(false); }
  };
  const confirmMap = async () => {
    if (!files || !picked) return; setBusy(true);
    try {
      const r = await mapSource(entity.id, { expectedVersion: entity.version, repository: repo, commit: files.commit, path: picked });
      patchEntity(qc, assessmentId, r.entity); if (r.proposal) onProposal(r.proposal); setPicked(null);
      toast({ title: "Source mapped", description: "Content fields were not changed." });
    } catch (e: any) { toast({ title: "Mapping failed", description: e?.status === 409 ? "The record changed; reload and retry." : e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const evaluate = async () => {
    setBusy(true);
    try { onProposal((await evaluateSource(entity.id, entity.version)).proposal); }
    catch (e: any) { toast({ title: "Evaluation failed", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  if (status.isLoading) return <Skeleton className="h-20 w-full" />;
  const s = status.data;
  return (
    <section className="rounded-md border border-slate-200 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500"><GitBranch className="h-3.5 w-3.5" />Map GitHub source</h4>
      {!s?.configured ? <p className="text-xs text-slate-500">GitHub integration is not configured on this server.</p> : !s.connected ? <p className="text-xs text-slate-500">Connect GitHub in the Source tab first.</p> : <>
        <div className="space-y-2">
          <Select value={repo} onValueChange={v => { setRepo(v); setFiles(null); }}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-github-repo"><SelectValue placeholder="Repository" /></SelectTrigger>
            <SelectContent>{s.repositories.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex gap-2"><Input value={ref} onChange={e => setRef(e.target.value)} placeholder="Branch, tag or commit" className="h-8 text-xs" data-testid="input-github-ref" />
            <Button size="sm" className="h-8" variant="outline" disabled={!repo || !ref || loading} onClick={() => void loadFiles()} data-testid="button-load-files">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Files"}</Button></div>
          {files && <>
            <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder={`Filter ${files.files.length} files`} className="h-8 text-xs" data-testid="input-filter-files" />
            <ul className="max-h-48 overflow-y-auto rounded border border-slate-100">
              {files.files.filter(f => !filter || f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 300).map(f => (
                <li key={f.path}><button onClick={() => setPicked(f.path)} className="w-full truncate px-2 py-1 text-left font-mono text-[10px] transition-colors hover:bg-slate-50" data-testid={`button-pick-file-${f.path}`}>{f.path}</button></li>
              ))}
            </ul>
          </>}
        </div>
        <Button size="sm" variant="outline" className="mt-2 h-7 w-full text-xs" disabled={busy || !entity.sources?.length} onClick={() => void evaluate()} data-testid="button-evaluate-source">Deterministic rule check (no AI)</Button>
        <Dialog open={!!picked} onOpenChange={o => { if (!o) setPicked(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Map source to {entity.name}?</DialogTitle><DialogDescription>Links <span className="font-mono">{repo}:{picked}</span> at commit <span className="font-mono">{files?.commit.slice(0, 10)}</span> to this record. Any returned proposal is shown separately and never overwrites content.</DialogDescription></DialogHeader>
            <DialogFooter><Button variant="outline" onClick={() => setPicked(null)}>Cancel</Button><Button disabled={busy} onClick={() => void confirmMap()} data-testid="button-confirm-map">{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirm mapping</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </>}
    </section>
  );
}

function InboxView({ ids, onOpen }: { ids: string[]; onOpen: (assessmentId: string, entityId?: string) => void }) {
  const { user } = useAuth();
  const results = useQueries({ queries: ids.map(id => ({ queryKey: detailKey(id), queryFn: ({ signal }: { signal: AbortSignal }) => getShared(id, signal), refetchInterval: POLL_MS, refetchOnWindowFocus: true })) });
  const loading = results.some(r => r.isLoading);
  const items = results.flatMap(r => r.data ? r.data.entities.filter(e => sameId(e.reviewer_id, user!.id) && stateKey(e.state) === "submitted").map(e => ({ e, a: r.data!.assessment })) : []);
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div><h2 className="text-lg font-semibold text-[#081d33]">Reviewer inbox</h2><p className="text-sm text-slate-600">Records submitted and assigned to you.</p></div>
      <ReviewNotifications onOpen={onOpen} />
      {loading && <Skeleton className="h-24 w-full" />}
      {results.filter(r => r.error).map((r, i) => <ErrorBox key={i} message={(r.error as Error).message} onRetry={() => void r.refetch()} />)}
      {!loading && items.length === 0 && <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500" data-testid="empty-inbox">Inbox clear. Nothing waiting for your review.</div>}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 bg-white">
        {items.map(({ e, a }) => (
          <li key={e.id}><button onClick={() => onOpen(a.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-50" data-testid={`row-inbox-${e.id}`}>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{e.name}</span><span className="block font-mono text-[10px] text-slate-500">{a.name} · v{e.version}</span></span>
            <StateBadge state={e.state} /><ChevronRight className="h-4 w-4 text-slate-300" />
          </button></li>
        ))}
      </ul>
    </div>
  );
}

function GithubView() {
  const qc = useQueryClient(); const { toast } = useToast();
  const status = useQuery({ queryKey: ["shared-github"], queryFn: ({ signal }) => githubStatus(signal) });
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await qc.invalidateQueries({ queryKey: ["shared-github"] }); } catch (e: any) { toast({ title: "GitHub request failed", description: e?.message, variant: "destructive" }); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h2 className="text-lg font-semibold text-[#081d33]">Source repositories</h2>
      <p className="text-sm text-slate-600">Map ABAP source files to shared records and run a deterministic rule check. AI source evaluation is not available.</p>
      {status.isLoading ? <Skeleton className="h-24 w-full" /> : status.error ? <ErrorBox message={(status.error as Error).message} onRetry={() => void status.refetch()} /> : (
        <div className="rounded-md border border-slate-200 bg-white p-4" data-testid="card-github-status">
          <p className="text-sm"><strong>Status:</strong> {!status.data!.configured ? "Not configured on this server" : status.data!.connected ? "Connected" : "Not connected"}</p>
          {status.data!.connected && <p className="mt-1 text-xs text-slate-600">{status.data!.repositories.length} repositories: <span className="font-mono">{status.data!.repositories.join(", ") || "none"}</span></p>}
          {status.data!.configured && (
            <div className="mt-3">{status.data!.connected
              ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(githubDisconnect)} data-testid="button-github-disconnect">Disconnect</Button>
              : <Button size="sm" disabled={busy} onClick={() => void run(githubConnect)} data-testid="button-github-connect">Connect GitHub</Button>}</div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminView() {
  const { toast } = useToast(); const qc = useQueryClient();
  const admin = useQuery({ queryKey: ["shared-admin"], queryFn: ({ signal }) => getAdministration(signal) });
  const [aid, setAid] = useState<string>("");
  const [local, setLocal] = useState<Record<string, Access | null>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const detail = useQuery({ queryKey: detailKey(aid), queryFn: ({ signal }) => getShared(aid, signal), enabled: !!aid, retry: false });
  const current = (uid: string): Access | null | undefined => {
    if (uid in local) return local[uid];
    const m = (detail.data?.members || []).find((x: any) => sameId(x.user_id ?? x.id, uid));
    return m ? (m.access ?? null) : detail.data ? null : undefined;
  };
  const lastAid = useRef(aid);
  if (lastAid.current !== aid) { lastAid.current = aid; setLocal({}); }
  const change = async (uid: string, v: string) => {
    const access = v === NONE ? null : v as Access; setSaving(uid);
    try { await putMember(aid, uid, access); setLocal(p => ({ ...p, [uid]: access })); void qc.invalidateQueries({ queryKey: ["shared-assessments"] }); void qc.invalidateQueries({ queryKey: detailKey(aid) }); toast({ title: "Membership saved" }); }
    catch (e: any) { toast({ title: "Membership not changed", description: e?.message, variant: "destructive" }); }
    finally { setSaving(null); }
  };
  if (admin.isLoading) return <Skeleton className="h-48 w-full" />;
  if (admin.error) return <ErrorBox message={(admin.error as Error).message} onRetry={() => void admin.refetch()} />;
  const owner = admin.data!.assessments.find(a => a.id === aid)?.owner_id;
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div><h2 className="text-lg font-semibold text-[#081d33]">Membership</h2><p className="text-sm text-slate-600">Administrators need explicit membership to read content too.</p></div>
      <Select value={aid} onValueChange={setAid}>
        <SelectTrigger className="bg-white" data-testid="select-admin-assessment"><SelectValue placeholder="Choose assessment" /></SelectTrigger>
        <SelectContent>{admin.data!.assessments.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
      </Select>
      {aid && (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          {detail.error && <p className="border-b border-slate-100 px-4 py-2 text-xs text-amber-800">Current memberships are hidden until you are a member yourself. Changes still apply.</p>}
          {admin.data!.users.map(u => {
            const c = current(String(u.id));
            return (
              <div key={u.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2 last:border-0" data-testid={`row-member-${u.id}`}>
                <span className="flex-1 text-sm">{u.username} <span className="font-mono text-[10px] uppercase text-slate-500">{u.role}</span>{sameId(owner, u.id) && <Badge variant="outline" className="ml-2 text-[10px]">owner</Badge>}</span>
                {saving === String(u.id) && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                <Select value={c === undefined ? "" : c ?? NONE} onValueChange={v => void change(String(u.id), v)} disabled={saving !== null}>
                  <SelectTrigger className="h-8 w-32" data-testid={`select-access-${u.id}`}><SelectValue placeholder="Unknown" /></SelectTrigger>
                  <SelectContent><SelectItem value={NONE}>No access</SelectItem><SelectItem value="read">Read</SelectItem><SelectItem value="edit">Edit</SelectItem><SelectItem value="review">Review</SelectItem></SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
