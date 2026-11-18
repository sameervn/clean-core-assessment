/**
 * Standalone, base-path-aware fetch helper for the Clean Core API.
 * Requests go to the same origin under `/api/...` with the session cookie.
 *
 * Session plumbing (set only by the AuthProvider):
 * - the CSRF token for the *current* session is attached to every mutation;
 * - every request is tied to the current session epoch, so switching or ending
 *   a session aborts stale in-flight requests and their late responses are dropped;
 * - 401/403 responses ask the AuthProvider to re-check /api/auth/me.
 * Browser checks are UX only; the server re-authorizes every request.
 */
let csrfToken: string | null = null;
let epoch = new AbortController();

export const AUTH_RECHECK_EVENT = "clean-core-auth-recheck";

/** Fixed id of the workspace holding all pre-project server data. */
export const LEGACY_PROJECT_ID = "00000000-0000-4000-8000-000000000002";
/** Product API prefixes that are isolated per client project on the server. */
const PROJECT_SCOPED_PREFIXES = ["/api/clean-core", "/api/shared-assessments", "/api/report-templates"];
let activeProjectId: string | null = null;
let projectEpoch = new AbortController();

export function isProjectScopedPath(url: string) {
  return PROJECT_SCOPED_PREFIXES.some(p => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));
}
export function getActiveProjectId() { return activeProjectId; }
/** Bind multi-step UI operations before local file/IndexedDB awaits, not just fetch. */
export function captureProjectGuard() {
  const project = activeProjectId, projectSignal = projectEpoch.signal, sessionSignal = epoch.signal;
  return () => {
    if (!project) throw new MissingProjectError();
    if (projectSignal.aborted || sessionSignal.aborted) {
      throw new DOMException("Project or session changed. Reopen the record before attaching source.", "AbortError");
    }
  };
}
/** Switch (or clear) the tab's project scope; aborts every request issued under the previous one. */
export function setActiveProjectId(id: string | null) {
  if (id === activeProjectId) return;
  activeProjectId = id;
  projectEpoch.abort();
  projectEpoch = new AbortController();
}

export class MissingProjectError extends Error {
  status = 428;
  constructor() { super("No client project is selected in this tab. Choose a project to continue."); this.name = "MissingProjectError"; }
}

export function setCsrfToken(token: string | null) { csrfToken = token; }

/** Abort every request issued under the previous identity. */
export function resetSessionRequests() {
  epoch.abort();
  epoch = new AbortController();
}

function combine(a: AbortSignal, b?: AbortSignal | null): AbortSignal {
  if (!b) return a;
  const anyFn = (AbortSignal as any).any as ((s: AbortSignal[]) => AbortSignal) | undefined;
  if (anyFn) return anyFn([a, b]);
  const c = new AbortController();
  const abort = () => c.abort();
  if (a.aborted || b.aborted) c.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return c.signal;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("/") ? path : `/${path}`;
  const method = (init?.method || "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  if (method !== "GET" && method !== "HEAD" && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const sessionSignal = epoch.signal;
  let signal = combine(sessionSignal, init?.signal);
  let scopeSignal: AbortSignal | null = null;
  if (isProjectScopedPath(url)) {
    // Fail closed: never let the server guess a scope (no implicit legacy fallback).
    if (!activeProjectId) throw new MissingProjectError();
    headers.set("X-CC-Project-ID", activeProjectId);
    scopeSignal = projectEpoch.signal;
    signal = combine(scopeSignal, signal);
  }
  const res = await fetch(url, { credentials: "include", ...init, headers, signal });
  if (sessionSignal.aborted) throw new DOMException("Session changed", "AbortError");
  if (scopeSignal?.aborted) throw new DOMException("Project changed", "AbortError");
  if ((res.status === 401 || res.status === 403) && !url.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event(AUTH_RECHECK_EVENT));
  }
  const guard = () => {
    if (sessionSignal.aborted) throw new DOMException("Session changed", "AbortError");
    if (scopeSignal?.aborted) throw new DOMException("Project changed", "AbortError");
  };
  // Scope can change after headers arrive but before a JSON/report body finishes.
  // Protect body readers too, including responses cloned by a consumer.
  const protect = (response: Response): Response => new Proxy(response, {
    get(target, property) {
      if (property === "clone") return () => protect(target.clone());
      const value = Reflect.get(target, property, target);
      if (["json", "text", "blob", "arrayBuffer", "formData"].includes(String(property))) {
        return async (...args: unknown[]) => {
          guard();
          const result = await value.apply(target, args);
          guard();
          return result;
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return protect(res);
}

export async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body && (body.message || body.error)) || `${fallback} (HTTP ${res.status})`;
}

/** JSON request helper that throws the server's `{message}` on failure. */
export async function apiJson<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init || {};
  const res = await apiFetch(path, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers as any) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const err = new Error(await readApiError(res, "Request failed")) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}
