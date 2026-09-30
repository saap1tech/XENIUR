import { sampleProvidersConfig } from "../../providers/src/test-config.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { RecipeStepDraft } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import { PermissionBroker } from "@xeniur/permissions";
import { loadProvidersConfig, type ProviderEnv } from "@xeniur/providers";
import { CapabilityRouter, RebuildRunner } from "./index.js";

const ROOT = process.cwd();
let dir: string, g: ObjectGraph, router: CapabilityRouter, runner: RebuildRunner;
let worldId: string, objectId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-rebuild-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  const env: ProviderEnv = {
    scratchDir: join(dir, "scratch"), rootDir: ROOT,
    binaries: {
      ffmpeg: "/opt/homebrew/bin/ffmpeg",
      blender: "/Applications/Blender.app/Contents/MacOS/Blender",
    },
  };
  router = new CapabilityRouter({
    graph: g, broker: new PermissionBroker(g.db), config: sampleProvidersConfig(ROOT), env,
  });
  runner = new RebuildRunner(g, router);

  worldId = g.createWorld({ title: "Asteroid Game", emoji: "R" }).id;
  objectId = g.createObject({ worldId, semanticType: "rocket", title: "Rocket" }).object.id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

async function giveSourceImage(bytes: string) {
  const png = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 240, g: 180, b: 60, alpha: 1 } },
  }).png().toBuffer();
  // Distinct bytes per call, so the fingerprint genuinely changes when the source does.
  const tagged = Buffer.concat([png, Buffer.from(bytes)]);
  const rep = g.addRepresentation({
    objectId, modality: "image", format: "png",
    blobHash: g.putBlob(tagged, "image/png", "png"), provenance: "human",
  });
  g.commitVersion({ objectId, forms: [{ role: "source.primary", representationId: rep.id }] });
  return rep;
}

/** Two deterministic image steps chained, plus one generative step beside them. */
const steps = (): RecipeStepDraft[] => [
  {
    key: "web_size", tool: "image.transform", replayPolicy: "deterministic",
    args: { width: 64, format: "png" },
    inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary",
               accepts: { modality: "image" }, required: true }],
    outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "delivery.web" }],
  },
  {
    key: "thumbnail", tool: "image.transform", replayPolicy: "deterministic",
    args: { width: 32, format: "png" },
    inputs: [{ slot: "source", sourceKind: "step", sourceRef: "web_size.primary",
               accepts: { modality: "image" }, required: true }],
    outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "preview.thumbnail" }],
  },
  {
    key: "hero_art", tool: "image.generate", replayPolicy: "candidate_generation",
    args: { prompt: "a rocket", width: 64, height: 64 },
    inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary",
               accepts: { modality: "image" }, required: false }],
    outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "art.primary" }],
  },
];

async function setUp() {
  await giveSourceImage("v1");
  const recipe = g.recipes.saveRecipe({ objectId, name: "asset", steps: steps() });
  g.commitVersion({ objectId, recipeId: recipe.id, label: "pin recipe" });
  return recipe;
}

