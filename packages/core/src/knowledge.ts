import { z } from "zod";
import { UuidSchema } from "./ids.js";
import { StanceSchema, SupportStatusSchema } from "./sensemaking.js";

/**
 * What a model may propose, and the shape it must take.
 *
 * A research answer does not arrive as prose. It arrives as *proposed Living Objects* — claims
 * and steps — each citing the exact words in a stored passage it rests on. Everything here
 * enters the graph as a candidate, like captured text does, and a person accepts, rejects or
 * reorders by touch. Strict schemas throughout: a field the model invents is a rejection.
 */
export const ProposedCitationInputSchema = z.object({
  sourceVersionId: UuidSchema,
  /** The exact words in the stored copy. Must be found there, or the citation is dropped. */
  exact: z.string().min(8).max(600),
  /** The model's opinion of whether the passage bears on the claim. A proposal, never a review. */
  bears: SupportStatusSchema.default("unresolved"),
}).strict();

export const ProposedClaimSchema = z.object({
  text: z.string().min(1).max(400),
  stance: StanceSchema.default("assertion"),
  citations: z.array(ProposedCitationInputSchema).max(6).default([]),
}).strict();

export const ProposedStepSchema = z.object({
  order: z.number().int().positive(),
  text: z.string().min(1).max(300),
  /** Which claims this step rests on, by index into `claims`. */
  restsOn: z.array(z.number().int().nonnegative()).max(6).default([]),
}).strict();

/**
 * The compression bound applies to *presentation*. The record may hold more than seven of
 * anything; the primary Scene shows at most seven and the rest sit one layer down. A plan too
 * long for the record is a plan that is wrong, not one that is too detailed.
 */
export const KnowledgeProposalSchema = z.object({
  worldId: UuidSchema,
  headline: z.string().min(1).max(200),
  claims: z.array(ProposedClaimSchema).min(1).max(24),
  steps: z.array(ProposedStepSchema).max(24).default([]),
  /** What the model was not sure about — disclosed rather than smoothed over. */
  uncertain: z.array(z.string().min(1).max(300)).max(12).default([]),
}).strict();
export type KnowledgeProposal = z.infer<typeof KnowledgeProposalSchema>;

/** How many items the primary Scene shows before the rest go behind "Show supporting detail". */
export const PRIMARY_ITEMS = 7;
export const MINIMUM_ITEMS = 3;

/**
 * Splits a list into what the primary Scene shows and what sits one layer down.
 *
 * Nothing is removed. Presentation is bounded; the record is not.
 */
export function compressForScene<T>(items: readonly T[], max = PRIMARY_ITEMS): { primary: T[]; supporting: T[] } {
  return { primary: items.slice(0, max), supporting: items.slice(max) };
}
