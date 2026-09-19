import type { ComponentType } from "react";
import type { LeafSceneNode, Scene, SceneComponentName, SceneNode } from "@xeniur/core";
import { SceneSchema, isKnownComponent } from "@xeniur/core";
import type { SceneBindings } from "./bindings.js";
import { ObjectCard, Gallery, Inspector, Comparison } from "./components/objects.jsx";
import { Document, Timeline, TaskProgress, ApprovalDialog, Browser, CodePreview } from "./components/work.jsx";
import { Viewport3D } from "./components/viewport3d.jsx";
import {
  FormStrip, ReadinessBoard, ChecksPanel, RebuildPreview, VersionTimeline, ImportDrop,
} from "./components/living.jsx";
import { LineageGraph, RecipeGraph } from "./components/graphs.jsx";
import { ThinkingMapView, IngredientPanel, FocusView } from "./components/thinking.jsx";
import {
  ImpactReview, CausalPath, DecisionCard, SourceViewer, PreviewCard, InspectorQuestions,
  CompareForms, ThinkingTable, IdeaDrawer,
} from "./components/workspace.jsx";
import { ClaimPair, TrustStrip } from "./components/trust.jsx";
import { ModelSetup } from "./components/models.jsx";
import {
  ObjectOrbit, AffordanceRing, SpatialCanvas, ConstraintStrip, RangeMeter, PriorityBalance,
  PeopleChips, Calendar, SchematicMap, ChoiceCards, Stepper, EvidenceMeter, EmptySlot, ReviewSheet,
} from "./components/visual.jsx";

export type LeafProps = { node: never; bindings: SceneBindings };

/**
 * The closed registry. AI composes these by name and never writes frontend code for
 * XENIUR's own interface — which is how generative interfaces stay predictable.
 * "Canvas" is handled by the renderer itself because it is the only container.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- one cast at the registry edge
export const COMPONENT_REGISTRY: Readonly<Record<Exclude<SceneComponentName, "Canvas">, ComponentType<any>>> = {
  ObjectCard, Inspector, Document, Timeline, TaskProgress,
  Comparison, Browser, CodePreview, Viewport3D, ApprovalDialog, Gallery,
  FormStrip, ReadinessBoard, ChecksPanel, RebuildPreview, VersionTimeline, ImportDrop,
  LineageGraph, RecipeGraph,
  ThinkingMap: ThinkingMapView, IngredientPanel, FocusView,
  ImpactReview, CausalPath, DecisionCard, SourceViewer, PreviewCard, InspectorQuestions,
  CompareForms, ThinkingTable, IdeaDrawer,
  ObjectOrbit, AffordanceRing, SpatialCanvas, ConstraintStrip, RangeMeter, PriorityBalance,
  PeopleChips, Calendar, SchematicMap, ChoiceCards, Stepper, EvidenceMeter, EmptySlot, ReviewSheet,
  ClaimPair, TrustStrip, ModelSetup,
};

export interface Refusal { id: string; component: string; reason: string; }

export interface ScenePlan {
  /** Nodes that will actually render, in order. */
  renderable: LeafSceneNode[];
  /** Nodes that were dropped, and why. Never rendered, always reported. */
  refusals: Refusal[];
}

/**
 * Walks a Scene and separates what will render from what is refused.
 *
 * This is deliberately a pure function, separate from React: the refusal rule is the
 * security boundary for generated interfaces, so it is testable on its own and cannot
 * drift from what the renderer actually does — the renderer calls this.
 */
export function planScene(node: SceneNode): ScenePlan {
  const renderable: LeafSceneNode[] = [];
  const refusals: Refusal[] = [];

  const walk = (n: SceneNode): void => {
    const name = (n as { component?: unknown }).component;
    if (typeof name !== "string" || !isKnownComponent(name)) {
      refusals.push({
        id: (n as { id?: string }).id ?? "(no id)",
        component: String(name),
        reason: "not in the XENIUR component registry",
      });
      return;
    }
    if (name === "Canvas") {
      for (const child of (n as { children?: SceneNode[] }).children ?? []) walk(child);
      return;
    }
    if (!(name in COMPONENT_REGISTRY)) {
      refusals.push({ id: (n as { id: string }).id, component: name, reason: "declared but not implemented" });
      return;
    }
    renderable.push(n as LeafSceneNode);
  };

  walk(node);
  return { renderable, refusals };
}

export interface SceneValidation {
  ok: boolean;
  scene: Scene | null;
  errors: string[];
}

/** Scene JSON is validated at the IPC boundary and again here, before anything renders. */
export function validateScene(input: unknown): SceneValidation {
  const result = SceneSchema.safeParse(input);
  if (result.success) return { ok: true, scene: result.data, errors: [] };
  return {
    ok: false, scene: null,
    errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}
