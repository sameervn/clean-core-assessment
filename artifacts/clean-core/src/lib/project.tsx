import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeftRight, Building2, FolderKanban, KeyRound, Loader2, LogOut, Plus, RefreshCw, Settings2, ShieldAlert, WifiOff } from "lucide-react";
import { getListClientProjectsQueryKey, type ClientProjectCatalog, type ClientProject, type AssessmentClient } from "@workspace/api-client-react";
import { apiJson, setActiveProjectId } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { hasUnsavedWork, readStoredSelection, writeStoredSelection } from "@/lib/project-scope";
import { Button } from "@/components/ui/button";
import { YashLogo } from "@/components/yash-logo";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const POLL_MS = 30_000;
export const fetchCatalog = (signal?: AbortSignal) => apiJson<ClientProjectCatalog>("/api/client-projects", { signal, cache: "no-store" });

export interface ActiveProject { project: ClientProject; client: AssessmentClient | null }

interface ProjectApi {
  catalog: ClientProjectCatalog | undefined;
  /** Projects whose contents this user may open (assigned:true). */
  available: ClientProject[];
  active: ActiveProject | null;
  /** Bumped on every switch; key routed content with it. */
  epoch: number;
  requestSwitch: (projectId: string | null) => void;
  openChooser: () => void;
  refresh: () => void;
  status: "loading" | "error" | "ready";
  error: string | null;
}

const Ctx = createContext<ProjectApi | null>(null);
export function useProject() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useProject must be used inside ProjectProvider");
  return c;
}