describe("a rebuild runs the DAG in dependency order", () => {
  it("builds the chain and leaves generation alone by default", async () => {
    await setUp();
    const result = await runner.run(objectId, { worldId });

    expect(result.outcomes.filter((o) => o.status === "rebuilt").map((o) => o.stepKey))
      .toEqual(["web_size", "thumbnail"]);
    expect(result.candidates).toBe(0);

    // Generation was offered, not run — it costs money and yields something different.
    const skipped = result.outcomes.find((o) => o.stepKey === "hero_art")!;
    expect(skipped.status).toBe("skipped");
    expect(skipped.reason).toContain("produces something different");

    // Both deterministic outputs are now current forms of the same Object.
    const state = g.currentState(objectId)!;
    expect(state.forms.map((f) => f.role).sort())
      .toEqual(["delivery.web", "preview.thumbnail", "source.primary"]);
  }, 60_000);

  it("goes fresh after building, and nothing rebuilds a second time", async () => {
    await setUp();
    await runner.run(objectId, { worldId });

    const after = g.recipes.statusOf(objectId);
    expect(after.find((s) => s.stepKey === "web_size")!.state).toBe("fresh");
    expect(after.find((s) => s.stepKey === "thumbnail")!.state).toBe("fresh");

    const second = await runner.run(objectId, { worldId });
    expect(second.rebuilt).toBe(0);   // nothing changed, so nothing is redone
  }, 60_000);

  it("rebuilds only what the changed source actually affects", async () => {
    await setUp();
    await runner.run(objectId, { worldId });
    const thumbBefore = g.currentState(objectId)!.forms
      .find((f) => f.role === "preview.thumbnail")!.representationId;

    // The person edits the source and brings it back.
    await giveSourceImage("v2-edited");

    // The preview is transitively honest: the thumbnail is listed too, because its input
    // is about to change. Reporting only web_size would leave a thumbnail derived from an
    // image that no longer exists, while calling the rebuild complete.
    const plan = runner.plan(objectId);
    expect(plan.willRebuild.map((s) => s.stepKey)).toEqual(["web_size", "thumbnail"]);
    expect(plan.willRebuild[0]!.reason).toContain("inputs or settings changed");
    expect(plan.willRebuild[1]!.reason).toContain("an earlier step will be rebuilt first");

    const result = await runner.run(objectId, { worldId });
    // The thumbnail depends on web_size, so it rebuilds once its own input changes too.
    expect(result.outcomes.filter((o) => o.status === "rebuilt").map((o) => o.stepKey))
      .toEqual(["web_size", "thumbnail"]);
    expect(g.currentState(objectId)!.forms.find((f) => f.role === "preview.thumbnail")!.representationId)
      .not.toBe(thumbBefore);
    expect(g.recipes.statusOf(objectId).every((s) => s.state === "fresh" || s.state === "never_built"))
      .toBe(true);
  }, 90_000);
});

describe("generation produces a candidate, never a replacement", () => {
  it("leaves the current form untouched and parks the result for a person", async () => {
    await setUp();
    await runner.run(objectId, { worldId });

    // The person picks an image for art.primary themselves.
    const chosen = await giveSourceImage("chosen-art");
    g.commitVersion({ objectId, forms: [{ role: "art.primary", representationId: chosen.id }] });

    const result = await runner.run(objectId, { worldId, includeGeneration: true });
    const generated = result.outcomes.find((o) => o.stepKey === "hero_art")!;
    expect(generated.status).toBe("candidate");
    expect(result.candidates).toBe(1);

    // The chosen form is exactly where it was; the generation is beside it.
    expect(g.currentState(objectId)!.forms.find((f) => f.role === "art.primary")!.representationId)
      .toBe(chosen.id);
    const pending = g.recipes.pendingCandidates(objectId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.formRole).toBe("art.primary");
    expect(g.getRepresentation(pending[0]!.representationId)!.provenance).toBe("mock");
  }, 90_000);
});

describe("a manual step is requested, never performed", () => {
  it("refuses to run it and blocks what depends on it", async () => {
    await giveSourceImage("v1");
    const withManual: RecipeStepDraft[] = [
      {
        key: "retouch", tool: "image.transform", replayPolicy: "manual", args: {},
        inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary",
                   accepts: { modality: "image" }, required: true }],
        outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "art.retouched" }],
      },
      {
        key: "web_size", tool: "image.transform", replayPolicy: "deterministic",
        args: { width: 64, format: "png" },
        inputs: [{ slot: "source", sourceKind: "step", sourceRef: "retouch.primary",
                   accepts: { modality: "image" }, required: true }],
        outputs: [{ slot: "primary", modality: "image", format: "png", formRole: "delivery.web" }],
      },
    ];
    const recipe = g.recipes.saveRecipe({ objectId, name: "manual", steps: withManual });
    g.commitVersion({ objectId, recipeId: recipe.id });

    const result = await runner.run(objectId, { worldId, includeGeneration: true });
    expect(result.rebuilt).toBe(0);

    const retouch = result.outcomes.find((o) => o.stepKey === "retouch")!;
    expect(retouch.status).toBe("skipped");
    expect(retouch.reason).toContain("has not been produced yet");

    const web = result.outcomes.find((o) => o.stepKey === "web_size")!;
    expect(web.status).toBe("skipped");
    expect(web.reason).toContain("waiting on you");

    // Nothing was invented on the person's behalf.
    expect(g.currentState(objectId)!.forms.map((f) => f.role)).toEqual(["source.primary"]);
  }, 60_000);
});
