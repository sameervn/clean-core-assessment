import type { AssessmentExplanation, AssessmentExplanationInput } from "@workspace/api-client-react";

export type AcceptedExplanation = AssessmentExplanation & { acceptedAt: string; summaryFingerprint?: string };
export type AiNarratives = Record<string, AcceptedExplanation>;

/** Versioned, collision-free canonical signature of only the summary sent to AI. */
export function summaryFingerprint(summary: AssessmentExplanationInput): string {
  return summary.targetRelease
    ? `v2:${JSON.stringify([summary.kind, summary.classification, summary.recommendation, summary.confidence, summary.targetRelease])}`
    : `v1:${JSON.stringify([summary.kind, summary.classification, summary.recommendation, summary.confidence])}`;
}

export function explanationReviewState(note: AcceptedExplanation, summary: AssessmentExplanationInput) {
  if (!note.summaryFingerprint) return "unknown";
  return note.summaryFingerprint === summaryFingerprint(summary) ? "current" : "needs-review";
}

/** Intentionally excludes identifiers, names, free-form evidence, notes and code. */
export function explanationSummary(kind: "object" | "interface", item: any, targetRelease?: string): AssessmentExplanationInput {
  // Recommendation IDs are deterministic engine outputs, not evidence text.
  const raw = item?.solutionRecommendation?.primary?.id || item?.recommendation?.primary?.id || item?.recommendation?.id || "";
  return {
    kind, classification: item.classification,
    recommendation: typeof raw === "string" ? raw.slice(0, 300) : "",
    confidence: ["low", "medium", "high"].includes(item?.confidence) ? item.confidence : "unknown",
    ...(targetRelease ? { targetRelease } : {}),
  };
}

function subjectKinds(item: any): Array<"object" | "interface"> {
  return item.interfaceName || item.dimension === "Integration" ? ["object", "interface"] : ["object"];
}

export function aiNarrativeRows(notes: AiNarratives, inventory: readonly any[], targetRelease?: string, versions?: Record<string, number>) {
  const subjects = new Map<string, AssessmentExplanationInput>();
  for (const item of inventory) {
    for (const kind of subjectKinds(item)) {
      subjects.set(`${kind}:${item.id}`, explanationSummary(kind, item, targetRelease));
    }
  }
  return Object.entries(notes).map(([subject, note]) => {
    const summary = subjects.get(subject);
    const reviewStatus = summary ? explanationReviewState(note, summary) : "needs-review";
    const reviewReason = !summary
      ? "Subject is missing from the current assessment; review before relying on this explanation."
      : reviewStatus === "unknown"
        ? "No saved summary fingerprint; freshness cannot be verified."
        : reviewStatus === "needs-review"
          ? "The current assessment summary differs from the accepted explanation's summary."
          : "Matches the current assessment summary; this does not validate the AI explanation.";
    return {
      ...note,
      subject, attribution: "AI-generated explanation; explicitly accepted by user; not deterministic assessment",
      reviewStatus, reviewReason,
      sourceStatus: sourceFreshness(note, versions),
    };
  });
}

/** Missing records retain their original notes without assigning a freshness state. */
export function retainedAiExplanations(inventory: any[], notes: AiNarratives) {
  const available = new Set(inventory.flatMap(item => subjectKinds(item).map(kind => `${kind}:${item.id}`)));
  return Object.entries(notes)
    .filter(([subject]) => !available.has(subject))
    .map(([subject, note]) => ({ subject, note }));
}

export function aiNarrativeReportText(note: ReturnType<typeof aiNarrativeRows>[number]) {
  return `${note.subject}\n${note.attribution}\nReview status: ${note.reviewStatus}\n${note.reviewReason}\nSource status: ${note.sourceStatus}\n${note.knowledgeDisclosure ?? "Legacy explanation; no knowledge provenance recorded."}\n${(note.sources ?? []).map(s => `${s.title} · version ${s.version} · ${s.section} · ${s.release} (${s.applicability}) · document ${s.id}`).join("\n")}\n${note.provider} / ${note.model}; generated ${note.generatedAt}; accepted ${note.acceptedAt}\n${note.text}`;
}
export function sourceFreshness(note: AcceptedExplanation, versions?: Record<string, number>) {
  if (!note.sources) return "unknown";
  if (!note.sources.length) return "no-uploaded-sources";
  if (!versions) return "unverified";
  return note.sources.some(s => versions[s.id] !== s.version) ? "stale-source" : "current";
}

/** Only subjects in the current assessment can be compared and opened for review. */
export function aiExplanationReviewQueue(inventory: any[], notes: AiNarratives, targetRelease?: string) {
  return inventory.flatMap(item =>
    subjectKinds(item).flatMap(kind => {
      const subject = `${kind}:${item.id}`;
      const note = notes[subject];
      if (!note) return [];
      const state = explanationReviewState(note, explanationSummary(kind, item, targetRelease));
      return state === "current" ? [] : [{ subject, kind, item, state }];
    }),
  );
}
