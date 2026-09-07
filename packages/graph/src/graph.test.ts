import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionPlan, Cost, ObjectState, Representation, Tool } from "@xeniur/core";
import { formOf } from "@xeniur/core";
import { StaleBaseVersion } from "@xeniur/core";
import { DivergedHistory, ObjectGraph } from "./index.js";

const cost = (usd: number): Cost => ({ inputTokens: 0, outputTokens: 0, credits: 0, usd, ms: 10 });
const plan = (tool: Tool, intent: string): ActionPlan =>
  ({ intent, objects: [], tool, args: {}, confirmation: false });

let dir: string;
let g: ObjectGraph;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-graph-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

/** The loop the product is about, now expressed as accumulating simultaneous forms. */
function buildRocket() {
  const world = g.createWorld({ title: "Asteroid Game", emoji: "🚀" });
  const rocket = g.createObject({ worldId: world.id, semanticType: "rocket", title: "Rocket" });
  const objectId = rocket.object.id;

  const circle = g.addRepresentation({
    objectId, modality: "image", format: "png",
    blobHash: g.putBlob(Buffer.from("a yellow circle"), "image/png", "png"),
    provenance: "imported",
  });
  g.commitVersion({ objectId, forms: [{ role: "source.primary", representationId: circle.id }], label: "circle" });

  const step = (
    tool: Tool, intent: string, from: Representation, role: string,
    out: { modality: Representation["modality"]; format: string; bytes: string },
    usd: number, provider: string,
  ) => {
    const action = g.beginAction({
      worldId: world.id, intent, tool, plan: plan(tool, intent),
      permissionLevel: "CREATE", provenance: "mock", provider,
      model: "mock-v1", toolVersion: "mock 0.1.0", generationParams: { seed: 7 },
    });
    const result = g.commitResult({
      actionId: action.id, objectId,
      representations: [{
        objectId, modality: out.modality, format: out.format,
        blobHash: g.putBlob(Buffer.from(out.bytes), "application/octet-stream", out.format),
        producedByActionId: action.id, provenance: "mock", provider,
        model: "mock-v1", toolVersion: "mock 0.1.0", generationParams: { seed: 7 },
      }],
      formRoles: [role],
      inputs: [{ representationId: from.id, role: "source" }],
      cost: cost(usd), model: "mock-v1", toolVersion: "mock 0.1.0", label: intent,
    });
    return result.representations[0]!;
  };

  const image = step("image.generate", "make it a rocket", circle, "art.illustration", { modality: "image", format: "png", bytes: "rocket art" }, 0.10, "mock.image");
  const mesh  = step("3d.generate", "make it 3D", image, "model.mesh", { modality: "mesh", format: "glb", bytes: "rocket mesh" }, 0.20, "mock.mesh");
  const asset = step("3d.process", "game-ready", mesh, "delivery.godot", { modality: "mesh", format: "glb", bytes: "game asset" }, 0.02, "local.blender");
  const stl   = step("3d.export", "printable", asset, "print.stl", { modality: "mesh", format: "stl", bytes: "printable" }, 0.10, "local.blender");

  return { world, objectId, circle, image, mesh, asset, stl };
}

describe("a version is a complete state snapshot", () => {
  it("holds every simultaneous form, not just the newest one", () => {
    const { objectId, circle, image, mesh, asset, stl } = buildRocket();
    const state = g.currentState(objectId)!;

    expect(state.forms.map((f) => f.role).sort()).toEqual([
      "art.illustration", "delivery.godot", "model.mesh", "print.stl", "source.primary",
    ]);
    expect(formOf(state, "source.primary")?.representationId).toBe(circle.id);
    expect(formOf(state, "art.illustration")?.representationId).toBe(image.id);
    expect(formOf(state, "model.mesh")?.representationId).toBe(mesh.id);
    expect(formOf(state, "delivery.godot")?.representationId).toBe(asset.id);
    expect(formOf(state, "print.stl")?.representationId).toBe(stl.id);
  });

  it("keeps one uuid across all five forms", () => {
    const { objectId } = buildRocket();
    const reps = g.listRepresentations(objectId);
    expect(reps).toHaveLength(5);
    expect(new Set(reps.map((r) => r.objectId))).toEqual(new Set([objectId]));
    expect(g.listObjects(g.currentState(objectId)!.object.worldId)).toHaveLength(1);
  });

  it("carries untouched forms forward rather than dropping them", () => {
    const { objectId } = buildRocket();
    const replacement = g.addRepresentation({
      objectId, modality: "image", format: "png",
      blobHash: g.putBlob(Buffer.from("new thumb"), "image/png", "png"), provenance: "deterministic",
    });
    const after = g.commitVersion({
      objectId, forms: [{ role: "preview.thumbnail", representationId: replacement.id }],
    });
    // Adding a thumbnail must not silently drop the GLB, the STL or anything else.
    expect(after.forms).toHaveLength(6);
    expect(formOf(after, "print.stl")).toBeDefined();
  });
});

