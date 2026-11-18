import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { GitBranch, KeyRound, Lock, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { ProjectSourceImport } from "@/components/project-source-import";
import { githubCheck, githubConnect, githubDisconnect, githubStatus } from "@/lib/shared-assessments";

const MAX_CONNECTIONS = 100;
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Normalizes owner/repo or https://github.com/owner/repo; returns null if invalid. */
function normalizeRepo(raw: string): string | null {
  let v = raw.trim();
  const m = /^https:\/\/(?:www\.)?github\.com\/([^/?#]+\/[^/?#]+?)(?:\.git)?\/?$/i.exec(v);
  if (m) v = m[1];
  else if (/^[a-z]+:\/\//i.test(v)) return null;
  v = v.replace(/\.git$/i, "");
  return REPO_RE.test(v) ? v : null;
}

/** Strip anything resembling a token from server error text before display. */
const safeMessage = (e: unknown, fallback: string) => {
  const msg = e instanceof Error ? e.message : "";
  return (msg || fallback).replace(/github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+/g, "[redacted]");
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Unknown date" : d.toLocaleString();
};

type Mode = { kind: "add" } | { kind: "replace"; repository: string; username: string } | null;

export function GithubConnections() {
  const { user, can } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [repo, setRepo] = useState("");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | "__all__" | null>(null);
  const [checkingRepo, setCheckingRepo] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, { ok: boolean; message: string }>>({});

  const status = useQuery({
    queryKey: ["shared-github", user?.id],
    queryFn: ({ signal }) => githubStatus(signal),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  // Never keep a token in memory after the component leaves the screen.
  useEffect(() => () => setToken(""), []);

  const mayConnect = !!user && ["Admin", "Developer"].includes(user.role) && can("evidence");
  const data = status.data;
  const connections = data?.connections ?? [];
  const atLimit = connections.length >= MAX_CONNECTIONS;

  const openForm = (m: Exclude<Mode, null>) => {
    setMode(m);
    setRepo(m.kind === "replace" ? m.repository : "");
    setUsername(m.kind === "replace" ? m.username : "");
    setToken("");
    setFormError(null);
  };
  const closeForm = () => { setMode(null); setToken(""); setRepo(""); setUsername(""); setFormError(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const secret = token;
    setToken(""); // cleared immediately, regardless of outcome
    const repository = normalizeRepo(repo);
    const login = username.trim();
    if (!repository) { setFormError("Enter the repository as owner/repo or https://github.com/owner/repo."); return; }
    if (!USER_RE.test(login)) { setFormError("Enter the GitHub username that owns the token."); return; }
    if (!/^github_pat_[A-Za-z0-9_]{20,244}$/.test(secret) || secret.length > 255) {
      setFormError("Use a fine-grained personal access token (it starts with github_pat_). Account passwords and classic tokens are not accepted. Enter the token again.");
      return;
    }
    const replacing = connections.some(c => c.repository.toLowerCase() === repository.toLowerCase());
    if (!replacing && atLimit) { setFormError(`You already have ${MAX_CONNECTIONS} saved repositories. Remove one first.`); return; }
    setBusy(true); setFormError(null);
    try {
      const next = await githubConnect({ repository, username: login, token: secret });
      qc.setQueryData(["shared-github", user?.id], next);
      setChecks({});
      await qc.invalidateQueries({ queryKey: ["shared-github"] });
      toast({ title: replacing ? "Token replaced" : "Repository connected", description: `${repository} was verified with GitHub and saved.` });
      closeForm();
    } catch (err) {
      setFormError(`${safeMessage(err, "GitHub could not verify this connection.")} Enter the token again to retry.`);
    } finally { setBusy(false); }
  };

  const checkConnection = async (repository: string) => {
    setBusy(true);
    setCheckingRepo(repository);
    setChecks(previous => { const next = { ...previous }; delete next[repository]; return next; });
    try {
      const result = await githubCheck(repository);
      setChecks(previous => ({
        ...previous,
        [repository]: { ok: true, message: `Connection verified ${fmtDate(result.checkedAt)}. Repository and contents read access confirmed.` },
      }));
    } catch (err) {
      setChecks(previous => ({
        ...previous,
        [repository]: { ok: false, message: safeMessage(err, "Connection check failed. Check your token, repository permissions and network access, then retry.") },
      }));
    } finally { setBusy(false); setCheckingRepo(null); }
  };

  const confirmRemove = async () => {
    const target = pendingRemove;
    if (!target) return;
    setBusy(true);
    try {
      await githubDisconnect(target === "__all__" ? undefined : target);
      setChecks({});
      await qc.invalidateQueries({ queryKey: ["shared-github"] });
      toast({ title: target === "__all__" ? "All GitHub credentials removed" : "GitHub credential removed", description: "Existing assessment source snapshots were retained." });
      if (mode?.kind === "replace" && (target === "__all__" || mode.repository === target)) closeForm();
    } catch (err) {
      toast({ title: "Could not remove credential", description: safeMessage(err, "Try again."), variant: "destructive" });
    } finally { setBusy(false); setPendingRemove(null); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="github-connections">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-2xl font-semibold"><GitBranch className="h-6 w-6 text-primary" />GitHub Connections</h2>
          <p className="mt-1 text-sm text-muted-foreground">Read-only source evidence from GitHub.com repositories you connect to your account.</p>
        </div>
        <Button variant="outline" size="sm" disabled={status.isFetching || busy} onClick={() => void status.refetch()} data-testid="button-refresh-github">
          <RefreshCw className={`mr-2 h-4 w-4 ${status.isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {status.isLoading ? (
        <div className="space-y-3" data-testid="status-loading-github"><Skeleton className="h-20 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
      ) : status.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" data-testid="status-github-error">
          <span>Could not load GitHub connection status. {safeMessage(status.error, "")}</span>
          <Button size="sm" variant="outline" onClick={() => void status.refetch()} data-testid="button-retry-github">Retry</Button>
        </div>
      ) : data ? (
        <section className="overflow-hidden rounded-lg border bg-card" data-testid="card-github-status">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-5 py-4">
            <div role="status" data-testid="status-github">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Your status</p>
              <p className="mt-0.5 font-semibold">
                {!data.configured ? "Secure storage unavailable" : data.connected ? `${data.repositories.length} usable ${data.repositories.length === 1 ? "repository" : "repositories"}` : "No usable repositories"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {connections.length > 1 && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setPendingRemove("__all__")} data-testid="button-github-disconnect-all">Remove all</Button>
              )}
              {data.configured && mayConnect && mode?.kind !== "add" && (
                <Button size="sm" disabled={busy || atLimit} onClick={() => openForm({ kind: "add" })} data-testid="button-github-add">
                  <Plus className="mr-1.5 h-4 w-4" />Add repository
                </Button>
              )}
            </div>
          </div>

          {!data.configured && (
            <div className="flex gap-3 border-b px-5 py-4 text-sm" data-testid="status-github-storage-unavailable">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p>Encrypted credential storage is not available on this server, so new tokens cannot be entered. Ask your deployment administrator to check the server's secure session configuration. You can still remove saved connections below.</p>
            </div>
          )}
          {data.configured && !mayConnect && (
            <p className="border-b px-5 py-3 text-sm text-muted-foreground" data-testid="text-github-role-gate">Adding or replacing credentials requires an Admin or Developer account with Load evidence permission. You can view and remove your own connections.</p>
          )}
          {atLimit && mayConnect && <p className="border-b px-5 py-3 text-sm text-muted-foreground">You have reached the limit of {MAX_CONNECTIONS} saved repositories.</p>}

          {mode && data.configured && mayConnect && (
            <form onSubmit={e => void submit(e)} className="space-y-4 border-b bg-primary/[0.03] px-5 py-5" data-testid="form-github-connection" autoComplete="off">
              <div className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4 text-primary" />{mode.kind === "replace" ? `Replace token for ${mode.repository}` : "Connect a repository"}</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="gh-repo">Repository</Label>
                  <Input id="gh-repo" value={repo} onChange={e => setRepo(e.target.value)} readOnly={mode.kind === "replace"} placeholder="owner/repo or https://github.com/owner/repo" className="font-mono" spellCheck={false} autoCapitalize="none" autoComplete="off" data-testid="input-github-repository" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gh-user">GitHub username</Label>
                  <Input id="gh-user" value={username} onChange={e => setUsername(e.target.value)} placeholder="Token owner's login" maxLength={39} spellCheck={false} autoCapitalize="none" autoComplete="off" data-testid="input-github-username" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gh-token">Personal access token</Label>
                  <Input id="gh-token" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="github_pat_..." maxLength={255} autoComplete="new-password" spellCheck={false} autoCapitalize="none" className="font-mono" data-testid="input-github-token" required />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Not your GitHub password. Create a fine-grained token on GitHub.com limited to this repository with Contents and Metadata set to Read-only. The username must match the token owner. Organization repositories may need owner approval before the token works.</p>
              {formError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="text-github-form-error">{formError}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" disabled={busy} onClick={closeForm} data-testid="button-github-cancel">Cancel</Button>
                <Button type="submit" disabled={busy || !repo.trim() || !username.trim() || !token} data-testid="button-github-connect">
                  {busy ? "Verifying with GitHub..." : mode.kind === "replace" ? "Verify and replace" : "Verify and save"}
                </Button>
              </div>
            </form>
          )}

          {connections.length ? (
            <ul className="divide-y" data-testid="list-github-connections">
              {connections.map(c => (
                <li key={c.repository} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-github-${c.repository}`}>
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-medium">{c.repository}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className={`mr-2 inline-flex items-center rounded px-1.5 py-0.5 font-medium ${c.usable ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`} data-testid={`status-github-usable-${c.repository}`}>{c.usable ? "Saved" : "Needs replacement"}</span>
                      as {c.username} · {fmtDate(c.connectedAt)}
                    </p>
                    {checks[c.repository] && (
                      <p role="status" className={`mt-2 text-xs ${checks[c.repository].ok ? "text-emerald-700" : "text-destructive"}`} data-testid={`result-github-check-${c.repository}`}>
                        {checks[c.repository].message}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {data.configured && mayConnect && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy || !c.usable} onClick={() => void checkConnection(c.repository)} data-testid={`button-github-check-${c.repository}`}>
                          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${checkingRepo === c.repository ? "animate-spin" : ""}`} />
                          {checkingRepo === c.repository ? "Checking..." : "Check connection"}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => openForm({ kind: "replace", repository: c.repository, username: c.username })} data-testid={`button-github-replace-${c.repository}`}>Replace token</Button>
                      </>
                    )}
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setPendingRemove(c.repository)} data-testid={`button-github-disconnect-${c.repository}`}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-8 text-center text-sm text-muted-foreground" data-testid="empty-github-connections">
              <GitBranch className="mx-auto mb-2 h-6 w-6 opacity-50" />
              No repositories connected yet.{data.configured && mayConnect ? " Add one to map source files into assessments." : ""}
            </div>
          )}
          {connections.length > 0 && <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">"Saved" means the stored credential can be decrypted, not that it is still valid. Use Check connection to verify live repository and contents read access without changing assessments. Results apply at the time of the check.</p>}
        </section>
      ) : null}

      {data?.configured && mayConnect && <ProjectSourceImport repositories={data.repositories} usable={data.connected && data.repositories.length > 0} />}

      <section className="space-y-2.5 rounded-lg border bg-card p-5 text-sm">
        <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" />Read-only source access</h3>
        <p>Only GitHub.com is supported. Tokens are verified live before saving and stored encrypted on the server for your account only; they are never shown again. The accelerator reads files only. It never pushes commits, opens pull requests or executes source code.</p>
        <p>In the Object Explorer or Interfaces tab of your workspace, or in Shared assessments, open an object or interface and use Map GitHub source. Matching abapGit files (including class includes and namespaced names) are suggested; you confirm the repository and files explicitly, and can select files manually. The assessment keeps a snapshot tied to an immutable commit, and source checks propose findings without overwriting your decisions.</p>
        <p className="text-muted-foreground">Removing a connection deletes the saved credential and stops new reads. Existing assessment snapshots stay available to authorized members. To fully revoke access, also delete the token on GitHub.</p>
        <Button variant="outline" onClick={() => navigate("/shared-assessments")} data-testid="button-github-open-assessments">Open shared assessments</Button>
      </section>

      <AlertDialog open={pendingRemove !== null} onOpenChange={o => { if (!o && !busy) setPendingRemove(null); }}>
        <AlertDialogContent data-testid="dialog-github-remove">
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingRemove === "__all__" ? "Remove all GitHub credentials?" : "Remove this GitHub credential?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove === "__all__" ? "Every saved token for your account will be deleted." : <>The saved token for <span className="break-all font-mono">{pendingRemove}</span> will be deleted.</>}
              {" "}New source reads will stop. Assessment source snapshots already captured are retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="button-github-remove-cancel">Keep</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); void confirmRemove(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-github-remove-confirm">
              {busy ? "Removing..." : "Remove credential"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
