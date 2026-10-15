import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BACKUP_FORMAT, BACKUP_VERSION, type StoredWorkspace, type WorkspaceStore } from "@/lib/workspace-store";
import { deleteRecoveryDraft, listRecoveryDrafts, writeRecoveryDraft, type RecoveryDraft } from "@/lib/recovery-drafts";

export function RecoveryDrafts({ store, snapshot, conflicted, onRecover, onDiscardActive }: {
  store: WorkspaceStore;
  snapshot: StoredWorkspace;
  conflicted: boolean;
  onRecover: (workspace: StoredWorkspace) => void;
  onDiscardActive: () => void;
}) {
  // Do not use sessionStorage: browsers can copy it when duplicating a tab.
  const [id] = useState(() => crypto.randomUUID());
  const [drafts, setDrafts] = useState<RecoveryDraft[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const chain = useRef(Promise.resolve());
  const skipReviewWrite = useRef(false);
  const reviewingId = useRef<string | null>(null);
  const discardingActive = useRef(false);
  const refresh = useCallback(() => {
    listRecoveryDrafts(store).then(setDrafts).catch(() => setError("Recovery drafts could not be read. Browser storage may be unavailable."));
  }, [store]);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  useEffect(() => {
    if (!conflicted || discardingActive.current) return;
    if (skipReviewWrite.current) {
      skipReviewWrite.current = false;
      setStatus("Reviewing the retained draft. No additional copy was created.");
      return;
    }
    let current = true;
    setStatus("Saving a separate recovery draft…");
    // Start immediately rather than waiting for unload or a debounce timer.
    chain.current = chain.current.catch(() => undefined).then(() => writeRecoveryDraft(store, id, snapshot));
    chain.current.then(() => {
      if (current) { setStatus("Recovery draft saved in this browser."); setError(""); refresh(); }
    }).catch(() => {
      if (current) {
        setStatus("");
        setError("Recovery draft could not be saved. Download this tab's backup before closing it.");
      }
    });
    return () => { current = false; };
  }, [store, id, snapshot, conflicted, refresh]);

  const download = (draft: RecoveryDraft) => {
    const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), workspace: draft.workspace };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `clean-core-recovery-${draft.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const available = drafts;
  if (!conflicted && !available.length && !error) return null;
  return <section aria-label="Recovery drafts" data-testid="recovery-drafts" className="shrink-0 border-b border-amber-300 bg-amber-50 p-3 text-sm text-slate-900">
    <p className="font-semibold">Separate recovery drafts</p>
    <p>Drafts contain assessment data and stay only in this browser for 7 days after their last edit. Expired drafts are removed when recovery is checked. Exporting or loading newer saved work keeps the draft; discard it explicitly when no longer needed. Editing a reviewed draft creates a separate copy for this tab, also listed here. Clearing browser data also removes drafts.</p>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
    {available.map(draft => <div key={draft.id} className="mt-3 flex flex-wrap items-center gap-2">
      <span>{draft.validWorkspace?.system || "Incomplete recovery draft"} — {draft.updatedAt ? new Date(draft.updatedAt).toLocaleString() : "Unknown date"}{draft.id === id ? " (this tab)" : ""}</span>
      {draft.validationError && <span role="status">Needs repair: {draft.validationError}. Export to keep all edits; this draft cannot be reviewed until repaired.</span>}
      <Button variant="outline" size="sm" onClick={() => download(draft)}>Export recovery draft</Button>
      <Button variant="outline" size="sm" disabled={conflicted || !draft.validWorkspace} onClick={() => {
        if (draft.validWorkspace && window.confirm("Open this draft for review? Saving will be paused, and the newer saved workspace will remain unchanged. Export the draft to keep a portable backup.")) {
          skipReviewWrite.current = true;
          reviewingId.current = draft.id;
          onRecover(draft.validWorkspace);
        }
      }}>Review recovery draft</Button>
      <Button variant="outline" size="sm" onClick={async () => {
        const active = draft.id === id || draft.id === reviewingId.current;
        if (!window.confirm(`Permanently discard this recovery draft? Export it first if you need a copy.${active ? " The newer saved workspace will be loaded." : ""}`)) return;
        if (active) discardingActive.current = true;
        try {
          await chain.current.catch(() => undefined);
          await deleteRecoveryDraft(store, draft.id);
          setError("");
          if (active) onDiscardActive();
          else refresh();
        }
        catch { discardingActive.current = false; setError("Could not discard this recovery draft. Please try again."); }
      }}>Discard draft</Button>
    </div>)}
  </section>;
}