describe("properties cannot escape undo", () => {
  it("snapshots properties into the version, not the object row", () => {
    const { objectId } = buildRocket();
    const state = g.currentState(objectId)!;
    expect(state.properties.title).toBe("Rocket");
    expect(state.properties.semanticType).toBe("rocket");
    // The objects row carries identity and pointers only.
    expect(Object.keys(state.object).sort()).toEqual([
      "archivedAt", "createdAt", "currentBranchId", "currentVersionId", "id", "parentId", "worldId",
    ]);
  });

  it("makes renaming, retagging and changing units undoable", () => {
    const { objectId } = buildRocket();
    g.setProperties(objectId, { title: "Rocket Mk II", tags: ["hero"], units: "mm" });
    expect(g.currentState(objectId)!.properties.title).toBe("Rocket Mk II");

    const back = g.undo(objectId)!;
    expect(back.properties.title).toBe("Rocket");
    expect(back.properties.tags).toEqual([]);
    expect(back.properties.units).toBeNull();
  });
});

describe("undo actually changes what is current", () => {
  it("moves the head so the current form changes, without deleting anything", () => {
    const { objectId, asset, stl } = buildRocket();
    const versions = g.versionChain(objectId).length;

    expect(formOf(g.currentState(objectId)!, "print.stl")?.representationId).toBe(stl.id);
    const undone = g.undo(objectId)!;
    // The STL was added by the last commit, so undoing removes it from the current state.
    expect(formOf(undone, "print.stl")).toBeUndefined();
    expect(formOf(undone, "delivery.godot")?.representationId).toBe(asset.id);
    expect(g.versionChain(objectId)).toHaveLength(versions);   // nothing destroyed
  });

  it("redo follows the branch line instead of guessing at a fork", () => {
    const { objectId, stl } = buildRocket();
    g.undo(objectId);
    g.undo(objectId);
    expect(g.redo(objectId)!.seq).toBe(4);
    expect(formOf(g.redo(objectId)!, "print.stl")?.representationId).toBe(stl.id);
    expect(g.redo(objectId)).toBeNull();   // already at the tip
  });

  it("refuses to fork a branch silently when the view is behind the tip", () => {
    const { objectId } = buildRocket();
    g.undo(objectId);
    expect(() => g.setProperties(objectId, { title: "oops" })).toThrow(DivergedHistory);
    // Naming the branch makes it explicit, and then it is allowed.
    const branched = g.commitVersion({ objectId, properties: { title: "Variant" }, branchName: "variant" });
    expect(branched.branchName).toBe("variant");
  });
});

describe("branches are explicit", () => {
  it("gives every object a main branch whose tip advances on commit", () => {
    const { objectId } = buildRocket();
    const branches = g.listBranches(objectId);
    expect(branches).toHaveLength(1);
    expect(branches[0]!.name).toBe("main");
    expect(branches[0]!.headVersionId).toBe(g.currentState(objectId)!.versionId);
  });

  it("keeps both rockets when you go back and take a different path", () => {
    const { objectId, mesh } = buildRocket();
    const atMesh = g.versionChain(objectId).find((v) => v.label === "make it 3D")!;

    const wide = g.addRepresentation({
      objectId, modality: "mesh", format: "glb",
      blobHash: g.putBlob(Buffer.from("wide wings"), "model/gltf-binary", "glb"),
      provenance: "deterministic", provider: "local.blender",
    });
    const branch = g.branchFrom({
      versionId: atMesh.id, name: "wide-wings",
      forms: [{ role: "model.mesh", representationId: wide.id }],
    });

    expect(branch.branchName).toBe("wide-wings");
    expect(g.listBranches(objectId).map((b) => b.name).sort()).toEqual(["main", "wide-wings"]);
    expect(g.headsOf(objectId)).toHaveLength(2);          // both lines survive
    expect(formOf(branch, "model.mesh")?.representationId).toBe(wide.id);
    // The branch inherits what it did not change, and not what came after its fork point.
    expect(formOf(branch, "source.primary")).toBeDefined();
    expect(formOf(branch, "print.stl")).toBeUndefined();

    // Switching back restores the other line exactly.
    const main = g.listBranches(objectId).find((b) => b.name === "main")!;
    const restored = g.switchBranch(objectId, main.id)!;
    expect(formOf(restored, "model.mesh")?.representationId).toBe(mesh.id);
    expect(formOf(restored, "print.stl")).toBeDefined();
  });
});

