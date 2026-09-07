import { z } from "zod";
import { UuidSchema } from "./ids.js";

/**
 * What a piece of thinking is made of.
 *
 * The classification is derived, never declared: it is a property of a lineage's *roots*.
 * Deterministic transforms are transparent — cropping a photograph you took keeps it
 * yours — so walking back to where a chain actually started, and asking what those things
 * were, is the whole computation. No new bookkeeping, and nothing for anyone to fill in
 * incorrectly.
 */
/**
 * Where a piece of material came from — and only that.
 *
 * There is deliberately no "verified fact" kind. A passing `image.dimensions` check makes
 * a file technically valid, not factually true, and no validator XENIUR runs establishes a
 * claim about the world. Evidence for a claim belongs to a Decision, which cites a source
 * passage; conflating the two let a correctly-sized PNG be labelled verified.
 */
export const INGREDIENT_KINDS = [
  "your_observation",     // provenance: human — your note, sketch, photo, dataset, measurement
  "external_human",       // provenance: imported, with a recorded source — an article, paper, talk
  "previous_object",      // something already released, in this World or another
  "ai_suggested",         // provenance: generated or mock
  "unattributed",         // origin not recorded — honest about not knowing
] as const;
export const IngredientKindSchema = z.enum(INGREDIENT_KINDS);
export type IngredientKind = z.infer<typeof IngredientKindSchema>;

/** The kinds that represent a person having thought something, rather than a model. */
export const HUMAN_KINDS: readonly IngredientKind[] = [
  "your_observation", "external_human",
];

export const IngredientSchema = z.object({
  representationId: UuidSchema,
  kind: IngredientKindSchema,
  /** How it is described in the ingredient panel. */
  label: z.string(),
  objectId: UuidSchema,
  formRole: z.string().nullable().default(null),
  sourceId: UuidSchema.nullable().default(null),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export interface IngredientSummary {
  objectId: string;
  ingredients: Ingredient[];
  counts: Record<IngredientKind, number>;
  /** True when at least one root is a person's thinking rather than a model's output. */
  humanSignalPresent: boolean;
  /** Root ids, used to measure overlap with previously produced work. */
  rootIds: string[];
  /**
   * Generative operations found anywhere in the ancestry, not only at its roots.
   *
   * Classifying roots alone made a model applied to your own photograph invisible: the
   * root stayed human and nothing recorded that a model had touched the result. Whose
   * material this is and who performed each step are different questions.
   */
  modelTouchedSteps: number;
  modelTouchedRepresentationIds: string[];
}

export const emptySummary = (objectId: string): IngredientSummary => ({
  objectId, ingredients: [],
  counts: {
    your_observation: 0, external_human: 0,
    previous_object: 0, ai_suggested: 0, unattributed: 0,
  },
  humanSignalPresent: false, rootIds: [],
  modelTouchedSteps: 0, modelTouchedRepresentationIds: [],
});

/**
 * How the ingredient panel describes a composition in one line.
 *
 * Counts, never a percentage. "62% human signal" would imply a measurement nobody
 * performed; "4 of your observations, 2 external sources, 9 AI-suggested" is simply what
 * is there, and the person can judge it themselves.
 */
export function describeIngredients(summary: IngredientSummary): string {
  const parts: Array<[IngredientKind, string]> = [
    ["your_observation", "of your observations"],
    ["external_human", "external sources"],
    ["previous_object", "previous XENIUR objects"],
    ["ai_suggested", "AI-suggested"],
    ["unattributed", "of unknown origin"],
  ];
  const said = parts
    .filter(([kind]) => summary.counts[kind] > 0)
    .map(([kind, label]) => `${summary.counts[kind]} ${label}`);
  return said.length === 0 ? "nothing yet" : said.join(", ");
}

/**
 * Repetition, measured on root identity.
 *
 * Structural overlap is checkable. Whether prose "recombines familiar patterns" is not,
 * and XENIUR does not claim to know — so this compares which ingredients two pieces of
 * work were built from, and says nothing about what they mean.
 */
export function rootOverlap(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((id) => setB.has(id)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}


export const ORIGIN_STATEMENTS = [
  "all_roots_generated", "origin_unknown", "personal_observations",
  "external_sources", "model_applied",
] as const;
export type OriginStatementKind = (typeof ORIGIN_STATEMENTS)[number];

/**
 * One precise, checkable thing about where this came from.
 *
 * Replaces a single "Low Human Signal" flag that fired whenever no human root was found
 * and then announced that nothing came from outside a model — which is false for material
 * whose origin was simply never recorded. Unknown is not the same as generated, and saying
 * so was the flag overclaiming in exactly the way the feature exists to prevent.
 */
export interface OriginStatement {
  kind: OriginStatementKind;
  /** The words shown to the person, verbatim. */
  text: string;
  count: number;
  /** Inspectable: which representations this statement is about. */
  representationIds: string[];
}

/** What XENIUR is about to think with. Described, never scored. */
export interface DnaReport {
  summary: IngredientSummary;
  /** Precise statements, each with a path you can follow. */
  statements: OriginStatement[];
  /** Structural overlap with earlier work here. Reported, never disapproved of. */
  highestOverlap: number;
  /** One line describing the composition, in counts. */
  composition: string;
  /**
   * Offered only when nothing here came from a person — and phrased as an invitation.
   * Null whenever any human material is present, including material of unknown origin
   * that a person may well have made.
   */
  invitation: string | null;
}
