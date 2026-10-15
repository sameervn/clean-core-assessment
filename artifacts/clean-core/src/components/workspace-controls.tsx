import { useRef } from "react";
import { AlertTriangle, Check, CloudOff, Download, Loader2, RotateCcw, Upload } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";
export interface PendingReplace { kind: "demo" | "restore" | "reset" | "unreadable"; onConfirm: () => void }

export function SaveIndicator({ state, error, lastSavedAt, onRetry }: { state: SaveState; error: string | null; lastSavedAt: Date | null; onRetry: () => void }) {
  if (state === "error") {
    return (
      <button onClick={onRetry} title={error || undefined} data-testid="status-save-error"
        className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Save failed, retry</span>
      </button>
    );
  }
  const label = state === "saving" || state === "pending" ? "Saving..." : state === "saved" ? "Saved locally" : "Not saved yet";
  const Icon = state === "saving" || state === "pending" ? Loader2 : state === "saved" ? Check : CloudOff;
  return (
    <span data-testid="status-save" title={lastSavedAt ? `Last saved to this browser at ${lastSavedAt.toLocaleTimeString()}` : "Workspace is stored only in this browser"}
      className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className={`h-3.5 w-3.5 ${state === "saving" || state === "pending" ? "animate-spin" : ""} ${state === "saved" ? "text-green-600" : ""}`} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

const COPY: Record<PendingReplace["kind"], { title: string; body: string; action: string }> = {
  unreadable: { title: "Replace unreadable saved work?", body: "This permanently replaces the unreadable record in this browser with an empty workspace. Download the unreadable record first if you want to keep it for recovery. Cancelling leaves it unchanged.", action: "Replace saved work" },
  demo: { title: "Replace workspace with demo landscape?", body: "Loading demo data replaces the current evidence, assessment, overrides, narratives and baseline in this browser. Export a workspace backup first if you want to keep them.", action: "Load demo" },
  restore: { title: "Replace workspace with backup?", body: "Restoring overwrites the current workspace in this browser after the server re-verifies the backup evidence and recomputes the assessment. If verification fails, nothing is replaced; re-upload the original evidence files instead.", action: "Restore backup" },
  reset: { title: "Clear this workspace?", body: "This permanently removes evidence, assessment, overrides, narratives and baseline from this browser. System and target release are kept.", action: "Clear workspace" },
};

export function ReplaceWorkspaceDialog({ pending, onClose }: { pending: PendingReplace | null; onClose: () => void }) {
  const copy = pending ? COPY[pending.kind] : null;
  return (
    <AlertDialog open={!!pending} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-replace">Cancel</AlertDialogCancel>
          <AlertDialogAction data-testid="button-confirm-replace"
            className={pending?.kind === "reset" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            onClick={() => { const p = pending; onClose(); p?.onConfirm(); }}>
            {copy?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function WorkspaceBackupCard({ onExport, onRestore, onReset, canExport = true, canRestore = true, canReset = true }: { onExport: () => void; onRestore: (file: File) => void; onReset: () => void; canExport?: boolean; canRestore?: boolean; canReset?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Card className="shadow-sm">
      <CardHeader className="bg-muted/20 border-b">
        <CardTitle>Workspace Backup</CardTitle>
        <CardDescription>The workspace lives only in this browser (IndexedDB). Back it up to move it between browsers or keep a safe copy.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button variant="outline" onClick={onExport} disabled={!canExport} data-testid="button-export-backup"><Download className="mr-2 h-4 w-4" /> Export workspace backup</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={!canRestore} data-testid="button-restore-backup"><Upload className="mr-2 h-4 w-4" /> Restore from backup</Button>
          <Button variant="ghost" className="text-destructive hover:text-destructive sm:ml-auto" onClick={onReset} disabled={!canReset} data-testid="button-reset-workspace"><RotateCcw className="mr-2 h-4 w-4" /> Clear workspace</Button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" data-testid="input-restore-backup"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onRestore(f); }} />
        </div>
        <p className="text-xs text-muted-foreground">
          Saved only in this browser; evidence is sent to this app's backend for processing, not retained there. Backups contain server-attested evidence, overrides, narratives and baseline. On restore, the file is validated and the assessment is recomputed by the server from the attested evidence before anything is replaced. If verification fails, your current workspace stays intact; re-upload the original evidence files instead.
        </p>
      </CardContent>
    </Card>
  );
}