describe("representation lineage", () => {
  it("walks the STL all the way back to the original circle", () => {
    const { circle, image, mesh, asset, stl } = buildRocket();
    expect(g.ancestryOf(stl.id).map((s) => s.representationId))
      .toEqual([stl.id, asset.id, mesh.id, image.id, circle.id]);
  });

  it("records a composite's inputs with distinct roles", () => {
    const { world, objectId, image } = buildRocket();
    const style = g.addRepresentation({
      objectId, modality: "image", format: "png",
      blobHash: g.putBlob(Buffer.from("style ref"), "image/png", "png"), provenance: "imported",
    });
    const action = g.beginAction({
      worldId: world.id, intent: "restyle", tool: "image.generate",
      plan: plan("image.generate", "restyle"), permissionLevel: "CREATE",
      provenance: "mock", provider: "mock.image",
    });
    const { representations } = g.commitResult({
      actionId: action.id, objectId,
      representations: [{
        objectId, modality: "image", format: "png",
        blobHash: g.putBlob(Buffer.from("restyled"), "image/png", "png"),
        producedByActionId: action.id, provenance: "mock", provider: "mock.image",
      }],
      formRoles: ["art.illustration"],
      inputs: [
        { representationId: image.id, role: "source" },
        { representationId: style.id, role: "style" },
      ],
      cost: cost(0.05),
    });

    const inputs = g.inputsOf(action.id);
    expect(inputs.map((i) => i.role).sort()).toEqual(["source", "style"]);
    expect(g.edgesInto(representations[0]!.id)).toHaveLength(2);
  });

  it("keeps representation_edges exactly equal to inputs x outputs", () => {
    buildRocket();
    expect(g.verifyLineageConsistency()).toEqual({ ok: true, missing: [], extra: [] });
  });

  it("counts every generated root in the lineage, not just the target", () => {
    const { world, objectId, image, stl } = buildRocket();
    expect(g.costOfLineage(stl.id).usd).toBeCloseTo(0.42, 6);

    // A style reference generated on its own: no inbound edge, but it cost real money.
    const styleAction = g.beginAction({
      worldId: world.id, intent: "make a style reference", tool: "image.generate",
      plan: plan("image.generate", "style"), permissionLevel: "CREATE",
      provenance: "mock", provider: "mock.image",
    });
    const style = g.commitResult({
      actionId: styleAction.id, objectId,
      representations: [{
        objectId, modality: "image", format: "png",
        blobHash: g.putBlob(Buffer.from("style"), "image/png", "png"),
        producedByActionId: styleAction.id, provenance: "mock", provider: "mock.image",
      }],
      formRoles: [null], cost: cost(0.07), commitVersion: false,
    }).representations[0]!;

    const composite = g.beginAction({
      worldId: world.id, intent: "restyle", tool: "image.generate",
      plan: plan("image.generate", "restyle"), permissionLevel: "CREATE",
      provenance: "mock", provider: "mock.image",
    });
    const out = g.commitResult({
      actionId: composite.id, objectId,
      representations: [{
        objectId, modality: "image", format: "png",
        blobHash: g.putBlob(Buffer.from("restyled"), "image/png", "png"),
        producedByActionId: composite.id, provenance: "mock", provider: "mock.image",
      }],
      formRoles: ["art.illustration"],
      inputs: [
        { representationId: image.id, role: "source" },
        { representationId: style.id, role: "style" },
      ],
      cost: cost(0.03),
    }).representations[0]!;

    // 0.10 (image) + 0.07 (the style reference's own generation) + 0.03 (the composite)
    expect(g.costOfLineage(out.id).usd).toBeCloseTo(0.20, 6);
    expect(g.actionsInLineage(out.id).map((a) => a.intent).sort())
      .toEqual(["make a style reference", "make it a rocket", "restyle"]);
  });
});

describe("the commit is all-or-nothing", () => {
  it("leaves no representation and no running action when the commit throws", () => {
    const { world, objectId } = buildRocket();
    const before = g.listRepresentations(objectId).length;
    const versionsBefore = g.versionChain(objectId).length;

    const action = g.beginAction({
      worldId: world.id, intent: "will fail", tool: "3d.export",
      plan: plan("3d.export", "will fail"), permissionLevel: "CREATE",
      provenance: "deterministic", provider: "local.blender",
    });

    expect(() => g.commitResult({
      actionId: action.id, objectId,
      representations: [
        { objectId, modality: "mesh", format: "stl",
          blobHash: g.putBlob(Buffer.from("ok"), "model/stl", "stl"),
          producedByActionId: action.id, provenance: "deterministic" },
        // A dangling object id blows up partway through, after the first row is written.
        { objectId: "11111111-1111-4111-8111-111111111111", modality: "mesh", format: "stl",
          provenance: "deterministic" },
      ],
      formRoles: ["print.stl", null],
    })).toThrow();

    expect(g.listRepresentations(objectId)).toHaveLength(before);
    expect(g.versionChain(objectId)).toHaveLength(versionsBefore);
    expect(g.getAction(action.id)!.status).toBe("running");   // never falsely completed
    expect(g.verifyLineageConsistency().ok).toBe(true);
  });
});

