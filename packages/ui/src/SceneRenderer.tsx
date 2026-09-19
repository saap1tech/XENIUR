import { createElement, type ReactNode } from "react";
import type { Scene, SceneNode } from "@xeniur/core";
import type { SceneBindings } from "./bindings.js";
import { COMPONENT_REGISTRY, planScene, type Refusal } from "./registry.js";

export interface SceneRendererProps {
  scene: Scene;
  bindings: SceneBindings;
  /** Called with anything the registry refused, so a refusal is visible, not silent. */
  onRefusal?(refusals: Refusal[]): void;
}

function renderNode(
  node: SceneNode, bindings: SceneBindings, refusals: Refusal[],
  slots: ReadonlyMap<string, { id: string; role: string }>,
): ReactNode {
  const name = (node as { component: string }).component;

  if (name === "Canvas") {
    const canvas = node as Extract<SceneNode, { component: "Canvas" }>;
    return (
      <div key={canvas.id} className={`xr-canvas xr-canvas--${canvas.layout}`}>
        {canvas.children.map((child) => renderNode(child, bindings, refusals, slots))}
      </div>
    );
  }

  const plan = planScene(node);
  if (plan.renderable.length === 0) { refusals.push(...plan.refusals); return null; }

  const leaf = plan.renderable[0]!;
  const Component = COMPONENT_REGISTRY[leaf.component as keyof typeof COMPONENT_REGISTRY];
  const rendered = createElement(Component, { node: leaf, bindings });
  const slot = slots.get(leaf.id);
  return slot
    ? <div key={leaf.id} className={`xr-scene-slot xr-scene-slot--${slot.role}`} data-slot={slot.id}>{rendered}</div>
    : <div key={leaf.id} className="xr-scene-slot">{rendered}</div>;
}

/** The screen-reader twin speaks subjects and values, never implementation names. */
export function semanticDescription(scene: Scene, bindings: SceneBindings): string {
  const focus = scene.focusId ? bindings.states[scene.focusId] : undefined;
  const parts = [scene.title];
  if (focus) parts.push(`Focused on ${focus.properties.title}`);
  const constraints = Object.values(bindings.constraints ?? {});
  if (constraints.length > 0) {
    parts.push(`Constraints: ${constraints.map((item) => `${item.appliesTo} ${String(item.value)}`).join(", ")}`);
  }
  return parts.filter(Boolean).join(". ");
}

/**
 * Renders a Scene from the closed component registry and nothing else.
 *
 * A node naming an unregistered component renders nothing and is reported. There is no
 * path here that evaluates model-authored markup, styles or code — the model chooses
 * which tested components to compose, and that is all it chooses.
 */
export function SceneRenderer({ scene, bindings, onRefusal }: SceneRendererProps) {
  const refusals: Refusal[] = [];
  const slots = new Map((scene.slots ?? []).map((slot) => [slot.nodeId, { id: slot.id, role: slot.role }]));
  const tree = renderNode(scene.root, bindings, refusals, slots);
  if (refusals.length > 0) {
    for (const r of refusals) {
      console.warn(`[XENIUR] refused scene node ${r.id}: "${r.component}" ${r.reason}`);
    }
    onRefusal?.(refusals);
  }
  return <div className="xr-scene" data-world={scene.worldId}
    data-layout={scene.layoutId ?? "legacy"} aria-label={semanticDescription(scene, bindings)}>{tree}</div>;
}
