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
  const res = await fetch(url, { credentials: "include", ...init, headers, signal: combine(sessionSignal, init?.signal) });
  if (sessionSignal.aborted) throw new DOMException("Session changed", "AbortError");
  if ((res.status === 401 || res.status === 403) && !url.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event(AUTH_RECHECK_EVENT));
  }
  return res;
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
