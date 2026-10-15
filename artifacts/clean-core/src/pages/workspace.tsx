import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ChevronDown, Eye, FileUp, KeyRound, Loader2, LogOut, ShieldCheck, Users, Inbox, Library, FileText } from "lucide-react";
import CleanCoreAssessmentPage, { type AssessmentAccess, type WorkspaceMode } from "@/pages/clean-core-assessment";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiJson } from "@/lib/api";
import { useAuth, initials } from "@/lib/auth";
import {
  openWorkspaceStore, parseBackup, validateWorkspace, emptyWorkspace, inspectAnonymousWorkspace, claimAnonymousWorkspace,
  declineAnonymousWorkspace, MAX_BACKUP_FILE_BYTES, type StoredWorkspace, type WorkspaceStore, type AnonymousWorkspaceInfo,
} from "@/lib/workspace-store";

type ReadOnlyView = { workspace: StoredWorkspace; label: string; seq: number };

/**
 * Per-account workspace host. Its storage handle is created for one immutable
 * user id and disposed on change, so late saves from a previous account fail
 * closed. The page is keyed by identity + permission signature and remounts
 * with empty in-memory state whenever either changes.
 */
export default function WorkspaceRoute() {
  const auth = useAuth();
  const user = auth.user!;
  const userId = String(user.id);
  const [store, setStore] = useState<WorkspaceStore | null>(null);
  const [view, setView] = useState<ReadOnlyView | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);

  useEffect(() => {
    const handle = openWorkspaceStore(userId);
    setStore(handle);
    setView(null);
    return () => { handle.dispose(); setStore(null); };
  }, [userId]);

  const authRef = useRef(auth);
  authRef.current = auth;
  const access = useMemo<AssessmentAccess>(() => ({
    can: (p) => authRef.current.can(p),
    authorize: (p) => authRef.current.authorize(p),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [auth.signature]);

  if (!auth.can("view")) return <NoAccess />;
  if (!store || store.scope !== `user-${userId}`) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50" data-testid="status-loading-workspace"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const mode: WorkspaceMode = view
    ? { kind: "readonly", workspace: view.workspace, label: view.label, onExit: () => setView(null) }
    : { kind: "saved", store };

  return (
    <>
      {auth.isAdmin && !view && <AnonymousClaimBanner store={store} onImported={() => setReloadSeq(n => n + 1)} />}
      <CleanCoreAssessmentPage
        key={`${auth.signature}:${view ? `ro-${view.seq}` : `saved-${reloadSeq}`}`}
        mode={mode}
        access={access}
        headerExtras={<AccountMenu onOpenReadOnly={(workspace, label) => setView(v => ({ workspace, label, seq: (v?.seq ?? 0) + 1 }))} />}
      />
    </>
  );
}

function useLogoutWithFeedback() {
  const { logout } = useAuth();
  const { toast } = useToast();
  return () => logout().catch((e: Error) => toast({ title: "Not signed out", description: e.message, variant: "destructive" }));
}

function NoAccess() {
  const { user } = useAuth();
  const logout = useLogoutWithFeedback();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f3f6f9] p-6">
      <div className="max-w-sm space-y-3 text-center" data-testid="no-view-permission">
        <ShieldCheck className="mx-auto h-8 w-8 text-slate-400" />
        <h1 className="text-lg font-semibold">No assessment access</h1>
        <p className="text-sm text-muted-foreground">{user?.username} is signed in but does not have the view permission. Ask an administrator to grant it.</p>
        <Button variant="outline" onClick={() => void logout()} data-testid="button-logout"><LogOut className="mr-2 h-4 w-4" /> Sign out</Button>
      </div>
    </div>
  );
}

