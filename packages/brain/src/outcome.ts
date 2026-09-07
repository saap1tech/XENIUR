import { z } from "zod";
import { ActionPlanSchema, ToolSchema, UuidSchema } from "@xeniur/core";

/**
 * What the Brain is allowed to come back with — three answers, not one.
 *
 * A router that can only return a plan will always return a plan, including for a request
 * it did not understand and for one XENIUR cannot do. Making "I need to know which one"
 * and "XENIUR cannot do that" first-class results is what stops a confident guess being
 * the only available shape of reply.
 *
 * None of these executes anything. `executable` is a *proposal*: the Permission Broker
 * still decides, and the model has no say in that. It cannot raise its own permission,
 * approve itself, or mark something reversible that is not.
 */
export const ExecutableSchema = z.object({
  kind: z.literal("executable"),
  plan: ActionPlanSchema,
  /** One sentence, in the person's terms, for the preview card. */
  why: z.string().min(1).max(300),
}).strict();

export const ClarificationSchema = z.object({
  kind: z.literal("clarification"),
  question: z.string().min(1).max(300),
  /** Concrete choices, never free text: each one names something that exists. */
  options: z.array(z.object({
    label: z.string().min(1).max(120),
    objectId: UuidSchema.nullable().default(null),
  })).min(2).max(6),
}).strict();

export const UnsupportedSchema = z.object({
  kind: z.literal("unsupported"),
  reason: z.string().min(1).max(300),
  /** The closest thing XENIUR *can* do, or null rather than an invention. */
  nearest: ToolSchema.nullable().default(null),
}).strict();

export const BrainOutcomeSchema = z.discriminatedUnion("kind", [
  ExecutableSchema, ClarificationSchema, UnsupportedSchema,
]);
export type BrainOutcome = z.infer<typeof BrainOutcomeSchema>;
export type Executable = z.infer<typeof ExecutableSchema>;

/**
 * What the Brain is asked to do, and nothing else.
 *
 * Deliberately narrow, and every one of them improves navigation of capabilities XENIUR
 * already has rather than adding a new one. Nothing here generates media, spends money on
 * a person's behalf, or decides whether something is safe.
 */
export const BRAIN_INTENTS = [
  "explain_check",        // what does this measurement mean, and what does it not
  "find_evidence",        // which of the things I captured bear on this
  "draft_decision",       // a decision draft: question, options, what to cite
  "choose_transform",     // which local, deterministic tool does what was asked
  "describe_impact",      // what changed, and what that means for the next delivery
  "prepare_delivery",     // assemble the preview of what would go out
] as const;
export const BrainIntentSchema = z.enum(BRAIN_INTENTS);
export type BrainIntent = z.infer<typeof BrainIntentSchema>;
