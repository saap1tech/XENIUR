import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecipeStepDraft } from "@xeniur/core";
import { RecipeInvalid, capabilityVersionFor } from "@xeniur/core";
import { ObjectGraph, fingerprintStep, topoOrder, validateRecipe } from "./index.js";

let dir: string, g: ObjectGraph, objectId: string, worldId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-recipes-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Asteroid Game", emoji: "R" }).id;
  objectId = g.createObject({ worldId, semanticType: "rocket", title: "Rocket" }).object.id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const step = (over: Partial<RecipeStepDraft> & Pick<RecipeStepDraft, "key" | "tool">): RecipeStepDraft => ({
  args: {}, replayPolicy: "deterministic", inputs: [], outputs: [], ...over,
});

/** The DAG from the plan: one source fans out into four deliverables. */
const rocketRecipe = (): RecipeStepDraft[] => [
  step({
    key: "export_glb", tool: "3d.export",
    inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary",
               accepts: { modality: "mesh" }, required: true }],
    outputs: [{ slot: "primary", modality: "mesh", format: "glb", formRole: "delivery.godot" }],
  }),
  step({
    key: "thumbnail", tool: "image.transform",
    inputs: [{ slot: "source", sourceKind: "step", sourceRef: "export_glb.primary",
               accepts: { modality: "mesh", formats: ["glb"] }, required: true }],
    outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "preview.thumbnail" }],
  }),
  step({
    key: "turntable_frames", tool: "video.generate",
    replayPolicy: "deterministic",
    inputs: [{ slot: "source", sourceKind: "step", sourceRef: "export_glb.primary",
               accepts: { modality: "mesh" }, required: true }],
    outputs: [{ slot: "frames", modality: "video", format: "mp4", formRole: null }],
  }),
  step({
    key: "turntable_mp4", tool: "video.edit",
    inputs: [{ slot: "source", sourceKind: "step", sourceRef: "turntable_frames.frames",
               accepts: { modality: "video" }, required: true }],
    outputs: [{ slot: "primary", modality: "video", format: "mp4", formRole: "preview.turntable" }],
  }),
  step({
    key: "print_stl", tool: "3d.process",
    inputs: [{ slot: "source", sourceKind: "step", sourceRef: "export_glb.primary",
               accepts: { modality: "mesh" }, required: true }],
    outputs: [{ slot: "primary", modality: "mesh", format: "stl", formRole: "print.stl" }],
  }),
];

/** Puts a real blob behind a form role so fingerprints have something to hash. */
function giveForm(role: string, bytes: string, format = "glb") {
  const rep = g.addRepresentation({
    objectId, modality: format === "png" ? "image" : format === "mp4" ? "video" : "mesh",
    format, blobHash: g.putBlob(Buffer.from(bytes), "application/octet-stream", format),
    provenance: "imported",
  });
  g.commitVersion({ objectId, forms: [{ role, representationId: rep.id }] });
  return rep;
}

