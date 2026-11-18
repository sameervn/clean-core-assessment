import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { captureProjectGuard } from "@/lib/api";
import { isInterfaceItem } from "@/lib/word-reports";
import { buildPublishEntity, getShared, getWorkspaceReview, importKeyFor, loadDraft, mapSource, publishBody, uploadSource, publishShared, sameId } from "@/lib/shared-assessments";
import { SourceViewer } from "@/components/source-viewer";
import { SourceMapper, type MappingPreparation, type MappingSelection } from "@/components/source-mapper";
import { SourceUploader, type UploadSelection } from "@/components/source-uploader";

/** GitHub source for one browser-workspace object/interface, via its shared server record. */
export function WorkspaceSource({ ctx, item, kind, unsaved }: { ctx: any; item: any; kind: "object" | "interface"; unsaved: boolean }) {
  const { user } = useAuth();
  // Read-only views never query the owner's server workspace context.
  if (ctx.readOnly || !user) return null;
  return <Inner ctx={ctx} item={item} kind={kind} unsaved={unsaved} />;
}

function conflict(message: string) { const e = new Error(message) as Error & { status?: number }; e.status = 409; return e; }
interface Prepared { assessmentId: string | null; entityId: string | null; version: number | null; members: string }
const memberIds = (members: any[], self: string) => (members || []).map((m: any) => String(m.user_id ?? m.id)).filter(id => id !== self).sort().join(",");

