import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectGraph } from "./graph.js";

describe("typed constraints", () => {
  it("rejects values with the wrong shape and values below their floor", () => {
    const dir = mkdtempSync(join(tmpdir(), "xeniur-constraints-"));
    const graph = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
    const world = graph.createWorld({ title: "Travel", emoji: "T" });
    const object = graph.createObject({ worldId: world.id, semanticType: "constraint", title: "People" });
    graph.constraints.define(object.object.id, { kind: "quantity", min: 1, max: 8, unit: "people" }, "Travellers", 2);
    expect(() => graph.constraints.setValue(object.object.id, "two")).toThrow();
    expect(() => graph.constraints.setValue(object.object.id, 0)).toThrow();
    expect(graph.constraints.setValue(object.object.id, 4).value).toBe(4);
    graph.close(); rmSync(dir, { recursive: true, force: true });
  });
});