describe("a recipe is a DAG, validated before it is stored", () => {
  it("accepts the rocket pipeline and orders it by dependency", () => {
    const recipe = g.recipes.saveRecipe({ objectId, name: "asset", steps: rocketRecipe() });
    expect(recipe.revision).toBe(0);
    expect(recipe.steps).toHaveLength(5);

    const order = topoOrder(recipe.steps).map((s) => s.key);
    expect(order.indexOf("export_glb")).toBeLessThan(order.indexOf("thumbnail"));
    expect(order.indexOf("turntable_frames")).toBeLessThan(order.indexOf("turntable_mp4"));
  });

  it("rejects a cycle at save time, not at run time", () => {
    const cyclic = [
      step({ key: "a", tool: "3d.process",
             inputs: [{ slot: "s", sourceKind: "step", sourceRef: "b.primary", accepts: {}, required: true }],
             outputs: [{ slot: "primary", modality: "mesh", format: "glb", formRole: null }] }),
      step({ key: "b", tool: "3d.process",
             inputs: [{ slot: "s", sourceKind: "step", sourceRef: "a.primary", accepts: {}, required: true }],
             outputs: [{ slot: "primary", modality: "mesh", format: "glb", formRole: null }] }),
    ];
    expect(validateRecipe(cyclic).join(" ")).toContain("cycle");
    expect(() => g.recipes.saveRecipe({ objectId, name: "bad", steps: cyclic })).toThrow(RecipeInvalid);
  });

  it("rejects a reference to a step or slot that does not exist", () => {
    const problems = validateRecipe([
      step({ key: "a", tool: "3d.export",
             inputs: [{ slot: "s", sourceKind: "step", sourceRef: "nowhere.primary", accepts: {}, required: true }],
             outputs: [{ slot: "primary", modality: "mesh", format: "glb", formRole: null }] }),
    ]);
    expect(problems.join(" ")).toContain('unknown step "nowhere"');
  });

  it("rejects a type mismatch between an output and the slot consuming it", () => {
    const problems = validateRecipe([
      step({ key: "mesh", tool: "3d.export",
             outputs: [{ slot: "primary", modality: "mesh", format: "glb", formRole: null }] }),
      step({ key: "edit", tool: "video.edit",
             inputs: [{ slot: "source", sourceKind: "step", sourceRef: "mesh.primary",
                        accepts: { modality: "video", formats: ["mp4"] }, required: true }],
             outputs: [{ slot: "primary", modality: "video", format: "mp4", formRole: null }] }),
    ]);
    expect(problems.join(" ")).toContain("accepts video/mp4 but");
    expect(problems.join(" ")).toContain("produces mesh/glb");
  });

  it("rejects a step that produces nothing", () => {
    expect(validateRecipe([step({ key: "a", tool: "3d.export" })]).join(" "))
      .toContain('step "a" produces nothing');
  });
});

describe("recipes are versioned, never edited in place", () => {
  it("keeps the revision that built a past release readable", () => {
    const v0 = g.recipes.saveRecipe({ objectId, name: "asset", steps: rocketRecipe() });
    const changed = rocketRecipe();
    changed[4]!.args = { targetHeight: 12 };
    const v1 = g.recipes.saveRecipe({ objectId, name: "asset", steps: changed });

    expect(v1.revision).toBe(1);
    expect(v1.parentRecipeId).toBe(v0.id);
    // The old revision is still there, with its old arguments.
    expect(g.recipes.getRecipe(v0.id)!.steps.find((s) => s.key === "print_stl")!.args).toEqual({});
    expect(g.recipes.getRecipe(v1.id)!.steps.find((s) => s.key === "print_stl")!.args)
      .toEqual({ targetHeight: 12 });
  });

  it("uses the revision pinned by the current version, not merely the newest", () => {
    const v0 = g.recipes.saveRecipe({ objectId, name: "asset", steps: rocketRecipe() });
    g.commitVersion({ objectId, recipeId: v0.id, label: "pin v0" });
    g.recipes.saveRecipe({ objectId, name: "asset", steps: rocketRecipe() });   // v1 exists
    expect(g.recipes.recipeAtCurrentVersion(objectId)!.revision).toBe(0);
  });
});

describe("fingerprints change exactly when something real changed", () => {
  const base = { tool: "3d.export" as const, capabilityVersion: "1.0.0", args: { format: "stl" }, inputHashes: ["aaa"] };

  it("is stable across key order and repeated calls", () => {
    expect(fingerprintStep(base)).toBe(fingerprintStep({ ...base, args: { format: "stl" } }));
    expect(fingerprintStep({ ...base, args: { a: 1, b: 2 } }))
      .toBe(fingerprintStep({ ...base, args: { b: 2, a: 1 } }));
  });

  it("changes when the source changes", () => {
    expect(fingerprintStep({ ...base, inputHashes: ["bbb"] })).not.toBe(fingerprintStep(base));
  });

  it("changes when the arguments change", () => {
    expect(fingerprintStep({ ...base, args: { format: "glb" } })).not.toBe(fingerprintStep(base));
  });

  it("changes when the capability version changes", () => {
    expect(fingerprintStep({ ...base, capabilityVersion: "2.0.0" })).not.toBe(fingerprintStep(base));
  });

  it("does not change when nothing did", () => {
    expect(fingerprintStep(base)).toBe(fingerprintStep({ ...base }));
  });
});