function AccountMenu({ onOpenReadOnly }: { onOpenReadOnly: (ws: StoredWorkspace, label: string) => void }) {
  const { user, isAdmin, authorize, can } = useAuth();
  const logout = useLogoutWithFeedback();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);
  if (!user) return null;

  const openDemo = async () => {
    setLoadingDemo(true);
    try {
      const { evidence, assessment } = await apiJson<{ evidence: any[]; assessment: any }>("/api/clean-core/review-demo");
      const check = validateWorkspace({ ...emptyWorkspace(), system: assessment?.system || "DEMO", targetRelease: assessment?.targetRelease || "S4HANA_2025", evidence, assessment });
      if (!check.ok) throw new Error(`Demo data invalid: ${check.error}`);
      onOpenReadOnly(check.workspace, "demo landscape");
    } catch (e: any) {
      if (e?.name !== "AbortError") toast({ title: "Demo preview unavailable", description: e?.message, variant: "destructive" });
    } finally { setLoadingDemo(false); }
  };

  const openBackup = async (file: File) => {
    if (file.size > MAX_BACKUP_FILE_BYTES) { toast({ title: "Backup too large", description: "Backups must be 64 MB or smaller.", variant: "destructive" }); return; }
    const text = await file.text().catch(() => null);
    if (text === null) { toast({ title: "Could not read file", variant: "destructive" }); return; }
    // Local, read-only: never recalculated, never saved, never replaces the workspace.
    const result = parseBackup(text);
    if (!result.ok) { toast({ title: "Backup rejected", description: result.error, variant: "destructive" }); return; }
    // Re-check with the server after the (possibly slow) read: catches revoked access.
    try { await authorize("view"); }
    catch (e: any) { toast({ title: "Not permitted", description: e?.message, variant: "destructive" }); return; }
    onOpenReadOnly(result.workspace, `backup “${file.name}” (as stored, not re-verified)`);
  };

  return (
    <>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" data-testid="input-open-backup-readonly"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void openBackup(f); }} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2 pl-1.5" data-testid="button-account-menu">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#081d33] font-mono text-[10px] text-white">{initials(user.username)}</span>
            <span className="hidden max-w-[8rem] truncate md:inline" data-testid="text-current-user">{user.username}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="space-y-1">
            <p className="text-sm">{user.username} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide" data-testid="text-current-role">{user.role}</span></p>
            <p className="font-mono text-[10px] font-normal leading-relaxed text-muted-foreground" data-testid="text-effective-permissions">{user.permissions.join(" · ")}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={loadingDemo} onSelect={() => void openDemo()} data-testid="menu-preview-demo">
            {loadingDemo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />} Preview demo (read-only)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => fileRef.current?.click()} data-testid="menu-open-backup-readonly">
            <FileUp className="mr-2 h-4 w-4" /> Open backup read-only…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {(can as (p: string) => boolean)("knowledge.read") && <DropdownMenuItem onSelect={() => navigate("/knowledge")} data-testid="menu-knowledge"><Library className="mr-2 h-4 w-4" /> Knowledge base</DropdownMenuItem>}
          {(can as (p: string) => boolean)("templates.manage") && <DropdownMenuItem onSelect={() => navigate("/report-templates")} data-testid="menu-report-templates"><FileText className="mr-2 h-4 w-4" /> Word report templates</DropdownMenuItem>}
          {isAdmin && <DropdownMenuItem onSelect={() => navigate("/admin")} data-testid="menu-manage-users"><Users className="mr-2 h-4 w-4" /> Users &amp; permissions</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => navigate("/account/password")} data-testid="menu-change-password"><KeyRound className="mr-2 h-4 w-4" /> Change password</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void logout()} className="text-destructive focus:text-destructive" data-testid="menu-logout"><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Admin-only, explicit, one-time import of the pre-accounts anonymous workspace. */
function AnonymousClaimBanner({ store, onImported }: { store: WorkspaceStore; onImported: () => void }) {
  const { user, can, authorize } = useAuth();
  const { toast } = useToast();
  const [info, setInfo] = useState<AnonymousWorkspaceInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    inspectAnonymousWorkspace().then(i => { if (live) setInfo(i); }).catch(() => undefined);
    return () => { live = false; };
  }, [store]);

  if (!info?.exists || info.claimedBy) return null;
  const claimer = `user-${String(user!.id)}`;

  const doImport = async () => {
    setBusy(true);
    try {
      await authorize("restore");
      // Marked claimed only after the scoped save commits, under a cross-tab lock.
      await claimAnonymousWorkspace(claimer, async (ws) => {
        const current = await store.load();
        await store.save(ws, current.revision);
      });
      setInfo({ ...info, claimedBy: claimer });
      toast({ title: "Earlier workspace imported", description: "It is now saved in your account's browser workspace. The original record is kept but will not be offered again." });
      onImported();
    } catch (e: any) {
      toast({ title: "Import failed", description: `${e?.message || "Unknown error"}. Nothing was marked claimed; you can retry.`, variant: "destructive" });
      inspectAnonymousWorkspace().then(setInfo).catch(() => undefined);
    } finally { setBusy(false); setConfirming(false); }
  };

  const decline = async () => {
    try { await declineAnonymousWorkspace(claimer); setInfo({ ...info, claimedBy: `declined:${claimer}` }); }
    catch (e: any) { toast({ title: "Could not save decision", description: e?.message, variant: "destructive" }); }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[#70d6c2]/50 bg-[#e8f8f4] px-3 py-2 text-sm text-[#0b3d36] md:px-6" data-testid="banner-anonymous-claim">
      <Inbox className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">
        This browser holds a workspace saved before sign-in was required{info.savedAt ? ` (last saved ${new Date(info.savedAt).toLocaleString()})` : ""}.
        {info.valid ? " It is hidden from all accounts until an administrator decides." : " It did not pass validation and cannot be imported."}
      </p>
      {info.valid && <Button size="sm" disabled={!can("restore") || busy} onClick={() => setConfirming(true)} data-testid="button-claim-anonymous">Import into my workspace</Button>}
      <Button size="sm" variant="ghost" onClick={() => void decline()} data-testid="button-decline-anonymous">Keep it untouched</Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import the earlier workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces your current saved workspace with the earlier one. Export a backup first if you need your current work. The import can only happen once; other accounts will never see it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); void doImport(); }} data-testid="button-confirm-claim">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Import and replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
