import { z } from "zod";

export const sizes = ["XS", "S", "M", "L", "XL", "XXL"] as const;
export function complexitySize(value: unknown): typeof sizes[number] | null {
  if (typeof value === "string" && sizes.includes(value.trim().toUpperCase() as any)) return value.trim().toUpperCase() as typeof sizes[number];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value <= 5 ? "XS" : value <= 10 ? "S" : value <= 20 ? "M" : value <= 30 ? "L" : value <= 40 ? "XL" : "XXL";
}
const text = z.string().max(20_000);
export const contentSchema = z.object({
  classification: z.enum(["A", "B", "C", "D"]).nullable(),
  classificationExplanation: text,
  disposition: z.enum(["keep", "retire", "refactor", "redesign", "move-to-btp"]).nullable(),
  narrative: text,
  complexitySize: z.enum(sizes).nullable(),
  recommendation: text,
  recommendationRationale: text,
  prerequisites: text,
  cautions: text,
  alternatives: text,
  validationQuestions: text,
  mitigation: text,
  mitigationValidation: text,
}).strict();
export type Content = z.infer<typeof contentSchema>;
export const sourceSchema = z.object({
  repository: z.string().max(200),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  path: z.string().max(1000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  blob: z.string().max(100),
  objectPath: z.string().max(2000),
}).strict();
export type State = "Draft" | "Submitted" | "Approved" | "Changes requested";
export function transition(state: State, action: string, actor: string, submitter: string | null, reviewer: string | null) {
  if (action === "submit") {
    if (state !== "Draft" && state !== "Changes requested") throw new Error("Only a draft or changes-requested revision can be submitted.");
    if (!reviewer || reviewer === actor) throw new Error("Assign a separate reviewer before submitting.");
    return "Submitted";
  }
  if (state !== "Submitted") throw new Error("Only a submitted revision can be reviewed.");
  if (reviewer !== actor || submitter === actor) throw new Error("Only the assigned independent reviewer can decide.");
  if (action === "approve") return "Approved";
  if (action === "request-changes") return "Changes requested";
  throw new Error("Unknown review action.");
}