export function clientName(catalog: ClientProjectCatalog | undefined, clientId: string) {
  return catalog?.clients.find(c => c.id === clientId)?.name ?? "Unknown client";
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = String(user!.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<string | null>(() => readStoredSelection(userId));
  const [epoch, setEpoch] = useState(0);
  const [switching, setSwitching] = useState<{ to: string | null } | null>(null);
  const [confirmTo, setConfirmTo] = useState<{ to: string | null } | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);

  const q = useQuery({
    queryKey: getListClientProjectsQueryKey(),
    queryFn: ({ signal }) => fetchCatalog(signal),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const catalog = q.data;
  const available = useMemo(() => (catalog?.projects ?? []).filter(p => p.assigned && p.provisioningStatus === "ready"), [catalog]);
  const project = selected ? available.find(p => p.id === selected) ?? null : null;
  const active = useMemo<ActiveProject | null>(() => project
    ? { project, client: catalog?.clients.find(c => c.id === project.clientId) ?? null }
    : null, [project, catalog]);

  // Bind (or clear) the API scope; nothing scoped renders until this matches.
  const boundId = project && !switching ? project.id : null;
  setActiveProjectId(boundId);
  useEffect(() => () => setActiveProjectId(null), []);

  // Membership revoked or project gone: fail closed and forget the selection.
  const revokedNotice = useRef(false);
  useEffect(() => {
    if (!catalog || !selected) return;
    if (!available.some(p => p.id === selected)) {
      writeStoredSelection(userId, null);
      setSelected(null);
      setEpoch(e => e + 1);
      if (!revokedNotice.current) {
        revokedNotice.current = true;
        toast({ title: "Project no longer available", description: "Your access to the selected project ended. Choose another project.", variant: "destructive" });
      }
    }
  }, [catalog, available, selected, userId, toast]);

  // Two-phase switch: unmount scoped content first (stopping autosaves), then rebind.
  useEffect(() => {
    if (!switching) return;
    qc.cancelQueries({ predicate: query => query.queryKey[0] !== getListClientProjectsQueryKey()[0] });
    qc.removeQueries({ predicate: query => query.queryKey[0] !== getListClientProjectsQueryKey()[0] });
    writeStoredSelection(userId, switching.to);
    revokedNotice.current = false;
    setSelected(switching.to);
    setEpoch(e => e + 1);
    setSwitching(null);
  }, [switching, qc, userId]);

  const requestSwitch = useCallback((to: string | null) => {
    setChooserOpen(false);
    if (to === selected) return;
    setActiveProjectId(null); // abort the old API epoch immediately
    if (selected && hasUnsavedWork()) { setConfirmTo({ to }); return; }
    setSwitching({ to });
  }, [selected]);

  const value: ProjectApi = {
    catalog, available, active: switching ? null : active, epoch,
    requestSwitch, openChooser: () => setChooserOpen(true), refresh: () => void q.refetch(),
    status: q.isError ? "error" : !catalog ? "loading" : "ready",
    error: q.error ? (q.error as Error).message : null,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Switch client project</DialogTitle>
            <DialogDescription>Evidence, knowledge, templates and shared reviews are kept separately per project. Switching reloads every screen in this tab only.</DialogDescription>
          </DialogHeader>
          <ProjectList compact />
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!confirmTo} onOpenChange={o => { if (!o) { setConfirmTo(null); if (project) setActiveProjectId(project.id); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave unsaved edits?</AlertDialogTitle>
            <AlertDialogDescription>
              Save any open editor text in {active?.project.name ?? "this project"} before switching; unsaved editor text may be lost. Saved workspace data and recovery drafts remain with their original project. Nothing is copied into the other project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-switch">Stay here</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-switch" onClick={() => { const t = confirmTo; setConfirmTo(null); if (t) setSwitching(t); }}>Switch project</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx.Provider>
  );
}

/** Product screens render only with a verified, assigned project bound to the API layer. */
export function ProjectGate({ children }: { children: ReactNode }) {
  const p = useProject();
  if (p.status === "loading") return <CenterShell testId="status-loading-projects"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /><p className="text-sm text-slate-500">Loading your client projects</p></CenterShell>;
  if (p.status === "error") return (
    <CenterShell testId="status-projects-error">
      <WifiOff className="h-6 w-6 text-slate-400" />
      <p className="max-w-sm text-sm text-slate-600">Project access could not be confirmed{p.error ? `: ${p.error}` : "."} Product data stays closed until it can be verified.</p>
      <Button variant="outline" onClick={p.refresh} data-testid="button-retry-projects"><RefreshCw className="mr-2 h-4 w-4" />Try again</Button>
      <PlatformLinks />
    </CenterShell>
  );
  if (!p.active) return <ProjectChooserPage />;
  return (
    <div key={`${p.active.project.id}:${p.epoch}`} className="flex min-h-[100dvh] flex-col">
      <ProjectBar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function CenterShell({ children, testId }: { children: ReactNode; testId: string }) {
  return <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[#f3f6f9] p-6 text-center" data-testid={testId}><YashLogo />{children}</div>;
}

function PlatformLinks() {
  const { isAdmin, logout } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap justify-center gap-2 pt-2">
      {isAdmin && <Button variant="ghost" size="sm" onClick={() => navigate("/admin/projects")} data-testid="link-manage-projects"><Settings2 className="mr-1.5 h-4 w-4" />Clients &amp; projects</Button>}
      {isAdmin && <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} data-testid="link-admin-users">Users &amp; permissions</Button>}
      <Button variant="ghost" size="sm" onClick={() => navigate("/account/password")} data-testid="link-change-password"><KeyRound className="mr-1.5 h-4 w-4" />Change password</Button>
      <Button variant="ghost" size="sm" onClick={() => logout().catch((e: Error) => toast({ title: "Not signed out", description: e.message, variant: "destructive" }))} data-testid="button-logout-chooser"><LogOut className="mr-1.5 h-4 w-4" />Sign out</Button>
    </div>
  );
}

function ProjectList({ compact = false }: { compact?: boolean }) {
  const p = useProject();
  const groups = useMemo(() => {
    const byClient = new Map<string, ClientProject[]>();
    for (const pr of p.available) byClient.set(pr.clientId, [...(byClient.get(pr.clientId) ?? []), pr]);
    return [...byClient.entries()].map(([id, projects]) => ({ id, name: clientName(p.catalog, id), projects: projects.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [p.available, p.catalog]);
  if (groups.length === 0) return null;
  return (
    <div className={compact ? "space-y-4" : "space-y-6"} data-testid="list-projects">
      {groups.map(g => (
        <section key={g.id}>
          <h3 className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-500"><Building2 className="h-3.5 w-3.5" />{g.name}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {g.projects.map(pr => {
              const current = p.active?.project.id === pr.id;
              return (
                <li key={pr.id}>
                  <button type="button" onClick={() => p.requestSwitch(pr.id)} disabled={current}
                    className="group flex w-full items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 text-left transition-colors hover:border-[#00468b] hover:bg-[#f5f9fd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00468b] disabled:cursor-default disabled:border-[#00468b] disabled:bg-[#eef4fb]"
                    data-testid={`button-select-project-${pr.id}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#081d33] text-white"><FolderKanban className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{pr.name}</span>
                      <span className="block truncate text-xs text-slate-500">{current ? "Open in this tab" : pr.legacy ? "Legacy workspace: all data from before projects" : "Isolated project workspace"}</span>
                    </span>
                    {pr.legacy && <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-800">Legacy</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ProjectChooserPage() {
  const p = useProject();
  const { user, isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const empty = p.available.length === 0;
  return (
    <div className="min-h-[100dvh] bg-[#f3f6f9]">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:px-8"><YashLogo /><span className="truncate text-sm text-slate-500" data-testid="text-chooser-user">{user?.username}</span></header>
      <main className="mx-auto max-w-3xl px-4 py-10 md:py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#00468b]">Step 1 · Scope</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">Which client are you working for?</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">Every assessment, knowledge document, report template and repository connection belongs to exactly one project. Your choice applies to this browser tab only.</p>
        <div className="mt-8">
          {empty ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center" data-testid="empty-projects">
              <ShieldAlert className="mx-auto h-7 w-7 text-slate-400" />
              <h2 className="mt-3 font-medium text-slate-900">No projects assigned to you yet</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                {isAdmin ? "Create a client and a project, then add yourself and your team as members." : "Ask an administrator to add you to a client project. You can still change your password or sign out."}
              </p>
              {isAdmin && <Button className="mt-4" onClick={() => navigate("/admin/projects")} data-testid="button-onboard-create"><Plus className="mr-2 h-4 w-4" />Set up clients &amp; projects</Button>}
            </div>
          ) : <ProjectList />}
        </div>
        <div className="mt-10 border-t border-slate-200 pt-4"><PlatformLinks /></div>
      </main>
    </div>
  );
}

/** Persistent scope strip shown above every product screen. */
export function ProjectBar() {
  const p = useProject();
  const { isAdmin } = useAuth();
  const [, navigate] = useLocation();
  if (!p.active) return null;
  const { project, client } = p.active;
  return (
    <div className="sticky top-0 z-40 flex items-center gap-2 border-b border-[#0f2e4f] bg-[#081d33] px-3 py-1.5 text-white md:px-6" role="region" aria-label="Active client project" data-testid="bar-active-project">
      <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-[#70d6c2] sm:inline">Scope</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        <Building2 className="h-3.5 w-3.5 shrink-0 text-white/60" />
        <span className="max-w-[35%] truncate text-white/75" data-testid="text-active-client">{client?.name ?? "Unknown client"}</span>
        <span className="text-white/40">/</span>
        <span className="truncate font-medium" data-testid="text-active-project">{project.name}</span>
        {project.legacy && <span className="ml-1 shrink-0 rounded bg-amber-400/20 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-200">Legacy</span>}
      </div>
      {isAdmin && <Button size="sm" variant="ghost" className="hidden h-7 text-white/80 hover:bg-white/10 hover:text-white md:inline-flex" onClick={() => navigate("/admin/projects")} data-testid="button-bar-manage-projects"><Settings2 className="mr-1.5 h-3.5 w-3.5" />Manage</Button>}
      <Button size="sm" variant="ghost" className="h-7 text-white hover:bg-white/10 hover:text-white" onClick={p.openChooser} data-testid="button-switch-project"><ArrowLeftRight className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Switch</span></Button>
    </div>
  );
}
