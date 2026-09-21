import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";

/**
 * The plan — a versioned, editable proposal for how to proceed toward the goal.
 *
 * Three things are kept apart, here and everywhere: the person's **goal** (their words, in
 * `WorkGoal`), the **plan** (named steps, a proposal the person may adopt, skip, rename, reorder
 * or replace), and the **recorded work state** (what actually happened: versions, decisions,
 * receipts, checks). A plan revision is immutable; editing makes a new one. Work state is
 * keyed by the goal and the step's stable id — never by revision — so that renaming, reordering
 * or re-proposing a plan can never assert that work happened.
 *
 * Disposition is what the person decided about the proposal. Execution is what the record
 * says about the work. `skipped` is not `complete`. `complete` needs the step's completion
 * rule to hold in the graph, or the person's explicit confirmation with a note.
 */
export const STEP_KINDS = ["gather", "understand", "compare", "decide", "make", "check", "deliver", "act"] as const;
export const StepKindSchema = z.enum(STEP_KINDS);
export type StepKind = z.infer<typeof StepKindSchema>;

export const STEP_DISPOSITIONS = ["proposed", "adopted", "skipped", "replaced"] as const;
export const StepDispositionSchema = z.enum(STEP_DISPOSITIONS);
export type StepDisposition = z.infer<typeof StepDispositionSchema>;

export const STEP_EXECUTIONS = ["not_started", "in_progress", "waiting", "blocked", "complete", "needs_review"] as const;
export const StepExecutionSchema = z.enum(STEP_EXECUTIONS);
export type StepExecution = z.infer<typeof StepExecutionSchema>;

export const STEP_EXECUTION_WORDS: Record<StepExecution, string> = {
  not_started: "not started",
  in_progress: "in progress",
  waiting: "waiting for you",
  blocked: "blocked",
  complete: "complete",
  needs_review: "needs review",
};

/** What must be true in the graph for a step to be complete. `person_confirms` needs a note. */
export const CompletionRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("form_exists"), role: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("decision_accepted") }).strict(),
  z.object({ kind: z.literal("claim_reviewed") }).strict(),
  z.object({ kind: z.literal("receipt_confirmed") }).strict(),
  z.object({ kind: z.literal("person_confirms") }).strict(),
]);
export type CompletionRule = z.infer<typeof CompletionRuleSchema>;

export const PlanInputSchema = z.object({
  objectId: UuidSchema,
  /** The version the step was planned against; a later version marks the step for review. */
  versionId: UuidSchema.nullable().default(null),
  role: z.string().min(1).max(60),
}).strict();
export type PlanInput = z.infer<typeof PlanInputSchema>;

export const PlanStepSchema = z.object({
  /** Stable across revisions: work state hangs on it. */
  id: z.string().min(1).max(80),
  kind: StepKindSchema,
  purpose: z.string().min(1).max(200),
  inputs: z.array(PlanInputSchema).default([]),
  expectedResult: z.string().max(300).default(""),
  completionRule: CompletionRuleSchema,
  dependsOn: z.array(z.string().min(1)).default([]),
  disposition: StepDispositionSchema.default("proposed"),
}).strict();
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type PlanStepInput = z.input<typeof PlanStepSchema>;

export const WorkPlanSchema = z.object({
  id: UuidSchema,
  goalId: UuidSchema,
  worldId: UuidSchema,
  revision: z.number().int().positive(),
  origin: z.enum(["template", "person"]),
  steps: z.array(PlanStepSchema).max(24),
  createdAt: TimestampSchema,
  supersededBy: UuidSchema.nullable().default(null),
}).strict();
export type WorkPlan = z.infer<typeof WorkPlanSchema>;

export const StepEvidenceSchema = z.object({
  kind: z.enum(["version", "receipt", "source_version", "decision", "note"]),
  id: z.string().min(1),
  at: TimestampSchema,
  by: z.enum(["person", "rule"]),
}).strict();
export type StepEvidence = z.infer<typeof StepEvidenceSchema>;

export const StepWorkSchema = z.object({
  goalId: UuidSchema,
  stepId: z.string().min(1),
  execution: StepExecutionSchema,
  evidence: z.array(StepEvidenceSchema).default([]),
  note: z.string().max(1000).default(""),
  updatedAt: TimestampSchema,
}).strict();
export type StepWork = z.infer<typeof StepWorkSchema>;

export interface PlanProgress {
  total: number;
  complete: number;
  inProgress: number;
  blocked: number;
  needsReview: number;
  skipped: number;
  /** One line for the header: "3 of 6 complete · 1 needs review". Counts, never a percentage. */
  sentence: string;
}

/** Progress over adopted steps. Skipped steps are counted as skipped, never as complete. */
export function planProgress(plan: WorkPlan, work: readonly StepWork[]): PlanProgress {
  const byStep = new Map(work.map((w) => [w.stepId, w]));
  const adopted = plan.steps.filter((s) => s.disposition === "adopted");
  const skipped = plan.steps.filter((s) => s.disposition === "skipped").length;
  const exec = (s: PlanStep) => byStep.get(s.id)?.execution ?? "not_started";
  const complete = adopted.filter((s) => exec(s) === "complete").length;
  const inProgress = adopted.filter((s) => exec(s) === "in_progress" || exec(s) === "waiting").length;
  const blocked = adopted.filter((s) => exec(s) === "blocked").length;
  const needsReview = adopted.filter((s) => exec(s) === "needs_review").length;
  const parts = [`${complete} of ${adopted.length} complete`];
  if (needsReview) parts.push(`${needsReview} need${needsReview === 1 ? "s" : ""} review`);
  if (blocked) parts.push(`${blocked} blocked`);
  if (skipped) parts.push(`${skipped} skipped`);
  return { total: adopted.length, complete, inProgress, blocked, needsReview, skipped, sentence: parts.join(" · ") };
}

/** The step the person is on: the first adopted step in progress, else the first not started. */
export function currentStepOf(plan: WorkPlan, work: readonly StepWork[]): PlanStep | null {
  const byStep = new Map(work.map((w) => [w.stepId, w]));
  const adopted = plan.steps.filter((s) => s.disposition === "adopted");
  const exec = (s: PlanStep) => byStep.get(s.id)?.execution ?? "not_started";
  return adopted.find((s) => exec(s) === "in_progress" || exec(s) === "waiting")
    ?? adopted.find((s) => exec(s) === "needs_review")
    ?? adopted.find((s) => exec(s) === "not_started")
    ?? null;
}