describe("staleness is computed from the graph, never stored as a flag", () => {
  function setUp() {
    giveForm("source.primary", "original mesh");
    const recipe = g.recipes.saveRecipe({ objectId, name: "asset", steps: rocketRecipe() });
    g.commitVersion({ objectId, recipeId: recipe.id, label: "pin recipe" });
    return recipe;
  }

  it("reports never_built before anything has run", () => {
    setUp();
    const statuses = g.recipes.statusOf(objectId);
    expect(statuses).toHaveLength(5);
    expect(statuses.every((s) => s.state === "never_built")).toBe(true);
    expect(statuses[0]!.reason).toContain("has not been produced yet");
  });

  it("goes fresh once built, and stale the moment the source changes", () => {
    const recipe = setUp();
    const built = giveForm("delivery.godot", "exported glb");
    const fingerprint = g.recipes.statusOf(objectId).find((s) => s.stepKey === "export_glb")!.fingerprint!;
    g.recipes.recordDerivation({
      representationId: built.id, recipeId: recipe.id, stepKey: "export_glb",
      fingerprint, capabilityVersion: capabilityVersionFor("3d.export"),
    });
    expect(g.recipes.statusOf(objectId).find((s) => s.stepKey === "export_glb")!.state).toBe("fresh");

    // The person edits the source and brings it back.
    giveForm("source.primary", "EDITED mesh");
    const after = g.recipes.statusOf(objectId).find((s) => s.stepKey === "export_glb")!;
    expect(after.state).toBe("stale");
    expect(after.reason).toContain("inputs or settings changed");
  });

  it("says so when a capability version moved under a step", () => {
    const recipe = setUp();
    const built = giveForm("delivery.godot", "exported glb");
    const fingerprint = g.recipes.statusOf(objectId).find((s) => s.stepKey === "export_glb")!.fingerprint!;
    g.recipes.recordDerivation({
      representationId: built.id, recipeId: recipe.id, stepKey: "export_glb",
      fingerprint: `${fingerprint.slice(0, -1)}0`, capabilityVersion: "0.9.0",
    });
    const status = g.recipes.statusOf(objectId).find((s) => s.stepKey === "export_glb")!;
    expect(status.state).toBe("stale");
    expect(status.reason).toContain("changed from 0.9.0 to 1.0.0");
  });

  it("marks a step unresolvable when a required input does not exist", () => {
    const recipe = g.recipes.saveRecipe({ objectId, name: "asset", steps: rocketRecipe() });
    g.commitVersion({ objectId, recipeId: recipe.id });   // no source.primary form at all
    const status = g.recipes.statusOf(objectId).find((s) => s.stepKey === "export_glb")!;
    expect(status.state).toBe("unresolvable");
    expect(status.reason).toContain('no "source.primary" form exists yet');
  });
});

