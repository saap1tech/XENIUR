import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkPositionSchema } from "@xeniur/core";
import { ObjectGraph, resumeCard } from "./index.js";

/** Where the person was, exactly — and nothing that grants. */
let dir: string, g: ObjectGraph, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-positions-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Rainwear 2027", emoji: "R" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("work positions", () => {
  it("round-trips the exact position and rides on the resume card", () => {
    const jacket = g.createObject({ worldId, semanticType: "prop", title: "Jacket" }).object.id;
    const goal = g.goals.create(worldId, "Ship it", { focusObjectId: jacket });
    g.positions.save({ worldId, goalId: goal.id, planRevision: 2, stepId: "t.make", objectId: jacket, formRole: "model.mesh", zone: "work", tabIds: ["tab-1"], pendingReviewId: null });
    const p = g.positions.get(worldId)!;
    expect(p).toMatchObject({ stepId: "t.make", objectId: jacket, formRole: "model.mesh", zone: "work", tabIds: ["tab-1"] });
    expect(resumeCard(g, worldId)!.position?.stepId).toBe("t.make");
    g.positions.save({ worldId, goalId: goal.id, stepId: "t.check", objectId: jacket });
    expect(g.positions.get(worldId)!.stepId).toBe("t.check");                 // one row per World
  });

  it("the schema has no field that could carry authority, and refuses one", () => {
    const keys = Object.keys(WorkPositionSchema.shape);
    for (const k of keys) expect(k, `${k} looks like authority`).not.toMatch(/grant|auth|token|session|permission|approve/i);
    expect(() => WorkPositionSchema.parse({ worldId: "11111111-1111-4111-8111-111111111111", savedAt: 1, grantId: "x" })).toThrow();
  });
});
