import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiJson, readApiError, resetSessionRequests, setCsrfToken, AUTH_RECHECK_EVENT } from "@/lib/api";

export type Role = "Admin" | "Developer" | "Reviewer";
export const PERMISSION_IDS = [
  "view", "evidence", "run", "notes", "classify", "baseline",
  "ai.generate", "ai.accept", "ai.remove", "export", "restore", "reset",
  "knowledge.read", "knowledge.upload", "knowledge.manage-all",
  "templates.manage",
] as const;
export type PermissionId = typeof PERMISSION_IDS[number];

export const PERMISSION_LABELS: Record<PermissionId, { label: string; hint: string }> = {
  "knowledge.read": { label: "Read knowledge", hint: "Search and read shared guidance and use it in AI previews." },
  "knowledge.upload": { label: "Upload knowledge", hint: "Upload guidance and manage your own documents." },
  "knowledge.manage-all": { label: "Manage all knowledge", hint: "Replace or remove any account's shared documents." },
  "templates.manage": { label: "Manage report templates", hint: "Upload, rename, replace, delete, preview and set the default Word report template." },
  view: { label: "View assessments", hint: "Open dashboards, explorer, roadmap and read-only previews." },
  evidence: { label: "Load evidence", hint: "Upload evidence files and load the demo landscape." },
  run: { label: "Run assessments", hint: "Send evidence to the engine and replace results." },
  notes: { label: "Expert narratives", hint: "Write and save object and interface notes." },
  classify: { label: "Classification overrides", hint: "Apply, retry or discard manual A–D overrides." },
  baseline: { label: "Baselines", hint: "Set the current assessment as the comparison baseline." },
  "ai.generate": { label: "Generate AI drafts", hint: "Send the structured summary to the configured AI provider." },
  "ai.accept": { label: "Accept AI explanations", hint: "Keep a generated draft alongside expert notes." },
  "ai.remove": { label: "Remove AI explanations", hint: "Delete accepted AI explanations." },
  export: { label: "Export & backup", hint: "Download reports, evidence packs and workspace backups." },
  restore: { label: "Restore backups", hint: "Replace the saved workspace from a backup file." },
  reset: { label: "Clear workspace", hint: "Remove all evidence, results and notes from this browser." },
};

export const ROLE_PRESETS: Record<Role, PermissionId[]> = {
  Admin: [...PERMISSION_IDS],
  Developer: PERMISSION_IDS.filter(p => p !== "knowledge.manage-all"),
  Reviewer: ["view", "export", "knowledge.read"],
};

export interface AuthUser {
  id: string | number;
  username: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  permissions: string[];
  overrides: Record<string, boolean>;
}

type MeResponse = { user: AuthUser | null; csrfToken?: string; setupRequired?: boolean };

type AuthState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "anonymous"; setupRequired: boolean; notice?: string }
  | { status: "authenticated"; user: AuthUser };

interface AuthApi {
  state: AuthState;
  user: AuthUser | null;
  can: (permission: PermissionId) => boolean;
  isAdmin: boolean;
  /** Stable identity + permission signature; remount scoped UI when it changes. */
  signature: string;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Server re-check before a local-only action (browser storage is not a security boundary). */
  authorize: (permission: PermissionId) => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);
