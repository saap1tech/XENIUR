import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";

/**
 * The bridge between thinking and making.
 *
 * A Decision is an ordinary Object — identity, versions, history, undo — with the part
 * that is particular to being a decision kept here. It exists because the honest answer to
 * *"why is this deliverable like this?"* is never mechanical. Lineage can prove that an
 * STL came out of a mesh; nothing in a graph can prove that a colour was chosen because of
 * paragraph three of a brief. A person asserts that, and XENIUR records who asserted it,
 * against exactly which source version, and when.
 *
 * That distinction runs through the whole model: a Decision references its evidence, and
 * changed evidence makes the Decision *worth reviewing*. It never makes it wrong, and it
 * never rebuilds anything.
 */
export const DECISION_STATES = ["draft", "accepted", "needs_review", "superseded"] as const;
export const DecisionStateSchema = z.enum(DECISION_STATES);
export type DecisionState = z.infer<typeof DecisionStateSchema>;

export const DecisionOptionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  note: z.string().default(""),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

/**
 * How a piece of evidence bears on a decision, as the person characterised it.
 *
 * `informed_by` is the honest default and the most common: this was in front of me and it
 * mattered. Claiming everything "supports" the decision would turn a reading list into a
 * proof.
 */
export const EVIDENCE_RELATIONS = ["supports", "contradicts", "informed_by"] as const;
export const EvidenceRelationSchema = z.enum(EVIDENCE_RELATIONS);
export type EvidenceRelation = z.infer<typeof EvidenceRelationSchema>;

export const DecisionEvidenceSchema = z.object({
  /** The exact stored copy, so the citation resolves to a passage rather than a URL. */
  sourceVersionId: UuidSchema.nullable().default(null),
  atomObjectId: UuidSchema.nullable().default(null),
  /** The atom's version when it was cited — editing a claim afterwards is reviewable. */
  atomVersionId: UuidSchema.nullable().default(null),
  relation: EvidenceRelationSchema.default("informed_by"),
  note: z.string().default(""),
});
export type DecisionEvidence = z.infer<typeof DecisionEvidenceSchema>;

/**
 * What the decision takes for granted, and what would make it worth revisiting.
 *
 * An assumption nobody wrote down is the usual reason a second revision goes wrong: the
 * conditions changed, and the only record of them was in somebody's head.
 */
export const AssumptionSchema = z.object({
  text: z.string().min(1),
  reviewTrigger: z.string().default(""),
  /** A steelman is the one reason this could be wrong, asked for before acceptance. */
  kind: z.enum(["assumption", "steelman"]).default("assumption"),
});
export type Assumption = z.infer<typeof AssumptionSchema>;
/** What a caller writes: `kind` and `reviewTrigger` may be left to their defaults. */
export type AssumptionInput = z.input<typeof AssumptionSchema>;

export const DecisionSchema = z.object({
  objectId: UuidSchema,
  question: z.string().min(1),
  chosenOption: z.string().nullable().default(null),
  rationale: z.string().default(""),
  state: DecisionStateSchema.default("draft"),
  acceptedBy: z.string().nullable().default(null),
  acceptedAt: TimestampSchema.nullable().default(null),
  /** The version of this Decision that was accepted, which is what builds bind to. */
  acceptedVersionId: UuidSchema.nullable().default(null),
  supersedesDecisionId: UuidSchema.nullable().default(null),
  supersedesVersionId: UuidSchema.nullable().default(null),
  /**
   * Whether the person named a reason this could be wrong before accepting. `skipped` is a
   * recorded choice, not agreement; `none` is only ever true of a draft.
   */
  steelman: z.enum(["none", "recorded", "skipped"]).default("none"),
});
export type Decision = z.infer<typeof DecisionSchema>;

/**
 * Raised when a decision would be accepted without the person having been asked for one
 * reason it could be wrong.
 *
 * Not a refusal: an answer, like NotReady. The caller either supplies a steelman or says
 * deliberately that they are skipping it, and either is recorded on the decision.
 */
export class SteelmanRequired extends Error {
  readonly code = "steelman_required" as const;
  constructor(readonly objectId: string) {
    super("before accepting, name one reason this could be wrong — or skip the question deliberately");
    this.name = "SteelmanRequired";
  }
}

export interface DecisionDetail extends Decision {
  options: DecisionOption[];
  evidence: DecisionEvidence[];
  assumptions: Assumption[];
}

/* ---------------------------------------------------------- semantic links */

/**
 * A relationship a person asserted, as distinct from one a machine performed.
 *
 * This is the structural line the product turns on, which is why it is a separate table
 * and not a column on the existing lineage edges:
 *
 *   lineage  (representation_edges) propagates **rebuild** — mechanically produced from
 *   semantic (semantic_links)       propagates **review**  — somebody said it was related
 *
 * A changed mesh invalidates the STL built from it; that is arithmetic. A changed article
 * makes a decision worth looking at again; that is judgement, and rebuilding something
 * because of it would be a category error in the direction of false confidence.
 */
export const SEMANTIC_RELATIONS = [
  "supports", "contradicts", "informed_by", "satisfies", "review_on_change",
] as const;
export const SemanticRelationSchema = z.enum(SEMANTIC_RELATIONS);
export type SemanticRelation = z.infer<typeof SemanticRelationSchema>;

export const SemanticLinkSchema = z.object({
  id: UuidSchema,
  fromObjectId: UuidSchema,
  fromVersionId: UuidSchema.nullable().default(null),
  toObjectId: UuidSchema,
  toVersionId: UuidSchema.nullable().default(null),
  relation: SemanticRelationSchema,
  note: z.string().default(""),
  createdAt: TimestampSchema,
});
export type SemanticLink = z.infer<typeof SemanticLinkSchema>;

/** One reason something needs a person's attention, with the path that produced it. */
export interface ReviewItem {
  objectId: string;
  title: string;
  /** What changed, named. */
  causeObjectId: string;
  causeTitle: string;
  relation: SemanticRelation;
  /** The change, in plain language, generated from the edge that caused it. */
  because: string;
  /** The version cited when the link was made, and what is current now. */
  citedVersionId: string | null;
  currentVersionId: string | null;
}

/**
 * The answer to the question the whole bridge exists for.
 *
 * *Which accepted decisions and which exact source versions influenced this delivery?* —
 * without pretending mechanical causation. Every decision here was accepted by a person,
 * and every source version is a stored copy that can still be read.
 */
export interface InfluenceReport {
  objectId: string;
  releaseId: string | null;
  versionId: string | null;
  decisions: Array<{
    objectId: string;
    question: string;
    chosenOption: string | null;
    /** The version of the decision that was accepted, which is what this was built under. */
    acceptedVersionId: string | null;
    acceptedBy: string | null;
    state: DecisionState;
    /** True when the decision has changed or been flagged since this delivery. */
    changedSince: boolean;
    sourceVersionIds: string[];
    atomObjectIds: string[];
  }>;
  /** Every distinct stored copy behind those decisions. */
  sourceVersionIds: string[];
  /** Said plainly, for a person reading the delivery report. */
  summary: string;
}
