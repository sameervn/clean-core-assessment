import { emptyWorkspace, type StoredWorkspace } from "./workspace-store";

/** Demo identity comes from persisted evidence metadata, never file names or object names. */
export function isDemoEvidence(evidence: { metadata?: Record<string, unknown> }): boolean {
  return evidence.metadata?.demo === true;
}

/** Keep uploaded evidence intact, including its original server attestation. */
export function withoutDemoEvidence<T extends { metadata?: Record<string, unknown> }>(evidence: T[]): T[] {
  return evidence.filter(item => !isDemoEvidence(item));
}

export function unloadDemoWorkspace(workspace: StoredWorkspace): StoredWorkspace {
  if (!workspace.evidence.some(isDemoEvidence)) return workspace;
  return {
    ...emptyWorkspace(),
    system: workspace.system,
    targetRelease: workspace.targetRelease,
    weighted: workspace.weighted,
    evidence: withoutDemoEvidence(workspace.evidence),
  };
}
