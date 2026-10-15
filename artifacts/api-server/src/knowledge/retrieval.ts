import { pool, type PoolClient } from "@workspace/db";
import type { AssessmentExplanationInput, KnowledgeRetrievalDiagnostics } from "@workspace/api-zod";
import { attestEvidenceValue, verifyEvidenceAttestation } from "../evidence-attestation";
import { AiError } from "../assessment-ai";

export type KnowledgeMode = "knowledge-only" | "allow-fallback";
export type Source = { id: string; title: string; version: number; section: string; release: string; applicability: "target-release" | "general" | "other-release" };
export type Excerpt = Source & { text: string };
export type Payload = { summary: AssessmentExplanationInput; mode: KnowledgeMode; references: Excerpt[]; disclosure: string };
export function searchTerms(summary: AssessmentExplanationInput) {
  return [...new Set(summary.recommendation.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !["the", "and", "with", "for", "move", "keep", "object"].includes(t)))].slice(0, 12);
}
export function guidanceDisclosure(references: Excerpt[], mode: KnowledgeMode) {
  const applicable = references.filter(r => r.applicability !== "other-release");
  const sufficient = applicable.reduce((n, r) => n + r.text.length, 0) >= 150;
  const positive = references.some(r => /\b(must|shall|required|always)\b/i.test(r.text));
  const negative = references.some(r => /\b(must not|shall not|never|prohibited|do not)\b/i.test(r.text));
  const conflict = positive && negative && new Set(references.map(r => r.id)).size > 1;
  const disclosure = [
    !references.length ? "No relevant uploaded guidance found." : !sufficient ? "Uploaded guidance is insufficient for this target and topic." : "Relevant uploaded passages found; completeness and applicability require human review.",
    references.some(r => r.applicability === "other-release") ? "Other-release guidance is historical/context only, not authority for this target." : "",
    conflict ? "Potentially conflicting directives found across sources. Do not resolve policy conflicts automatically; compare the excerpts with an expert." : "",
    mode === "allow-fallback" ? "General-model fallback is permitted and must be labeled; it is not live internet research."
      : "Knowledge-base-only: unsupported claims must be identified as gaps. No general-model fallback is permitted.",
  ].filter(Boolean).join(" ");
  return { disclosure, canGenerate: mode === "allow-fallback" || sufficient };
}
export async function retrieve(summary: AssessmentExplanationInput, mode: KnowledgeMode, c: Pick<PoolClient, "query"> = pool) {
  if (!summary.targetRelease) throw new AiError(400, "Target release is required for a new AI preview.");
  const terms = searchTerms(summary);
  const diagnostics: KnowledgeRetrievalDiagnostics = {
    terms, targetRelease: summary.targetRelease, requiredTermMatches: Math.min(2, terms.length),
    candidateLimit: 24, matchingPassages: 0, applicableCharacters: 0, requiredCharacters: 150, candidates: [],
  };
  let references: Excerpt[] = [];
  if (terms.length) {
    // GIN-indexed lexical selection; release alone never qualifies a passage.
    const result = await c.query(`SELECT d.id,d.title,d.version,d.release,c.section,c.text,
      count(*) OVER () AS matching_passages,
      ts_rank_cd(c.search,to_tsquery('english',$1)) AS rank
      FROM cc_knowledge_chunks c JOIN cc_knowledge d ON d.id=c.document_id
      WHERE d.status='ready' AND c.search @@ to_tsquery('english',$1)
      ORDER BY CASE WHEN d.release=$2 THEN 0 WHEN lower(d.release)='general' THEN 1 ELSE 2 END,
      (ts_rank_cd(c.search,to_tsquery('english',$1)) + ts_rank(to_tsvector('english',d.topics::text),to_tsquery('english',$1))) DESC,d.id,c.ordinal LIMIT 24`, [terms.join(" | "), summary.targetRelease]);
    const counts = new Map<string, number>();
    diagnostics.matchingPassages = Number(result.rows[0]?.matching_passages ?? 0);
    for (const row of result.rows) {
      // Require meaningful lexical coverage, not a ubiquitous single-word match.
      const matchedTerms = terms.filter(t => row.text.toLowerCase().includes(t));
      const reason = matchedTerms.length < Math.min(2, terms.length) ? "insufficient-coverage"
        : (counts.get(row.id) ?? 0) >= 2 ? "document-limit"
        : references.length >= 4 ? "excerpt-limit" : "selected";
      diagnostics.candidates.push({ id: row.id, title: row.title, section: row.section, release: row.release, matchedTerms, reason });
      if (reason !== "selected") continue;
      references.push({ id: row.id, title: row.title, version: row.version, release: row.release, section: row.section,
        applicability: row.release === summary.targetRelease ? "target-release" : row.release.toLowerCase() === "general" ? "general" : "other-release", text: row.text });
      counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
    }
  }
  const { disclosure, canGenerate } = guidanceDisclosure(references, mode);
  diagnostics.applicableCharacters = references.filter(r => r.applicability !== "other-release").reduce((n, r) => n + r.text.length, 0);
  const epoch = (await c.query("SELECT revision::text FROM cc_knowledge_epoch WHERE singleton=true")).rows[0]?.revision;
  if (epoch === undefined) throw new AiError(503, "Knowledge index is unavailable; no AI request was sent.");
  return { payload: { summary, mode, references, disclosure } as Payload, epoch, canGenerate, diagnostics };
}
export function consentToken(user: string, payload: Payload, epoch: string, expires = Date.now() + 300_000) {
  return `${expires}.${attestEvidenceValue({ user, payload, epoch, expires })}`;
}
export function validateConsent(token: string, user: string, payload: Payload, epoch: string) {
  const [time, signature] = token.split(".");
  const expires = Number(time);
  if (!/^\d+\.[a-f0-9]{64}$/.test(token) || !Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + 300_000
    || !verifyEvidenceAttestation({ user, payload, epoch, expires }, signature)) {
    throw new AiError(409, "The assessment, library or consent preview changed or expired. Preview again before sending.");
  }
}
