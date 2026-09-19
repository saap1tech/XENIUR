import { z } from "zod";
import { ConstraintRecordSchema, SemanticTraitsSchema, UuidSchema } from "@xeniur/core";
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
export const GoalSchema = z.object({
  kind: z.enum(GOAL_KINDS),
  description: z.string().min(1).max(500).optional(),
  deliverableId: UuidSchema.optional(),
}).strict();
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

export const SituationSchema = z.object({
  worldId: UuidSchema,
  title: z.string().min(1),
  goal: GoalSchema,
  scope: SituationScopeSchema,
  meaning: MeaningSchema,
  interaction: InteractionSchema,
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
