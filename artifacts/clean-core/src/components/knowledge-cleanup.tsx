import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { KnowledgeCleanupReport, KnowledgeCleanupStatus } from "@workspace/api-client-react";
import { apiJson } from "@/lib/api";
import { Button } from "@/components/ui/button";

const endpoint = "/api/clean-core/knowledge/cleanup";
export function KnowledgeCleanup() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["knowledge-cleanup"], queryFn: () => apiJson<KnowledgeCleanupStatus>(endpoint), refetchInterval: 60_000 });
  const [preview, setPreview] = useState<KnowledgeCleanupReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(dryRun: boolean) {
    setBusy(true); setError("");
    try {
      const result = await apiJson<KnowledgeCleanupReport>(endpoint, { method: "POST", json: { dryRun } });
      setPreview(dryRun ? result : null);
      await Promise.all([qc.invalidateQueries({ queryKey: ["knowledge-cleanup"] }), qc.invalidateQueries({ queryKey: ["knowledge"] })]);
    } catch (e) { setError(e instanceof Error ? e.message : "Cleanup failed."); }
    finally { setBusy(false); }
  }
  const report = preview ?? status.data?.report;
  return <section className="mx-4 my-3 rounded-md border bg-white p-3 text-sm md:mx-8" aria-label="Knowledge cleanup">
    <h2 className="font-semibold">Upload cleanup · Administrator</h2>
    <p className="text-xs text-slate-600">Runs hourly in bounded batches. Pending or failed uploads expire after 24 hours of inactivity. Processing uploads and referenced sealed files are protected.</p>
    <div className="my-2 flex gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(true)}>Preview cleanup</Button>
      <Button size="sm" variant="outline" disabled={busy || !preview} onClick={() => void run(false)}>Run cleanup batch</Button>
    </div>
    <p className="text-xs">Running cleanup permanently removes eligible private files and expires abandoned uploads. Results are rechecked at execution.</p>
    {status.isLoading && <p>Loading last run…</p>}
    {(error || status.error) && <p role="alert" className="text-red-700">{error || (status.error as Error).message}</p>}
    {report ? <p role="status" className="mt-2 text-xs">
      {report.dryRun ? "Dry run" : "Last run"}: {new Date(report.startedAt).toLocaleString()} ·
      {" "}{report.expiredUploads} expired registrations · {report.scanned} files scanned · {report.candidates} eligible ·
      {" "}{report.deleted} deleted · {report.protected} retained · {report.failures} failed.
      {report.hasMore ? " More batches remain." : " Scan reached the end; the next batch starts a new pass."}
    </p> : !status.isLoading && !status.error && <p className="mt-2 text-xs">No completed cleanup run yet.</p>}
  </section>;
}
