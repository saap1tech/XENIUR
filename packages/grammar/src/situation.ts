import { z } from "zod";
import { ConstraintRecordSchema, GoalStatusSchema, SemanticTraitsSchema, UuidSchema, goalKindFor, type GoalStatus } from "@xeniur/core";
import { InteractionSchema, MeaningSchema, TaskStateSchema } from "./dimensions.js";
import { DisclosureLayerSchema } from "./density.js";

export const FocusSchema = z.object({
  kind: z.enum(["object", "decision", "constraints"]),
  id: UuidSchema,
  label: z.string().min(1),
}).strict();
export type Focus = z.infer<typeof FocusSchema>;

export const GOAL_KINDS = [
  "understand", "decide", "create", "transform", "validate", "deliver", "act",
] as const;

/**
 * The goal the Scene is compiled for.
 *
 * `kind` is what the compiler acts on. When a Situation carries a WorkGoal — the person's
 * `outcome` and `status` — the kind is derived from the status and need not be given: the
 * status is how the person is working, the kind is what the compiler does about it.
 */
export const GoalSchema = z.preprocess((raw) => {
  if (raw && typeof raw === "object" && !("kind" in raw) && "status" in raw) {
    return { ...raw, kind: goalKindFor((raw as { status: GoalStatus }).status) };
  }
  return raw;
}, z.object({
  kind: z.enum(GOAL_KINDS),
  description: z.string().min(1).max(500).optional(),
  deliverableId: UuidSchema.optional(),
  /* From a WorkGoal, when the World has one. */
  id: UuidSchema.optional(),
  outcome: z.string().min(1).max(500).optional(),
  status: GoalStatusSchema.optional(),
  requiredOutputs: z.array(z.string().min(1)).default([]),
  openQuestions: z.array(UuidSchema).default([]),
  nextActions: z.array(z.object({ id: z.string().min(1), text: z.string().min(1), objectId: UuidSchema.nullable().default(null) }).strict()).default([]),
}).strict());
export type Goal = z.infer<typeof GoalSchema>;

export const SituationScopeSchema = z.object({
  worldId: UuidSchema,
  objectIds: z.array(UuidSchema).max(256).optional(),
  taskId: UuidSchema.optional(),
  externalContextAllowed: z.boolean(),
}).strict();
export type SituationScope = z.infer<typeof SituationScopeSchema>;

export const SituationObjectSchema = z.object({
  id: UuidSchema,
  title: z.string().min(1),
  semanticType: z.string().min(1),
  traits: SemanticTraitsSchema.default([]),
  meaning: MeaningSchema.optional(),
  states: z.array(TaskStateSchema).default([]),
  formRoles: z.array(z.string()).default([]),
  x: z.number().optional(), y: z.number().optional(),
  value: z.unknown().optional(),
}).strict();
export type SituationObject = z.infer<typeof SituationObjectSchema>;

export const SituationChangeSchema = z.object({
  objectId: UuidSchema,
  kind: z.enum(["rebuild", "review"]),
  subject: z.string().min(1),
  because: z.string().min(1),
}).strict();
export type SituationChange = z.infer<typeof SituationChangeSchema>;

export const SituationChoiceSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), detail: z.string().default(""),
  selected: z.boolean().default(false), excluded: z.boolean().default(false),
  cost: z.number().nonnegative().nullable().default(null),
}).strict();

/** Counts of the five knowledge states, from `standingFor`. Refines which question is next. */
export const KnowledgeCountsSchema = z.object({
  known: z.number().int().nonnegative(), proposed: z.number().int().nonnegative(), disputed: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(), chosenDespite: z.number().int().nonnegative(),
}).strict();

export const SituationSchema = z.object({
  worldId: UuidSchema,
  title: z.string().min(1),
  goal: GoalSchema,
  scope: SituationScopeSchema,
  /** Optional now: when absent, the need chosen from the goal supplies them. A zone the person clicked sets them. */
  meaning: MeaningSchema.optional(),
  interaction: InteractionSchema.optional(),
  knowledge: KnowledgeCountsSchema.optional(),
  /** A host may name the question directly; otherwise `needFor` chooses it. */
  need: z.enum(["know_more", "understand_conflict", "decide", "make", "see_change", "finish"]).optional(),
  taskStates: z.array(TaskStateSchema).default([]),
  focus: FocusSchema,
  objects: z.array(SituationObjectSchema).default([]),
  changes: z.array(SituationChangeSchema).default([]),
  capabilities: z.array(z.string().min(1)).default([]),
  constraints: z.array(ConstraintRecordSchema).default([]),
  choices: z.array(SituationChoiceSchema).default([]),
  layer: DisclosureLayerSchema.default(2),
}).strict().superRefine((situation, context) => {
  if (situation.scope.worldId !== situation.worldId) context.addIssue({
    code: "custom", path: ["scope", "worldId"], message: "scope must name the Situation world",
  });
  if (situation.scope.objectIds && !situation.scope.objectIds.includes(situation.focus.id)) {
    context.addIssue({ code: "custom", path: ["scope", "objectIds"], message: "scope must include the focus" });
  }
  if (situation.goal.deliverableId && !situation.objects.some((object) => object.id === situation.goal.deliverableId)) {
    context.addIssue({ code: "custom", path: ["goal", "deliverableId"], message: "deliverable must be present in the Situation" });
  }
  if (situation.goal.deliverableId && situation.scope.objectIds &&
      !situation.scope.objectIds.includes(situation.goal.deliverableId)) {
    context.addIssue({ code: "custom", path: ["scope", "objectIds"], message: "scope must include the goal deliverable" });
  }
  const focusExists = situation.focus.kind === "constraints"
    ? situation.constraints.some((constraint) => constraint.objectId === situation.focus.id)
    : situation.objects.some((object) => object.id === situation.focus.id);
  if (!focusExists) context.addIssue({
    code: "custom", path: ["focus", "id"], message: "focus must name an object present in the situation",
  });
});
export type Situation = z.infer<typeof SituationSchema>;