function Inner({ ctx, item, kind, unsaved }: { ctx: any; item: any; kind: "object" | "interface"; unsaved: boolean }) {
  const ensureProject = useRef(captureProjectGuard()).current;
  const { user, can } = useAuth();
  const [, navigate] = useLocation();
  const canMap = ["Admin", "Developer"].includes(user!.role) && can("evidence") && can("classify");
  const canView = ["Admin", "Developer"].includes(user!.role) && can("classify");
  const prepared = useRef<Prepared | null>(null);
  const qc = useQueryClient();
  const record = useMemo(() => {
    const merged = { ...item, ...(ctx.assessment.integrations || []).find((i: any) => i.id === item.id) };
    return buildPublishEntity(merged, isInterfaceItem(merged) ? "interface" : "object", ctx.narratives[item.id]);
  }, [item, ctx.assessment, ctx.narratives]);
  const identity = useQuery({ queryKey: ["workspace-review-identity", ctx.assessment.provenance], queryFn: () => importKeyFor(ctx.assessment), staleTime: Infinity });
  const queryKey = ["workspace-review", user!.id, identity.data, record.key];
  const context = useQuery({
    queryKey, queryFn: ({ signal }) => getWorkspaceReview(identity.data!, record.key, signal),
    enabled: !!identity.data && canView, refetchInterval: 20_000, refetchOnWindowFocus: true,
  });
  const [name, setName] = useState(`${ctx.system} assessment`);
  const entity = context.data?.entity ?? null;
  const sharedDraft = entity ? loadDraft(user!.id, entity.id) : null;
  const localSaveFailed = ctx.saveState === "error" || ctx.saveConflict || ctx.newerWorkspace;
  const blockedReason = unsaved ? "Save or discard your narrative and classification edits before attaching source."
    : sharedDraft ? "An unfinished shared-record edit is kept in this browser. Save or discard it in Shared assessments first."
    : localSaveFailed ? "Resolve the workspace save error or newer-workspace warning before attaching source."
    : !context.data || !identity.data ? "Loading shared record status." : null;

  const prepare = async (): Promise<MappingPreparation> => {
    ensureProject();
    prepared.current = null;
    const fresh = await getWorkspaceReview(identity.data!, record.key);
    const assessment = fresh.assessment;
    if (!assessment) {
      prepared.current = { assessmentId: null, entityId: null, version: null, members: "" };
      return { acknowledgements: [], notes: ["Your saved workspace snapshot of only this record is published to a new private shared assessment owned by you. No one else is granted access."] };
    }
    const d = await getShared(assessment.id);
    const others = (d.members || []).filter((m: any) => !sameId(m.user_id ?? m.id, user!.id));
    const current = d.entities.find(e => e.entity_key === record.key && e.kind === record.kind);
    prepared.current = { assessmentId: assessment.id, entityId: current?.id ?? null, version: current?.version ?? null, members: memberIds(d.members, String(user!.id)) };
    const notes = [d.entities.some(e => e.entity_key === record.key) ? `Updates the source of this record in "${d.assessment.name}".` : `Adds only this record to the existing shared assessment "${d.assessment.name}".`];
    return {
      notes,
      acknowledgements: others.length ? [`${others.length} existing member${others.length === 1 ? "" : "s"} of "${d.assessment.name}" (${others.map((m: any) => m.username || `user ${m.user_id ?? m.id}`).join(", ")}) will be able to read this record and its mapped source code. Membership is not changed.`] : [],
    };
  };

  const refreshAll = (assessmentId?: string | null) => Promise.all([
    qc.invalidateQueries({ queryKey }),
    qc.invalidateQueries({ queryKey: ["shared-assessments"] }),
    ...(assessmentId ? [qc.invalidateQueries({ queryKey: ["shared-assessment", assessmentId] })] : []),
  ]);

  const commit = async (m: MappingSelection | UploadSelection) => {
    ensureProject();
    const p = prepared.current;
    if (!identity.data || !p) throw conflict("Confirmation expired; review and confirm again");
    try {
      // Re-verify exactly what the user confirmed before any write.
      const fresh = await getWorkspaceReview(identity.data, record.key);
      if ((fresh.assessment?.id ?? null) !== p.assessmentId) throw conflict("The shared assessment for this record changed after you confirmed. Review and confirm again");
      if (p.assessmentId) {
        const d0 = await getShared(p.assessmentId);
        const t0 = d0.entities.find(e => e.entity_key === record.key && e.kind === record.kind);
        if ((t0?.id ?? null) !== p.entityId || (t0?.version ?? null) !== p.version) throw conflict("The shared record changed (edit, approval or mapping) after you confirmed. Review and confirm again");
        if (memberIds(d0.members, String(user!.id)) !== p.members) throw conflict("The assessment's members changed after you confirmed. Review who can read this record and confirm again");
      }
      if ("fileBase64" in m && m.version !== p.version) throw conflict("The confirmed source upload version changed. Review and confirm again");
      await ctx.persistForReview();
      ensureProject();
      let assessmentId = p.assessmentId;
      if (!p.entityId) {
        const published = await publishShared(publishBody(identity.data, name.trim() || `${ctx.system} assessment`, ctx.system, [record]));
        if (p.assessmentId && published.assessment.id !== p.assessmentId) throw conflict("The record was saved to a different shared assessment than confirmed. Review and confirm again");
        assessmentId = published.assessment.id;
      }
      const detail = await getShared(assessmentId!);
      ensureProject();
      const target = detail.entities.find(e => e.entity_key === record.key && e.kind === record.kind);
      if (!target) throw new Error("The shared record was not found after saving");
      if (p.entityId && target.id !== p.entityId) throw conflict("The shared record changed after you confirmed. Review and confirm again");
      if (p.assessmentId && memberIds(detail.members, String(user!.id)) !== p.members) throw conflict("The assessment's members changed after you confirmed. Review and confirm again");
      // Existing record: the version the user confirmed. New record: the version just created.
      const expectedVersion = p.entityId ? p.version! : target.version;
      const r = "fileBase64" in m
        ? await uploadSource(target.id, { expectedVersion, fileName: m.fileName, fileBase64: m.fileBase64 })
        : await mapSource(target.id, { expectedVersion, repository: m.repository, commit: m.commit, paths: m.paths });
      ensureProject();
      prepared.current = null;
      qc.setQueryData(queryKey, (old: any) => old ? { ...old, assessment: old.assessment ?? detail.assessment, entity: r.entity } : old);
      await refreshAll(assessmentId);
    } catch (e: any) {
      if (e?.status === 409) { prepared.current = null; void refreshAll(p.assessmentId ?? context.data?.assessment?.id); }
      throw e;
    }
  };

  if (!canView) {
    return (
      <section className="space-y-2 rounded-md border bg-card p-3 text-xs" data-testid={`source-${kind}`}>
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Code2 className="h-3.5 w-3.5" />Source code</h4>
        <p className="text-muted-foreground" data-testid="text-source-role">Mapped source for workspace records is available to Admin and Developer accounts with Classify permission. If this record is shared with you, view its saved source in Shared assessments.</p>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate("/shared-assessments")} data-testid="button-open-shared-source">Open Shared assessments</Button>
      </section>
    );
  }

  return (
    <section className="space-y-2 rounded-md border bg-card p-3 text-xs" data-testid={`source-${kind}`}>
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Code2 className="h-3.5 w-3.5" />Source code</h4>
      {(identity.isLoading || context.isLoading) ? <Skeleton className="h-16 w-full" data-testid="status-workspace-source-loading" />
        : (identity.error || context.error) ? (
          <p role="alert" className="text-destructive" data-testid="status-workspace-source-error">{(identity.error || context.error)?.message}
            <Button variant="link" size="sm" className="h-auto px-1 text-xs" onClick={() => { void identity.refetch(); void context.refetch(); }} data-testid="button-retry-workspace-source">Retry</Button></p>
        ) : <>
          {entity ? <SourceViewer entity={entity} /> : <p className="text-muted-foreground" data-testid="empty-source">Not shared yet, so no source is attached. Mapping or uploading saves this record to the server first.</p>}
          {canMap && <>
            {!context.data?.assessment && !blockedReason && <label className="block">Shared assessment name<Input maxLength={160} value={name} onChange={e => setName(e.target.value)} className="mt-1 h-8 text-xs" data-testid="input-source-assessment-name" /></label>}
            <SourceMapper name={String(item.objectName || record.name)} objectType={item.objectType} state={entity?.state} recordVersion={entity?.version ?? null}
              existingSources={entity?.sources} blockedReason={blockedReason} prepare={prepare} commit={commit} />
            <SourceUploader name={String(item.objectName || record.name)} state={entity?.state} recordVersion={entity?.version ?? null}
              existingSources={entity?.sources} blockedReason={blockedReason} prepare={prepare} commit={commit} />
          </>}
        </>}
    </section>
  );
}
