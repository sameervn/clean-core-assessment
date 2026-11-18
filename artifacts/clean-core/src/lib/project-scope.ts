/** Tab-local registry of editors holding unsaved text, consulted before a project switch. */
const checks = new Set<() => boolean>();

export function registerUnsavedWork(check: () => boolean): () => void {
  checks.add(check);
  return () => { checks.delete(check); };
}

export function hasUnsavedWork(): boolean {
  for (const c of checks) { try { if (c()) return true; } catch { return true; } }
  return false;
}

const SELECTION_PREFIX = "clean-core:active-project:";

/** Selection is TAB-LOCAL (sessionStorage) and keyed by user; never cookie/localStorage. */
export function readStoredSelection(userId: string): string | null {
  try { return sessionStorage.getItem(SELECTION_PREFIX + userId); } catch { return null; }
}
export function writeStoredSelection(userId: string, projectId: string | null) {
  try {
    if (projectId) sessionStorage.setItem(SELECTION_PREFIX + userId, projectId);
    else sessionStorage.removeItem(SELECTION_PREFIX + userId);
  } catch { /* in-memory selection still applies for this tab */ }
}
export function clearAllStoredSelections() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SELECTION_PREFIX)) sessionStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

/** Forget one account's tab selection (on sign-out or switching to another account). */
export function clearStoredSelection(userId: string) { writeStoredSelection(userId, null); }
