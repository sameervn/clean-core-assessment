const RULE_EXPLANATIONS: Record<string, string> = {
  "REC-RETIRE-ZERO-USAGE": "The supplied usage evidence records no executions, so controlled retirement is suggested rather than rebuilding the object. Confirm seasonal usage, dependencies, and process-owner approval before removing it.",
  "REC-INTEGRATION-CONTRACT": "The evidence identifies an interface or integration-related signal. A released API or event-based integration pattern is suggested to separate system-to-system communication from custom core logic. Confirm whether Integration Suite is needed; an existing supported contract may be retained.",
  "REC-STANDARD-CLEAN": "The assessment identifies a Level A object with a standard-functionality signal. Retaining standard functionality is suggested to avoid an unnecessary custom extension.",
  "REC-KEY-USER": "The assessment identifies a Level A object or a key-user extensibility signal. Key-user extensibility is suggested as a candidate for supported in-app changes. Confirm that the required behavior fits the available extension points.",
  "REC-RELEASED-BADI": "The evidence identifies a BAdI or extension point together with a successor or release-related signal. Released developer extensibility is suggested to implement the change through an extension contract rather than a core modification. A successor name alone does not confirm release status.",
  "REC-BTP-CAP-BOUNDARY": "The evidence contains BTP, CAP, or side-by-side extension signals. CAP on SAP BTP is suggested to keep custom application logic separate from the S/4HANA core and connect through released contracts. Confirm the required transactional boundary and runtime.",
  "REC-RAP-ABAP-CLOUD": "The evidence contains ABAP Cloud/RAP signals, or identifies a Level B class, CDS definition, or program. RAP is suggested as a candidate for ABAP-based business services using released contracts. Object type alone does not establish suitability; confirm the business-object behavior and supported ABAP Cloud environment.",
  "REC-RELEASED-DEVELOPER": "The assessment identifies a Level B/C object or a candidate successor. Released developer extensibility is suggested to retain or replace custom behavior through a supported extension contract. Verify the specific API or extension point for the target release.",
  "REC-REDESIGN-SIDE-BY-SIDE": "The object requires redesign and the current evidence did not select a more specific extension pattern. CAP on SAP BTP is suggested as a candidate to move custom logic outside the core, not as a confirmed architecture choice. Compare it with RAP after validating process, dependencies, and released contracts.",
};

export function solutionExplanation(recommendation: {
  trace?: { rule?: string };
  rationale?: unknown;
}): string {
  const rule = recommendation.trace?.rule;
  if (rule && RULE_EXPLANATIONS[rule]) return RULE_EXPLANATIONS[rule];
  if (typeof recommendation.rationale === "string" && recommendation.rationale.trim()) return recommendation.rationale;
  if (Array.isArray(recommendation.rationale)) {
    const text = recommendation.rationale.filter((entry): entry is string => typeof entry === "string").join(" ");
    if (text) return text;
  }
  return "This saved assessment does not include a solution-selection explanation. Run the assessment again to obtain evidence-based reasoning.";
}

export function recommendationConfidenceExplanation(confidence: unknown): string {
  switch (confidence) {
    case "high":
      return "The assessment has populated process, interface, usage, release-status, and dependency evidence, with an affirmative release signal and no flagged release conflict. This supports the suggestion but does not prove business fit or replace architecture approval.";
    case "medium":
      return "The suggestion has partial evidence support. One or two evidence gaps or an unconfirmed release status reduce confidence. Resolve the validation questions below before choosing the solution.";
    case "low":
      return "Several evidence gaps or release-status uncertainty limit support for this suggestion. Treat it as a candidate for review, not a confirmed solution, and resolve the validation questions below.";
    default:
      return "A recommendation confidence level was not recorded. Run the assessment again to evaluate the available evidence; no confidence level has been assumed.";
  }
}