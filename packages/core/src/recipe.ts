import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";
import { ModalitySchema } from "./enums.js";
import { FormRoleSchema } from "./object.js";
import { ToolSchema, type Tool } from "./tools.js";

/**
 * How a step behaves when its inputs change.
 *
 * A boolean here would be wrong: a manual Blender edit and an AI generation are both "not
 * deterministic" and behave nothing alike. One can be re-run for free, one produces
 * something *different* every time and so must never overwrite a choice, and one XENIUR
 * cannot perform at all.
 */
export const REPLAY_POLICIES = ["deterministic", "candidate_generation", "manual"] as const;
export const ReplayPolicySchema = z.enum(REPLAY_POLICIES);
export type ReplayPolicy = z.infer<typeof ReplayPolicySchema>;

/**
 * The contract version a step was authored against. Bumping one marks every step using
 * that tool as needing review rather than silently re-running under changed semantics.
 */
export const CAPABILITY_VERSIONS: Readonly<Record<Tool, string>> = {
  "object.create": "1.0.0", "object.update": "1.0.0", "object.move": "1.0.0",
  "import.file": "1.0.0", "export.package": "1.0.0",
  "image.generate": "1.0.0", "image.transform": "1.0.0",
  "3d.generate": "1.0.0", "3d.process": "1.0.0", "3d.export": "1.0.0",
  "3d.solidify": "1.0.0", "3d.render": "1.0.0", "3d.turntable": "1.0.0",
  "video.generate": "1.0.0", "video.edit": "1.0.0", "video.export": "1.0.0",
  "code.scaffold": "1.0.0", "code.patch": "1.0.0", "code.run": "1.0.0",
  "doc.write": "1.0.0",
  "browser.search": "1.0.0", "browser.open": "1.0.0", "browser.extract": "1.0.0",
  "browser.fill": "1.0.0", "browser.click": "1.0.0", "browser.submit": "1.0.0",
  "export.file": "1.0.0",
};

export const capabilityVersionFor = (tool: Tool): string => CAPABILITY_VERSIONS[tool] ?? "0.0.0";

export const AcceptsSchema = z.object({
  modality: ModalitySchema.optional(),
  formats: z.array(z.string()).optional(),
}).strict();
export type Accepts = z.infer<typeof AcceptsSchema>;

/** Where a step's input comes from: an Object form, or an upstream step's output slot. */
export const RecipeStepInputSchema = z.object({
  slot: z.string().min(1),
  /**
   * Where this input comes from. `decision` binds the accepted brief of a Decision Object,
   * which is what turns "we decided X" into a version-pinned dependency of a built asset
   * rather than a note beside it. Accepting a *different* decision changes the input and
   * the step is genuinely out of date — that is a real rebuild, not a review.
   */
  sourceKind: z.enum(["form", "step", "decision"]),
  /**
   * A form role like "source.primary", "<step key>.<output slot>", or the object id of a
   * Decision.
   */
  sourceRef: z.string().min(1),
  accepts: AcceptsSchema.default({}),
  required: z.boolean().default(true),
}).strict();
export type RecipeStepInput = z.infer<typeof RecipeStepInputSchema>;

export const RecipeStepOutputSchema = z.object({
  slot: z.string().min(1),
  modality: ModalitySchema,
  format: z.string().min(1),
  /** The Object form this slot publishes to, or null for a step that only emits checks. */
  formRole: FormRoleSchema.nullable().default(null),
}).strict();
export type RecipeStepOutput = z.infer<typeof RecipeStepOutputSchema>;

export const RecipeStepSchema = z.object({
  id: UuidSchema,
  recipeId: UuidSchema,
  /** Stable within the recipe; downstream steps reference it. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "a step key is lower_snake_case"),
  tool: ToolSchema,
  capabilityVersion: z.string().min(1),
  args: z.record(z.unknown()).default({}),
  replayPolicy: ReplayPolicySchema,
  inputs: z.array(RecipeStepInputSchema).default([]),
  outputs: z.array(RecipeStepOutputSchema).default([]),
}).strict();
export type RecipeStep = z.infer<typeof RecipeStepSchema>;

export const RecipeSchema = z.object({
  id: UuidSchema,
  objectId: UuidSchema,
  name: z.string().min(1),
  revision: z.number().int().nonnegative(),
  parentRecipeId: UuidSchema.nullable().default(null),
  enabled: z.boolean().default(true),
  createdAt: TimestampSchema,
  steps: z.array(RecipeStepSchema).default([]),
});
export type Recipe = z.infer<typeof RecipeSchema>;

/** What a step wants written, before it has an id. */
export const RecipeStepDraftSchema = RecipeStepSchema
  .omit({ id: true, recipeId: true, capabilityVersion: true })
  .extend({ capabilityVersion: z.string().min(1).optional() });
export type RecipeStepDraft = z.infer<typeof RecipeStepDraftSchema>;

/* ------------------------------------------------------------- staleness */

/**
 * Why a step is not current. Three distinct states rather than one flag, because they
 * call for completely different responses.
 */
export const STEP_STATES = [
  "fresh",        // built, and its fingerprint still matches
  "never_built",  // no output has been produced yet
  "stale",        // inputs, args or capability version changed — rebuildable
  "blocked",      // an upstream manual step is pending; anything built here uses old input
  "superseded",   // a generated candidate is waiting for a person to accept or reject
  "unresolvable", // a required input does not exist at the current version
] as const;
export const StepStateSchema = z.enum(STEP_STATES);
export type StepState = z.infer<typeof StepStateSchema>;

export interface StepStatus {
  stepKey: string;
  tool: Tool;
  replayPolicy: ReplayPolicy;
  state: StepState;
  /** Plain-language cause, shown verbatim in the rebuild preview. */
  reason: string;
  fingerprint: string | null;
  builtFingerprint: string | null;
  formRoles: string[];
}

/** The three honest buckets a rebuild preview shows. */
export interface RebuildPlan {
  objectId: string;
  recipeId: string | null;
  /** Deterministic and out of date: re-runs automatically, free, same bytes. */
  willRebuild: StepStatus[];
  /** Generative: produces a candidate beside the current form. Never overwrites. */
  canRegenerate: StepStatus[];
  /** A human step XENIUR cannot perform. It can only be requested. */
  waitingOnYou: StepStatus[];
  /** Downstream of something pending — buildable, but onto old input. */
  blocked: StepStatus[];
  fresh: StepStatus[];
  estimatedUsd: number;
}

export class RecipeInvalid extends Error {
  readonly code = "recipe_invalid" as const;
  constructor(readonly problems: string[]) {
    super(`this recipe cannot be saved:\n  - ${problems.join("\n  - ")}`);
    this.name = "RecipeInvalid";
  }
}
