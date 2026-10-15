import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, KeyRound, Loader2, Plus, RefreshCw, Search, ShieldCheck, UserCog, Users } from "lucide-react";
import { YashLogo } from "@/components/yash-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/api";
import { useAuth, initials, PERMISSION_IDS, PERMISSION_LABELS, ROLE_PRESETS, type AuthUser, type PermissionId, type Role } from "@/lib/auth";
import { PasswordMeter, passwordProblem } from "@/pages/change-password";
import { AccountAudit } from "@/pages/account-audit";

type UsersResponse = { users: AuthUser[]; permissions: string[]; roles: Role[] };
const USERS_KEY = ["admin", "users"] as const;
const ROLE_TONE: Record<Role, string> = {
  Admin: "bg-[#081d33] text-white border-transparent",
  Developer: "bg-[#70d6c2]/20 text-[#0b4d44] border-[#70d6c2]/50",
  Reviewer: "bg-amber-100 text-amber-900 border-amber-300",
};

function effective(role: Role, overrides: Record<string, boolean>): Set<string> {
  const set = new Set<string>(ROLE_PRESETS[role]);
  for (const [k, v] of Object.entries(overrides)) v ? set.add(k) : set.delete(k);
  return set;
}

type TriState = "inherit" | "grant" | "revoke";
function OverrideEditor({ role, overrides, onChange, permissions }: { role: Role; overrides: Record<string, boolean>; onChange: (o: Record<string, boolean>) => void; permissions: string[] }) {
  const preset = new Set<string>(ROLE_PRESETS[role]);
  const ids = (permissions.length ? permissions : [...PERMISSION_IDS]) as PermissionId[];
  const set = (id: string, t: TriState) => {
    const next = { ...overrides };
    if (t === "inherit") delete next[id]; else next[id] = t === "grant";
    onChange(next);
  };
  return (
    <div className="divide-y rounded-md border" data-testid="permission-editor">
      {ids.map(id => {
        const state: TriState = id in overrides ? (overrides[id] ? "grant" : "revoke") : "inherit";
        const on = state === "inherit" ? preset.has(id) : state === "grant";
        return (
          <div key={id} className="flex flex-wrap items-center gap-3 p-2.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-[#0b7a6b]" : "bg-slate-300"}`} aria-label={on ? "allowed" : "denied"} />
            <div className="min-w-[140px] flex-1">
              <p className="text-sm font-medium">{PERMISSION_LABELS[id]?.label ?? id} <span className="font-mono text-[10px] text-muted-foreground">{id}</span></p>
              <p className="text-xs text-muted-foreground">{PERMISSION_LABELS[id]?.hint}</p>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-md border text-xs" role="radiogroup" aria-label={`${id} setting`}>
              {(["inherit", "grant", "revoke"] as TriState[]).map(t => (
                <button key={t} type="button" role="radio" aria-checked={state === t} onClick={() => set(id, t)} data-testid={`perm-${id}-${t}`}
                  className={`px-2 py-1 capitalize transition-colors ${state === t ? (t === "revoke" ? "bg-destructive text-white" : t === "grant" ? "bg-[#0b7a6b] text-white" : "bg-slate-800 text-white") : "hover:bg-muted"}`}>
                  {t === "inherit" ? `Role (${preset.has(id) ? "on" : "off"})` : t}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoleSelect({ value, onChange, roles, testId }: { value: Role; onChange: (r: Role) => void; roles: Role[]; testId: string }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as Role)}>
      <SelectTrigger data-testid={testId}><SelectValue /></SelectTrigger>
      <SelectContent>{roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export default function AdminUsersPage() {
  const { user: me, isAdmin } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AuthUser | null>(null);
  const [resetting, setResetting] = useState<AuthUser | null>(null);

  const query = useQuery({ queryKey: USERS_KEY, queryFn: () => apiJson<UsersResponse>("/api/admin/users"), enabled: isAdmin });
  const roles = query.data?.roles ?? (["Admin", "Developer", "Reviewer"] as Role[]);
  const permissions = query.data?.permissions ?? [...PERMISSION_IDS];
  const users = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (query.data?.users ?? []).filter(u => !q || u.username.toLowerCase().includes(q) || u.role.toLowerCase().includes(q));
  }, [query.data, search]);

  const toggleActive = useMutation({
    mutationFn: (u: AuthUser) => apiJson<{ user: AuthUser }>(`/api/admin/users/${encodeURIComponent(String(u.id))}`, { method: "PATCH", json: { active: !u.active } }),
    onSuccess: ({ user }) => { qc.invalidateQueries({ queryKey: USERS_KEY }); toast({ title: user.active ? "User reactivated" : "User deactivated", description: user.active ? `${user.username} can sign in again.` : `${user.username}'s sessions were revoked.` }); },
    onError: (e: Error) => toast({ title: "Change rejected", description: e.message, variant: "destructive" }),
  });

  if (!isAdmin) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#f3f6f9] p-6">
        <div className="max-w-sm space-y-3 text-center" data-testid="admin-forbidden">
          <ShieldCheck className="mx-auto h-8 w-8 text-slate-400" />
          <h1 className="text-lg font-semibold">Administrators only</h1>
          <p className="text-sm text-muted-foreground">User management requires the Admin role. Assessment permissions cannot grant it.</p>
          <Link href="/" className="inline-flex items-center gap-1 text-sm font-medium text-[#0b7a6b] underline-offset-4 hover:underline" data-testid="link-back-assessment"><ArrowLeft className="h-4 w-4" /> Back to assessment</Link>
        </div>
      </div>
    );
  }

  const counts = (query.data?.users ?? []).reduce((acc, u) => { acc[u.role] = (acc[u.role] || 0) + 1; if (!u.active) acc.inactive++; return acc; }, { Admin: 0, Developer: 0, Reviewer: 0, inactive: 0 } as Record<string, number>);

  return (
    <div className="min-h-[100dvh] bg-[#f3f6f9]">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b bg-background px-3 shadow-sm md:px-6">
        <div className="flex items-center gap-3">
          <YashLogo />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#0b7a6b]">Administration</p>
            <h1 className="text-base font-semibold leading-tight md:text-lg">Users &amp; permissions</h1>
          </div>
        </div>
        <Link href="/" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted" data-testid="link-back-assessment"><ArrowLeft className="h-4 w-4" /> Assessment</Link>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 p-3 md:p-8">
        <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-wrap gap-6 font-mono text-xs text-muted-foreground">
            {(["Admin", "Developer", "Reviewer"] as Role[]).map(r => (
              <div key={r}><div className="text-2xl font-semibold text-foreground" data-testid={`count-${r.toLowerCase()}`}>{counts[r]}</div>{r}s</div>
            ))}
            <div><div className="text-2xl font-semibold text-foreground">{counts.inactive}</div>inactive</div>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1 md:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search username or role" value={search} onChange={e => setSearch(e.target.value)} className="bg-background pl-8" data-testid="input-search-users" />
            </div>
            <Button variant="outline" size="icon" onClick={() => query.refetch()} aria-label="Refresh" data-testid="button-refresh-users"><RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} /></Button>
            <Button onClick={() => setCreating(true)} className="bg-[#081d33] text-white hover:bg-[#0f2c4a]" data-testid="button-create-user"><Plus className="mr-1.5 h-4 w-4" /> New user</Button>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border bg-background shadow-sm">
          {query.isLoading && <div className="space-y-2 p-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded bg-muted" />)}</div>}
          {query.isError && (
            <div className="space-y-3 p-8 text-center" data-testid="users-error">
              <p className="text-sm text-destructive">{(query.error as Error).message}</p>
              <Button variant="outline" onClick={() => query.refetch()}>Retry</Button>
            </div>
          )}
          {query.isSuccess && users.length === 0 && (
            <div className="space-y-2 p-12 text-center" data-testid="users-empty">
              <Users className="mx-auto h-8 w-8 text-slate-300" />
              <p className="text-sm text-muted-foreground">{search ? `No users match “${search}”.` : "No users yet."}</p>
            </div>
          )}
          {query.isSuccess && users.length > 0 && (
            <ul className="divide-y">
              {users.map(u => {
                const custom = Object.keys(u.overrides || {}).length;
                return (
                  <li key={String(u.id)} className={`flex flex-col gap-3 p-4 md:flex-row md:items-center ${u.active ? "" : "bg-slate-50 opacity-70"}`} data-testid={`row-user-${u.id}`}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#081d33]/90 font-mono text-xs text-white">{initials(u.username)}</span>
                      <div className="min-w-0">
                        <p className="truncate font-medium" data-testid={`text-username-${u.id}`}>{u.username}{String(u.id) === String(me?.id) && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">{u.permissions.join(" · ") || "no permissions"}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={ROLE_TONE[u.role]}>{u.role}</Badge>
                      {custom > 0 && <Badge variant="outline">{custom} custom</Badge>}
                      {u.mustChangePassword && <Badge variant="outline" className="border-amber-300 text-amber-800">temp password</Badge>}
                      {!u.active && <Badge variant="outline" className="border-destructive/40 text-destructive">inactive</Badge>}
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditing(u)} data-testid={`button-edit-user-${u.id}`}><UserCog className="mr-1 h-4 w-4" /> Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => setResetting(u)} data-testid={`button-reset-user-${u.id}`}><KeyRound className="mr-1 h-4 w-4" /> Reset</Button>
                      <Button size="sm" variant="ghost" disabled={toggleActive.isPending} onClick={() => toggleActive.mutate(u)} className={u.active ? "text-destructive hover:text-destructive" : ""} data-testid={`button-toggle-user-${u.id}`}>
                        {u.active ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <p className="text-xs text-muted-foreground">Roles are presets; per-user grants and revocations apply to assessment actions only. User management always requires the Admin role. The last active Admin cannot be demoted or deactivated. Changes apply to the user's next request.</p>
        <AccountAudit />
      </main>

      <CreateUserDialog open={creating} onClose={() => setCreating(false)} roles={roles} permissions={permissions} />
      <EditUserSheet user={editing} onClose={() => setEditing(null)} roles={roles} permissions={permissions} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}

function CreateUserDialog({ open, onClose, roles, permissions }: { open: boolean; onClose: () => void; roles: Role[]; permissions: string[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("Reviewer");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const reset = () => { setUsername(""); setPassword(""); setRole("Reviewer"); setOverrides({}); create.reset(); };
  const create = useMutation({
    mutationFn: () => apiJson<{ user: AuthUser }>("/api/admin/users", { method: "POST", json: { username: username.trim(), password, role, overrides } }),
    onSuccess: ({ user }) => {
      qc.invalidateQueries({ queryKey: USERS_KEY });
      toast({ title: "User created", description: `Give ${user.username} the temporary password through a separate secure channel. They must change it at first sign-in.` });
      reset(); onClose();
    },
  });
  const problem = passwordProblem(password);
  const submit = (e: FormEvent) => { e.preventDefault(); if (!problem && username.trim()) create.mutate(); };
  const eff = effective(role, overrides);
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>Set a temporary password. It is never shown again or logged.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="new-username">Username</Label>
              <Input id="new-username" value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" maxLength={64} required data-testid="input-new-username" /></div>
            <div className="space-y-1.5"><Label>Role preset</Label><RoleSelect value={role} onChange={setRole} roles={roles} testId="select-new-role" /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="new-user-password">Temporary password</Label>
            <Input id="new-user-password" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} maxLength={128} required data-testid="input-new-user-password" />
            <PasswordMeter value={password} /></div>
          <div className="space-y-1.5">
            <Label>Assessment permissions <span className="font-normal text-muted-foreground">· effective: {eff.size}</span></Label>
            <OverrideEditor role={role} overrides={overrides} onChange={setOverrides} permissions={permissions} />
          </div>
          {create.isError && <p role="alert" className="text-sm text-destructive">{(create.error as Error).message}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" disabled={create.isPending || !!problem || !username.trim()} data-testid="button-submit-create-user">
              {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserSheet({ user, onClose, roles, permissions }: { user: AuthUser | null; onClose: () => void; roles: Role[]; permissions: string[] }) {
  return (
    <Sheet open={!!user} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {user && <EditUserForm key={String(user.id)} user={user} onClose={onClose} roles={roles} permissions={permissions} />}
      </SheetContent>
    </Sheet>
  );
}

function EditUserForm({ user, onClose, roles, permissions }: { user: AuthUser; onClose: () => void; roles: Role[]; permissions: string[] }) {
  const qc = useQueryClient();
  const { refresh, user: me } = useAuth();
  const { toast } = useToast();
  const [role, setRole] = useState<Role>(user.role);
  const [active, setActive] = useState(user.active);
  const [overrides, setOverrides] = useState<Record<string, boolean>>(user.overrides || {});
  const save = useMutation({
    mutationFn: () => apiJson<{ user: AuthUser }>(`/api/admin/users/${encodeURIComponent(String(user.id))}`, { method: "PATCH", json: { role, active, overrides } }),
    onSuccess: ({ user: saved }) => {
      qc.invalidateQueries({ queryKey: USERS_KEY });
      if (String(saved.id) === String(me?.id)) void refresh();
      toast({ title: "Permissions updated", description: `${saved.username}: ${saved.permissions.length} effective permissions.` });
      onClose();
    },
  });
  const eff = effective(role, overrides);
  return (
    <div className="space-y-5">
      <SheetHeader>
        <SheetTitle>{user.username}</SheetTitle>
        <SheetDescription>Effective now: <span className="font-mono">{[...eff].join(", ") || "none"}</span></SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label>Role preset</Label><RoleSelect value={role} onChange={setRole} roles={roles} testId="select-edit-role" /></div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div><p className="text-sm font-medium">Active</p><p className="text-xs text-muted-foreground">Inactive users cannot sign in.</p></div>
          <Switch checked={active} onCheckedChange={setActive} data-testid="switch-active" />
        </div>
      </div>
      {role === "Admin" && <p className="rounded-md bg-[#081d33]/5 p-3 text-xs text-slate-700">Admin role grants user management. Assessment overrides below never affect that.</p>}
      <OverrideEditor role={role} overrides={overrides} onChange={setOverrides} permissions={permissions} />
      {save.isError && <p role="alert" className="text-sm text-destructive">{(save.error as Error).message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-user">{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save changes</Button>
      </div>
    </div>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: AuthUser | null; onClose: () => void }) {
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: () => apiJson<{ ok: true }>(`/api/admin/users/${encodeURIComponent(String(user!.id))}/reset-password`, { method: "POST", json: { password } }),
    onSuccess: () => {
      toast({ title: "Temporary password set", description: `${user?.username}'s sessions were revoked. They must change it at next sign-in.` });
      setPassword(""); onClose();
    },
  });
  const problem = passwordProblem(password);
  return (
    <Dialog open={!!user} onOpenChange={o => { if (!o) { setPassword(""); reset.reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {user?.username}</DialogTitle>
          <DialogDescription>Deliver the temporary password through a separate secure channel.</DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); if (!problem) reset.mutate(); }} className="space-y-3">
          <Input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} maxLength={128} placeholder="Temporary password" data-testid="input-reset-password" />
          <PasswordMeter value={password} />
          {reset.isError && <p role="alert" className="text-sm text-destructive">{(reset.error as Error).message}</p>}
          <DialogFooter>
            <Button type="submit" disabled={reset.isPending || !!problem} data-testid="button-submit-reset-password">{reset.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Set temporary password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
