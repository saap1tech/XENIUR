import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";

/**
 * A WorkGoal — what the person is trying to accomplish in a World.
 *
 * An Object is not the reason someone opened XENIUR. The goal is. It is one sentence in the
 * person's own words, a status that names how they are working right now, the Object in the
 * centre, what the work must produce, what is still open, and what they mean to do next.
 *
 * World is the context that survives; Goal is the reason; Focus is what is in the hands;
 * Scene is how XENIUR makes that understandable. The four are never merged.
 */
export const GOAL_STATUSES = ["exploring", "understanding", "making", "reviewing", "ready", "finished"] as const;
export const GoalStatusSchema = z.enum(GOAL_STATUSES);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

/**
 * Statuses are ways of working, not stages. Nothing requires "understanding" before "making";
 * the person moves among them freely and the interface follows.
 */
export const GOAL_STATUS_WORDS: Record<GoalStatus, { label: string; means: string }> = {
  exploring: { label: "exploring", means: "gathering what there is to know" },
  understanding: { label: "understanding", means: "working out what it means" },
  making: { label: "making", means: "producing the thing" },
  reviewing: { label: "reviewing", means: "checking what changed and what holds" },
  ready: { label: "ready", means: "everything needed is in place" },
  finished: { label: "finished", means: "delivered, and recorded as such" },
};

export const NextActionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(200),
  objectId: UuidSchema.nullable().default(null),
  tool: z.string().nullable().default(null),
  /** Where it came from: the person wrote it, or accepted a proposal. Never generated silently. */
  origin: z.enum(["person", "accepted_proposal"]).default("person"),
  doneAt: TimestampSchema.nullable().default(null),
}).strict();
export type NextAction = z.infer<typeof NextActionSchema>;

export const WorkGoalSchema = z.object({
  id: UuidSchema,
  worldId: UuidSchema,
  /** In the person's words, verbatim. */
  outcome: z.string().min(1).max(500),
  status: GoalStatusSchema,
  focusObjectId: UuidSchema.nullable(),
  /** Form roles (e.g. "print.stl") or Object ids the work must produce. */
  requiredOutputs: z.array(z.string().min(1)).default([]),
  /** Question atoms still open. */
  openQuestionIds: z.array(UuidSchema).default([]),
  nextActions: z.array(NextActionSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lastActiveAt: TimestampSchema,
}).strict();
export type WorkGoal = z.infer<typeof WorkGoalSchema>;

/** The compiler's goal kind, when the Situation gives a status and no kind. */
export function goalKindFor(status: GoalStatus): "understand" | "decide" | "create" | "transform" | "validate" | "deliver" | "act" {
  switch (status) {
    case "exploring": return "understand";
    case "understanding": return "understand";
    case "making": return "create";
    case "reviewing": return "validate";
    case "ready": return "deliver";
    case "finished": return "deliver";
  }
}

/** The goal as one line for the shell header: "Choose a jacket finish the client will accept — making". */
export function describeGoal(goal: Pick<WorkGoal, "outcome" | "status">): string {
  return `${goal.outcome} — ${GOAL_STATUS_WORDS[goal.status].label}`;
}

/** What Finish answers: done, or what is missing — in words a person can act on. */
export type FinishResult =
  | { finished: true; goal: WorkGoal }
  | { finished: false; missing: string[] };
