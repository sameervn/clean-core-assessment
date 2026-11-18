import { useRef, useState } from "react";
import { AlertTriangle, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { MAX_RECORD_SOURCES, MAX_UPLOAD_NAME, MAX_UPLOAD_SOURCE_BYTES, isUploadSource, stateKey } from "@/lib/shared-assessments";
import type { MappingPreparation } from "@/components/source-mapper";

export interface UploadSelection { file: File; fileName: string; fileBase64: string; version: number | null }

const EXT = /\.(txt|abap)$/i;

function toBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Validates locally; the server re-validates everything. Returns an actionable message or the encoded payload. */
async function readSource(file: File): Promise<{ error: string } | { fileBase64: string }> {
  if (!EXT.test(file.name)) return { error: `"${file.name}" is not a .txt or .abap file. Export the ABAP source as plain text with one of those extensions.` };
  if (file.name !== file.name.trim()) return { error: "The file name starts or ends with a space. Rename the file and choose it again." };
  if (/[\/\\\u0000-\u001f\u007f]/.test(file.name)) return { error: "The file name contains a slash, backslash or control character. Rename the file and choose it again." };
  if (file.name.length > MAX_UPLOAD_NAME) return { error: `File name is ${file.name.length} characters; rename it to ${MAX_UPLOAD_NAME} characters or fewer.` };
  if (file.size === 0) return { error: "The file is empty. Choose the exported source file." };
  if (file.size > MAX_UPLOAD_SOURCE_BYTES) return { error: `File is ${file.size.toLocaleString()} bytes; the limit is ${MAX_UPLOAD_SOURCE_BYTES.toLocaleString()} bytes. Split the source into includes and upload them separately.` };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { error: "The file is not valid UTF-8 text. Re-export it as UTF-8 (binary or other encodings are rejected)." }; }
  if (bytes.some(b => (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f)) return { error: "The file contains control characters (only tab and line breaks are allowed). Upload plain UTF-8 text only." };
  if (!text.trim()) return { error: "The file contains only whitespace. Choose the exported source file." };
  return { fileBase64: toBase64(bytes) };
}

/** Attach one local .txt/.abap file to a record; nothing is uploaded without explicit confirmation. */
export function SourceUploader({ name, state, recordVersion, existingSources, blockedReason, prepare, commit }: {
  name: string; state?: string | null; recordVersion?: number | null; existingSources: unknown[] | null | undefined;
  blockedReason?: string | null; prepare?: () => Promise<MappingPreparation>; commit: (u: UploadSelection) => Promise<void>;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useRef(`source-upload-${Math.random().toString(36).slice(2)}`).current;
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<(UploadSelection & { state: string }) | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [prep, setPrep] = useState<{ loading: boolean; error?: string; data?: MappingPreparation }>({ loading: false });
  const [acks, setAcks] = useState<Record<number, boolean>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sources = (Array.isArray(existingSources) ? existingSources : []) as any[];
  const replaces = (fn: string) => sources.some(s => isUploadSource(s) && s?.path === fn);
  const total = (fn: string) => sources.filter(s => !(isUploadSource(s) && s?.path === fn)).length + 1;
  const stale = !!frozen && (frozen.version !== (recordVersion ?? null) || frozen.state !== (state || ""));
  const sealed = ["submitted", "approved"].includes(stateKey(state || ""));

  const pick = (f: File | null) => { setFile(f); setInvalid(null); setError(null); };
  const clear = () => { pick(null); if (inputRef.current) inputRef.current.value = ""; };

  const openConfirm = async () => {
    if (!file || blockedReason) return;
    setChecking(true); setInvalid(null);
    try {
      const r = await readSource(file);
      if ("error" in r) { setInvalid(r.error); return; }
      if (total(file.name) > MAX_RECORD_SOURCES) { setInvalid(`This record already has ${sources.length} source files; the limit is ${MAX_RECORD_SOURCES} across GitHub and uploads. Re-map GitHub with fewer files or reuse an existing upload name to replace it.`); return; }
      setFrozen({ file, fileName: file.name, fileBase64: r.fileBase64, version: recordVersion ?? null, state: state || "" });
    } catch (e: any) { setInvalid(`Could not read the file: ${e?.message || "unknown error"}. Choose it again.`); return; }
    finally { setChecking(false); }
    setConfirming(true); setAcks({}); setConfirmed(false); setError(null);
    if (!prepare) { setPrep({ loading: false, data: { acknowledgements: [], notes: [] } }); return; }
    setPrep({ loading: true });
    try { setPrep({ loading: false, data: await prepare() }); }
    catch (e: any) { setPrep({ loading: false, error: e?.message || "Could not check who can read this record." }); }
  };
  const allAcked = !stale && !blockedReason && !!prep.data && prep.data.acknowledgements.every((_, n) => acks[n]) && confirmed;
  const run = async () => {
    const chosen = frozen;
    if (!chosen || !allAcked || busy) return;
    setBusy(true); setError(null);
    try {
      await commit({ file: chosen.file, fileName: chosen.fileName, fileBase64: chosen.fileBase64, version: chosen.version });
      setConfirming(false); setFrozen(null); clear();
      toast({ title: "Source uploaded", description: `${chosen.fileName} attached as a new Draft version. Narrative and classification unchanged.` });
    } catch (e: any) {
      setError(e?.status === 409 ? `${e?.message || "The record changed since you confirmed"}. Nothing was uploaded; your file is still selected. Cancel and confirm again.`
        : e?.status === 413 ? "The server rejected the file as too large. Nothing was uploaded."
        : `${e?.message || "Upload failed"}. Nothing was uploaded; your file is still selected.`);
    } finally { setBusy(false); }
  };

  return (
    <div className="min-w-0 space-y-2 rounded-md border border-dashed p-2" data-testid="source-uploader">
      <label htmlFor={inputId} className="block text-[11px] font-medium">Upload source file (.txt or .abap, UTF-8, up to {Math.round(MAX_UPLOAD_SOURCE_BYTES / 1000)} KB)</label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input ref={inputRef} id={inputId} type="file" accept=".txt,.abap,text/plain" disabled={!!blockedReason || busy}
          onChange={e => pick(e.target.files?.[0] ?? null)} aria-describedby={`${inputId}-help`}
          className="min-w-0 max-w-full flex-1 text-[11px] file:mr-2 file:rounded file:border file:bg-background file:px-2 file:py-1 file:text-[11px]" data-testid="input-source-upload" />
        {file && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={clear} disabled={busy} aria-label="Clear selected file" data-testid="button-clear-upload"><X className="h-3.5 w-3.5" /></Button>}
        <Button size="sm" variant="outline" className="h-8" disabled={!file || !!blockedReason || checking || busy} onClick={() => void openConfirm()} data-testid="button-review-upload">
          {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}Review upload
        </Button>
      </div>
      <p id={`${inputId}-help`} className="text-[10px] text-muted-foreground">One file per confirmation. Re-uploading the same file name replaces only that upload; GitHub files are kept. Max {MAX_RECORD_SOURCES} source files per record.</p>
      {file && !invalid && <p className="font-mono text-[10px]" data-testid="text-upload-selected">{file.name} · {file.size.toLocaleString()} bytes{replaces(file.name) ? " · replaces existing upload" : ""}</p>}
      {invalid && <p role="alert" className="flex items-start gap-1.5 text-[11px] text-destructive" data-testid="status-upload-invalid"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{invalid}</p>}
      <Dialog open={confirming} onOpenChange={o => { if (!o && !busy) setConfirming(false); }}>
        <DialogContent className="max-w-lg" data-testid="dialog-confirm-upload">
          <DialogHeader>
            <DialogTitle>Upload {frozen?.fileName} to {name}?</DialogTitle>
            <DialogDescription>Local file, {frozen?.file.size.toLocaleString()} bytes. Stored with a SHA-256 checksum, upload time and your user ID. No repository or commit is recorded.</DialogDescription>
          </DialogHeader>
          {(stale || blockedReason) && <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-xs text-amber-950" data-testid="status-upload-stale">{blockedReason || "This record changed (version or state) after you opened this confirmation. Cancel and review again."}</p>}
          {frozen && replaces(frozen.fileName) && <p className="rounded border bg-muted/30 p-2 text-xs" data-testid="text-upload-replaces">Replaces the existing upload named <span className="font-mono">{frozen.fileName}</span>. Other uploads and GitHub files are unchanged.</p>}
          <div className={`rounded border p-2 text-xs ${sealed ? "border-amber-400 bg-amber-50 text-amber-950" : "bg-muted/30"}`} data-testid="text-upload-state-warning">
            Uploading saves a new version in <strong>Draft</strong>.{sealed ? ` This record is currently ${state}; it returns to Draft and must be sent for approval again.` : " Submitted or Approved records return to Draft."} Previously approved exports remain unchanged. Narrative, classification and other content are not changed and no proposal is applied.
          </div>
          {prep.loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking who can read this record</p>}
          {prep.error && <p role="alert" className="text-xs text-destructive">{prep.error} <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void openConfirm()}>Retry</Button></p>}
          {prep.data?.notes.map((n, k) => <p key={k} className="text-xs text-muted-foreground">{n}</p>)}
          {prep.data?.acknowledgements.map((a, k) => (
            <label key={k} className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50/60 p-2 text-xs"><input type="checkbox" checked={!!acks[k]} onChange={e => setAcks(s => ({ ...s, [k]: e.target.checked }))} data-testid={`checkbox-upload-ack-${k}`} /><span>{a}</span></label>
          ))}
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} data-testid="checkbox-confirm-upload" /><span>I confirm <span className="font-mono">{frozen?.fileName}</span> is source for {name}.</span></label>
          {error && <p role="alert" className="text-xs text-destructive" data-testid="status-upload-error">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)} data-testid="button-cancel-upload">Cancel</Button>
            <Button disabled={!allAcked || busy} onClick={() => void run()} data-testid="button-confirm-upload">{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Confirm upload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