describe("blob storage", () => {
  it("keeps every asset on disk and no bytes in the database", () => {
    const { objectId } = buildRocket();
    const reps = g.listRepresentations(objectId);
    expect(reps.every((r) => r.blobHash !== null)).toBe(true);

    const tables = (g.db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    ).all() as Array<{ name: string }>).map((t) => t.name);
    for (const table of tables) {
      for (const row of g.db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>) {
        for (const [column, value] of Object.entries(row)) {
          expect(Buffer.isBuffer(value) || value instanceof Uint8Array,
            `${table}.${column} holds raw bytes; assets belong on disk`).toBe(false);
        }
      }
    }
  });

  it("stores identical bytes once, so a version chain stays cheap", () => {
    const w = g.createWorld({ title: "t", emoji: "x" });
    const o = g.createObject({ worldId: w.id, semanticType: "t", title: "t" }).object;
    const a = g.putBlob(Buffer.from("same"), "text/plain", "txt");
    const b = g.putBlob(Buffer.from("same"), "text/plain", "txt");
    expect(a).toBe(b);
    g.addRepresentation({ objectId: o.id, modality: "text", format: "txt", blobHash: a, provenance: "human" });
    g.addRepresentation({ objectId: o.id, modality: "text", format: "txt", blobHash: b, provenance: "human" });
    expect((g.db.prepare(`SELECT refcount FROM blobs WHERE sha256 = ?`).get(a) as { refcount: number }).refcount).toBe(2);
  });
});

describe("work built against a version the person has moved past", () => {
  it("refuses to commit onto a head it never saw", () => {
    const { objectId } = buildRocket();
    const base = g.currentState(objectId)!.versionId;

    // The person renames the Object while a long job is still running.
    g.setProperties(objectId, { title: "Rocket, second pass" });

    const rep = g.addRepresentation({
      objectId, modality: "mesh", format: "stl",
      blobHash: g.putBlob(Buffer.from("late output"), "application/octet-stream", "stl"),
      provenance: "deterministic",
    });

    expect(() => g.commitVersion({
      objectId, expectedBaseVersionId: base,
      forms: [{ role: "print.stl", representationId: rep.id }],
    })).toThrow(StaleBaseVersion);

    // And the rename survives, which is the whole point.
    expect(g.currentState(objectId)!.properties.title).toBe("Rocket, second pass");
  });

  it("commits normally when nothing moved underneath it", () => {
    const { objectId } = buildRocket();
    const base = g.currentState(objectId)!.versionId;
    const rep = g.addRepresentation({
      objectId, modality: "mesh", format: "stl",
      blobHash: g.putBlob(Buffer.from("on time"), "application/octet-stream", "stl"),
      provenance: "deterministic",
    });
    const state = g.commitVersion({
      objectId, expectedBaseVersionId: base,
      forms: [{ role: "print.stl", representationId: rep.id }],
    });
    expect(formOf(state, "print.stl")?.representationId).toBe(rep.id);
  });

  it("keeps a late job's output as a conflict instead of losing it or publishing it", () => {
    const { objectId, stl } = buildRocket();
    const base = g.currentState(objectId)!.versionId;

    g.setProperties(objectId, { title: "changed mid-flight" });

    const action = g.beginAction({
      worldId: g.currentState(objectId)!.object.worldId, intent: "printable", tool: "3d.export",
      plan: plan("3d.export", "printable"), permissionLevel: "CREATE",
      provenance: "deterministic", provider: "local.blender",
      model: null, toolVersion: "blender 5.2.0", generationParams: {},
    });
    const result = g.commitResult({
      actionId: action.id, objectId,
      representations: [{
        objectId, modality: "mesh", format: "stl",
        blobHash: g.putBlob(Buffer.from("late stl"), "application/octet-stream", "stl"),
        producedByActionId: action.id, provenance: "deterministic", provider: "local.blender",
      }],
      formRoles: ["print.stl"],
      inputs: [], cost: cost(0), label: "printable",
      expectedBaseVersionId: base,
    });

    expect(result.conflict).toBeInstanceOf(StaleBaseVersion);
    // The bytes are kept — the work was real.
    expect(result.representations).toHaveLength(1);
    expect(g.getRepresentation(result.representations[0]!.id)).not.toBeNull();
    // But the published form is still the one the person is looking at.
    expect(formOf(g.currentState(objectId)!, "print.stl")?.representationId).toBe(stl.id);
  });
});
