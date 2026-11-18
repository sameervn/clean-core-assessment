import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Building2, FolderKanban, Loader2, Pencil, Plus, RefreshCw, ShieldCheck, Users } from "lucide-react";
import {
  getListClientProjectsQueryKey, getGetClientProjectMembersQueryKey,
  type AssessmentClient, type ClientProject, type ProjectMemberDirectory,
} from "@workspace/api-client-react";
import { apiJson } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fetchCatalog } from "@/lib/project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { YashLogo } from "@/components/yash-logo";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const createClient = (name: string) => apiJson<AssessmentClient>("/api/client-projects/clients", { method: "POST", json: { name } });
const createProject = (clientId: string, name: string) => apiJson<ClientProject>("/api/client-projects/projects", { method: "POST", json: { clientId, name } });
const updateProject = (id: string, clientId: string, name: string) => apiJson<ClientProject>(`/api/client-projects/projects/${encodeURIComponent(id)}`, { method: "PATCH", json: { clientId, name } });
const getMembers = (id: string, signal?: AbortSignal) => apiJson<ProjectMemberDirectory>(`/api/client-projects/projects/${encodeURIComponent(id)}/members`, { signal, cache: "no-store" });
const putMember = (id: string, userId: string, enabled: boolean) => apiJson<ProjectMemberDirectory>(`/api/client-projects/projects/${encodeURIComponent(id)}/members`, { method: "PUT", json: { userId, enabled } });

