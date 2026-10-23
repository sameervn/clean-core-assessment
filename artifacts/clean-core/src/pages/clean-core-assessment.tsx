import { YashLogo } from "@/components/yash-logo";
import { useMutation } from "@tanstack/react-query";
import {
  Database, Target, Play, FileJson, FileText,
  Network, GitCommit, Zap, X, ListTree,
  FlaskConical, Download, Settings2, ShieldAlert,
  Edit, Plus, LayoutDashboard, FileSpreadsheet, FileIcon,
  ChevronDown, Info, Link as LinkIcon, HardDrive
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { csvCell } from "@/lib/csv";
import { exportSourceVersions } from "@/lib/source-versions";
import { solutionExplanation, recommendationConfidenceExplanation } from "@/lib/solution-recommendation-explanation";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { apiFetch, readApiError } from "@/lib/api";
import { SaveIndicator, ReplaceWorkspaceDialog, type SaveState, type PendingReplace } from "@/components/workspace-controls";
import { AssessmentAiExplanation } from "@/components/assessment-ai";
import { explanationSummary, summaryFingerprint, aiNarrativeRows, aiNarrativeReportText, aiExplanationReviewQueue, retainedAiExplanations, type AiNarratives } from "@/lib/ai-narratives";
import type { Sheet as ExcelSheet } from "write-excel-file/browser";
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { LazySection } from "@/components/error-boundary";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription } from "@/components/ui/alert-dialog";
import type { PermissionId } from "@/lib/auth";
import { WorkspaceConflictError, WorkspaceClosedError, type WorkspaceStore, emptyWorkspace, buildBackup, parseBackup, validateWorkspace, MAX_BACKUP_FILE_BYTES, type StoredWorkspace } from "@/lib/workspace-store";
import { RecoveryDrafts } from "@/components/recovery-drafts";
import { WordExportButton } from "@/components/word-export";
import { allEntities } from "@/lib/word-reports";
import { itemComplexitySize, itemComplexityLabel, COMPLEXITY_SIZES } from "@/lib/complexity-size";
import { usageFor, usageCounts, USAGE_LABEL } from "@/lib/usage-status";
import { UsageTab } from "@/components/usage-tab";
import { PublishSharedButton } from "@/components/publish-shared";
import { SendForApproval } from "@/components/send-for-approval";
import { ApprovedAssessmentsFolder, CompanyTemplatesSection } from "@/components/approved-exports";
import { classificationOrigin, loadPendingClassification, writePendingClassification, type PendingClassification } from "@/lib/workspace-store";

const EVIDENCE_TYPES = [
  { id: "atc", label: "ATC Results" },
  { id: "cloud-readiness", label: "Cloud Readiness Check" },
  { id: "custom-code", label: "Custom Code Migration" },
  { id: "usage", label: "SCMON / SUSG Usage" },
  { id: "modifications", label: "Modifications (SMODILOG)" },
  { id: "enhancements", label: "Enhancements" },
  { id: "object-metadata", label: "Object Metadata" },
  { id: "interfaces", label: "Interface Inventory" },
  { id: "readiness-check", label: "S/4HANA Readiness Check" },
  { id: "cloud-alm", label: "Cloud ALM Data" },
  { id: "process-data", label: "Process Mining" }
] as const;

type EvidenceType = typeof EVIDENCE_TYPES[number]["id"];

interface EvidenceRecord {
  type: EvidenceType;
  fileName: string;
  count: number;
  rows: any[];
  attestation: string;
  metadata: {
    source: string;
    importedAt: string;
    collectionStart?: string;
    collectionEnd?: string;
    freshness: string;
    coverage: number;
    confidence: "low" | "medium" | "high";
  };
}

interface AssessmentResult {
  system: string;
  targetRelease: string;
  weighted: boolean;
  provenance: { engineVersion: string; generatedAt: string; authority: string; };
  inventory: any[];
  rollups: any;
  cleanCoreShare: number;
  technicalDebtScore: number;
  clusters: any[];
  levelD: any[];
  deadCode: any[];
  duplicates: any[];
  integrations: any[];
  recommendations: any[];
  roadmap: { waves: any[] };
  quickWins: any[];
  upgradeRisk: any[];
  totals: { objects: number; };
  evidenceQuality: { confidence: string; gaps: string[]; provenance: any; authority: string; };
}

interface BaselineSnapshot {
  targetRelease?: string;
  cleanCoreShare: number;
  technicalDebtScore: number;
  inventory: Array<{ id: string; classification: string }>;
}

const MAX_BASELINE_BYTES = 250_000;
const MAX_EVIDENCE_BYTES = 16_000_000;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
function InfoTooltip({ text }: { text: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label="Show definition"
          className="inline-flex cursor-help text-muted-foreground ml-1.5 align-middle rounded-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Info className="w-4 h-4 hover:text-foreground transition-colors" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px] text-sm font-normal">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

const DISPOSITION_DEFINITIONS: Record<string, string> = {
  keep: "Retain the object because it already follows an approved clean-core extension pattern.",
  retire: "Remove the object after confirming it is unused and has no active consumers.",
  refactor: "Change the implementation to use released contracts while preserving the business capability.",
  redesign: "Replace the current design with a different extension or integration pattern.",
  "move-to-btp": "Move the capability side-by-side to SAP BTP and access SAP through released APIs.",
};

const PROTOCOL_DEFINITIONS: Record<string, string> = {
  RFC: "Remote Function Call: a synchronous SAP integration protocol that requires a released, stable function contract.",
  IDOC: "Intermediate Document: SAP's structured asynchronous message format.",
  ODATA: "Open Data Protocol: an HTTP API style commonly used for released SAP business services.",
  SOAP: "A contract-based XML web-service protocol.",
  REST: "An HTTP resource API style; clean-core use still depends on a released, governed contract.",
  BAPI: "Business Application Programming Interface: an SAP business API that must be explicitly released for supported use.",
};

function DefinedValue({ value, definition, className = "" }: { value: string; definition?: string; className?: string }) {
  if (!definition) return <span className={className}>{value}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={`${className} cursor-help rounded-sm underline decoration-dotted underline-offset-2 focus:outline-none focus:ring-2 focus:ring-ring`}
        >
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px] text-sm font-normal">{definition}</TooltipContent>
    </Tooltip>
  );
}

const LEGACY_ESTIMATE_KEYS = new Set([
  "cost", "costs", "costbreakdown", "deliverycost", "estimatedcost", "estimatecost",
  "effort", "effortdays", "estimatedeffort", "estimatedeffortdays", "estimateddays", "dayrate",
  "annualbtpruntime", "btpruntimecost",
]);

function sanitizeAssessment(assessment: unknown): AssessmentResult | null {
  if (!assessment) return null;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !LEGACY_ESTIMATE_KEYS.has(key.toLowerCase().replace(/[-_\s]/g, "")))
        .map(([key, child]) => [key, visit(child)]),
    );
  };
  return visit(assessment) as AssessmentResult;
}

function recommendationList(value: unknown): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry: any) => {
    if (typeof entry === "string") return entry;
    return entry?.label || entry?.reason || entry?.description || entry?.summary || entry?.id || "";
  }).filter(Boolean);
}

function recommendationRationale(recommendation: any): string {
  return recommendationList(recommendation?.rationale).join("; ");
}

function getSolutionRecommendation(item: any): any {
  if (item?.solutionRecommendation) return item.solutionRecommendation;
  if (!item?.recommendation) return null;
  const recommendation = item.recommendation;
  return {
    ...recommendation,
    primary: recommendation.primary || {
      id: recommendation.id,
      label: recommendation.label,
      description: recommendation.description,
    },
  };
}

function recommendationLabel(item: any): string {
  const recommendation = getSolutionRecommendation(item);
  return recommendation?.primary?.label || recommendation?.primary?.id || "";
}

function solutionPatternLabels(patterns: unknown): string[] {
  if (!Array.isArray(patterns)) return recommendationList(patterns);
  return patterns.map((pattern: any) => {
    const label = typeof pattern === "string" ? pattern : pattern?.label || pattern?.summary || pattern?.id || "";
    return label && Number.isFinite(pattern?.count) ? `${label} (${pattern.count})` : label;
  }).filter(Boolean);
}

