import { validateWorkspace, type WorkspaceStore, type StoredWorkspace } from "./workspace-store";

const PREFIX = "recovery:";
export const DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export interface RecoveryDraft {
  id: string;
  updatedAt: number;
  workspace: unknown;
  validWorkspace?: StoredWorkspace;
  validationError?: string;
}

// Separate keys, never the canonical "current" record. Transactions serialize
// cleanup against draft writes, including writes from other tabs.
export async function listRecoveryDrafts(store: WorkspaceStore): Promise<RecoveryDraft[]> {
  const db = await store.database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readwrite");
    const request = tx.objectStore("workspace").openCursor();
    const drafts: RecoveryDraft[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.key === "string" && cursor.key.startsWith(PREFIX)) {
        const raw = cursor.value;
        if (typeof raw?.updatedAt === "number" && raw.updatedAt < Date.now() - DRAFT_RETENTION_MS) {
          cursor.delete();
        } else {
          let validWorkspace: StoredWorkspace | undefined;
          let validationError: string | undefined;
          try {
            const result = validateWorkspace(raw?.workspace);
            if (result.ok) validWorkspace = result.workspace;
            else validationError = result.error;
          } catch { validationError = "The draft needs repair."; }
          // Preserve raw contents for export even if a field was incomplete at
          // close time. Validation gates review, never discovery or download.
          drafts.push({
            id: cursor.key.slice(PREFIX.length),
            updatedAt: Number.isFinite(raw?.updatedAt) ? raw.updatedAt : 0,
            workspace: raw?.workspace,
            validWorkspace, validationError,
          });
        }
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(drafts.sort((a, b) => b.updatedAt - a.updatedAt));
    tx.onabort = tx.onerror = () => reject(tx.error || new Error("Could not read recovery drafts."));
  });
}

export async function writeRecoveryDraft(store: WorkspaceStore, id: string, workspace: StoredWorkspace): Promise<void> {
  await changeDraft(store, id, { id, updatedAt: Date.now(), workspace });
}

export async function deleteRecoveryDraft(store: WorkspaceStore, id: string): Promise<void> {
  await changeDraft(store, id);
}

async function changeDraft(store: WorkspaceStore, id: string, draft?: RecoveryDraft): Promise<void> {
  const db = await store.database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", "readwrite");
    const store = tx.objectStore("workspace");
    if (draft) store.put(draft, PREFIX + id);
    else store.delete(PREFIX + id);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error || new Error("Could not update recovery draft."));
  });
}
