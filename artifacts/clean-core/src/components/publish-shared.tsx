import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildPublishEntities, importKeyFor, publishBody, publishShared, MAX_PUBLISH_ENTITIES } from "@/lib/shared-assessments";

/** Explicit publish: backup download first, browser workspace never replaced, stable importKey prevents duplicates. */
export function PublishSharedButton({ ctx }: { ctx: any }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => `${ctx.system} ${new Date().toISOString().slice(0, 10)}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState("");
  const count = (ctx.assessment?.inventory?.length || 0);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      setStep("Saving local backup");
      const ok = await ctx.guarded("export", () => ctx.downloadBackupNow());
      if (!ok) throw new Error("A local backup is required before publishing.");
      setStep("Preparing records");
      const entities = buildPublishEntities(ctx.assessment, ctx.narratives || {});
      const body = publishBody(await importKeyFor(ctx.assessment), name.trim(), ctx.system, entities);
      setStep("Publishing");
      const r = await publishShared(body);
      ctx.toast({ title: r.existing ? "Shared copy updated" : "Published", description: r.existing ? "Missing records were added to the existing shared copy. Previously shared revisions were not overwritten." : `${entities.length} records shared. Your browser workspace is unchanged.` });
      setOpen(false);
      navigate(`/shared-assessments?id=${encodeURIComponent(r.assessment.id)}`);
    } catch (e: any) { setError(e?.message || "Publish failed"); }
    finally { setBusy(false); setStep(""); }
  };
  return (
    <>
      <Button variant="outline" size="sm" disabled={!ctx.perms.export} onClick={() => setOpen(true)} data-testid="button-publish-shared"><Share2 className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Publish shared</span></Button>
      <Dialog open={open} onOpenChange={o => { if (!busy) setOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish a shared copy</DialogTitle>
            <DialogDescription>A backup of this workspace downloads first. The server receives a copy of {count.toLocaleString()} objects plus interfaces; this browser workspace stays exactly as it is. Re-publishing the same assessment reuses the existing shared copy. Limit {MAX_PUBLISH_ENTITIES.toLocaleString()} records / 8 MB.</DialogDescription>
          </DialogHeader>
          <Input value={name} onChange={e => setName(e.target.value)} maxLength={200} placeholder="Shared assessment name" data-testid="input-publish-name" />
          {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" data-testid="status-publish-error">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || !name.trim()} onClick={() => void run()} data-testid="button-confirm-publish">{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{busy ? step : "Back up and publish"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