function solutionSummaryRows(assessment: any) {
  const labels = [...new Set((assessment?.inventory || []).map(recommendationLabel).filter(Boolean))] as string[];
  return labels.map((label) => {
    const items = assessment.inventory.filter((item: any) => recommendationLabel(item) === label);
    const recommendations: any[] = items.map(getSolutionRecommendation).filter(Boolean);
    const confidence = Object.fromEntries(["high", "medium", "low"].map(level => [
      level,
      recommendations.filter((recommendation: any) => recommendation.confidence === level).length,
    ]));
    return {
      label,
      count: items.length,
      confidence,
      confidenceText: `high ${confidence.high}, medium ${confidence.medium}, low ${confidence.low}`,
      rationales: [...new Set<string>(recommendations.map(recommendationRationale).filter(Boolean))],
      prerequisites: recommendationList(recommendations[0]?.prerequisites),
      cautions: recommendationList(recommendations[0]?.cautions),
    };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function RecommendationPanel({ item }: { item: any }) {
  const recommendation = getSolutionRecommendation(item);
  if (!recommendation?.primary) return null;
  const sections: Array<[string, unknown]> = [
    ["Evidence-based reasons", recommendation.reasons],
    ["Prerequisites", recommendation.prerequisites],
    ["Suitability signals", recommendation.suitabilitySignals],
    ["Cautions", recommendation.cautions],
    ["Validation questions", recommendation.validationQuestions],
  ];
  const alternatives = recommendationList(recommendation.alternatives);

  return (
    <div>
      <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Solution Recommendation</h4>
      <div className="rounded-md border border-teal-200 bg-teal-50/50 p-3 text-sm dark:border-teal-800 dark:bg-teal-900/10">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-teal-950 dark:text-teal-100">{recommendation.primary.label || recommendation.primary.id}</p>
            {recommendation.primary.description && <p className="mt-1 text-teal-900/80 dark:text-teal-200/80">{recommendation.primary.description}</p>}
          </div>
        </div>
        <div className="mt-3 space-y-3 border-t border-teal-200/70 pt-3 dark:border-teal-800/70">
          <div>
            <p className="text-sm font-semibold text-teal-950 dark:text-teal-100">Why this solution is suggested</p>
            <p className="mt-1 text-sm text-teal-900 dark:text-teal-200">{solutionExplanation(recommendation)}</p>
          </div>
          <div className="rounded-md border border-teal-200/70 bg-background/70 p-3 dark:border-teal-800/70">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">Recommendation confidence</p>
              <Badge variant="outline" className={`capitalize ${
                recommendation.confidence === "high" ? "border-green-500 text-green-800 dark:text-green-300"
                  : recommendation.confidence === "medium" ? "border-amber-500 text-amber-800 dark:text-amber-300"
                  : recommendation.confidence === "low" ? "border-orange-500 text-orange-800 dark:text-orange-300" : ""
              }`}>{["high", "medium", "low"].includes(recommendation.confidence) ? recommendation.confidence : "Not assessed"}</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{recommendationConfidenceExplanation(recommendation.confidence)}</p>
            <p className="mt-2 text-xs text-muted-foreground">This reflects evidence support for the recommendation, not the object’s Clean Core level or a probability of success.</p>
          </div>
          {sections.map(([title, value]) => {
            const entries = recommendationList(value);
            if (!entries.length) return null;
            return (
              <div key={title}>
                <p className="text-xs font-semibold text-teal-950 dark:text-teal-100">{title}</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-teal-900/80 dark:text-teal-200/80">
                  {entries.map((entry, index) => <li key={index}>{entry}</li>)}
                </ul>
              </div>
            );
          })}
          {alternatives.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-teal-950 dark:text-teal-100">Alternatives</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {alternatives.map((alternative, index) => <Badge key={index} variant="secondary" className="font-normal">{alternative}</Badge>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AiDetail({ kind, item, ctx }: any) {
  const subject = `${kind}:${item.id}`;
  const summary = explanationSummary(kind, item, ctx.assessment.targetRelease);
  return <AssessmentAiExplanation
    key={`${subject}:${ctx.assessment.provenance.generatedAt}:${summaryFingerprint(summary)}`}
    summary={summary} accepted={ctx.aiNarratives[subject]}
    canGenerate={ctx.perms["ai.generate"]} canAccept={ctx.perms["ai.accept"]} canRemove={ctx.perms["ai.remove"]}
    onAccept={note => ctx.guarded("ai.accept", () => ctx.setAiNarratives((prev: AiNarratives) => ({ ...prev, [subject]: note })))}
    onRemove={() => ctx.guarded("ai.remove", () => ctx.setAiNarratives((prev: AiNarratives) => {
      const next = { ...prev }; delete next[subject]; return next;
    }))}
  />;
}

export type WorkspaceMode =
  | { kind: "saved"; store: WorkspaceStore }
  | { kind: "readonly"; workspace: StoredWorkspace; label: string; onExit: () => void };
export interface AssessmentAccess {
  can: (permission: PermissionId) => boolean;
  /** Server re-check; rejects when not permitted. */
  authorize: (permission: PermissionId) => Promise<void>;
}
const ACTION_PERMISSIONS: PermissionId[] = ["evidence", "run", "notes", "classify", "baseline", "ai.generate", "ai.accept", "ai.remove", "export", "restore", "reset"];

export default function CleanCoreAssessmentPage({ mode, access, headerExtras }: { mode: WorkspaceMode; access: AssessmentAccess; headerExtras?: React.ReactNode }) {
  const { toast } = useToast();
  // Captured once per mount: the parent remounts on any identity/permission change.
  const store = mode.kind === "saved" ? mode.store : null;
  const readOnly = mode.kind === "readonly";
  const perms = useMemo(() => Object.fromEntries(ACTION_PERMISSIONS.map(p => [p, access.can(p) && (!readOnly || p === "export")])) as Record<PermissionId, boolean>, [access, readOnly]);
  const accessRef = useRef(access);
  accessRef.current = access;
  /** Local-only actions: UI permission, then server re-authorization, then mutate. */
  const guarded = useCallback(async (permission: PermissionId, action: () => void | Promise<void>): Promise<boolean> => {
    if (!perms[permission]) {
      toast({ title: "Not permitted", description: readOnly ? "This is a read-only view." : "Your account does not have this permission.", variant: "destructive" });
      return false;
    }
    try { await accessRef.current.authorize(permission); }
    catch (e: any) { toast({ title: "Not permitted", description: e?.message || "The server denied this action.", variant: "destructive" }); return false; }
    await action();
    return true;
  }, [perms, readOnly, toast]);

  const [activeTab, setActiveTab] = useState("dashboard");

  // Configuration State
  const [system, setSystem] = useState("PRD");
  const [targetRelease, setTargetRelease] = useState("S4HANA_2025");
  const [weighted, setWeighted] = useState(true);
  const [classificationOverrides, setClassificationOverrides] = useState<any>(null);
  const [overrideDraft, setOverrideDraft] = useState<any[] | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const overrideBusy = useRef(false);
  const pendingClassification = useRef<PendingClassification | null>(null);
  const committedClassification = useRef<PendingClassification | null>(null);
  const [resumeClassification, setResumeClassification] = useState(false);
  const [classificationMismatch, setClassificationMismatch] = useState(false);
  const [classificationStorageError, setClassificationStorageError] = useState<string | null>(null);
  const [narratives, setNarratives] = useState<Record<string, string>>({});
  const [aiNarratives, setAiNarratives] = useState<AiNarratives>({});

  // Evidence State
  const [evidenceType, setEvidenceType] = useState<EvidenceType>("atc");
  const [evidence, setEvidence] = useState<EvidenceRecord[]>([]);

  // Assessment State
  const [assessment, setAssessment] = useState<AssessmentResult | null>(null);
  const [baseline, setBaseline] = useState<BaselineSnapshot | null>(null);

  // Browser-local persistence (IndexedDB)
  const [hydrated, setHydrated] = useState(false);
  const [unreadable, setUnreadable] = useState<{ raw: unknown } | null>(null);
  const [replacingUnreadable, setReplacingUnreadable] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(null);
  const dirtyRef = useRef(false);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const saveSeq = useRef(0);
  const skipNextSave = useRef(true);
  const revisionRef = useRef<string | null>(null);
  const conflictRef = useRef(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const [newerWorkspace, setNewerWorkspace] = useState(false);

  useEffect(() => {
    if (!hydrated || unreadable || !store) return;
    let disposed = false;
    const check = async () => {
      try {
        // Let this tab's own commit update its revision before comparing.
        await saveChain.current;
        const localRevision = revisionRef.current;
        const savedRevision = await store.readRevision();
        if (!disposed && localRevision === revisionRef.current) {
          setNewerWorkspace(savedRevision !== localRevision);
        }
      } catch { /* Advisory checks never change save state or revision authority. */ }
    };
    const unsubscribe = store.subscribe(() => { void check(); });
    void check(); // Covers a save between hydration and listener registration.
    return () => { disposed = true; unsubscribe(); };
  }, [hydrated, unreadable, store]);

  const applyWorkspace = useCallback((ws: StoredWorkspace) => {
    setSystem(ws.system);
    setTargetRelease(ws.targetRelease);
    setWeighted(ws.weighted);
    setEvidence(ws.evidence as EvidenceRecord[]);
    setAssessment(ws.assessment ? sanitizeAssessment(ws.assessment) : null);
    setClassificationOverrides(ws.classificationOverrides);
    setNarratives(ws.narratives);
    setAiNarratives(ws.aiNarratives ?? {});
    setBaseline(ws.baseline);
  }, []);

  const hydrate = useCallback(() => {
    setLoadError(null);
    if (!store) {
      if (mode.kind === "readonly") { skipNextSave.current = true; applyWorkspace(mode.workspace); setHydrated(true); }
      return;
    }
    store.load()
      .then(async ({ workspace, unreadable, revision }) => {
        revisionRef.current = revision;
        skipNextSave.current = true;
        setUnreadable(unreadable ?? null);
        if (workspace) applyWorkspace(workspace);
        try {
          const draft = await loadPendingClassification(store);
          if (draft) {
            pendingClassification.current = draft;
            setOverrideDraft(draft.rules);
            setResumeClassification(true);
            setClassificationMismatch(!workspace || draft.origin !== await classificationOrigin(workspace));
            setOverrideError("Recovered pending classification changes. Nothing has been applied.");
          }
        } catch (error) {
          if (error instanceof WorkspaceClosedError) return;
          setClassificationStorageError((error as Error).message);
        }
        setSaveState(workspace ? "saved" : "idle");
        setHydrated(true);
      })
      .catch((e: Error) => { if (!(e instanceof WorkspaceClosedError)) setLoadError(e.message || "Could not read browser storage."); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyWorkspace, store]);

  useEffect(() => { hydrate(); }, [hydrate]);

  const snapshot = useMemo<StoredWorkspace>(() => ({
    system, targetRelease, weighted, evidence, assessment,
    classificationOverrides: Array.isArray(classificationOverrides) ? classificationOverrides : (classificationOverrides?.rules ?? null),
    narratives, aiNarratives, baseline,
  }), [system, targetRelease, weighted, evidence, assessment, classificationOverrides, narratives, aiNarratives, baseline]);

  const persistNow = useCallback((ws: StoredWorkspace) => {
    if (!store || unreadable || conflictRef.current) return;
    const seq = ++saveSeq.current;
    setSaveState("saving");
    saveChain.current = saveChain.current
      .catch(() => undefined)
      .then(async () => {
        if (conflictRef.current) throw new WorkspaceConflictError();
        revisionRef.current = await store.save(ws, revisionRef.current);
        const committed = committedClassification.current;
        if (committed && JSON.stringify(ws.classificationOverrides) === JSON.stringify(committed.rules)) {
          try {
            await writePendingClassification(store, committed, true);
            if (pendingClassification.current?.id === committed.id) pendingClassification.current = null;
            committedClassification.current = null;
          } catch (error) {
            if (error instanceof WorkspaceClosedError) throw error;
            setClassificationStorageError((error as Error).message);
          }
        }
      })
      .then(() => {
        if (seq !== saveSeq.current) return;
        dirtyRef.current = false;
        setSaveError(null);
        setSaveState("saved");
        setLastSavedAt(new Date());
      })
      .catch((e: Error) => {
        if (e instanceof WorkspaceClosedError) return; // account changed: stale write dropped
        if (e instanceof WorkspaceConflictError) {
          conflictRef.current = true;
          dirtyRef.current = true;
          setSaveConflict(true);
          setSaveError(e.message);
          setSaveState("error");
          return;
        }
        if (seq !== saveSeq.current) return;
        setSaveError(e?.message || "Write failed");
        setSaveState("error");
      });
  }, [unreadable, store]);

  // Serialize this tab's saves; storage checks revisions atomically across tabs.
  useEffect(() => {
    if (!hydrated || unreadable || !store) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    dirtyRef.current = true;
    if (conflictRef.current) return;
    saveSeq.current++; // invalidate any in-flight save so it cannot mark these newer changes as saved
    setSaveState("pending");
    const t = window.setTimeout(() => persistNow(snapshot), 400);
    return () => window.clearTimeout(t);
  }, [snapshot, hydrated, unreadable, persistNow]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const hasWork = evidence.length > 0 || !!assessment || Object.keys(narratives).length > 0 || !!baseline || (Array.isArray(classificationOverrides) && classificationOverrides.length > 0);

  const replaceWorkspace = useCallback((ws: StoredWorkspace) => {
    applyWorkspace(ws);
  }, [applyWorkspace]);

  const exportBackup = () => void guarded("export", () => {
    downloadBlob(JSON.stringify(buildBackup(snapshot), null, 2), `clean-core-workspace-${snapshot.system}-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
  });

  const handleRestoreFile = async (file: File) => {
    if (!perms.restore) { toast({ title: "Not permitted", description: "Restoring a backup replaces saved work and needs the restore permission. Use “Open backup read-only” to inspect it.", variant: "destructive" }); return; }
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      toast({ title: "Backup too large", description: "Workspace backups must be 64 MB or smaller.", variant: "destructive" });
      return;
    }
    const text = await file.text().catch(() => null);
    if (text === null) { toast({ title: "Restore failed", description: "Could not read the file.", variant: "destructive" }); return; }
    const result = parseBackup(text);
    if (!result.ok) { toast({ title: "Restore rejected", description: result.error, variant: "destructive" }); return; }
    const parsed = result.workspace;
    if (parsed.assessment && parsed.evidence.length === 0) {
      toast({ title: "Restore rejected", description: "Backup contains an assessment but no evidence to verify it against.", variant: "destructive" });
      return;
    }
    const doRestore = async () => {
      try { await accessRef.current.authorize("restore"); }
      catch (e: any) { toast({ title: "Not permitted", description: e?.message, variant: "destructive" }); return; }
      let ws = parsed;
      if (parsed.assessment) {
        // Never trust a stored assessment: recompute from server-attested evidence before replacing anything.
        try {
          const res = await apiFetch("/api/clean-core/assessment", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system: parsed.system, targetRelease: parsed.targetRelease, weighted: parsed.weighted, evidence: parsed.evidence,
              ...(parsed.classificationOverrides ? { classificationOverrides: parsed.classificationOverrides } : {}),
            }),
          });
          if (!res.ok) throw new Error(await readApiError(res, "Evidence verification failed"));
          const recomputed = sanitizeAssessment(await res.json());
          const check = validateWorkspace({ ...parsed, assessment: recomputed });
          if (!check.ok) throw new Error(`Recomputed assessment invalid: ${check.error}`);
          ws = check.workspace;
        } catch (e: any) {
          toast({ title: "Restore aborted", description: `${e?.message || "Verification failed"}. Your current workspace was not changed. If the evidence attestations no longer verify, re-upload the original evidence files instead.`, variant: "destructive" });
          return;
        }
      }
      replaceWorkspace(ws);
      toast({ title: "Workspace restored", description: ws.assessment ? "Assessment was recomputed from the backup's attested evidence." : "No assessment in backup; run the engine when ready." });
    };
    if (hasWork) setPendingReplace({ kind: "restore", onConfirm: () => { void doRestore(); } });
    else void doRestore();
  };

  const requestReset = () => setPendingReplace({
    kind: "reset",
    onConfirm: () => void guarded("reset", () => {
      const ws = emptyWorkspace();
      replaceWorkspace(ws);
      toast({ title: "Workspace cleared", description: "Evidence, assessment, overrides, narratives and baseline were removed from this browser." });
    }),
  });

  const uploadEvidence = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error("Files must be 16 MB or smaller.");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", evidenceType);
      const res = await apiFetch("/api/clean-core/evidence", { method: "POST", body: formData });
      if (!res.ok) throw new Error(await readApiError(res, "Upload failed"));
      return (await res.json()) as EvidenceRecord;
    },
    onSuccess: (data) => {
      const nextEvidence = [...evidence.filter(e => e.type !== data.type), data];
      const bytes = new Blob([JSON.stringify(nextEvidence)]).size;
      if (bytes > MAX_EVIDENCE_BYTES) {
        toast({ title: "Evidence Limit Reached", description: "Combined normalized evidence would exceed 16 MB. Import rejected.", variant: "destructive" });
        return;
      }
      setEvidence(nextEvidence);
      setAssessment(null);
      toast({ title: "Evidence Imported", description: `Imported ${data.count} items from ${data.fileName}` });
    },
    onError: (err) => toast({ title: "Import Failed", description: err.message, variant: "destructive" })
  });

  const runAssessment = useMutation({
    mutationFn: async (overridesToUse?: any) => {
      if (!evidence.length) throw new Error("No evidence imported.");
      const overrides = overridesToUse ?? classificationOverrides;
      const payload = {
        system, targetRelease, weighted, evidence,
        ...(overrides ? { classificationOverrides: overrides } : {}),
      };
      const res = await apiFetch("/api/clean-core/assessment", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await readApiError(res, "Assessment failed"));
      return (await res.json()) as AssessmentResult;
    },
    onSuccess: (data, overridesToUse) => {
      setAssessment(sanitizeAssessment(data));
      if (overridesToUse !== undefined) {
        committedClassification.current = pendingClassification.current;
        setClassificationOverrides(overridesToUse);
        setOverrideDraft(null);
        setOverrideError(null);
      }
      toast({ title: "Assessment Complete", description: "Analysis generated successfully." });
    },
    onError: (err, overridesToUse) => {
      if (overridesToUse !== undefined) setOverrideError(err.message);
      else toast({ title: "Assessment Failed", description: `${err.message}. If evidence came from a restored backup, re-upload the original files.`, variant: "destructive" });
    },
    onSettled: () => { overrideBusy.current = false; },
  });

  const submitOverrides = async (rules: any[]) => {
    if (!perms.classify || !perms.run) { toast({ title: "Not permitted", description: "Classification overrides need the classify and run permissions.", variant: "destructive" }); return; }
    if (!store || overrideBusy.current || runAssessment.isPending) return;
    overrideBusy.current = true;
    setOverrideDraft(rules);
    setOverrideError(null);
    try {
      await accessRef.current.authorize("classify");
      await accessRef.current.authorize("run");
      const origin = await classificationOrigin(snapshot);
      const existing = pendingClassification.current;
      if (existing && existing.origin !== origin) {
        setClassificationMismatch(true);
        throw new Error("These changes belong to a different assessment and cannot be resumed.");
      }
      await saveChain.current;
      const saved = await store.load();
      if (existing && (!saved.workspace || await classificationOrigin(saved.workspace) !== existing.origin)) {
        setClassificationMismatch(true);
        throw new Error("Saved evidence or assessment has changed. Download or discard these pending rules.");
      }
      const draft: PendingClassification = existing ?? { version: 1, id: crypto.randomUUID(), origin, rules };
      pendingClassification.current = draft;
      await writePendingClassification(store, draft);
      setClassificationStorageError(null);
      setResumeClassification(false);
      if (store.disposed) throw new WorkspaceClosedError();
    } catch (error) {
      overrideBusy.current = false;
      if (!(error instanceof WorkspaceClosedError)) setOverrideError((error as Error).message + " Your rules remain available for download.");
      return;
    }
    runAssessment.mutate(rules);
  };

  const discardOverrides = async () => {
    if (!store) return;
    try {
      if (pendingClassification.current) await writePendingClassification(store, pendingClassification.current, true);
      pendingClassification.current = null;
      setOverrideDraft(null);
      setOverrideError(null);
      setResumeClassification(false);
      setClassificationMismatch(false);
      setClassificationStorageError(null);
    } catch (error) {
      if (!(error instanceof WorkspaceClosedError)) setOverrideError((error as Error).message);
    }
  };

  const handleSaveOverride = async (objectId: string, level: string, reason: string) => {
    const arr = Array.isArray(classificationOverrides) ? classificationOverrides : (classificationOverrides?.rules || []);
    const newOverrides = [...arr.filter((o: any) => o.objectPattern !== objectId), { objectPattern: objectId, level, reason }];
    submitOverrides(newOverrides);
  };

  const handleSaveBulkOverride = (objectNames: string[], level: string, reason: string) => {
    const selected = new Set(objectNames);
    const current = Array.isArray(classificationOverrides) ? classificationOverrides : (classificationOverrides?.rules || []);
    const newOverrides = [
      ...current.filter((override: any) => !selected.has(override.objectPattern)),
      ...objectNames.map((objectPattern) => ({ objectPattern, level, reason })),
    ];
    submitOverrides(newOverrides);
  };

  const loadDemoData = useMutation({
    mutationFn: async () => {
      const response = await apiFetch("/api/clean-core/demo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system, targetRelease, weighted }),
      });
      if (!response.ok) throw new Error(await readApiError(response, "Could not load demo data"));
      return response.json() as Promise<{ evidence: EvidenceRecord[]; assessment: AssessmentResult }>;
    },
    onSuccess: ({ evidence: demoEvidence, assessment: demoAssessment }) => {
      setEvidence(demoEvidence);
      setAssessment(sanitizeAssessment(demoAssessment));
      setBaseline(null);
      setClassificationOverrides(null);
      setNarratives({});
      setAiNarratives({});
      toast({ title: "Demo landscape loaded", description: `${demoAssessment.totals.objects} SAP objects ready.` });
    },
    onError: (error: Error) => toast({ title: "Demo load failed", description: error.message, variant: "destructive" }),
  });

  const requestDemo = () => {
    if (hasWork) setPendingReplace({ kind: "demo", onConfirm: () => loadDemoData.mutate() });
    else loadDemoData.mutate();
  };

  const saveBaseline = () => void guarded("baseline", () => {
    if (!assessment) return;
    try {
      const snapshot: BaselineSnapshot = {
        targetRelease: assessment.targetRelease,
        cleanCoreShare: assessment.cleanCoreShare,
        technicalDebtScore: assessment.technicalDebtScore,
        inventory: assessment.inventory.map(item => ({ id: item.id, classification: item.classification })),
      };
      setBaseline(snapshot);
      toast({ title: "Baseline Saved", description: "Current assessment is now the comparative baseline." });
    } catch (error: any) {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    }
  });

  const downloadBlob = (content: BlobPart, filename: string, mimeType: string) => {
    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Download Failed", description: e.message, variant: "destructive" });
    }
  };

  const handleExport = async (type: string) => {
    try {
      await guarded("export", () => handleExportUnsafe(type));
    } catch (e: any) {
      toast({ title: `${type} export failed`, description: `${e?.message || "Unexpected error"}. Try another format or re-run the assessment.`, variant: "destructive" });
    }
  };

  const handleExportUnsafe = async (type: string) => {
    if (type === "Evidence Pack") {
      downloadBlob(JSON.stringify({ system, targetRelease, evidence }, null, 2), `evidence-${system}.json`, "application/json");
      return;
    }
    if (!assessment) return;
    
    const sourceVersions = await exportSourceVersions(aiNarratives);
    const acceptedAi = aiNarrativeRows(aiNarratives, assessment.inventory, assessment.targetRelease, sourceVersions);
    const aiAppendix = acceptedAi.map(aiNarrativeReportText);
    const uc = usageCounts(assessment.inventory, evidence);
    const usageSummary = `in use ${uc["in-use"]}, not in use ${uc["not-in-use"]}, unknown ${uc.unknown}`;
    const sizeTally = new Map<string, number>();
    for (const item of assessment.inventory) { const z = itemComplexityLabel(item); sizeTally.set(z, (sizeTally.get(z) || 0) + 1); }
    const sizeSummary = [...COMPLEXITY_SIZES, "Unassessed"].filter(z => sizeTally.get(z)).map(z => `${z} ${sizeTally.get(z)}`).join(", ") || "none";
    if (type === 'Exec Summary') {
      const waveSummary = (assessment.roadmap?.waves || []).map((wave: any) =>
        `## Wave ${wave.wave}: ${wave.name}\nObjects: ${wave.count}\nTarget solution patterns: ${solutionPatternLabels(wave.solutionPatterns).join(", ") || "Not specified"}\nObjective: ${wave.objective}\nExpected outcome: ${wave.expectedOutcome}\nExit criteria:\n${(wave.exitCriteria || []).map((criterion: string) => `- ${criterion}`).join("\n")}`,
      ).join("\n\n");
      const recommendationSummary = solutionSummaryRows(assessment).map(group => {
        return `## ${group.label} (${group.count})\nConfidence mix: ${group.confidenceText}\nRule rationale: ${group.rationales.join(" ") || "Review object-level evidence."}\nPrerequisites: ${group.prerequisites.join("; ") || "None recorded"}\nCautions: ${group.cautions.join("; ") || "None recorded"}\nValidation: Review the object-level evidence and validation questions before adoption.`;
      }).join("\n\n");
      const content = `# Clean Core Executive Summary\nSystem: ${assessment.system}\nTarget: ${assessment.targetRelease.replace("S4HANA_", "S/4HANA ")}\nGenerated: ${new Date().toISOString()}\nClean Core Share: ${assessment.cleanCoreShare}%\nTechnical Debt Score: ${assessment.technicalDebtScore}\nTotal Objects: ${assessment.totals.objects}\nUsage: ${usageSummary}\nComplexity sizes: ${sizeSummary}\n\n# Recommended Solution Patterns\n${recommendationSummary || "No solution recommendations available."}\n\n# Mitigation Roadmap\n${waveSummary}`;
      downloadBlob(content + (aiAppendix.length ? `\n\n# Accepted AI explanations\n\n${aiAppendix.join("\n\n").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}` : ""), `exec-summary-${assessment.system}.md`, 'text/markdown');
    } else if (type === 'CSV Details') {
      const fields: Array<[string, (item: any) => unknown]> = [
        ["targetRelease", () => assessment.targetRelease],
        ["acceptedAiExplanations", item => acceptedAi.filter(note => note.subject === `object:${item.id}` || note.subject === `interface:${item.id}`).map(aiNarrativeReportText).join("\n\n")],
        ["id", item => item.id], ["objectName", item => item.objectName], ["objectType", item => item.objectType],
        ["module", item => item.module], ["package", item => item.package],
        ["classification", item => item.classification], ["disposition", item => item.disposition],
        ["classificationReason", item => item.classificationReason?.summary || item.classificationExplanation],
        ["matchedRule", item => item.classificationReason?.matchedRule || ''],
        ["confidence", item => item.confidence],
        ["recommendedSolutionId", item => getSolutionRecommendation(item)?.primary?.id || ''],
        ["recommendedSolution", item => recommendationLabel(item)],
        ["recommendedSolutionDescription", item => getSolutionRecommendation(item)?.primary?.description || ''],
        ["recommendationRationale", item => recommendationRationale(getSolutionRecommendation(item))],
        ["recommendationReasons", item => recommendationList(getSolutionRecommendation(item)?.reasons).join("; ")],
        ["recommendationConfidence", item => getSolutionRecommendation(item)?.confidence || ''],
        ["recommendationPrerequisites", item => recommendationList(getSolutionRecommendation(item)?.prerequisites).join("; ")],
        ["recommendationSuitabilitySignals", item => recommendationList(getSolutionRecommendation(item)?.suitabilitySignals).join("; ")],
        ["recommendationCautions", item => recommendationList(getSolutionRecommendation(item)?.cautions).join("; ")],
        ["recommendationValidationQuestions", item => recommendationList(getSolutionRecommendation(item)?.validationQuestions).join("; ")],
        ["recommendationAlternatives", item => recommendationList(getSolutionRecommendation(item)?.alternatives).join("; ")],
        ["recommendationRule", item => getSolutionRecommendation(item)?.trace?.rule || ''],
        ["recommendedAction", item => item.mitigation?.recommendedAction || ''],
        ["validation", item => item.mitigation?.validation || ''],
        ["dependencies", item => (item.dependencies || []).join("; ")],
        ["interfaceName", item => item.interfaceName || ''], ["interfaceType", item => item.interfaceType || ''],
        ["releaseStatus", item => item.releaseStatus || ''],
        ["complexitySize", item => itemComplexityLabel(item)],
        ["usageStatus", item => USAGE_LABEL[usageFor(item, evidence).status]],
        ["usageCount", item => usageFor(item, evidence).count ?? ""],
      ];
      const headers = fields.map(([label]) => csvCell(label)).join(",");
      const rows = assessment.inventory.map((item: any) => fields.map(([, read]) => csvCell(read(item))).join(","));
      // Keep accepted notes for removed subjects in the report, without inventing inventory data.
      const exportedSubjects = new Set<string>(assessment.inventory.flatMap((item: any) => [`object:${item.id}`, `interface:${item.id}`]));
      for (const note of acceptedAi) {
        if (!exportedSubjects.has(note.subject)) {
          rows.push(fields.map(([label]) => csvCell(label === "acceptedAiExplanations" ? aiNarrativeReportText(note) : label === "id" ? note.subject : "")).join(","));
        }
      }
      downloadBlob(`${headers}\n${rows.join("\n")}`, `clean-core-objects-${assessment.system}.csv`, "text/csv;charset=utf-8");
    } else if (type === 'Full JSON') {
      downloadBlob(JSON.stringify({ ...assessment, acceptedAiExplanations: acceptedAi }, null, 2), `assessment-${assessment.system}.json`, 'application/json');
    } else if (type === "Excel") {
      const { default: writeExcelFile } = await import("write-excel-file/browser");
      const sheets: ExcelSheet<Blob | File | ArrayBuffer>[] = [];
      const appendSheet = (records: Record<string, unknown>[], name: string) => {
        const headers = [...new Set(records.flatMap(record => Object.keys(record)))];
        sheets.push({
          sheet: name,
          data: [
            headers.map(value => ({ value, type: String })),
            ...records.map(record => headers.map(key => {
              const value = record[key];
              if (value == null) return null;
              if (typeof value === "number") return { value, type: Number };
              if (typeof value === "boolean") return { value, type: Boolean };
              // Explicit strings keep formula-like user text inert in Excel.
              return { value: typeof value === "object" ? JSON.stringify(value) : String(value), type: String };
            })),
          ],
        });
      };
      if (acceptedAi.length) appendSheet(acceptedAi, "Accepted AI Explanations");
      appendSheet([{
        system: assessment.system,
        targetRelease: assessment.targetRelease,
        generatedAt: assessment.provenance.generatedAt,
        cleanCoreShare: assessment.cleanCoreShare,
        technicalDebtScore: assessment.technicalDebtScore,
        totalObjects: assessment.totals.objects,
      }], "Overview");
      appendSheet(assessment.inventory.map((item: any) => ({
        objectName: item.objectName,
        objectType: item.objectType,
        module: item.module,
        package: item.package,
        classification: item.classification,
        confidence: item.confidence,
        disposition: item.disposition,
        usageStatus: USAGE_LABEL[usageFor(item, evidence).status],
        usageCount: usageFor(item, evidence).count ?? "",
        complexitySize: itemComplexityLabel(item),
         classificationReason: item.classificationReason?.summary || item.classificationExplanation,
         matchedRule: item.classificationReason?.matchedRule || '',
         recommendedSolutionId: getSolutionRecommendation(item)?.primary?.id || '',
         recommendedSolution: recommendationLabel(item),
         recommendedSolutionDescription: getSolutionRecommendation(item)?.primary?.description || '',
         recommendationRationale: recommendationRationale(getSolutionRecommendation(item)),
         recommendationReasons: recommendationList(getSolutionRecommendation(item)?.reasons).join("; "),
         recommendationConfidence: getSolutionRecommendation(item)?.confidence || '',
         recommendationPrerequisites: recommendationList(getSolutionRecommendation(item)?.prerequisites).join("; "),
         recommendationSuitabilitySignals: recommendationList(getSolutionRecommendation(item)?.suitabilitySignals).join("; "),
         recommendationCautions: recommendationList(getSolutionRecommendation(item)?.cautions).join("; "),
         recommendationValidationQuestions: recommendationList(getSolutionRecommendation(item)?.validationQuestions).join("; "),
         recommendationAlternatives: recommendationList(getSolutionRecommendation(item)?.alternatives).join("; "),
         recommendationRule: getSolutionRecommendation(item)?.trace?.rule || '',
         recommendedAction: item.mitigation?.recommendedAction || '',
         validation: item.mitigation?.validation || '',
        interfaceName: item.interfaceName || '',
        interfaceType: item.interfaceType || '',
         releaseStatus: item.releaseStatus || '',
        dependencies: (item.dependencies || []).join("; "),
      })), "Object Inventory");
      appendSheet((assessment.roadmap?.waves || []).map((wave: any) => ({
        wave: wave.wave,
        name: wave.name,
        objects: wave.count,
        objective: wave.objective,
        rationale: wave.rationale,
        prerequisites: (wave.prerequisites || []).join("; "),
        mitigationSteps: (wave.mitigationSteps || []).join("; "),
        expectedOutcome: wave.expectedOutcome,
         targetSolutionPatterns: solutionPatternLabels(wave.solutionPatterns).join("; "),
        exitCriteria: (wave.exitCriteria || []).join("; "),
      })), "Mitigation Roadmap");
      const output = await writeExcelFile(sheets).toBlob();
      downloadBlob(output, `clean-core-assessment-${assessment.system}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } else if (type === "PowerPoint") {
      const { default: PptxGenJS } = await import("pptxgenjs");
      const presentation = new PptxGenJS();
      presentation.layout = "LAYOUT_WIDE";
      presentation.author = "Clean Core Assessment";
      presentation.subject = "SAP Clean Core Assessment";
      presentation.title = `${assessment.system} Clean Core Assessment`;
      presentation.company = "Clean Core Assessment";

      const titleSlide = presentation.addSlide();
      titleSlide.background = { color: "081D33" };
      titleSlide.addText("Clean Core Assessment Accelerator", { x: 0.7, y: 1.4, w: 11.9, h: 0.7, fontSize: 28, bold: true, color: "FFFFFF" });
      titleSlide.addText(`${assessment.system} · ${assessment.targetRelease}`, { x: 0.72, y: 2.2, w: 8, h: 0.4, fontSize: 16, color: "70D6C2" });
      titleSlide.addText(`Generated ${new Date(assessment.provenance.generatedAt).toLocaleString()}`, { x: 0.72, y: 6.6, w: 8, h: 0.3, fontSize: 10, color: "B7C9D8" });

      const summarySlide = presentation.addSlide();
      summarySlide.background = { color: "F5F8FB" };
      summarySlide.addText("Executive scorecard", { x: 0.7, y: 0.45, w: 8, h: 0.5, fontSize: 24, bold: true, color: "081D33" });
      const summaryItems = [
        ["Clean Core share", `${assessment.cleanCoreShare}%`],
        ["Technical debt score", assessment.technicalDebtScore.toLocaleString()],
        ["Custom objects", assessment.totals.objects.toLocaleString()],
        ["Interfaces analyzed", assessment.inventory.filter((i:any) => i.interfaceName || i.dimension === 'Integration').length.toLocaleString()],
        ["Usage (in / not / unknown)", `${uc["in-use"]} / ${uc["not-in-use"]} / ${uc.unknown}`],
        ["Complexity sizes", sizeSummary],
      ];
      summaryItems.forEach(([label, value], index) => {
        const x = 0.7 + (index % 3) * 4.1;
        const y = 1.45 + Math.floor(index / 3) * 2.05;
        summarySlide.addText(label, { x, y, w: 3.65, h: 0.35, fontSize: 11, color: "53697A" });
        summarySlide.addText(value, { x, y: y + 0.42, w: 3.65, h: 0.65, fontSize: 23, fit: "shrink", bold: true, color: index === 0 ? "008C7A" : "081D33" });
      });

      const roadmapSlide = presentation.addSlide();
      roadmapSlide.background = { color: "F5F8FB" };
      roadmapSlide.addText("Recommended mitigation waves", { x: 0.7, y: 0.45, w: 8, h: 0.5, fontSize: 24, bold: true, color: "081D33" });
      const waves = assessment.roadmap?.waves || [];
      waves.slice(0, 5).forEach((wave: any, index: number) => {
        roadmapSlide.addText(`${wave.wave || index + 1}. ${wave.name || wave.title || `Wave ${index + 1}`}`, { x: 0.9, y: 1.35 + index * 0.92, w: 5.2, h: 0.35, fontSize: 15, bold: true, color: "081D33" });
        roadmapSlide.addText(`${wave.count ?? wave.objectIds?.length ?? 0} items in scope`, { x: 6.2, y: 1.35 + index * 0.92, w: 4.4, h: 0.35, fontSize: 13, color: "53697A" });
         const patterns = solutionPatternLabels(wave.solutionPatterns).join(", ");
         roadmapSlide.addText(`${patterns ? `Target: ${patterns}. ` : ""}${wave.expectedOutcome || wave.objective || ""}`, { x: 0.9, y: 1.7 + index * 0.92, w: 10.6, h: 0.28, fontSize: 8.5, color: "53697A", breakLine: false });
      });
      const recommendationsSlide = presentation.addSlide();
      recommendationsSlide.background = { color: "F5F8FB" };
      recommendationsSlide.addText("Recommended solution patterns", { x: 0.7, y: 0.45, w: 8, h: 0.5, fontSize: 24, bold: true, color: "081D33" });
      const recommendationGroups = solutionSummaryRows(assessment);
      recommendationGroups.forEach((group, index) => {
        recommendationsSlide.addText(`${group.label} (${group.count})`, { x: 0.9, y: 1.18 + index * 0.78, w: 4.2, h: 0.3, fontSize: 12, bold: true, color: "081D33" });
        recommendationsSlide.addText(`Confidence: ${group.confidenceText}. ${group.rationales.join(" ") || "Validate against object-level evidence."}`, { x: 4.55, y: 1.18 + index * 0.78, w: 7.5, h: 0.5, fontSize: 8.5, color: "53697A", breakLine: false });
      });
      for (const entry of aiAppendix) {
        const chunks = entry.match(/[\s\S]{1,1800}/g) || [];
        chunks.forEach((text, index) => {
          const slide = presentation.addSlide();
          slide.addText(`Accepted AI explanation (${index + 1}/${chunks.length}) — not assessment`, { x: 0.7, y: 0.4, w: 12, h: 0.5, fontSize: 20 });
          slide.addText(text, { x: 0.7, y: 1.1, w: 12, h: 5.8, fontSize: 12, fit: "shrink" });
        });
      }
      await presentation.writeFile({ fileName: `clean-core-assessment-${assessment.system}.pptx` });
    } else if (type === "PDF") {
      const [{ PDFDocument, rgb }, { createPdfText }, { default: fontUrl }, { drawPdfRecommendations }, scriptFonts] = await Promise.all([
        import("pdf-lib"),
        import("@/lib/pdf-text"),
        import("@fontsource/unifont/files/unifont-latin-400-normal.woff?url"),
        import("@/lib/pdf-recommendations"),
        import("@/lib/pdf-fonts").then(module => module.loadPdfScriptFonts()),
      ]);
      const fontResponse = await fetch(fontUrl);
      if (!fontResponse.ok) throw new Error("Could not load the PDF Unicode font. Please retry the download");
      const document = await PDFDocument.create();
      const pdf = await createPdfText(document, new Uint8Array(await fontResponse.arrayBuffer()), scriptFonts);
      const { regular, bold } = pdf;
      const page = document.addPage([842, 595]);
      page.drawRectangle({ x: 0, y: 500, width: 842, height: 95, color: rgb(0.03, 0.11, 0.2) });
      page.drawText("Clean Core Assessment Accelerator", { x: 46, y: 548, size: 24, font: bold, color: rgb(1, 1, 1) });
      pdf.draw(page, `${assessment.system} - ${assessment.targetRelease}`, { x: 46, y: 522, size: 12, color: rgb(0.44, 0.84, 0.76) });
      const lines = [
        ["Clean Core share", `${assessment.cleanCoreShare}%`],
        ["Technical debt score", assessment.technicalDebtScore.toLocaleString()],
        ["Custom objects assessed", assessment.totals.objects.toLocaleString()],
        ["Interfaces analyzed", assessment.inventory.filter((i:any) => i.interfaceName || i.dimension === 'Integration').length.toLocaleString()],
        ["Usage (in / not / unknown)", `${uc["in-use"]} / ${uc["not-in-use"]} / ${uc.unknown}`],
        ["Complexity sizes", sizeSummary],
        ["Classification engine", assessment.provenance.engineVersion],
        ["Evidence confidence", assessment.evidenceQuality.confidence],
      ];
      lines.forEach(([label, value], index) => {
        const y = 455 - index * 48;
        pdf.draw(page, label, { x: 52, y, size: 10, color: rgb(0.32, 0.41, 0.48) });
        pdf.draw(page, value, { x: 315, y: y - 2, size: 17, strong: true, color: rgb(0.03, 0.11, 0.2) });
      });
      page.drawText("Deterministic classifications remain rule-based; AI explanations are separate, user-accepted guidance.", { x: 52, y: 62, size: 9, font: regular, color: rgb(0.32, 0.41, 0.48) });
      pdf.appendix(aiAppendix);
      drawPdfRecommendations(document, pdf, solutionSummaryRows(assessment));
      const output = await document.save();
      downloadBlob(Uint8Array.from(output).buffer, `clean-core-assessment-${assessment.system}.pdf`, "application/pdf");
    }
  };

  const aiReviewQueue = useMemo(
    () => aiExplanationReviewQueue(assessment?.inventory ?? [], aiNarratives, assessment?.targetRelease),
    [assessment, aiNarratives],
  );

  const ctx = {
    aiReviewQueue,
    evidence, setEvidence, assessment, setAssessment, baseline,
    classificationOverrides, setClassificationOverrides, narratives, aiNarratives, setAiNarratives,
    perms, guarded, readOnly, saveConflict, newerWorkspace,
    persistForReview: async () => {
      if (!store || unreadable || conflictRef.current || newerWorkspace) throw new Error("Resolve the browser workspace conflict before sending");
      dirtyRef.current = true;
      persistNow(snapshot);
      await saveChain.current;
      if (dirtyRef.current || conflictRef.current) throw new Error("The workspace could not be saved; retry the local save before sending");
    },
    setNarratives: (update: any) => guarded("notes", () => setNarratives(update)),
    system, targetRelease, weighted, evidenceType, setEvidenceType, setActiveTab,
    // Changing the assessment context invalidates the current result (baseline is kept for comparison).
    setSystem: (v: string) => { setSystem(v); setAssessment(null); },
    setTargetRelease: (v: string) => { setTargetRelease(v); setAssessment(null); },
    setWeighted: (v: boolean) => { setWeighted(v); setAssessment(null); },
    uploadEvidence, runAssessment, loadDemoData, requestDemo, saveBaseline, handleExport, handleSaveOverride, handleSaveBulkOverride, toast,
    exportBackup, handleRestoreFile,
    /** Synchronous backup download; callers must already be authorized for export. */
    downloadBackupNow: () => downloadBlob(JSON.stringify(buildBackup(snapshot), null, 2), `clean-core-workspace-${snapshot.system}-${new Date().toISOString().slice(0, 10)}.json`, "application/json"), requestReset, saveState, saveError, lastSavedAt, retrySave: () => persistNow(snapshot),
    canReload: hydrated && !unreadable && (saveState === "saved" || saveState === "idle"),
    safeReload: () => {
      // Check again at click time: never discard pending or failed writes.
      if (hydrated && !unreadable && !dirtyRef.current && (saveState === "saved" || saveState === "idle")) {
        window.location.reload();
      }
    },
  };

  const NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "explorer", label: "Object Explorer", icon: ListTree },
    { id: "interfaces", label: "Interfaces", icon: Network },
    { id: "ai-review", label: `AI Review (${aiReviewQueue.length})`, icon: ShieldAlert },
    { id: "roadmap", label: "Mitigation Roadmap", icon: Target },
    { id: "usage", label: "Usage", icon: Zap },
    { id: "evidence", label: "Evidence & Sources", icon: Database },
    { id: "export", label: "Export Center", icon: Download },
  ];

  if (unreadable) {
    const downloadUnreadable = () => {
      try {
        const text = JSON.stringify(unreadable.raw, null, 2);
        if (text === undefined) throw new Error("This record cannot be represented as JSON.");
        downloadBlob(text, `clean-core-unreadable-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
        setRecoveryError(null);
      } catch {
        setRecoveryError("Could not export this record as JSON. It remains unchanged in this browser. Do not replace it if you still need to recover it.");
      }
    };
    const replaceUnreadable = async () => {
      if (!store) return;
      try { await accessRef.current.authorize("reset"); }
      catch (e: any) { setRecoveryError(e?.message || "Replacing saved work needs the reset permission."); return; }
      setReplacingUnreadable(true);
      setRecoveryError(null);
      try {
        const empty = emptyWorkspace();
        revisionRef.current = await store.save(empty, revisionRef.current);
        skipNextSave.current = true;
        applyWorkspace(empty);
        setUnreadable(null);
        setSaveState("saved");
        setLastSavedAt(new Date());
      } catch (error) {
        setRecoveryError(error instanceof WorkspaceConflictError
          ? "Another tab changed the saved workspace. Download this record if needed, then reload this page to load the newer saved work."
          : "Replacement failed. Your unreadable saved record has not been replaced. You can download it or try again.");
      } finally {
        setReplacingUnreadable(false);
      }
    };
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-6 dark:bg-slate-950/50">
        <Card className="max-w-lg" data-testid="workspace-recovery">
          <CardHeader>
            <CardTitle>Saved workspace unreadable</CardTitle>
            <CardDescription>The saved record did not pass validation and has not been loaded into the assessment. It remains unchanged in this browser.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Download the raw record to keep a copy for recovery before starting again. This is not a validated workspace backup and may need repair before it can be restored. It may contain sensitive assessment data.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={!perms.export} onClick={() => void guarded("export", downloadUnreadable)} data-testid="button-download-unreadable">Download unreadable record</Button>
              <Button disabled={replacingUnreadable || !perms.reset} onClick={() => setPendingReplace({ kind: "unreadable", onConfirm: replaceUnreadable })} data-testid="button-replace-unreadable">
                {replacingUnreadable ? "Replacing..." : "Start a new workspace"}
              </Button>
            </div>
            {recoveryError && <p role="alert" className="text-sm text-destructive">{recoveryError}</p>}
          </CardContent>
        </Card>
        <ReplaceWorkspaceDialog pending={pendingReplace} onClose={() => setPendingReplace(null)} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-6 dark:bg-slate-950/50">
        <Card className="max-w-md">
          <CardHeader>
            <YashLogo className="mb-3" />
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" /> Browser storage unavailable</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>The workspace is stored only in this browser using IndexedDB. Private browsing modes or disabled site storage can prevent it from opening.</p>
            <Button onClick={hydrate} data-testid="button-retry-load">Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-slate-50 dark:bg-slate-950/50" data-testid="status-loading-workspace">
        <div className="flex h-16 items-center border-b bg-background px-3 md:px-6"><YashLogo /></div>
        <div className="flex flex-1">
          <div className="hidden w-56 border-r bg-background md:block" />
          <div className="flex-1 space-y-4 p-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[0, 1, 2, 3].map(i => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}
            </div>
            <div className="h-72 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
    {classificationStorageError && <p role="alert" className="p-3 text-destructive">{classificationStorageError} Download pending rules before leaving if recovery storage is unavailable.</p>}
    <AlertDialog open={overrideDraft !== null}>
      <AlertDialogContent onEscapeKeyDown={event => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{resumeClassification ? "Recover pending classification changes" : overrideError ? "Classification changes not applied" : "Recalculating classification changes"}</AlertDialogTitle>
          <AlertDialogDescription>
            Your saved rules and assessment remain unchanged until recalculation succeeds.
            {classificationMismatch ? " These rules belong to a different assessment. They cannot be applied to the current evidence." : overrideError ? " Resume or retry to recalculate, or discard only these pending edits. You can also download a copy." : " Please wait while a separate recovery draft is saved and recalculation runs."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {overrideError && <>
          <p role="alert" className="text-sm text-destructive">{overrideError}</p>
          <div className="max-h-48 overflow-auto text-sm" aria-label="Pending classification rules">
            {overrideDraft?.map(rule => <p key={rule.objectPattern}>{rule.objectPattern}: {rule.level} — {rule.reason}</p>)}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={classificationMismatch || !perms.classify || !perms.run} onClick={() => submitOverrides(overrideDraft!)}>{resumeClassification ? "Resume classification changes" : "Retry classification changes"}</Button>
            <Button variant="outline" disabled={!perms.export} onClick={() => void guarded("export", () => downloadBlob(JSON.stringify(overrideDraft, null, 2), "pending-classification-rules.json", "application/json"))}>Download pending rules</Button>
            <Button variant="outline" disabled={!perms.classify} onClick={() => void guarded("classify", discardOverrides)}>Discard pending changes</Button>
          </div>
        </>}
      </AlertDialogContent>
    </AlertDialog>
    <div className="flex h-[100dvh] flex-col bg-slate-50 dark:bg-slate-950/50 text-foreground">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-b px-3 md:px-6 bg-background z-10 shadow-sm">
         <div className="flex min-w-0 items-center gap-2 md:gap-4">
            <YashLogo />
            <h1 className="font-semibold text-sm leading-tight md:text-lg" data-testid="text-app-title">
               Clean Core Assessment
            </h1>
            <div className="h-4 w-px bg-border hidden md:block" />
            <div className="hidden md:flex items-center gap-3 text-sm text-muted-foreground">
               <span className="flex items-center gap-1"><Database className="w-3 h-3"/> {system}</span>
               <span className="flex items-center gap-1"><Target className="w-3 h-3"/> {targetRelease.replace("S4HANA_", "S/4HANA ")}</span>
               {assessment && (
                  <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:border-green-800/50 dark:text-green-400">
                     Analyzed: {new Date(assessment.provenance.generatedAt).toLocaleDateString()}
                  </Badge>
               )}
            </div>
         </div>
         <div className="flex shrink-0 items-center gap-2 md:gap-3">
            {readOnly
              ? <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-900" data-testid="status-read-only">Read-only</Badge>
              : <SaveIndicator state={saveState} error={saveError} lastSavedAt={lastSavedAt} onRetry={() => persistNow(snapshot)} />}
            {!assessment && <Badge variant="secondary" className="hidden lg:inline-flex">No Assessment Data</Badge>}
            {assessment && baseline && (
               <Badge variant="outline" className="hidden lg:inline-flex bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:border-blue-800/50 dark:text-blue-400">
                   Baseline Active
               </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => setActiveTab('evidence')} data-testid="button-configuration">
               <Settings2 className="w-4 h-4 md:mr-2" /> <span className="hidden md:inline">Configuration</span>
            </Button>
            {!readOnly && assessment && <PublishSharedButton ctx={ctx} />}
            {headerExtras}
         </div>
      </header>
      {mode.kind === "readonly" && (
        <div role="status" data-testid="banner-read-only" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-[repeating-linear-gradient(135deg,#fffbeb_0_14px,#fef3c7_14px_28px)] px-3 py-2 text-sm text-amber-950 md:px-6">
          <p><strong>Read-only inspection · {mode.label}.</strong> Nothing here is saved, recalculated or merged into your workspace.</p>
          <Button size="sm" variant="outline" className="bg-white" onClick={mode.onExit} data-testid="button-exit-read-only">Back to my workspace</Button>
        </div>
      )}
      {(saveConflict || newerWorkspace) && (
        <div role="alert" data-testid={saveConflict ? "workspace-save-conflict" : "workspace-newer-work"} className="shrink-0 border-b border-amber-300 bg-amber-50 p-3 text-sm text-slate-900">
          <p className="font-semibold">{saveConflict ? "Another tab saved newer work. Saving in this tab is paused." : "Another tab saved newer work. Refresh before editing this older copy."}</p>
          <p>{saveConflict ? "Your edits have not replaced the saved workspace. Check the recovery draft status below, or download a backup before closing this tab." : "Nothing in this tab has been replaced. Any local edits stay here; download a backup before loading the newer saved workspace."}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportBackup}>Download this tab's backup</Button>
            <Button size="sm" onClick={() => {
              if (window.confirm("Load the newer saved workspace? Unsaved edits in this tab will be discarded. Download this tab's backup first if you want to keep them.")) {
                dirtyRef.current = false;
                window.location.reload();
              }
            }}>Load newer saved workspace</Button>
          </div>
        </div>
      )}
      {store && <RecoveryDrafts store={store} snapshot={snapshot} conflicted={saveConflict} onDiscardActive={() => {
        dirtyRef.current = false;
        window.location.reload();
      }} onRecover={ws => {
        conflictRef.current = true;
        dirtyRef.current = true;
        saveSeq.current++;
        setSaveConflict(true);
        setSaveState("error");
        setSaveError("Reviewing a recovery draft. Saving is paused; the saved workspace is unchanged.");
        applyWorkspace(ws);
      }} />}
      <nav className="md:hidden shrink-0 border-b bg-background" aria-label="Sections">
         <div className="flex gap-1 overflow-x-auto p-2 [scrollbar-width:none]">
            {NAV_ITEMS.map(item => (
                <button
                   key={item.id}
                   onClick={() => setActiveTab(item.id)}
                   data-testid={`tab-mobile-${item.id}`}
                   className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-1.5 text-sm rounded-md transition-colors ${activeTab === item.id ? 'bg-primary text-primary-foreground font-medium shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                >
                   <item.icon className="w-4 h-4" />
                   {item.label}
                </button>
            ))}
         </div>
      </nav>
      <div className="flex flex-1 overflow-hidden">
         <nav className="hidden md:flex w-56 shrink-0 border-r bg-background flex-col p-2 overflow-y-auto">
            <div className="space-y-1">
            {NAV_ITEMS.map(item => (
                <button
                   key={item.id}
                   onClick={() => setActiveTab(item.id)}
                   data-testid={`tab-${item.id}`}
                   className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md transition-colors ${activeTab === item.id ? 'bg-primary text-primary-foreground font-medium shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                >
                   <item.icon className="w-4 h-4" />
                   {item.label}
                </button>
            ))}
            </div>
            <div className="mt-auto rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground" data-testid="text-browser-only-notice">
               <p className="font-medium text-foreground flex items-center gap-1.5"><HardDrive className="h-3.5 w-3.5" /> Stored in this browser</p>
               <p className="mt-1">{readOnly ? "Read-only view: not saved anywhere." : "Saved only in this browser, scoped to your account. Browser storage is not a security boundary against anyone with access to this device."}</p>
               <p className="mt-1 hidden">Saved only in this browser; evidence is sent to this app's backend for processing, not retained there. Export a workspace backup to keep a copy.</p>
            </div>
         </nav>
         <main className="flex-1 overflow-hidden bg-slate-50/50 dark:bg-background/50 p-3 md:p-6 flex flex-col">
            {activeTab === 'dashboard' && <DashboardTab ctx={ctx} />}
            {activeTab === 'explorer' && <ExplorerTab ctx={ctx} />}
            {activeTab === 'interfaces' && <InterfacesTab ctx={ctx} />}
            {activeTab === 'ai-review' && <AiReviewTab ctx={ctx} />}
            {activeTab === 'roadmap' && <RoadmapTab ctx={ctx} />}
            {activeTab === 'evidence' && (
              <LazySection load={loadEvidenceTab} section="Evidence" componentProps={{ ctx, evidenceTypes: EVIDENCE_TYPES }} canReload={ctx.canReload} onSafeReload={ctx.safeReload} onExportBackup={ctx.exportBackup} />
            )}
            {activeTab === 'export' && <ExportCenterTab ctx={ctx} />}
           {activeTab === 'usage' && <UsageTab ctx={ctx} />}
         </main>
      </div>
      <ReplaceWorkspaceDialog pending={pendingReplace} onClose={() => setPendingReplace(null)} />
    </div>
    </TooltipProvider>
  );
}

// --- SUBCOMPONENTS ---

function AiReviewTab({ ctx }: any) {
  const [selected, setSelected] = useState<{ kind: "object" | "interface"; id: string } | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const queue: ReturnType<typeof aiExplanationReviewQueue> = ctx.aiReviewQueue;
  const retained = useMemo(
    () => retainedAiExplanations(ctx.assessment?.inventory ?? [], ctx.aiNarratives),
    [ctx.assessment, ctx.aiNarratives],
  );
  const filtered = queue.filter(row =>
    (filter === "all" || row.state === filter) &&
    `${row.item.objectName} ${row.item.interfaceName ?? ""} ${row.item.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedExists = selected && ctx.assessment?.inventory.some((item: any) => item.id === selected.id);
  return (
    <div className="flex h-full gap-4 overflow-x-auto" data-testid="ai-review-queue">
      <Card className="flex min-w-[320px] flex-1 flex-col overflow-hidden">
        <CardHeader>
          <CardTitle>AI explanations needing review ({queue.length})</CardTitle>
          <CardDescription>
            Accepted explanations with changed assessment inputs or unknown freshness. Review does not remove accepted text or expert notes.
          </CardDescription>
          <p className="text-sm text-muted-foreground">
            {queue.filter(row => row.state === "needs-review").length} changed · {queue.filter(row => row.state === "unknown").length} unknown
          </p>
          {retained.length > 0 && <p className="text-sm text-muted-foreground" data-testid="retained-ai-notice">
            {retained.length} retained explanation(s) for unavailable records are listed separately below. Not included in review counts.
          </p>}
          <div className="flex flex-wrap gap-2 pt-2">
            <Input className="max-w-xs" aria-label="Search AI reviews" placeholder="Search name or ID…" value={search} onChange={event => setSearch(event.target.value)} />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-48" aria-label="AI review status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All needing review</SelectItem>
                <SelectItem value="needs-review">Changed inputs</SelectItem>
                <SelectItem value="unknown">Unknown freshness</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <ScrollArea className="min-h-0 flex-1">
          <Table>
            <TableHeader><TableRow><TableHead>Record</TableHead><TableHead>Explanation</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map(row => (
                <TableRow key={row.subject} data-state={selected?.kind === row.kind && selected?.id === row.item.id ? "selected" : undefined}>
                  <TableCell><p className="font-medium">{row.item.objectName || row.item.id}</p><p className="text-xs text-muted-foreground">{row.item.interfaceName || row.item.id}</p></TableCell>
                  <TableCell>{row.kind === "object" ? "Object" : "Interface"}</TableCell>
                  <TableCell><Badge variant="outline">{row.state === "needs-review" ? "Changed inputs" : "Unknown freshness"}</Badge></TableCell>
                  <TableCell><Button variant="outline" size="sm" aria-label={`Review ${row.kind} ${row.item.objectName || row.item.id}`} onClick={() => setSelected({ kind: row.kind, id: row.item.id })}>Review</Button></TableCell>
                </TableRow>
              ))}
              {!filtered.length && <TableRow><TableCell colSpan={4} className="p-8 text-center text-muted-foreground">
                {!ctx.assessment ? "Run an assessment to check accepted explanations." : queue.length ? "No explanations match these filters." : "No accepted AI explanations for current records need review."}
              </TableCell></TableRow>}
            </TableBody>
          </Table>
          {retained.length > 0 && <section className="m-4 space-y-3 rounded-md border p-4" aria-labelledby="retained-ai-heading" data-testid="retained-ai-explanations">
            <h3 id="retained-ai-heading" className="font-semibold">Retained explanations — records unavailable ({retained.length})</h3>
            <p className="text-sm text-muted-foreground">
              {ctx.assessment
                ? "These records are not in the current assessment."
                : "There is no current assessment, so these records are unavailable."}
              {" "}Their accepted AI text is preserved below, read-only. Freshness cannot be compared without the record.
              This is different from unknown freshness, where a current record exists but the explanation has no saved comparison data.
            </p>
            {retained.map(({ subject, note }) => <details key={subject} className="rounded-md border p-3">
              <summary className="cursor-pointer break-words text-sm font-medium">
                {subject} — Record unavailable
              </summary>
              <div className="mt-3 space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">AI-generated · {note.provider} / {note.model} · accepted {note.acceptedAt}. Not an authoritative assessment.</p>
                <p className="whitespace-pre-wrap break-words">{note.text}</p>
              </div>
            </details>)}
          </section>}
        </ScrollArea>
      </Card>
      {selected && selectedExists && (selected.kind === "object"
        ? <ObjectDetailPanel key={`object:${selected.id}`} id={selected.id} ctx={ctx} onClose={() => setSelected(null)} />
        : <InterfaceDetailPanel key={`interface:${selected.id}`} id={selected.id} ctx={ctx} onClose={() => setSelected(null)} />)}
    </div>
  );
}

function MetricCard({ title, value, icon: Icon }: any) {
  return (
     <Card className="hover-elevate h-full min-w-0">
        <CardContent className="p-4 flex min-w-0 items-center gap-3">
           <div className="p-3 bg-primary/10 text-primary rounded-full shrink-0">
              <Icon className="w-5 h-5" />
           </div>
           <div className="min-w-0">
              <div className="text-sm font-medium leading-tight text-muted-foreground flex flex-wrap items-center">{title}</div>
              <h3 className="text-2xl font-bold break-words">{value}</h3>
           </div>
        </CardContent>
     </Card>
  )
}

const CLASSIFICATION_DEFINITIONS: Record<string, string> = {
  A: "Standard adoption or key-user extensibility that does not depend on custom developer code.",
  B: "Developer extensibility using released SAP contracts and ABAP Cloud-compatible patterns.",
  C: "Classic or restricted extension that should be remediated to a released contract.",
  D: "Core modification, direct access, or unreleased dependency that requires redesign.",
};

const OBJECT_TYPE_DEFINITIONS: Record<string, string> = {
  PROG: "ABAP executable program or report.",
  CLAS: "ABAP class containing reusable application logic.",
  FUNC: "ABAP function module or function group implementation.",
  DDLS: "Core Data Services data definition.",
  BADI: "Business Add-In implementation used to extend SAP behavior.",
};

function ClassificationBadge({ level, reasonSummary }: { level: string, reasonSummary?: string }) {
  const colors = {
      'A': 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800/50',
      'B': 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/50',
      'C': 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800/50',
      'D': 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50',
  };
  const cls = (colors as any)[level] || 'bg-muted text-muted-foreground';
  const explanation = reasonSummary || CLASSIFICATION_DEFINITIONS[level] || "Classification definition is unavailable.";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`${cls} cursor-help`}
          tabIndex={0}
          aria-label={`Level ${level}: ${explanation}`}
        >
          {level}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px]">
         <p className="font-semibold mb-1">{reasonSummary ? "Why this category" : `Level ${level}`}</p>
         <p className="text-sm">{explanation}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function ObjectNameWithTooltip({ item }: { item: any }) {
  const explanation = item.classificationReason?.summary || item.classificationExplanation;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help font-medium underline decoration-dotted decoration-muted-foreground/50 underline-offset-4" tabIndex={0}>
          {item.objectName}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[360px] space-y-1">
        <p className="font-semibold">{item.objectType} · {item.module} · {item.disposition}</p>
        <p>{OBJECT_TYPE_DEFINITIONS[item.objectType] || "Custom SAP repository object."}</p>
        {explanation && <p className="text-muted-foreground">{explanation}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

function EmptyState({ ctx }: { ctx?: any }) {
  return (
     <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-4 text-muted-foreground">
         <Database className="w-12 h-12 opacity-50" />
         <h3 className="text-lg font-medium text-foreground">No Assessment Data</h3>
         <p>Load the demo landscape or upload evidence to run the deterministic assessment engine.</p>
         {ctx && (
           <div className="flex flex-col gap-2 sm:flex-row">
             <Button onClick={ctx.requestDemo} disabled={ctx.loadDemoData.isPending || !ctx.perms.evidence || !ctx.perms.run} data-testid="button-empty-load-demo">
               <FlaskConical className="w-4 h-4 mr-2" /> {ctx.loadDemoData.isPending ? "Building landscape..." : "Load Demo Data"}
             </Button>
             <Button variant="outline" onClick={() => ctx.setActiveTab("evidence")} data-testid="button-empty-upload-evidence">
               <Database className="w-4 h-4 mr-2" /> Upload Evidence
             </Button>
           </div>
         )}
     </div>
  );
}

function DashboardTab({ ctx }: { ctx: any }) {
  const { assessment, baseline } = ctx;
  const inventory = assessment?.inventory || [];

  const dist = [
     { name: "Level A", value: inventory.filter((i: any) => i.classification === 'A').length, color: "#10b981" },
     { name: "Level B", value: inventory.filter((i: any) => i.classification === 'B').length, color: "#3b82f6" },
     { name: "Level C", value: inventory.filter((i: any) => i.classification === 'C').length, color: "#f59e0b" },
     { name: "Level D", value: inventory.filter((i: any) => i.classification === 'D').length, color: "#ef4444" },
  ].filter(d => d.value > 0);

  const dimensions = useMemo(() => {
      const counts: any = {};
      inventory.forEach((i: any) => {
          counts[i.dimension] = (counts[i.dimension] || 0) + 1;
      });
      return Object.entries(counts).map(([k, v]) => ({ name: k, count: v })).sort((a: any, b: any) => b.count - a.count);
  }, [inventory]);

  const comparison = useMemo(() => {
    if (!assessment || !baseline) return null;
    const currentIds = new Set(assessment.inventory.filter((item: any) => item.classification === "C" || item.classification === "D").map((item: any) => item.id));
    const baseIds = new Set(baseline.inventory.filter((item: any) => item.classification === "C" || item.classification === "D").map((item: any) => item.id));

    const remaining = [...currentIds].filter(id => baseIds.has(id)).length;
    const resolved = [...baseIds].filter(id => !currentIds.has(id)).length;
    const newItems = [...currentIds].filter(id => !baseIds.has(id)).length;

    return {
      remaining, resolved, newItems,
      scoreDelta: (assessment.cleanCoreShare || 0) - (baseline.cleanCoreShare || 0),
      debtDelta: (assessment.technicalDebtScore || 0) - (baseline.technicalDebtScore || 0)
    };
  }, [assessment, baseline]);

  if (!assessment) return <EmptyState ctx={ctx} />;

  return (
      <div className="space-y-6 overflow-y-auto pb-8 h-full pr-4">
         <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
             <MetricCard
                title={<span className="flex items-center">Clean Core Share <InfoTooltip text="Percentage of custom extensions and objects aligned with SAP clean core guidelines (Classification A and B)." /></span>}
                value={`${assessment.cleanCoreShare}%`}
                icon={Target}
             />
             <MetricCard
                title={<span className="flex items-center">Technical Debt <InfoTooltip text="Cumulative penalty score derived from direct modifications, obsolete APIs, and complexity violations." /></span>}
                value={assessment.technicalDebtScore.toLocaleString()}
                icon={ShieldAlert}
             />
             <MetricCard
                title={<span className="flex items-center">Total Objects <InfoTooltip text="Total number of evaluated custom repository objects in scope." /></span>}
                value={assessment.totals.objects.toLocaleString()}
                icon={Database}
             />
             <MetricCard
                title={<span className="flex items-center">Interfaces <InfoTooltip text="Number of unique integration points or APIs identified in the inventory." /></span>}
                value={assessment.inventory.filter((item: any) => item.interfaceName || item.dimension === "Integration").length.toLocaleString()}
                icon={Network}
             />
             <MetricCard
                title={<span className="flex items-center">High Confidence <InfoTooltip text="Number of objects with robust telemetry and static analysis data." /></span>}
                value={assessment.inventory.filter((item: any) => item.confidence === "high").length.toLocaleString()}
                icon={Zap}
             />
         </div>

         {baseline && comparison && (
            <div className="p-4 border rounded-md bg-background shadow-sm">
               <h3 className="font-medium mb-4 flex items-center gap-2"><GitCommit className="w-4 h-4 text-primary"/> Baseline Progression</h3>
               <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                     <p className="text-sm text-muted-foreground">Score Change</p>
                     <p className={`text-xl font-bold ${comparison.scoreDelta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {comparison.scoreDelta >= 0 ? '+' : ''}{comparison.scoreDelta.toFixed(1)}%
                     </p>
                  </div>
                  <div>
                     <p className="text-sm text-muted-foreground">Debt Reduction</p>
                     <p className={`text-xl font-bold ${comparison.debtDelta <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {comparison.debtDelta > 0 ? '+' : ''}{Math.abs(comparison.debtDelta).toFixed(1)}
                     </p>
                  </div>
                  <div>
                     <p className="text-sm text-muted-foreground">Resolved Risks</p>
                     <p className="text-xl font-bold text-green-600">{comparison.resolved}</p>
                  </div>
                  <div>
                     <p className="text-sm text-muted-foreground">New Risks</p>
                     <p className={`text-xl font-bold ${comparison.newItems === 0 ? 'text-green-600' : 'text-red-600'}`}>{comparison.newItems}</p>
                  </div>
               </div>
            </div>
         )}

         <LazySection load={loadDashboardCharts} section="Charts" componentProps={{ distribution: dist, dimensions }} canReload={ctx.canReload} onSafeReload={ctx.safeReload} onExportBackup={ctx.exportBackup} />
      </div>
  )
}

function ExplorerTab({ ctx }: { ctx: any }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLevel, setSelectedLevel] = useState("ALL");
  const [selectedModule, setSelectedModule] = useState("ALL");
  const [selectedPackage, setSelectedPackage] = useState("ALL");
  const [selectedUsage, setSelectedUsage] = useState("ALL");
  const [selectedDisposition, setSelectedDisposition] = useState("ALL");
  const [selectedComplexity, setSelectedComplexity] = useState("ALL");
  const [selectedRecommendation, setSelectedRecommendation] = useState("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkLevel, setBulkLevel] = useState("B");
  const [bulkReason, setBulkReason] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(150);

  if (!ctx.assessment) return <EmptyState ctx={ctx} />;

  const modules = [...new Set(ctx.assessment.inventory.map((item: any) => item.module).filter(Boolean))] as string[];
  const packages = [...new Set(ctx.assessment.inventory.map((item: any) => item.package).filter(Boolean))] as string[];
  const dispositions = [...new Set(ctx.assessment.inventory.map((item: any) => item.disposition).filter(Boolean))] as string[];
  const recommendations = [...new Set(ctx.assessment.inventory.map(recommendationLabel).filter(Boolean))] as string[];
  const filtered = ctx.assessment.inventory.filter((i: any) => {
    if (selectedLevel !== "ALL" && i.classification !== selectedLevel) return false;
    if (selectedModule !== "ALL" && i.module !== selectedModule) return false;
    if (selectedPackage !== "ALL" && i.package !== selectedPackage) return false;
    if (selectedUsage !== "ALL") {
      const u = usageFor(i, ctx.evidence).status;
      if (selectedUsage === "ACTIVE" && u !== "in-use") return false;
      if (selectedUsage === "DEAD" && u !== "not-in-use") return false;
      if (selectedUsage === "UNKNOWN" && u !== "unknown") return false;
    }
    if (selectedDisposition !== "ALL" && i.disposition !== selectedDisposition) return false;
    if (selectedRecommendation !== "ALL" && recommendationLabel(i) !== selectedRecommendation) return false;
    if (selectedComplexity !== "ALL" && (itemComplexitySize(i) ?? "UNASSESSED") !== selectedComplexity) return false;
    if (searchTerm && !i.objectName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });
  const filteredIds = filtered.map((item: any) => item.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id: string) => selectedIds.includes(id));

  const applyBulkOverride = () => {
    const objectNames = ctx.assessment.inventory
      .filter((item: any) => selectedIds.includes(item.id))
      .map((item: any) => item.objectName);
    ctx.handleSaveBulkOverride(objectNames, bulkLevel, bulkReason);
    setSelectedIds([]);
    setBulkReason("");
  };

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 shrink-0">
           <Input placeholder="Search objects by name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full md:max-w-xs bg-background" />
           <Select value={selectedLevel} onValueChange={setSelectedLevel}>
              <SelectTrigger className="w-[150px] bg-background">
                 <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                 <SelectItem value="ALL">All levels</SelectItem>
                 <SelectItem value="A">Level A</SelectItem>
                 <SelectItem value="B">Level B</SelectItem>
                 <SelectItem value="C">Level C</SelectItem>
                 <SelectItem value="D">Level D</SelectItem>
              </SelectContent>
           </Select>
           <Select value={selectedModule} onValueChange={setSelectedModule}>
              <SelectTrigger className="w-[145px] bg-background"><SelectValue placeholder="LOB" /></SelectTrigger>
              <SelectContent><SelectItem value="ALL">All LOBs</SelectItem>{modules.map(module => <SelectItem key={module} value={module}>{module}</SelectItem>)}</SelectContent>
           </Select>
           <Select value={selectedPackage} onValueChange={setSelectedPackage}>
              <SelectTrigger className="w-[170px] bg-background"><SelectValue placeholder="Package" /></SelectTrigger>
              <SelectContent><SelectItem value="ALL">All packages</SelectItem>{packages.map(pkg => <SelectItem key={pkg} value={pkg}>{pkg}</SelectItem>)}</SelectContent>
           </Select>
           <Select value={selectedUsage} onValueChange={setSelectedUsage}>
              <SelectTrigger className="w-[135px] bg-background"><SelectValue placeholder="Usage" /></SelectTrigger>
              <SelectContent><SelectItem value="ALL">All usage</SelectItem><SelectItem value="ACTIVE">In use</SelectItem><SelectItem value="DEAD">Not in use</SelectItem><SelectItem value="UNKNOWN">Unknown</SelectItem></SelectContent>
           </Select>
           <Select value={selectedDisposition} onValueChange={setSelectedDisposition}>
              <SelectTrigger className="w-[170px] bg-background"><SelectValue placeholder="Disposition" /></SelectTrigger>
              <SelectContent><SelectItem value="ALL">All dispositions</SelectItem>{dispositions.map(disposition => <SelectItem key={disposition} value={disposition}>{disposition}</SelectItem>)}</SelectContent>
           </Select>
           <Select value={selectedComplexity} onValueChange={setSelectedComplexity}>
              <SelectTrigger className="w-[145px] bg-background"><SelectValue placeholder="Complexity" /></SelectTrigger>
              <SelectContent><SelectItem value="ALL">All complexity</SelectItem>{COMPLEXITY_SIZES.map(z => <SelectItem key={z} value={z}>{z}</SelectItem>)}<SelectItem value="UNASSESSED">Unassessed</SelectItem></SelectContent>
           </Select>
            <Select value={selectedRecommendation} onValueChange={setSelectedRecommendation}>
               <SelectTrigger className="w-[220px] bg-background"><SelectValue placeholder="Recommended solution" /></SelectTrigger>
               <SelectContent><SelectItem value="ALL">All solutions</SelectItem>{recommendations.map(recommendation => <SelectItem key={recommendation} value={recommendation}>{recommendation}</SelectItem>)}</SelectContent>
            </Select>
           <div className="flex-1" />
           <Badge variant="secondary" className="font-normal">{filtered.length} objects</Badge>
           <WordExportButton ctx={ctx} selection={allEntities(ctx.assessment)} label="Export Word: all" scopeLabel={`entire assessment — every unique object and interface (inventory + integrations)`} testId="button-export-word-all" />
        </div>
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/5 p-2">
            <Badge>{selectedIds.length} selected</Badge>
            <Select value={bulkLevel} onValueChange={setBulkLevel}>
              <SelectTrigger className="w-[130px] bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>{["A", "B", "C", "D"].map(level => <SelectItem key={level} value={level}>Set level {level}</SelectItem>)}</SelectContent>
            </Select>
            <Input value={bulkReason} onChange={event => setBulkReason(event.target.value)} placeholder="Required audit reason" className="min-w-[220px] flex-1 bg-background" />
            <Button size="sm" onClick={applyBulkOverride} disabled={!ctx.perms.classify || !ctx.perms.run || !bulkReason.trim()}>Apply to selected</Button>
            <WordExportButton ctx={ctx} selection={selectedIds.map((id: string) => ({ id, kind: "object" as const }))} scopeLabel="explicit selection" testId="button-export-word-selected" />
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Clear</Button>
          </div>
        )}
        <div className="flex-1 border rounded-md overflow-hidden bg-background shadow-sm flex flex-col">
           <ScrollArea className="flex-1">
              <Table>
                 <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm shadow-sm">
                    <TableRow>
                       <TableHead className="w-10">
                         <input
                           type="checkbox"
                           aria-label="Select all filtered objects"
                           checked={allFilteredSelected}
                           onChange={(event) => setSelectedIds(event.target.checked ? [...new Set([...selectedIds, ...filteredIds])] : selectedIds.filter(id => !filteredIds.includes(id)))}
                         />
                       </TableHead>
                       <TableHead>Object Name</TableHead>
                       <TableHead>Type</TableHead>
                       <TableHead>Module</TableHead>
                        <TableHead>Recommended Solution</TableHead>
                       <TableHead className="text-right">Classification</TableHead>
                    </TableRow>
                 </TableHeader>
                 <TableBody>
                    {filtered.slice(0, visibleCount).map((item: any) => (
                       <TableRow
                         key={item.id}
                         role="button"
                         tabIndex={0}
                         aria-label={`Open details for ${item.objectName}`}
                         className={`cursor-pointer transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${selectedId === item.id ? 'bg-primary/5 border-primary/20' : 'hover:bg-muted/50'}`}
                         onClick={() => setSelectedId(item.id)}
                         onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                             event.preventDefault();
                             setSelectedId(item.id);
                           }
                         }}
                       >
                           <TableCell onClick={event => event.stopPropagation()}>
                             <input
                               type="checkbox"
                               aria-label={`Select ${item.objectName}`}
                               checked={selectedIds.includes(item.id)}
                               onChange={(event) => setSelectedIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}
                             />
                           </TableCell>
                           <TableCell><ObjectNameWithTooltip item={item} /></TableCell>
                          <TableCell>{item.objectType}</TableCell>
                          <TableCell>{item.module}</TableCell>
                           <TableCell><Badge variant="outline" className="max-w-[220px] truncate font-normal">{recommendationLabel(item) || "Not available"}</Badge></TableCell>
                          <TableCell className="text-right"><ClassificationBadge level={item.classification} reasonSummary={item.classificationReason?.summary} /></TableCell>
                       </TableRow>
                    ))}
                    {filtered.length === 0 && (
                       <TableRow>
                            <TableCell colSpan={6} className="text-center p-8 text-muted-foreground">No objects match the current filters.</TableCell>
                       </TableRow>
                    )}
                    {filtered.length > visibleCount && (
                       <TableRow>
                            <TableCell colSpan={6} className="text-center p-4">
                              <Button variant="ghost" onClick={() => setVisibleCount(v => v + 150)}>Load More Objects</Button>
                           </TableCell>
                       </TableRow>
                    )}
                 </TableBody>
              </Table>
              <ScrollBar orientation="horizontal" />
           </ScrollArea>
        </div>
      </div>
      {selectedId && <ObjectDetailPanel key={selectedId} id={selectedId} ctx={ctx} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function ObjectDetailPanel({ id, ctx, onClose }: any) {
  const item = ctx.assessment.inventory.find((i: any) => i.id === id);
  const [narrative, setNarrative] = useState(ctx.narratives[id] || "");
  const [level, setLevel] = useState(item?.classification || "B");
  const [reason, setReason] = useState("");

  if (!item) return null;

  const classReason = item.classificationReason;
  const mitigation = item.mitigation;

  const handleSaveNarrative = () => {
     void ctx.setNarratives((prev: any) => ({ ...prev, [id]: narrative })).then((ok: boolean) => {
        if (ok) ctx.toast({ title: "Narrative saved", description: "Architectural note persisted to workspace." });
     });
  };

  return (
     <Card className="w-[450px] shrink-0 flex flex-col h-full rounded-md border shadow-lg overflow-hidden animate-in slide-in-from-right-4">
        <CardHeader className="p-4 border-b shrink-0 flex flex-row items-start justify-between space-y-0 bg-muted/20">
            <div>
               <CardTitle className="text-lg flex items-center gap-2">{item.objectName}</CardTitle>
               <CardDescription className="mt-1">{item.objectType} &middot; {item.module} &middot; {item.package}</CardDescription>
               <div className="mt-2"><WordExportButton ctx={ctx} selection={[{ id: item.id, kind: "object" }]} testId="button-export-word-object" /></div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="-mr-2 -mt-2"><X className="h-4 w-4"/></Button>
        </CardHeader>
        <ScrollArea className="flex-1 p-4">
            <div className="space-y-6">
               <SendForApproval ctx={ctx} item={item} kind="object" unsaved={narrative !== (ctx.narratives[id] || "") || !!reason.trim() || level !== item.classification} />
               <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Classification Reasoning</h4>
                  <div className="flex flex-col gap-2">
                     <div className="flex items-center gap-2">
                         <ClassificationBadge level={item.classification} />
                        <DefinedValue
                          value={item.disposition}
                          definition={DISPOSITION_DEFINITIONS[String(item.disposition).toLowerCase()]}
                          className="text-sm font-medium capitalize"
                        />
                     </div>
                     {classReason ? (
                        <div className="bg-muted/40 p-3 rounded-md border border-muted space-y-2 text-sm">
                           <p className="font-medium text-foreground">{classReason.summary}</p>
                           {classReason.matchedRule && <p className="text-muted-foreground">Rule: {classReason.matchedRule}</p>}
                           {classReason.dispositionReason && <p className="text-muted-foreground">Disposition: {classReason.dispositionReason}</p>}
                            {classReason.override?.applied && (
                              <div className="mt-2 pt-2 border-t text-xs text-orange-700 dark:text-orange-400">
                                  Manual override applied: “{classReason.override.reason}”
                                  {classReason.override.originalLevel && (
                                    <span className="block mt-1">
                                      Original Level {classReason.override.originalLevel}: {classReason.override.originalReason}
                                    </span>
                                  )}
                              </div>
                           )}
                            {classReason.supportingSignals?.length > 0 && (
                              <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
                                {classReason.supportingSignals.map((signal: string, index: number) => <li key={index}>• {signal}</li>)}
                              </ul>
                            )}
                        </div>
                     ) : (
                        <p className="text-sm text-foreground bg-muted/40 p-3 rounded-md border border-muted">{item.classificationExplanation}</p>
                     )}
                  </div>
               </div>
               
               <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                     <p className="text-muted-foreground mb-1 flex items-center">Extensibility Tier <InfoTooltip text="The SAP extension approach used by this object. Released APIs and key-user or developer extensibility are preferred over classic or core modifications." /></p>
                     <p className="font-medium">{item.extensibilityTier || 'Unknown'}</p>
                  </div>
                  <div>
                     <p className="text-muted-foreground mb-1 flex items-center">Data Confidence <InfoTooltip text="How strongly the category is supported by the available static findings, usage telemetry, and object metadata." /></p>
                     <Badge variant="outline" className={item.confidence === 'high' ? 'border-green-500 text-green-600' : 'border-yellow-500 text-yellow-600'}>{item.confidence || 'medium'}</Badge>
                  </div>
                  <div>
                     <p className="text-muted-foreground mb-1 flex items-center">Complexity <InfoTooltip text="A relative indicator derived from findings, dependencies, and modification patterns; use it only to sequence review." /></p>
                     <p className="font-medium">{itemComplexityLabel(item)}</p>
                  </div>
                  <div>
                     <p className="text-muted-foreground mb-1 flex items-center">Usage / Activity <InfoTooltip text="Conservative status: positive count means in use; not in use only with an explicit zero over a complete observation period at 100% telemetry coverage; otherwise unknown." /></p>
                     <p className="font-medium">{(() => { const u = usageFor(item, ctx.evidence); return u.status === "in-use" ? `In use${u.count !== null ? ` · ${u.count} executions` : ""}` : u.status === "not-in-use" ? "Not in use (complete observation)" : `Unknown · ${u.reason}`; })()}</p>
                  </div>
               </div>

                {item.successor && (
                   <div>
                      <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Released Successor</h4>
                      <p className="rounded-md border bg-muted/30 p-3 text-sm font-medium">{item.successor}</p>
                   </div>
                )}

                <RecommendationPanel item={item} />

               {mitigation && (
                  <div>
                     <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Mitigation Action</h4>
                     <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 p-3 rounded-md space-y-2 text-sm">
                        <p className="font-medium text-blue-900 dark:text-blue-200">{mitigation.recommendedAction}</p>
                        {mitigation.targetPattern && <p className="text-blue-800 dark:text-blue-300">Target: {mitigation.targetPattern}</p>}
                        {mitigation.steps?.length > 0 && (
                           <ul className="list-disc list-inside pl-4 text-blue-800/80 dark:text-blue-300/80">
                              {mitigation.steps.map((step: string, idx: number) => <li key={idx}>{step}</li>)}
                           </ul>
                        )}
                        {mitigation.validation && (
                           <div className="mt-2 pt-2 border-t border-blue-200/50 dark:border-blue-800/50 text-blue-700 dark:text-blue-400 text-xs">
                              Validation: {mitigation.validation}
                           </div>
                        )}
                     </div>
                  </div>
               )}

               <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Dependencies</h4>
                  <div className="flex flex-wrap gap-1">
                     {item.dependencies?.length > 0 ? item.dependencies.map((d: string) => <Badge key={d} variant="secondary" className="font-normal bg-secondary/50">{d}</Badge>) : <span className="text-sm text-muted-foreground">None identified</span>}
                  </div>
               </div>

               <AiDetail kind="object" item={item} ctx={ctx} />
               <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2 flex justify-between items-center">
                     Expert Narrative
                  </h4>
                  <div className="relative">
                     <textarea readOnly={!ctx.perms.notes} className="w-full min-h-[120px] p-3 text-sm rounded-md border bg-transparent focus:outline-none focus:ring-1 focus:ring-primary resize-y read-only:opacity-70" placeholder={ctx.perms.notes ? "Add architectural context, planned successor details, or remediation notes..." : "No narrative recorded. Editing notes needs the notes permission."} value={narrative} onChange={e => setNarrative(e.target.value)} />
                  </div>
                  <Button size="sm" variant="secondary" className="mt-2 w-full" disabled={!ctx.perms.notes} onClick={handleSaveNarrative}>Save Narrative</Button>
               </div>

               <div className="p-4 bg-muted/30 border rounded-md space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2"><Edit className="w-4 h-4"/> Classification Override</h4>
                  <Select value={level} onValueChange={setLevel}>
                     <SelectTrigger className="bg-background"><SelectValue placeholder="Select level" /></SelectTrigger>
                     <SelectContent>
                        <SelectItem value="A">Level A (Standard)</SelectItem>
                        <SelectItem value="B">Level B (Developer Ext)</SelectItem>
                        <SelectItem value="C">Level C (Classic/Legacy)</SelectItem>
                        <SelectItem value="D">Level D (Modification)</SelectItem>
                     </SelectContent>
                  </Select>
                  <Input placeholder="Reason for manual override..." value={reason} onChange={e => setReason(e.target.value)} className="bg-background" />
                  <Button size="sm" className="w-full" onClick={() => ctx.handleSaveOverride(item.objectName, level, reason)} disabled={!ctx.perms.classify || !ctx.perms.run || !reason.trim() || level === item.classification}>Apply Override</Button>
               </div>
            </div>
        </ScrollArea>
     </Card>
  );
}

function InterfacesTab({ ctx }: { ctx: any }) {
  const { assessment } = ctx;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [visibleCount, setVisibleCount] = useState(200);

  if (!assessment) return <EmptyState ctx={ctx} />;

  const interfaces = assessment.inventory.filter((i: any) => i.interfaceName || i.dimension === 'Integration');
  const filtered = interfaces.filter((i: any) => !searchTerm || i.objectName.toLowerCase().includes(searchTerm.toLowerCase()) || (i.interfaceName && i.interfaceName.toLowerCase().includes(searchTerm.toLowerCase())));

  if (interfaces.length === 0) {
     return (
        <div className="text-center p-12 text-muted-foreground border rounded-lg bg-background shadow-sm h-full flex flex-col items-center justify-center">
            <Network className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground mb-2">No Interfaces Identified</h3>
            <p>No integration points or custom APIs were found in the current evidence sets.</p>
        </div>
     );
  }

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      <div className="flex-1 flex flex-col gap-4 overflow-hidden">
        <div className="flex items-center gap-2 shrink-0">
           <Input placeholder="Search interfaces by endpoint or object name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full md:max-w-sm bg-background" />
           <div className="flex-1" />
           <Badge variant="secondary" className="font-normal">{filtered.length} integrations</Badge>
           <WordExportButton ctx={ctx} selection={filtered.map((i: any) => ({ id: i.id, kind: "interface" as const }))} label="Export Word" scopeLabel={searchTerm ? "interfaces matching the current search" : "all interfaces"} testId="button-export-word-interfaces" />
        </div>
        <div className="flex-1 border rounded-md overflow-hidden bg-background shadow-sm flex flex-col">
           <ScrollArea className="flex-1">
              <Table>
                 <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur-sm shadow-sm">
                    <TableRow>
                       <TableHead>Object Name</TableHead>
                       <TableHead>Endpoint / Protocol</TableHead>
                       <TableHead>Connected Systems</TableHead>
                        <TableHead>Recommended Solution</TableHead>
                       <TableHead>Status</TableHead>
                       <TableHead className="text-right">Classification</TableHead>
                    </TableRow>
                 </TableHeader>
                 <TableBody>
                    {filtered.slice(0, visibleCount).map((item: any) => (
                       <TableRow
                         key={item.id}
                         role="button"
                         tabIndex={0}
                         aria-label={`Open interface details for ${item.objectName}`}
                         className={`cursor-pointer transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring ${selectedId === item.id ? 'bg-primary/5 border-primary/20' : 'hover:bg-muted/50'}`}
                         onClick={() => setSelectedId(item.id)}
                         onKeyDown={(event) => {
                           if (event.key === "Enter" || event.key === " ") {
                             event.preventDefault();
                             setSelectedId(item.id);
                           }
                         }}
                       >
                           <TableCell><ObjectNameWithTooltip item={item} /></TableCell>
                           <TableCell className="text-muted-foreground">
                             {item.interfaceName || "N/A"}
                             {item.interfaceType && (
                               <Badge variant="secondary" className="ml-2 bg-muted/50">
                                 <DefinedValue
                                   value={item.interfaceType}
                                   definition={PROTOCOL_DEFINITIONS[String(item.interfaceType).toUpperCase()]}
                                 />
                               </Badge>
                             )}
                           </TableCell>
                          <TableCell>
                             <div className="flex flex-col text-xs text-muted-foreground">
                                {item.sourceSystem && <span>Src: {item.sourceSystem}</span>}
                                {item.targetSystem && <span>Tgt: {item.targetSystem}</span>}
                                {item.interfaceDirection && <span>Dir: {item.interfaceDirection}</span>}
                                {(!item.sourceSystem && !item.targetSystem && !item.interfaceDirection) && <span>Unknown</span>}
                             </div>
                          </TableCell>
                           <TableCell><Badge variant="outline" className="max-w-[200px] truncate font-normal">{recommendationLabel(item) || "Not available"}</Badge></TableCell>
                          <TableCell>{item.releaseStatus || 'N/A'}</TableCell>
                          <TableCell className="text-right"><ClassificationBadge level={item.classification} reasonSummary={item.classificationReason?.summary} /></TableCell>
                       </TableRow>
                    ))}
                    {filtered.length > visibleCount && (
                       <TableRow>
                            <TableCell colSpan={6} className="text-center p-4">
                              <Button variant="ghost" onClick={() => setVisibleCount(v => v + 200)}>Load More</Button>
                           </TableCell>
                       </TableRow>
                    )}
                 </TableBody>
              </Table>
              <ScrollBar orientation="horizontal" />
           </ScrollArea>
        </div>
      </div>
      {selectedId && <InterfaceDetailPanel key={selectedId} id={selectedId} ctx={ctx} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function InterfaceDetailPanel({ id, ctx, onClose }: any) {
  const item = ctx.assessment.inventory.find((i: any) => i.id === id);
  const [narrative, setNarrative] = useState(ctx.narratives[id] || "");
  const [level, setLevel] = useState(item?.classification || "B");
  const [reason, setReason] = useState("");

  if (!item) return null;
  
  const classReason = item.classificationReason;
  const mitigation = item.interfaceMitigation || item.mitigation;

  const handleSaveNarrative = () => {
     void ctx.setNarratives((prev: any) => ({ ...prev, [id]: narrative })).then((ok: boolean) => {
        if (ok) ctx.toast({ title: "Narrative saved", description: "Interface note persisted to workspace." });
     });
  };

  return (
     <Card className="w-[450px] shrink-0 flex flex-col h-full rounded-md border shadow-lg overflow-hidden animate-in slide-in-from-right-4">
        <CardHeader className="p-4 border-b shrink-0 flex flex-row items-start justify-between space-y-0 bg-muted/20">
            <div>
               <CardTitle className="text-lg flex items-center gap-2">{item.objectName}</CardTitle>
               <CardDescription className="mt-1 flex items-center gap-2">
                  <Network className="w-3 h-3"/> {item.interfaceName || 'Integration Endpoint'}
               </CardDescription>
               <div className="mt-2"><WordExportButton ctx={ctx} selection={[{ id: item.id, kind: "interface" }]} testId="button-export-word-interface" /></div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="-mr-2 -mt-2"><X className="h-4 w-4"/></Button>
        </CardHeader>
        <ScrollArea className="flex-1 p-4">
            <div className="space-y-6">
               <SendForApproval ctx={ctx} item={item} kind="interface" unsaved={narrative !== (ctx.narratives[id] || "") || !!reason.trim() || level !== item.classification} />
               <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Classification Reasoning</h4>
                  <div className="flex flex-col gap-2">
                     <div className="flex items-center gap-2">
                         <ClassificationBadge level={item.classification} />
                        <DefinedValue
                          value={item.disposition}
                          definition={DISPOSITION_DEFINITIONS[String(item.disposition).toLowerCase()]}
                          className="text-sm font-medium capitalize"
                        />
                     </div>
                     {classReason ? (
                        <div className="bg-muted/40 p-3 rounded-md border border-muted space-y-2 text-sm">
                           <p className="font-medium text-foreground">{classReason.summary}</p>
                           {classReason.matchedRule && <p className="text-muted-foreground">Rule: {classReason.matchedRule}</p>}
                            {classReason.dispositionReason && <p className="text-muted-foreground">Disposition: {classReason.dispositionReason}</p>}
                            {classReason.override?.applied && (
                              <p className="border-t pt-2 text-xs text-orange-700 dark:text-orange-400">
                                Manual override applied: “{classReason.override.reason}”
                              </p>
                            )}
                            {classReason.supportingSignals?.length > 0 && (
                              <ul className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
                                {classReason.supportingSignals.map((signal: string, index: number) => <li key={index}>• {signal}</li>)}
                              </ul>
                            )}
                        </div>
                     ) : (
                        <p className="text-sm text-foreground bg-muted/40 p-3 rounded-md border border-muted">{item.classificationExplanation}</p>
                     )}
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                     <p className="text-muted-foreground mb-1 flex items-center">Protocol / Type <InfoTooltip text="The integration technology or contract style, such as RFC, IDoc, OData, SOAP, or REST." /></p>
                     <p className="font-medium">{item.interfaceType || 'Unknown'}</p>
                  </div>
                  <div>
                     <p className="text-muted-foreground mb-1 flex items-center">Release Status <InfoTooltip text="Whether the interface contract is released for customer use, requires review, or is restricted for clean-core adoption." /></p>
                     <p className="font-medium">{item.releaseStatus || 'N/A'}</p>
                  </div>
                  <div>
                     <p className="text-muted-foreground mb-1">Source System</p>
                     <p className="font-medium">{item.sourceSystem || 'Unknown'}</p>
                  </div>
                  <div>
                     <p className="text-muted-foreground mb-1">Target System</p>
                     <p className="font-medium">{item.targetSystem || 'Unknown'}</p>
                  </div>
                  <div>
                     <p className="text-muted-foreground mb-1 flex items-center">Direction <InfoTooltip text="Whether data enters SAP, leaves SAP, or moves in both directions." /></p>
                     <p className="font-medium">{item.interfaceDirection || 'N/A'}</p>
                  </div>
                  <div>
                     <p className="text-muted-foreground mb-1 flex items-center">Data Confidence <InfoTooltip text="How strongly the interface category is supported by the available protocol, release-status, usage, and dependency evidence." /></p>
                     <Badge variant="outline" className={item.confidence === 'high' ? 'border-green-500 text-green-600' : 'border-yellow-500 text-yellow-600'}>{item.confidence || 'medium'}</Badge>
                  </div>
               </div>

                {item.successor && (
                   <div>
                      <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Released Successor</h4>
                      <p className="rounded-md border bg-muted/30 p-3 text-sm font-medium">{item.successor}</p>
                   </div>
                )}

                <RecommendationPanel item={item} />

               {mitigation && (
                  <div>
                     <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Mitigation Action</h4>
                     <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 p-3 rounded-md space-y-2 text-sm">
                        <p className="font-medium text-blue-900 dark:text-blue-200">{mitigation.recommendedAction}</p>
                        {mitigation.targetPattern && <p className="text-blue-800 dark:text-blue-300">Target: {mitigation.targetPattern}</p>}
                        {mitigation.steps?.length > 0 && (
                           <ul className="list-disc list-inside pl-4 text-blue-800/80 dark:text-blue-300/80">
                              {mitigation.steps.map((step: string, idx: number) => <li key={idx}>{step}</li>)}
                           </ul>
                        )}
                         {mitigation.validation && (
                           <div className="mt-2 pt-2 border-t border-blue-200/50 dark:border-blue-800/50 text-blue-700 dark:text-blue-400 text-xs">
                               Validation: {mitigation.validation}
                           </div>
                        )}
                     </div>
                  </div>
               )}

               <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Dependencies</h4>
                  <div className="flex flex-wrap gap-1">
                    {item.dependencies?.length > 0
                      ? item.dependencies.map((dependency: string) => <Badge key={dependency} variant="secondary" className="font-normal">{dependency}</Badge>)
                      : <span className="text-sm text-muted-foreground">None identified</span>}
                  </div>
               </div>

               <AiDetail kind="interface" item={item} ctx={ctx} />
               <div>
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2 flex justify-between items-center">
                     Expert Narrative
                  </h4>
                  <div className="relative">
                     <textarea readOnly={!ctx.perms.notes} className="w-full min-h-[120px] p-3 text-sm rounded-md border bg-transparent focus:outline-none focus:ring-1 focus:ring-primary resize-y read-only:opacity-70" placeholder={ctx.perms.notes ? "Add architectural context, planned successor details, or remediation notes..." : "No narrative recorded. Editing notes needs the notes permission."} value={narrative} onChange={e => setNarrative(e.target.value)} />
                  </div>
                  <Button size="sm" variant="secondary" className="mt-2 w-full" disabled={!ctx.perms.notes} onClick={handleSaveNarrative}>Save Narrative</Button>
               </div>

               <div className="p-4 bg-muted/30 border rounded-md space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2"><Edit className="w-4 h-4"/> Classification Override</h4>
                  <Select value={level} onValueChange={setLevel}>
                     <SelectTrigger className="bg-background"><SelectValue placeholder="Select level" /></SelectTrigger>
                     <SelectContent>
                        <SelectItem value="A">Level A (Standard)</SelectItem>
                        <SelectItem value="B">Level B (Developer Ext)</SelectItem>
                        <SelectItem value="C">Level C (Classic/Legacy)</SelectItem>
                        <SelectItem value="D">Level D (Modification)</SelectItem>
                     </SelectContent>
                  </Select>
                  <Input placeholder="Reason for manual override..." value={reason} onChange={e => setReason(e.target.value)} className="bg-background" />
                  <Button size="sm" className="w-full" onClick={() => ctx.handleSaveOverride(item.objectName, level, reason)} disabled={!ctx.perms.classify || !ctx.perms.run || !reason.trim() || level === item.classification}>Apply Override</Button>
               </div>
            </div>
        </ScrollArea>
     </Card>
  );
}

function WaveItemsTable({
  objectIds,
  interfaceIds,
  inventory,
  onSelect,
}: {
  objectIds: string[];
  interfaceIds: string[];
  inventory: any[];
  onSelect: (id: string) => void;
}) {
   const [visibleCount, setVisibleCount] = useState(100);
   const allIds = useMemo(() => new Set([...(objectIds || []), ...(interfaceIds || [])]), [objectIds, interfaceIds]);
   const items = useMemo(() => inventory.filter(item => allIds.has(item.id)), [allIds, inventory]);

   useEffect(() => {
     setVisibleCount(100);
   }, [objectIds, interfaceIds]);

   if (items.length === 0) return <p className="text-sm text-muted-foreground">No specific objects mapped.</p>;

   return (
      <div className="border rounded-md overflow-hidden bg-background">
         <Table>
            <TableHeader className="bg-muted/50">
               <TableRow>
                  <TableHead>Object Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Module</TableHead>
                   <TableHead>Target Solution</TableHead>
                  <TableHead className="text-right">Classification</TableHead>
               </TableRow>
            </TableHeader>
            <TableBody>
                {items.slice(0, visibleCount).map(item => (
                  <TableRow
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open roadmap details for ${item.objectName}`}
                    className="cursor-pointer hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
                    onClick={() => onSelect(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(item.id);
                      }
                    }}
                  >
                     <TableCell className="text-xs"><ObjectNameWithTooltip item={item} /></TableCell>
                     <TableCell className="text-xs">{item.objectType}</TableCell>
                     <TableCell className="text-xs">{item.module}</TableCell>
                      <TableCell className="text-xs">{recommendationLabel(item) || "Not available"}</TableCell>
                     <TableCell className="text-right"><ClassificationBadge level={item.classification} reasonSummary={item.classificationReason?.summary} /></TableCell>
                  </TableRow>
               ))}
            </TableBody>
         </Table>
         {items.length > visibleCount && (
             <div className="p-3 text-center text-xs text-muted-foreground bg-muted/10 border-t space-y-2">
                <p>Showing {visibleCount} of {items.length} items. Select a row for its reasoning and mitigation details.</p>
                <Button size="sm" variant="outline" onClick={() => setVisibleCount((count) => count + 100)}>
                  Load More Affected Items
                </Button>
            </div>
         )}
      </div>
   );
}

function RoadmapTab({ ctx }: { ctx: any }) {
  const { assessment } = ctx;
  const [selectedWaveIndex, setSelectedWaveIndex] = useState<number | null>(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  if (!assessment || !assessment.roadmap || !assessment.roadmap.waves) return <EmptyState ctx={ctx} />;

  const waves = assessment.roadmap.waves || [];

  if (waves.length === 0) return (
     <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-4 text-muted-foreground">
         <Target className="w-12 h-12 opacity-50" />
         <h3 className="text-lg font-medium text-foreground">No Roadmap Generated</h3>
         <p>Run the assessment engine to produce a wave-based mitigation roadmap.</p>
     </div>
  );

  const selectedWave = selectedWaveIndex !== null ? waves[selectedWaveIndex] : null;
  const selectedItem = selectedItemId ? assessment.inventory.find((item: any) => item.id === selectedItemId) : null;

  return (
    <div className="flex h-full gap-4 overflow-hidden">
       {/* Waves List */}
       <div className="w-[380px] shrink-0 border rounded-md bg-background shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 bg-muted/20 border-b">
             <h3 className="font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-primary"/> Mitigation Waves <InfoTooltip text="Ordered groups of related findings that can be addressed together based on risk, usage, dependencies, and clean-core treatment." /></h3>
          </div>
          <ScrollArea className="flex-1">
             <div className="p-3 space-y-3">
                {waves.map((wave: any, idx: number) => (
                   <div
                      key={idx}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open wave ${wave.wave || idx + 1}: ${wave.name || `Phase ${idx + 1}`}`}
                      className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 hover-elevate focus:outline-none focus:ring-2 focus:ring-ring ${selectedWaveIndex === idx ? 'bg-primary/5 border-primary/50 shadow-sm' : 'hover:bg-muted/50 bg-background'}`}
                      onClick={() => {
                        setSelectedWaveIndex(idx);
                        setSelectedItemId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedWaveIndex(idx);
                          setSelectedItemId(null);
                        }
                      }}
                   >
                      <div className="flex items-start justify-between mb-2">
                         <Badge variant="outline" className="bg-background text-primary border-primary/30">Wave {wave.wave || idx + 1}</Badge>
                         <span className="text-xs text-muted-foreground font-medium">{wave.count || (wave.objectIds?.length || 0)} items</span>
                      </div>
                      <h4 className="font-semibold text-sm text-foreground leading-tight">{wave.name || `Phase ${idx + 1}`}</h4>
                      {wave.classificationMix && (
                         <div className="flex items-center gap-2 mt-3 pt-3 border-t text-[11px] font-medium">
                            {wave.classificationMix.A > 0 && <span className="text-green-700 bg-green-100 px-1.5 py-0.5 rounded">{wave.classificationMix.A} A</span>}
                            {wave.classificationMix.B > 0 && <span className="text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">{wave.classificationMix.B} B</span>}
                            {wave.classificationMix.C > 0 && <span className="text-yellow-700 bg-yellow-100 px-1.5 py-0.5 rounded">{wave.classificationMix.C} C</span>}
                            {wave.classificationMix.D > 0 && <span className="text-red-700 bg-red-100 px-1.5 py-0.5 rounded">{wave.classificationMix.D} D</span>}
                         </div>
                      )}
                   </div>
                ))}
             </div>
          </ScrollArea>
       </div>

       {/* Wave Detail */}
        {selectedItem ? (
          selectedItem.interfaceName || selectedItem.dimension === "Integration"
            ? <InterfaceDetailPanel key={selectedItem.id} id={selectedItem.id} ctx={ctx} onClose={() => setSelectedItemId(null)} />
            : <ObjectDetailPanel key={selectedItem.id} id={selectedItem.id} ctx={ctx} onClose={() => setSelectedItemId(null)} />
        ) : selectedWave ? (
          <div className="flex-1 flex flex-col border rounded-md bg-background shadow-sm overflow-hidden">
             <div className="p-6 border-b bg-muted/10">
                <div className="flex items-center gap-3 mb-2">
                   <Badge className="bg-primary/10 text-primary hover:bg-primary/20">Wave {selectedWave.wave || (selectedWaveIndex ?? 0) + 1}</Badge>
                   <h2 className="text-2xl font-bold">{selectedWave.name || "Unnamed Wave"}</h2>
                </div>
                <p className="text-muted-foreground mt-2 text-sm max-w-3xl">{selectedWave.objective || "No primary objective defined for this wave."}</p>
                 {solutionPatternLabels(selectedWave.solutionPatterns).length > 0 && (
                   <div className="mt-3 flex flex-wrap items-center gap-2">
                     <span className="text-xs font-semibold uppercase text-muted-foreground">Target patterns</span>
                     {solutionPatternLabels(selectedWave.solutionPatterns).map((pattern, index) => <Badge key={index} variant="secondary">{pattern}</Badge>)}
                   </div>
                 )}
             </div>
             <ScrollArea className="flex-1">
                <div className="p-6 space-y-8 max-w-4xl">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-3">
                         <h4 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-2">
                            <ListTree className="w-4 h-4"/> Rationale
                         </h4>
                         <p className="text-sm leading-relaxed text-foreground">{selectedWave.rationale || "N/A"}</p>
                      </div>
                      <div className="space-y-3">
                         <h4 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-2">
                            <GitCommit className="w-4 h-4"/> Prerequisites <InfoTooltip text="Actions or decisions that must be complete before this mitigation wave can proceed safely." />
                         </h4>
                         {selectedWave.prerequisites?.length > 0 ? (
                            <ul className="list-disc list-outside ml-4 text-sm space-y-1.5 text-foreground">
                               {selectedWave.prerequisites.map((req: string, i: number) => <li key={i}>{req}</li>)}
                            </ul>
                         ) : <p className="text-sm text-muted-foreground">None identified</p>}
                      </div>
                   </div>

                   <div className="space-y-4">
                      <h4 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-2">
                         <Settings2 className="w-4 h-4"/> Mitigation Steps
                      </h4>
                      {selectedWave.mitigationSteps?.length > 0 ? (
                         <div className="grid gap-3 text-sm bg-muted/30 p-5 rounded-lg border">
                            {selectedWave.mitigationSteps.map((step: string, i: number) => (
                               <div key={i} className="flex gap-4">
                                  <div className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">{i + 1}</div>
                                  <p className="leading-relaxed mt-0.5">{step}</p>
                               </div>
                            ))}
                         </div>
                      ) : <p className="text-sm text-muted-foreground">Action plan not detailed for this wave.</p>}
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t">
                      <div className="space-y-3">
                         <h4 className="text-sm font-semibold uppercase text-green-700 dark:text-green-500 tracking-wider flex items-center gap-2">
                            <Target className="w-4 h-4"/> Expected Outcome
                         </h4>
                         <p className="text-sm leading-relaxed">{selectedWave.expectedOutcome || "N/A"}</p>
                      </div>
                      <div className="space-y-3">
                         <h4 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider flex items-center gap-2">
                            <ShieldAlert className="w-4 h-4"/> Exit Criteria <InfoTooltip text="Observable conditions that must be true before this wave is considered complete." />
                         </h4>
                         {selectedWave.exitCriteria?.length > 0 ? (
                            <ul className="list-disc list-outside ml-4 text-sm space-y-1.5">
                               {selectedWave.exitCriteria.map((crit: string, i: number) => <li key={i}>{crit}</li>)}
                            </ul>
                         ) : <p className="text-sm text-muted-foreground">N/A</p>}
                      </div>
                   </div>

                   {/* Interactive Affected Items List */}
                   {(selectedWave.objectIds?.length > 0 || selectedWave.interfaceIds?.length > 0) && (
                      <div className="space-y-4 pt-4 border-t">
                         <h4 className="text-sm font-semibold uppercase text-muted-foreground tracking-wider">Affected Inventory</h4>
                         <WaveItemsTable
                            objectIds={selectedWave.objectIds || []}
                            interfaceIds={selectedWave.interfaceIds || []}
                            inventory={ctx.assessment.inventory}
                            onSelect={setSelectedItemId}
                         />
                      </div>
                   )}
                </div>
             </ScrollArea>
          </div>
       ) : (
          <div className="flex-1 flex items-center justify-center border rounded-md bg-background text-muted-foreground">
             Select a wave to view details
          </div>
       )}
    </div>
  )
}

function ExportCenterTab({ ctx }: { ctx: any }) {
  const { handleExport, assessment } = ctx;
  if (!assessment) return (
    <div className="max-w-5xl mx-auto space-y-6 h-full overflow-y-auto pr-4 pb-8">
      <EmptyState ctx={ctx} />
      <ApprovedAssessmentsFolder canExport={ctx.perms.export} />
      <CompanyTemplatesSection />
    </div>
  );

  return (
      <div className="max-w-5xl mx-auto space-y-6 h-full overflow-y-auto pr-4 pb-8">
          <div className="mb-6">
             <h2 className="text-2xl font-semibold mb-2">Export Center</h2>
             <p className="text-muted-foreground">Download assessment artifacts for integration, reporting, and management presentations.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
              <ExportCard title="Full JSON Payload" description="Complete deterministic assessment data for API integration." icon={FileJson} disabled={!ctx.perms.export} onClick={() => handleExport('Full JSON')} />
              <ExportCard title="CSV Inventory Details" description="Detailed object listing including scores and computed classification." icon={FileSpreadsheet} disabled={!ctx.perms.export} onClick={() => handleExport('CSV Details')} />
              <ExportCard title="Executive Summary (MD)" description="Markdown summary of key metrics, totals, and overall debt." icon={FileText} disabled={!ctx.perms.export} onClick={() => handleExport('Exec Summary')} />
              
              <ExportCard title="PowerPoint Deck" description="Management presentation of findings and wave roadmap." icon={FileIcon} disabled={!ctx.perms.export} onClick={() => handleExport('PowerPoint')} />
              <ExportCard title="Excel Workbook" description="Multi-sheet workbook with overview and object inventory." icon={FileSpreadsheet} disabled={!ctx.perms.export} onClick={() => handleExport('Excel')} />
              <ExportCard title="PDF Assessment" description="Portable executive scorecard for governance and review." icon={FileText} disabled={!ctx.perms.export} onClick={() => handleExport('PDF')} />
              <ExportCard title="Evidence Pack (JSON)" description="Server-attested normalized evidence sets used for this assessment." icon={Database} disabled={!ctx.perms.export} onClick={() => handleExport('Evidence Pack')} />
          </div>
          <ApprovedAssessmentsFolder canExport={ctx.perms.export} />
          <CompanyTemplatesSection />
      </div>
  )
}

function ExportCard({ title, description, icon: Icon, onClick, disabled }: any) {
  return (
     <Card role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} data-testid={`button-export-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        className={`transition-all border shadow-sm group ${disabled ? "cursor-not-allowed opacity-50" : "hover-elevate cursor-pointer hover:border-primary/30"}`}
        onClick={disabled ? undefined : onClick} onKeyDown={(e: React.KeyboardEvent) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}>
        <CardContent className="p-6 flex flex-col items-center text-center space-y-4">
           <div className="p-4 bg-primary/5 text-primary rounded-2xl group-hover:scale-110 transition-transform duration-300">
              <Icon className="w-8 h-8" />
           </div>
           <div>
              <h4 className="font-semibold text-foreground group-hover:text-primary transition-colors">{title}</h4>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{description}</p>
           </div>
        </CardContent>
     </Card>
  )
}

const loadDashboardCharts = () => import("@/components/dashboard-charts");

const loadEvidenceTab = () => import("@/pages/evidence-tab");
