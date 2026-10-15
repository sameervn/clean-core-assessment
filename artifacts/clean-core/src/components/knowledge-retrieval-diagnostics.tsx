import type { KnowledgeRetrievalDiagnostics as Diagnostics } from "@workspace/api-client-react";

const reasons = {
  selected: "Included in preview",
  "insufficient-coverage": "Excluded: not enough topic terms in passage text",
  "document-limit": "Excluded: two-passage limit for this document",
  "excerpt-limit": "Excluded: four-passage preview limit",
};

export function KnowledgeRetrievalDiagnostics({ diagnostics: d }: { diagnostics: Diagnostics }) {
  return <details className="rounded border p-3">
    <summary className="cursor-pointer font-medium">Why uploaded guidance was insufficient — library manager diagnostics</summary>
    <div className="mt-3 space-y-3">
      <p>Read-only local search details. Not sent to the AI provider. No live browsing, rule changes or consent changes.</p>
      <p><strong>Solution topic terms:</strong> {d.terms.join(", ") || "None — the recommendation produced no searchable terms."}</p>
      <p>Terms come from the recommendation, not the release. At least {d.requiredTermMatches} distinct terms must occur in each passage’s text.</p>
      <p><strong>Release ordering:</strong> {d.targetRelease} first → General → other releases. Within each group, passage relevance plus topic-tag relevance determines order. Tags can improve ranking but cannot qualify a passage without a text match.</p>
      <p><strong>Candidate coverage:</strong> {d.matchingPassages} ready passages matched the lexical search; the first {d.candidateLimit} are inspected. {d.candidates.length} inspected in this preview.
        {" "}{Math.max(0, d.matchingPassages - d.candidates.length)} matches fall outside the candidate window.</p>
      <p><strong>Applicable text:</strong> {d.applicableCharacters} / {d.requiredCharacters} required characters. Only included target-release and General passages count; other releases provide historical context only.</p>
      <p>Documents that are not ready and passages with no lexical match are excluded before this list. Search uses English stemming; the coverage check then looks for the original terms in passage text, so a stemmed match can still fail coverage.</p>
      {d.candidates.length === 0 ? <p>No candidates to inspect.</p> : <ol className="max-h-80 space-y-2 overflow-auto">
        {d.candidates.map((c, i) => <li key={`${c.id}-${i}`} className="rounded bg-muted p-2">
          <strong>{i + 1}. {c.title}</strong> · {c.section} · {c.release}
          <p>Coverage: {c.matchedTerms.length} / {d.terms.length} terms ({c.matchedTerms.join(", ") || "none"}). {reasons[c.reason]}.</p>
          {c.reason === "selected" && c.release !== d.targetRelease && c.release.toLowerCase() !== "general" && <p>Not counted toward sufficiency: other release.</p>}
        </li>)}
      </ol>}
      <p>In the Knowledge Library, review document readiness, release labels, topic tags and extracted content. Add substantive, relevant guidance for this solution and target release, then refresh the preview. Do not add terms merely to meet the threshold; this check does not establish completeness or authority.</p>
    </div>
  </details>;
}
