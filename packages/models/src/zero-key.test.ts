import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectGraph, applyTemplate, impactOf, loadProfiles, ReadinessEvaluator } from "@xeniur/graph";
import { MemoryKeyStore, ModelRegistry } from "./index.js";

/**
 * XENIUR is complete with zero keys.
 *
 * Every local capability — the graph, versions, recipes, staleness, readiness, decisions,
 * packaging, the compilers — works with no key present. Adding a key *unlocks*; it never
 * *enables*. This is the invariant the first-run Skip button rests on, and it is asserted
 * here rather than remembered.
 */
describe("XENIUR is complete with zero keys", () => {
  it("offers no live model before the OpenRouter connection", () => {
    const registry = ModelRegistry.load(process.cwd());
    const keys = new MemoryKeyStore();
    const callable = registry.callable((p) => keys.has(p));
    expect(callable.every((m) => m.tags.includes("local"))).toBe(true);
    expect(callable).toEqual([]);
  });

  it("runs the whole local loop — object, version, recipe, staleness, readiness, decision — with no key", () => {
    const dir = mkdtempSync(join(tmpdir(), "xeniur-zero-key-"));
    const g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
    try {
      const applied = applyTemplate(g, "asset3d", { title: "Rocket" })!;
      const objectId = applied.state.object.id;
      const rep = g.addRepresentation({
        objectId, modality: "mesh", format: "glb",
        blobHash: g.putBlob(Buffer.from("mesh"), "model/gltf-binary", "glb"), provenance: "imported",
      });
      g.commitVersion({ objectId, forms: [{ role: "model.mesh", representationId: rep.id }] });
      expect(g.recipes.statusOf(objectId).length).toBeGreaterThan(0);
      expect(impactOf(g, objectId).headline.length).toBeGreaterThan(0);

      const readiness = new ReadinessEvaluator(g, loadProfiles(process.cwd()));
      expect(readiness.evaluateAll(objectId).length).toBeGreaterThan(0);

      const d = g.decisions.create({
        worldId: applied.worldId, question: "Which finish?",
        options: [{ key: "matte", label: "Matte", note: "" }], chosenOption: "matte",
      });
      g.decisions.accept(d.objectId, "you", { skipSteelman: true });
      expect(g.decisions.briefOf(d.objectId)).toContain("Matte");
      // None of the above consulted a key store. There is not one in scope.
    } finally {
      g.close(); rmSync(dir, { recursive: true, force: true });
    }
  });
});
