import type { LeafSceneNode, Scene } from "@xeniur/core";
import type { SemanticConcept, SemanticPlan } from "./compile.js";

export interface LayoutIdentity {
  layoutId: string;
  /** Concept ids in their durable order from an earlier compile of this identity. */
  slotOrder?: readonly string[];
}

export interface CompiledScenePlan extends Scene {
  layoutId: string;
  focusId: string;
  disclosure: 1 | 2 | 3 | 4;
  slots: Array<{ id: string; nodeId: string; role: "centre" | "primary" | "supporting" }>;
}

const fixedOrder = (concepts: readonly SemanticConcept[], prior: readonly string[]): SemanticConcept[] => {
  const rank = new Map(prior.map((id, index) => [id, index]));
  return concepts.map((concept, index) => ({ concept, index }))
    .sort((a, b) => {
      const ar = rank.get(a.concept.id); const br = rank.get(b.concept.id);
      if (ar !== undefined && br !== undefined) return ar - br;
      if (ar !== undefined) return -1;
      if (br !== undefined) return 1;
      return a.index - b.index;
    }).map(({ concept }) => concept);
};

/** Pure layout compiler: it assigns slots and never reinterprets meaning. */
export function layoutScene(plan: SemanticPlan, identity: LayoutIdentity): CompiledScenePlan {
  const focus = plan.concepts.find((concept) => concept.role === "focus");
  if (!focus || focus.subjectId !== plan.focusId) throw new Error("semantic plan has no durable focus concept");
  const rest = fixedOrder(plan.concepts.filter((concept) => concept.id !== focus.id), identity.slotOrder ?? []);
  const ordered = [focus, ...rest];
  const slots: CompiledScenePlan["slots"] = ordered.map((concept, index) => ({
    id: index === 0 ? "centre" : `slot-${index}`,
    nodeId: concept.id,
    role: index === 0 ? "centre" : concept.role as "primary" | "supporting",
  }));
  const children = ordered.map((concept) => ({
    id: concept.id, component: concept.component, ...concept.props,
  })) as LeafSceneNode[];
  return {
    worldId: plan.worldId, title: plan.title,
    reason: `Focused on ${plan.focusLabel}`,
    layoutId: identity.layoutId || plan.layoutId,
    focusId: plan.focusId,
    disclosure: plan.disclosure,
    slots,
    root: { id: "compiled-root", component: "Canvas", layout: "free", children },
  };
}