describe("the three replay policies behave differently, which is the point", () => {
  function withPolicies() {
    giveForm("source.primary", "original mesh");
    const steps: RecipeStepDraft[] = [
      step({
        key: "sculpt", tool: "3d.process", replayPolicy: "manual",
        inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary", accepts: {}, required: true }],
        outputs: [{ slot: "primary", modality: "mesh", format: "glb", formRole: "model.mesh" }],
      }),
      step({
        key: "export_glb", tool: "3d.export", replayPolicy: "deterministic",
        inputs: [{ slot: "source", sourceKind: "step", sourceRef: "sculpt.primary", accepts: {}, required: true }],
        outputs: [{ slot: "primary", modality: "mesh", format: "glb", formRole: "delivery.godot" }],
      }),
      step({
        key: "hero_art", tool: "image.generate", replayPolicy: "candidate_generation",
        inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary", accepts: {}, required: true }],
        outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "art.primary" }],
      }),
    ];
    const recipe = g.recipes.saveRecipe({ objectId, name: "mixed", steps });
    g.commitVersion({ objectId, recipeId: recipe.id });
    return recipe;
  }

  it("sorts a rebuild into will-rebuild, can-regenerate and waiting-on-you", () => {
    withPolicies();
    const plan = g.recipes.planRebuild(objectId, () => 0.25);

    // The export depends on a hand step nobody has done yet, so it is not offered as a
    // free rebuild — running it would produce a deliverable from a mesh that never existed.
    expect(plan.willRebuild).toHaveLength(0);
    expect(plan.blocked.map((s) => s.stepKey)).toEqual(["export_glb"]);
    expect(plan.waitingOnYou.map((s) => s.stepKey)).toEqual(["sculpt"]);
    // The art step reads the source directly, so it is independent of the hand step.
    expect(plan.canRegenerate.map((s) => s.stepKey)).toEqual(["hero_art"]);
    // Only generation costs anything; deterministic work is free.
    expect(plan.estimatedUsd).toBeCloseTo(0.25, 6);
  });

  it("offers the deterministic step for free once the hand step is done", () => {
    const recipe = withPolicies();
    const sculpted = giveForm("model.mesh", "hand sculpted");
    const fp = g.recipes.statusOf(objectId).find((s) => s.stepKey === "sculpt")!.fingerprint!;
    g.recipes.recordDerivation({
      representationId: sculpted.id, recipeId: recipe.id, stepKey: "sculpt",
      fingerprint: fp, capabilityVersion: capabilityVersionFor("3d.process"),
    });
    const plan = g.recipes.planRebuild(objectId, () => 0.25);
    expect(plan.willRebuild.map((s) => s.stepKey)).toEqual(["export_glb"]);
    expect(plan.waitingOnYou).toHaveLength(0);
  });

  it("blocks what sits behind a pending manual step rather than calling it fresh", () => {
    const recipe = withPolicies();
    // The manual step is done; everything behind it can now proceed.
    const sculpted = giveForm("model.mesh", "hand sculpted");
    const sculptFp = g.recipes.statusOf(objectId).find((s) => s.stepKey === "sculpt")!.fingerprint!;
    g.recipes.recordDerivation({
      representationId: sculpted.id, recipeId: recipe.id, stepKey: "sculpt",
      fingerprint: sculptFp, capabilityVersion: capabilityVersionFor("3d.process"),
    });
    expect(g.recipes.statusOf(objectId).find((s) => s.stepKey === "sculpt")!.state).toBe("fresh");
    expect(g.recipes.statusOf(objectId).find((s) => s.stepKey === "export_glb")!.state).toBe("never_built");

    // Now the source moves again: the manual step is pending, so the export is blocked,
    // not merely stale — rebuilding it would bake in a mesh the person has moved past.
    giveForm("source.primary", "EDITED again");
    const after = g.recipes.statusOf(objectId);
    expect(after.find((s) => s.stepKey === "sculpt")!.state).toBe("stale");
    const exportStep = after.find((s) => s.stepKey === "export_glb")!;
    expect(exportStep.state).toBe("blocked");
    expect(exportStep.reason).toContain("waiting on you");
    expect(g.recipes.planRebuild(objectId).willRebuild).toHaveLength(0);
  });

  it("parks a generated result as a candidate instead of overwriting a chosen form", () => {
    withPolicies();
    const chosen = giveForm("art.primary", "the art I picked", "png");
    const candidate = g.addRepresentation({
      objectId, modality: "image", format: "png",
      blobHash: g.putBlob(Buffer.from("a different generation"), "image/png", "png"),
      provenance: "generated", provider: "openai.image",
    });
    g.recipes.addCandidate({ objectId, representationId: candidate.id, formRole: "art.primary" });

    // The chosen form is untouched; the step reports that something is waiting.
    const state = g.currentState(objectId)!;
    expect(state.forms.find((f) => f.role === "art.primary")!.representationId).toBe(chosen.id);
    expect(g.recipes.statusOf(objectId).find((s) => s.stepKey === "hero_art")!.state).toBe("superseded");
    expect(g.recipes.pendingCandidates(objectId)).toHaveLength(1);

    g.recipes.decideCandidate(g.recipes.pendingCandidates(objectId)[0]!.id, "rejected");
    expect(g.recipes.pendingCandidates(objectId)).toHaveLength(0);
  });
});
