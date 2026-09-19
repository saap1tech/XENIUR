import { z } from "zod";
import type { SceneComponentName } from "@xeniur/core";
import type { SemanticTrait } from "@xeniur/core";

export const MEANINGS = [
  "where", "when", "who", "cost", "quantity", "priority", "sequence", "relationship",
] as const;
export const MeaningSchema = z.enum(MEANINGS);
export type Meaning = z.infer<typeof MeaningSchema>;

export const TASK_STATES = ["selected", "missing", "changed", "ready", "blocked", "conflict"] as const;
export const TaskStateSchema = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const INTERACTIONS = ["choose", "compare", "adjust", "connect", "review", "commit"] as const;
export const InteractionSchema = z.enum(INTERACTIONS);
export type Interaction = z.infer<typeof InteractionSchema>;

export interface VisualState {
  opacity: number;
  pulse: boolean;
  marker: "none" | "missing" | "rebuild" | "review" | "conflict";
  blocked: boolean;
  selected: boolean;
}

const generic = (meaning: Meaning, interaction: Interaction): SceneComponentName[] => {
  if (interaction === "compare") return ["CompareForms"];
  if (interaction === "commit") return ["ReviewSheet"];
  if (interaction === "connect") return ["SpatialCanvas", "AffordanceRing"];
  if (interaction === "choose") return ["ChoiceCards"];
  if (interaction === "adjust") return meaning === "quantity" ? ["Stepper"] : ["ConstraintStrip"];
  return ["EvidenceMeter"];
};

/** Closed, total meaning x interaction table. */
export const PRIMITIVE_TABLE: Readonly<Record<Meaning, Readonly<Record<Interaction, readonly SceneComponentName[]>>>> =
  Object.fromEntries(MEANINGS.map((meaning) => [meaning, Object.fromEntries(INTERACTIONS.map((interaction) => {
    let components = generic(meaning, interaction);
    if (meaning === "where") components = interaction === "choose"
      ? ["SchematicMap", "ChoiceCards"] : ["SpatialCanvas"];
    if (meaning === "when" && interaction === "adjust") components = ["Calendar"];
    if ((meaning === "when" || meaning === "sequence") && interaction === "connect") components = ["Timeline"];
    if (meaning === "who" && interaction === "adjust") components = ["PeopleChips"];
    if (meaning === "cost" && interaction === "adjust") components = ["RangeMeter"];
    if (meaning === "priority" && interaction === "adjust") components = ["PriorityBalance"];
    if (meaning === "quantity" && interaction === "adjust") components = ["Stepper"];
    if (meaning === "relationship" && interaction !== "compare" && interaction !== "commit") {
      components = ["ObjectOrbit"];
    }
    return [interaction, components];
  }))])) as unknown as Readonly<Record<Meaning, Readonly<Record<Interaction, readonly SceneComponentName[]>>>>;

export const STATE_MODIFIERS: Readonly<Record<TaskState, VisualState>> = {
  selected: { opacity: 1, pulse: false, marker: "none", blocked: false, selected: true },
  missing: { opacity: 0.66, pulse: false, marker: "missing", blocked: false, selected: false },
  changed: { opacity: 1, pulse: true, marker: "review", blocked: false, selected: false },
  ready: { opacity: 1, pulse: false, marker: "none", blocked: false, selected: false },
  blocked: { opacity: 0.46, pulse: false, marker: "none", blocked: true, selected: false },
  conflict: { opacity: 1, pulse: false, marker: "conflict", blocked: false, selected: false },
};

export const primitiveFor = (meaning: Meaning, interaction: Interaction): readonly SceneComponentName[] =>
  PRIMITIVE_TABLE[meaning][interaction];

/** Traits compose existing human concepts; they never add components or a new dimension. */
export const TRAIT_MEANINGS: Readonly<Record<SemanticTrait, readonly Meaning[]>> = {
  locatable: ["where"], temporal: ["when"], priced: ["cost"], personLike: ["who"],
  versioned: ["sequence"], composable: ["relationship"], deliverable: ["relationship"],
  printable: ["relationship"], bookable: ["where", "when", "who", "cost"],
  spatial: ["relationship"], renderable: ["relationship"], external: ["relationship"],
  consequential: ["relationship"],
};

export const meaningsForTraits = (traits: readonly SemanticTrait[]): readonly Meaning[] =>
  [...new Set(traits.flatMap((trait) => TRAIT_MEANINGS[trait]))];

export const primitivesForTraits = (
  traits: readonly SemanticTrait[], interaction: Interaction,
): readonly SceneComponentName[] => [...new Set(
  meaningsForTraits(traits).flatMap((meaning) => primitiveFor(meaning, interaction)),
)];

export const modifiersFor = (state: TaskState): VisualState => STATE_MODIFIERS[state];
