import type { ObjectState, RecipeStepDraft } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";

export interface WorldTemplate {
  id: string;
  name: string;
  emoji: string;
  summary: string;
  /** The readiness profiles this kind of work is aiming at. */
  profiles: string[];
  /** What the person is expected to bring. Templates never invent the source. */
  expects: string;
  /** The pipeline, ready to run the moment a source exists. */
  recipe: { name: string; steps: RecipeStepDraft[] };
  /** Properties every object of this kind should carry. */
  properties?: Record<string, unknown>;
}

/**
 * A template seeds the recipe and the readiness targets. It never fabricates the source:
 * every one of these pipelines waits on something the person actually brings, because a
 * World pre-filled with invented material is a World about nothing.
 */
export const TEMPLATES: readonly WorldTemplate[] = [
  {
    id: "asset3d",
    name: "3D asset",
    emoji: "🚀",
    summary: "A model you own, kept deliverable as you keep working on it.",
    profiles: ["godot", "print3d"],
    expects: "a .blend, .glb, .stl or .obj",
    properties: { units: "mm" },
    recipe: {
      name: "asset",
      steps: [
        {
          key: "make_solid", tool: "3d.solidify", replayPolicy: "deterministic",
          args: { targetHeight: 120, shadeSmooth: true },
          inputs: [{ slot: "source", sourceKind: "form", sourceRef: "model.mesh",
                     accepts: { modality: "mesh" }, required: true }],
          outputs: [{ slot: "primary", modality: "mesh", format: "glb", formRole: "delivery.godot" }],
        },
        {
          key: "print_stl", tool: "3d.export", replayPolicy: "deterministic", args: { format: "stl" },
          inputs: [{ slot: "source", sourceKind: "step", sourceRef: "make_solid.primary",
                     accepts: { modality: "mesh", formats: ["glb"] }, required: true }],
          outputs: [{ slot: "primary", modality: "mesh", format: "stl", formRole: "print.stl" }],
        },
        {
          key: "thumbnail", tool: "3d.render", replayPolicy: "deterministic",
          args: { width: 640, height: 640 },
          inputs: [{ slot: "source", sourceKind: "step", sourceRef: "make_solid.primary",
                     accepts: { modality: "mesh" }, required: true }],
          outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "preview.thumbnail" }],
        },
        {
          key: "turntable", tool: "3d.turntable", replayPolicy: "deterministic",
          args: { width: 480, height: 480, frames: 24, fps: 24 },
          inputs: [{ slot: "source", sourceKind: "step", sourceRef: "make_solid.primary",
                     accepts: { modality: "mesh" }, required: true }],
          outputs: [{ slot: "primary", modality: "video", format: "mp4", formRole: "preview.turntable" }],
        },
      ],
    },
  },

  {
    id: "brand",
    name: "Brand identity",
    emoji: "🎨",
    summary: "A logo, and every size and surface it has to survive.",
    profiles: ["web", "retail"],
    expects: "a logo as PNG or SVG",
    recipe: {
      name: "identity",
      steps: [
        {
          key: "web_logo", tool: "image.transform", replayPolicy: "deterministic",
          args: { width: 512, format: "png" },
          inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary",
                     accepts: { modality: "image" }, required: true }],
          outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "delivery.web" }],
        },
        {
          key: "retail_logo", tool: "image.transform", replayPolicy: "deterministic",
          args: { width: 2400, format: "png", allowUpscale: true },
          inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary",
                     accepts: { modality: "image" }, required: true }],
          outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "delivery.retail" }],
        },
        {
          key: "app_icon", tool: "image.transform", replayPolicy: "deterministic",
          args: { width: 1024, height: 1024, fit: "contain", format: "png" },
          inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary",
                     accepts: { modality: "image" }, required: true }],
          outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "delivery.icon" }],
        },
        {
          key: "mono", tool: "image.transform", replayPolicy: "deterministic",
          args: { width: 512, grayscale: true, format: "png" },
          inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary",
                     accepts: { modality: "image" }, required: true }],
          outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "delivery.mono" }],
        },
      ],
    },
  },

  {
    id: "figure",
    name: "Scientific figure",
    emoji: "📊",
    summary: "A figure a journal will accept, and that says where its numbers came from.",
    profiles: ["publication"],
    expects: "a chart or plot as PNG or SVG",
    recipe: {
      name: "figure",
      steps: [
        {
          key: "print_figure", tool: "image.transform", replayPolicy: "deterministic",
          args: { width: 2400, format: "png", allowUpscale: true },
          inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary",
                     accepts: { modality: "image" }, required: true }],
          outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "delivery.figure" }],
        },
        {
          key: "web_figure", tool: "image.transform", replayPolicy: "deterministic",
          args: { width: 900, format: "webp" },
          inputs: [{ slot: "source", sourceKind: "step", sourceRef: "print_figure.primary",
                     accepts: { modality: "image" }, required: true }],
          outputs: [{ slot: "primary", modality: "image", format: "webp", formRole: "delivery.web" }],
        },
      ],
    },
  },

  {
    id: "onepager",
    name: "Document one-pager",
    emoji: "📄",
    summary: "A plan or proposal, kept honest about what is in it before it goes out.",
    profiles: ["client", "send"],
    expects: "a Markdown or text draft",
    recipe: {
      name: "document",
      steps: [
        {
          key: "draft", tool: "doc.write", replayPolicy: "manual", args: {},
          inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary",
                     accepts: { modality: "text" }, required: true }],
          outputs: [{ slot: "primary", modality: "text", format: "md", formRole: "doc.primary" }],
        },
      ],
    },
  },
];

export const templateById = (id: string): WorldTemplate | undefined =>
  TEMPLATES.find((t) => t.id === id);

/**
 * Creates a World from a template, plus the Object its pipeline is waiting for.
 *
 * The Object starts empty on purpose: dropping in a file is the first real step, and an
 * empty Object that says exactly what it wants is more useful than a full one that lied.
 */
export function applyTemplate(
  graph: ObjectGraph, templateId: string, opts: { title?: string } = {},
): { worldId: string; state: ObjectState; recipeId: string } | null {
  const template = templateById(templateId);
  if (!template) return null;

  const world = graph.createWorld({
    title: opts.title ?? template.name, emoji: template.emoji, summary: template.summary,
  });
  const created = graph.createObject({
    worldId: world.id, semanticType: template.id,
    title: opts.title ?? template.name,
    properties: {
      tags: [template.id],
      settings: { template: template.id, expects: template.expects, profiles: template.profiles },
      ...(template.properties ?? {}),
    },
  });

  const recipe = graph.recipes.saveRecipe({
    objectId: created.object.id, name: template.recipe.name, steps: template.recipe.steps,
  });
  const state = graph.commitVersion({
    objectId: created.object.id, recipeId: recipe.id,
    label: `set up as a ${template.name}`,
  });

  return { worldId: world.id, state, recipeId: recipe.id };
}