const REFRESH_MS = 60_000;
function notifySessionChanged() {
  try {
    const channel = new BroadcastChannel("cc-session-changed");
    channel.postMessage("refresh");
    channel.close();
  } catch { /* Focus and periodic checks remain available. */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const identityRef = useRef<string>("none");
  const signatureRef = useRef<string>("none");
  const inflight = useRef<Promise<void> | null>(null);
  /** Bumped by login/logout/password change; stale /me responses are ignored. */
  const generation = useRef(0);

  const apply = useCallback((body: MeResponse, notice?: string) => {
    const user = body.user;
    identityRef.current = user ? `${user.id}` : "none";
    const sig = user
      ? `${user.id}|${user.role}|${user.active}|${user.mustChangePassword}|${[...user.permissions].sort().join(",")}`
      : "none";
    if (sig !== signatureRef.current) {
      // Different account, sign-out, or changed authority: drop everything tied to the old state.
      signatureRef.current = sig;
      resetSessionRequests();
      queryClient.cancelQueries();
      queryClient.clear();
    }
    setCsrfToken(user ? body.csrfToken ?? null : null);
    setState(user ? { status: "authenticated", user } : { status: "anonymous", setupRequired: !!body.setupRequired, notice });
  }, [queryClient]);

  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    const gen = generation.current;
    let run: Promise<void> | null = null;
    run = (async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        if (!res.ok && res.status !== 401) throw new Error(await readApiError(res, "Could not check your session"));
        const body = (res.ok ? await res.json() : { user: null }) as MeResponse;
        if (gen !== generation.current) return; // superseded by login/logout/password change
        apply(body, identityRef.current !== "none" && !body.user ? "Your session ended. Sign in again to continue." : undefined);
      } catch (e) {
        if (gen !== generation.current) return;
        setState(prev => prev.status === "authenticated" ? prev : { status: "error", message: e instanceof Error ? e.message : "Could not reach the server." });
        } finally { if (inflight.current === run) inflight.current = null; }
    })();
    inflight.current = run;
    return run!;
  }, [apply]);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_MS);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("cc-session-changed");
      channel.onmessage = () => {
        generation.current++;
        inflight.current = null;
        resetSessionRequests();
        queryClient.cancelQueries();
        queryClient.clear();
        setState({ status: "loading" });
        void refresh();
      };
    } catch { /* Focus checks still synchronize without BroadcastChannel. */ }
    window.addEventListener("focus", onFocus);
    window.addEventListener(AUTH_RECHECK_EVENT, onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      channel?.close();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(AUTH_RECHECK_EVENT, onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, queryClient]);

  const login = useCallback(async (username: string, password: string) => {
    generation.current++;
    inflight.current = null;
    const res = await fetch("/api/auth/login", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(await readApiError(res, "Sign-in failed"));
    const body = await res.json();
    generation.current++;
    inflight.current = null;
    apply(body);
    notifySessionChanged();
  }, [apply]);

  const logout = useCallback(async () => {
    generation.current++;
    inflight.current = null;
    let res: Response;
    try { res = await apiFetch("/api/auth/logout", { method: "POST" }); }
    catch { throw new Error("Could not reach the server. You are still signed in; try again."); }
    // 401 means the server session is already gone.
    if (!res.ok && res.status !== 401) throw new Error(await readApiError(res, "Sign-out failed. You are still signed in"));
    generation.current++;
    apply({ user: null }, "You have signed out.");
    notifySessionChanged();
  }, [apply]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    generation.current++;
    inflight.current = null;
    await apiJson("/api/auth/password", { method: "POST", json: { currentPassword, newPassword } });
    generation.current++;
    apply({ user: null }, "Password changed. All sessions were signed out — sign in with your new password.");
    notifySessionChanged();
  }, [apply]);

  const authorize = useCallback(async (permission: PermissionId) => {
    const res = await apiFetch("/api/auth/authorize", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permission }),
    });
    if (!res.ok) {
      const message = await readApiError(res, "Not permitted");
      void refresh();
      throw new Error(message);
    }
  }, [refresh]);

  const user = state.status === "authenticated" ? state.user : null;
  const value = useMemo<AuthApi>(() => {
    const perms = new Set(user?.active ? user.permissions : []);
    return {
      state, user, refresh, login, logout, changePassword, authorize,
      can: (p) => perms.has(p),
      isAdmin: !!user?.active && user.role === "Admin",
      signature: user ? `${user.id}|${user.role}|${[...perms].sort().join(",")}` : "anonymous",
    };
  }, [state, user, refresh, login, logout, changePassword, authorize]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function initials(name: string) {
  return name.replace(/[^a-zA-Z0-9]/g, " ").trim().split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase() || "?";
}