export default function AdminProjectsPage() {
  const { isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: getListClientProjectsQueryKey(), queryFn: ({ signal }) => fetchCatalog(signal), enabled: isAdmin, refetchInterval: 5_000 });
  const [clientName, setClientName] = useState("");
  const [newProject, setNewProject] = useState({ clientId: "", name: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<ClientProject | null>(null);
  const [members, setMembers] = useState<ClientProject | null>(null);

  const clients = useMemo(() => [...(q.data?.clients ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: getListClientProjectsQueryKey() });

  if (!isAdmin) return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-[#f3f6f9] p-6 text-center" data-testid="admin-projects-denied">
      <ShieldCheck className="h-8 w-8 text-slate-400" /><p className="text-sm text-slate-600">Only administrators manage clients and projects.</p>
      <Button variant="outline" onClick={() => navigate("/")}>Back</Button>
    </div>
  );

  const addClient = async () => {
    const name = clientName.trim(); if (!name) return;
    setBusy("client");
    try { const c = await createClient(name); setClientName(""); setNewProject(p => ({ ...p, clientId: c.id })); toast({ title: "Client created", description: c.name }); await refresh(); }
    catch (e: any) { toast({ title: "Client not created", description: e?.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const addProject = async () => {
    const name = newProject.name.trim(); if (!name || !newProject.clientId) return;
    setBusy("project");
    try { const p = await createProject(newProject.clientId, name); setNewProject(s => ({ ...s, name: "" })); toast({ title: "Project setup requested", description: `${p.name} is pending operator provisioning. It cannot be opened yet.` }); await refresh(); setMembers(p); }
    catch (e: any) { toast({ title: "Project not created", description: e?.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };
  const provisioning = async (p: ClientProject, action: "retry" | "cancel") => {
    if (action === "cancel" && !window.confirm(`Cancel setup for ${p.name}? No ready workspace or assessment data will be deleted. The request and audit history will be retained.`)) return;
    setBusy(p.id);
    try {
      await apiJson<ClientProject>(`/api/client-projects/projects/${encodeURIComponent(p.id)}/provisioning`, { method: "POST", json: { action } });
      toast({ title: action === "retry" ? "Setup queued again" : "Setup cancelled" });
      await refresh();
    } catch (e: any) { toast({ title: "Setup request not changed", description: e?.message, variant: "destructive" }); await refresh(); }
    finally { setBusy(null); }
  };

  return (
    <div className="min-h-[100dvh] bg-[#f3f6f9]">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-8">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")} data-testid="button-back-projects"><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
        <YashLogo />
      </header>
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 md:py-12">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#00468b]">Administration</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Clients &amp; projects</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Each project has its own isolated data store: assessments, knowledge, Word templates and GitHub links never cross projects, even within one client. Global roles still apply inside every project a user is a member of.</p>
          <p className="mt-2 text-sm text-slate-600">New projects remain pending until the operator provisioning job finishes. Failed setup leaves no accessible workspace; ask the operator to fix the issue before retrying. This list refreshes automatically.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_1.4fr]">
          <form className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" onSubmit={e => { e.preventDefault(); void addClient(); }}>
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4 text-[#00468b]" />New client</h2>
            <Label htmlFor="client-name" className="sr-only">Client name</Label>
            <Input id="client-name" maxLength={120} placeholder="e.g. Nordhafen Logistik GmbH" value={clientName} onChange={e => setClientName(e.target.value)} data-testid="input-client-name" />
            <Button type="submit" size="sm" disabled={!clientName.trim() || busy === "client"} data-testid="button-create-client">{busy === "client" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create client</Button>
          </form>
          <form className="space-y-3 rounded-lg border border-slate-200 bg-white p-4" onSubmit={e => { e.preventDefault(); void addProject(); }}>
            <h2 className="flex items-center gap-2 text-sm font-semibold"><FolderKanban className="h-4 w-4 text-[#00468b]" />New project</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <select aria-label="Client" value={newProject.clientId} onChange={e => setNewProject(s => ({ ...s, clientId: e.target.value }))}
                className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-project-client">
                <option value="" disabled>{clients.length ? "Choose client" : "Create a client first"}</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <Input aria-label="Project name" maxLength={120} placeholder="e.g. S/4 conversion wave 2" value={newProject.name} onChange={e => setNewProject(s => ({ ...s, name: e.target.value }))} data-testid="input-project-name" />
            </div>
            <Button type="submit" size="sm" disabled={!newProject.clientId || !newProject.name.trim() || busy === "project"} data-testid="button-create-project">{busy === "project" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create project</Button>
          </form>
        </div>

        <section aria-label="Projects by client" className="space-y-4">
          {q.isLoading && <div className="space-y-2" data-testid="status-loading-catalog">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>}
          {q.isError && <div className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{(q.error as Error).message}<Button size="sm" variant="outline" onClick={() => void q.refetch()} data-testid="button-retry-catalog"><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button></div>}
          {q.data && clients.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600" data-testid="empty-clients">No clients yet. Create one above to start.</p>}
          {clients.map(c => {
            const projects = (q.data?.projects ?? []).filter(p => p.clientId === c.id).sort((a, b) => a.name.localeCompare(b.name));
            return (
              <div key={c.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-testid={`card-client-${c.id}`}>
                <h3 className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-600"><Building2 className="h-3.5 w-3.5" />{c.name}</h3>
                {projects.length === 0 ? <p className="px-4 py-3 text-sm text-slate-500">No projects for this client.</p> : (
                  <ul className="divide-y divide-slate-100">
                    {projects.map(p => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5" data-testid={`row-project-${p.id}`}>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs capitalize" data-testid={`status-project-${p.id}`}>{p.provisioningStatus}</span>
                        {p.provisioningError && <span role="status" className="w-full text-sm text-red-700">{p.provisioningError}</span>}
                        {p.provisioningStatus === "failed" && <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => void provisioning(p, "retry")} data-testid={`button-retry-project-${p.id}`}>Retry setup</Button>}
                        {["pending", "failed"].includes(p.provisioningStatus) && <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => void provisioning(p, "cancel")} data-testid={`button-cancel-project-${p.id}`}>Cancel setup</Button>}
                        {p.legacy && <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-800">Legacy</span>}
                        <span className={`rounded px-1.5 py-0.5 text-[11px] ${p.assigned ? "bg-[#e8f8f4] text-[#0b3d36]" : "bg-slate-100 text-slate-500"}`}>{p.assigned ? "You are a member" : "Not a member"}</span>
                        <Button size="sm" variant="outline" onClick={() => setMembers(p)} data-testid={`button-members-${p.id}`}><Users className="mr-1.5 h-3.5 w-3.5" />Members</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(p)} data-testid={`button-edit-project-${p.id}`}><Pencil className="mr-1.5 h-3.5 w-3.5" />Edit</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      </main>
      {editing && <EditProjectDialog project={editing} clients={clients} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />}
      {members && <MembersDialog project={members} onClose={() => setMembers(null)} onChanged={() => void refresh()} />}
    </div>
  );
}

function EditProjectDialog({ project, clients, onClose, onSaved }: { project: ClientProject; clients: AssessmentClient[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(project.name);
  const [clientId, setClientId] = useState(project.clientId);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== project.name || clientId !== project.clientId;
  const needsAck = changed && (project.legacy || clientId !== project.clientId);
  const save = async () => {
    setBusy(true);
    try { await updateProject(project.id, clientId, name.trim()); toast({ title: "Project updated" }); onSaved(); }
    catch (e: any) { toast({ title: "Project not updated", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit project</DialogTitle><DialogDescription>Rename the project or move it to another client. Members are unchanged.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="edit-project-name">Name</Label><Input id="edit-project-name" maxLength={120} value={name} onChange={e => setName(e.target.value)} data-testid="input-edit-project-name" /></div>
          <div className="space-y-1"><Label>Client</Label>
            <select aria-label="Client for this project" value={clientId} onChange={e => { setClientId(e.target.value); setAck(false); }}
              className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" data-testid="select-edit-project-client">
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {(project.legacy || clientId !== project.clientId) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert" data-testid="warning-legacy-move">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />{project.legacy ? "This is the legacy workspace" : "Move the entire project"}</p>
              <p className="mt-1">Reassignment moves the ENTIRE workspace, including every assessment, knowledge document, template and connection. Membership does not change: existing members keep access. Review the member list before moving client data.</p>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} data-testid="checkbox-ack-legacy" />I understand the whole workspace moves</label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!changed || !name.trim() || busy || (needsAck && !ack)} onClick={() => void save()} data-testid="button-save-project">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MembersDialog({ project, onClose, onChanged }: { project: ClientProject; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = getGetClientProjectMembersQueryKey(project.id);
  const q = useQuery({ queryKey: key, queryFn: ({ signal }) => getMembers(project.id, signal) });
  const [pending, setPending] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const toggle = async (userId: string, enabled: boolean) => {
    setPending(userId);
    try { const dir = await putMember(project.id, userId, enabled); qc.setQueryData(key, dir); onChanged(); }
    catch (e: any) { toast({ title: enabled ? "Could not add member" : "Could not remove member", description: e?.message, variant: "destructive" }); }
    finally { setPending(null); }
  };
  const users = (q.data?.users ?? []).filter(u => u.username.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Members of {project.name}</DialogTitle><DialogDescription>Members can open this project's contents with their global role. Removing someone takes effect on their next check (within about 30 seconds).</DialogDescription></DialogHeader>
        <Input placeholder="Filter users" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter users" data-testid="input-filter-members" />
        {q.isLoading && <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10" />)}</div>}
        {q.isError && <div className="text-sm text-red-700" role="alert">{(q.error as Error).message} <Button size="sm" variant="link" onClick={() => void q.refetch()}>Retry</Button></div>}
        <ul className="divide-y divide-slate-100" data-testid="list-members">
          {users.map(u => (
            <li key={u.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1"><span className={`block truncate text-sm ${u.active ? "" : "text-slate-400 line-through"}`}>{u.username}</span><span className="text-xs text-slate-500">{u.role}{u.active ? "" : " · inactive"}</span></span>
              {pending === u.id && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              <Switch checked={u.assigned} disabled={pending !== null} onCheckedChange={v => void toggle(u.id, v)} aria-label={`${u.assigned ? "Remove" : "Add"} ${u.username}`} data-testid={`switch-member-${u.id}`} />
            </li>
          ))}
          {q.data && users.length === 0 && <li className="py-4 text-center text-sm text-slate-500">No matching users.</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
