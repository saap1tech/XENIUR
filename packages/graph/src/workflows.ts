import { sha256Hex, WorkflowManifestSchema, type Constraint, type ConstraintValue, type WorkflowManifest, type WorkflowListing } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";
import { TEMPLATES, applyTemplate } from "./templates.js";
import { validateRecipe } from "./recipes.js";

const TOOL_ARGS: Record<string, readonly string[]> = {
  "image.transform": ["width", "height", "format", "fit", "allowUpscale", "grayscale"],
  "3d.solidify": ["targetHeight", "shadeSmooth"], "3d.export": ["format"],
  "3d.render": ["width", "height"], "3d.turntable": ["width", "height", "frames", "fps"],
  "doc.write": [],
};
const VALUES = new Set(["png", "webp", "jpg", "jpeg", "stl", "glb", "contain", "cover", "fill", "inside", "outside"]);

function initialValue(definition: Constraint): ConstraintValue {
  switch (definition.kind) {
    case "range": case "quantity": return definition.min;
    case "enum": return definition.multiple ? [definition.options[0]!.id] : definition.options[0]!.id;
    case "boolean": return false;
    case "date_range": return { start: definition.earliest, end: definition.earliest };
    case "location": return definition.places[0]!.id;
    case "priority": return Object.fromEntries(definition.dimensions.map((name) => [name, .5]));
  }
}

/** The first exchange format is data only. Capability/argument allowlists also constrain trusted tools. */
export function validateWorkflow(input: unknown): WorkflowManifest {
  const manifest = WorkflowManifestSchema.parse(input);
  const problems = validateRecipe(manifest.recipe.steps);
  if (problems.length) throw new Error(problems.join("; "));
  for (const step of manifest.recipe.steps) {
    const keys = TOOL_ARGS[step.tool];
    if (!keys) throw new Error(`This workflow uses a capability not permitted in shared workflows: ${step.tool}`);
    for (const [key, value] of Object.entries(step.args)) {
      if (!keys.includes(key)) throw new Error(`Workflow argument ${key} is not shareable.`);
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8192) continue;
      if (typeof value === "boolean") continue;
      if (typeof value === "string" && VALUES.has(value)) continue;
      throw new Error(`Workflow argument ${key} is outside the accepted values.`);
    }
    if (step.inputs.some((input) => input.sourceKind === "decision")) throw new Error("Private decision references must be removed before sharing.");
    if (step.tool === "doc.write" && step.replayPolicy !== "manual") throw new Error("Shared writing steps must be manual.");
    if (step.replayPolicy === "candidate_generation") throw new Error("This initial workflow format includes local and manual steps only.");
  }
  return manifest;
}

export class WorkflowLibrary {
  constructor(private readonly graph: ObjectGraph) {}
  list(): WorkflowListing[] {
    const installed = (this.graph.db.prepare("SELECT id,manifest FROM installed_workflows ORDER BY installed_at DESC").all() as { id: string; manifest: string }[])
      .map((row) => { const m = validateWorkflow(JSON.parse(row.manifest)); return { id: row.id, name: m.name, author: m.author, summary: m.summary, steps: m.recipe.steps.length, source: "installed" as const }; });
    return [...installed, ...TEMPLATES.map((t) => ({ id: t.id, name: t.name, author: "XENIUR", summary: t.summary, steps: t.recipe.steps.length, source: "bundled" as const }))];
  }
  install(input: unknown): WorkflowListing {
    const manifest = validateWorkflow(input);
    const body = JSON.stringify(manifest), id = sha256Hex(body);
    this.graph.db.prepare("INSERT OR IGNORE INTO installed_workflows(id,manifest,installed_at) VALUES(?,?,?)").run(id, body, Date.now());
    return { id, name: manifest.name, author: manifest.author, summary: manifest.summary, steps: manifest.recipe.steps.length, source: "installed" };
  }
  apply(id: string): string {
    const builtIn = TEMPLATES.find((t) => t.id === id);
    if (builtIn) return applyTemplate(this.graph, id)!.worldId;
    const row = this.graph.db.prepare("SELECT manifest FROM installed_workflows WHERE id=?").get(id) as { manifest: string } | undefined;
    if (!row) throw new Error("Workflow not found.");
    const m = validateWorkflow(JSON.parse(row.manifest));
    return this.graph.db.transaction(() => {
      const world = this.graph.createWorld({ title: m.name, emoji: "↗", summary: m.summary });
      const state = this.graph.createObject({ worldId: world.id, title: "Your starting object", semanticType: "object" });
      const recipe = this.graph.recipes.saveRecipe({ objectId: state.object.id, ...m.recipe });
      this.graph.commitVersion({ objectId: state.object.id, recipeId: recipe.id, label: "Applied shared workflow",
        properties: { settings: { workflowId: id, readinessProfiles: m.readinessProfiles, instructions: m.instructions, sceneIntent: m.scene } } });
      for (const sample of m.sampleObjects) this.graph.createObject({ worldId: world.id, ...sample });
      for (const definition of m.constraints) {
        const constraint = this.graph.createObject({ worldId: world.id, title: `${definition.kind.replaceAll("_", " ")} constraint`, semanticType: "constraint" });
        this.graph.constraints.define(constraint.object.id, definition, state.object.id, initialValue(definition));
        this.graph.decisions.link({ fromObjectId: constraint.object.id, toObjectId: state.object.id,
          relation: "review_on_change", note: "This reusable constraint shapes the workflow outcome." });
      }
      if (m.decisionTemplate.question) this.graph.decisions.create({ worldId: world.id, question: m.decisionTemplate.question,
        options: m.decisionTemplate.options.map((label, index) => ({ key: `option-${index}`, label, note: "" })) });
      return world.id;
    })();
  }
  export(objectId: string, name: string, author: string): WorkflowManifest {
    const state = this.graph.currentState(objectId);
    if (!state) throw new Error("This Object no longer exists.");
    const recipe = this.graph.recipes.recipeAtCurrentVersion(objectId);
    if (!recipe) throw new Error("This Object has no recipe to share yet.");
    const steps = recipe.steps.map(({ id: _id, recipeId: _recipe, ...step }) => step);
    const manifest = validateWorkflow({ format: "xeniur-workflow/1", name, author,
      summary: "A reusable local workflow. Bring your own sources.", instructions: "Import a source, complete manual steps, run local steps, then inspect readiness before delivery.",
      scene: { meaning: "relationship", interaction: "choose", layer: 2 },
      constraints: this.graph.constraints.list(state.object.worldId)
        .filter((item) => item.appliesTo === objectId || item.appliesTo === state.properties.title)
        .map((item) => item.definition),
      recipe: { name: "Shared recipe", steps }, readinessProfiles: [], decisionTemplate: { question: "", options: [] },
      deliveryRoles: [...new Set(steps.flatMap((s) => s.outputs.map((o) => o.formRole).filter(Boolean)))], sampleObjects: [],
    });
    return manifest;
  }
}
