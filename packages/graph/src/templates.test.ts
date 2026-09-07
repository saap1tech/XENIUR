import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectGraph, TEMPLATES, applyTemplate, validateRecipe } from "./index.js";

let dir: string, g: ObjectGraph;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-templates-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("every shipped template is a valid pipeline", () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s validates", (_id, template) => {
    expect(validateRecipe(template.recipe.steps)).toEqual([]);
  });

  it("sets up a World, an Object and a pinned recipe", () => {
    const result = applyTemplate(g, "asset3d")!;
    expect(result).not.toBeNull();

    const state = g.currentState(result.state.object.id)!;
    expect(state.recipeId).toBe(result.recipeId);
    expect(g.recipes.recipeAtCurrentVersion(state.object.id)!.steps).toHaveLength(4);
    expect(state.properties.units).toBe("mm");
  });

  it("waits for a source rather than inventing one", () => {
    const result = applyTemplate(g, "brand")!;
    const state = g.currentState(result.state.object.id)!;
    expect(state.forms).toHaveLength(0);

    // Every step says exactly what it is missing, rather than failing obscurely later.
    const statuses = g.recipes.statusOf(state.object.id);
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((s) => s.state === "unresolvable")).toBe(true);
    expect(statuses[0]!.reason).toContain('no "source.primary" form exists yet');
  });

  it("tells the person what to bring", () => {
    for (const template of TEMPLATES) {
      expect(template.expects.length).toBeGreaterThan(0);
      expect(template.profiles.length).toBeGreaterThan(0);
    }
  });

  it("targets readiness profiles that actually exist", async () => {
    const { loadProfiles } = await import("./readiness.js");
    const known = new Set(loadProfiles(process.cwd()).map((p) => p.id));
    for (const template of TEMPLATES) {
      for (const profile of template.profiles) {
        expect(known.has(profile), `${template.id} targets unknown profile "${profile}"`).toBe(true);
      }
    }
  });
});

describe("a profile name may claim only what the profile measures", () => {
  const load = async () => (await import("./readiness.js")).loadProfiles(process.cwd());

  it("does not promise that another system will accept the work", async () => {
    // "Ready for Godot" is a claim about Godot, and nothing here has ever run Godot. The
    // names are earned back one validator at a time, not asserted in config.
    for (const p of await load()) {
      if (p.gates !== "artifact") continue;
      expect(p.name.toLowerCase().startsWith("ready for"),
        `"${p.name}" promises an external system's verdict that no validator produces`).toBe(false);
    }
  });

  it("states both what each profile establishes and what it leaves unmeasured", async () => {
    for (const p of await load()) {
      const sentences = p.verifies.split(/(?<=\.)\s+/).filter((s) => s.trim().length > 0);
      expect(p.verifies.length, `${p.id} says nothing about what it verifies`).toBeGreaterThan(0);
      expect(sentences.length,
        `${p.id} names what it checks but never what it does not`).toBeGreaterThanOrEqual(2);
    }
  });

  it("carries that sentence into the readiness report the person reads", async () => {
    const profiles = await load();
    const { ReadinessEvaluator } = await import("./readiness.js");
    const world = g.createWorld({ title: "w", emoji: "w" });
    const obj = g.createObject({ worldId: world.id, semanticType: "object", title: "thing" });

    const reports = new ReadinessEvaluator(g, profiles).evaluateAll(obj.object.id);
    for (const r of reports) {
      expect(r.verifies, `${r.profileId} lost its verifies sentence on the way to the UI`)
        .toBe(profiles.find((p) => p.id === r.profileId)!.verifies);
    }
  });
});
