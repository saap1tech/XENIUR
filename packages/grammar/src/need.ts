import type { GoalStatus, SceneComponentName, StepKind } from "@xeniur/core";
import type { Interaction, Meaning } from "./dimensions.js";

/**
 * The next relevant human question inside the goal.
 *
 * The compiler used to translate a Situation straight into visual concepts. Now it first
 * asks which question the person is at — and chooses the representation that serves it: a
 * comparison for alternatives, a timeline for sequence, a document for a sustained argument,
 * a graph only for relationships. Not a graph by default.
 *
 * These are available ways of working, not stages. Nothing here requires "knowing enough"
 * before "making"; the person's status decides, the knowledge counts refine, and the zone the
 * person clicked still wins.
 */
export const NEEDS = ["know_more", "understand_conflict", "decide", "make", "see_change", "finish"] as const;
export type Need = (typeof NEEDS)[number];

export const NEED_WORDS: Record<Need, string> = {
  know_more: "I don't know enough yet",
  understand_conflict: "I need to understand conflicting information",
  decide: "I need to decide",
  make: "I need to make something",
  see_change: "I need to know what changed",
  finish: "I need to finish",
};

export interface KnowledgeCounts { known: number; proposed: number; disputed: number; unknown: number; chosenDespite: number }

export interface NeedInput {
  /** The plan step the person is on. Its kind is the question; the status is the fallback. */
  step?: StepKind | undefined;
  status?: GoalStatus | undefined;
  goalKind: string;
  focusKind: "object" | "decision" | "constraints";
  knowledge?: KnowledgeCounts | undefined;
  changes: number;
  hasChoices: boolean;
}

export function needFor(input: NeedInput): Need {
  const k = input.knowledge;
  if (input.focusKind === "decision" || input.hasChoices) return "decide";
  // A step the person adopted says what they are doing more precisely than the status does.
  switch (input.step) {
    case "gather": return "know_more";
    case "understand": return k && k.disputed > 0 ? "understand_conflict" : "know_more";
    case "compare":
    case "decide": return "decide";
    case "make": return "make";
    case "check": return input.changes > 0 ? "see_change" : "finish";
    case "deliver":
    case "act": return "finish";
    case undefined: break;
  }
  switch (input.status) {
    case "finished":
    case "ready": return "finish";
    case "reviewing": return input.changes > 0 ? "see_change" : "finish";
    case "making": return "make";
    case "understanding": return k && k.disputed > 0 ? "understand_conflict" : "know_more";
    case "exploring": return k && k.disputed > 0 && k.known === 0 ? "understand_conflict" : "know_more";
    case undefined: break;
  }
  // No WorkGoal: the goal kind the host gave.
  switch (input.goalKind) {
    case "understand": return k && k.disputed > 0 ? "understand_conflict" : "know_more";
    case "decide": return "decide";
    case "validate": return input.changes > 0 ? "see_change" : "finish";
    case "deliver": return "finish";
    default: return "make";
  }
}

/**
 * What each need looks like: the meaning and interaction it defaults to, and the components
 * that answer it, laid beside the focus. The zone the person chose can still override the
 * defaults; the components are added whatever the zone says, because the question is theirs.
 */
export const NEED_REPRESENTATION: Record<Need, {
  meaning: Meaning; interaction: Interaction; components: readonly SceneComponentName[];
}> = {
  know_more:           { meaning: "relationship", interaction: "connect", components: ["ThinkingTable", "EmptySlot"] },
  understand_conflict: { meaning: "relationship", interaction: "review",  components: ["SupportMap", "ThinkingTable"] },
  decide:              { meaning: "priority",     interaction: "choose",  components: ["ChoiceCards", "ConstraintStrip"] },
  make:                { meaning: "relationship", interaction: "adjust",  components: ["FormStrip"] },
  see_change:          { meaning: "sequence",     interaction: "compare", components: ["ImpactReview", "CausalPath"] },
  finish:              { meaning: "relationship", interaction: "commit",  components: ["ReadinessBoard", "TrustStrip"] },
};

/**
 * Representations that draw a graph. Allowed only when the meaning is relationship or at
 * disclosure layer 4 (the machinery, asked for). A test holds the compiler to this.
 */
export const GRAPH_COMPONENTS: ReadonlySet<SceneComponentName> = new Set<SceneComponentName>([
  "SpatialCanvas", "LineageGraph", "RecipeGraph", "ThinkingMap",
]);

/**
 * When a graph-shaped representation may appear: for relationships; as the schematic map when
 * the meaning is *where* (a map is spatial, not a graph); and at layer 4, the machinery.
 */
export function graphAllowed(component: SceneComponentName, meaning: Meaning, layer: number): boolean {
  if (!GRAPH_COMPONENTS.has(component)) return true;
  if (meaning === "relationship") return true;
  if (meaning === "where" && component === "SpatialCanvas") return true;
  return layer === 4;
}
