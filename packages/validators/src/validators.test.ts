import {findExecutable} from "../../../apps/desktop/src/main/binaries.js";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { NotReady } from "@xeniur/core";
import { ObjectGraph, ReadinessEvaluator, ideaDna, loadProfiles, ingredientsOf } from "@xeniur/graph";
import type { ProviderEnv } from "@xeniur/providers";
import { ValidationRunner } from "./index.js";

const ROOT = process.cwd();
const BLENDER = findExecutable("blender",process.env["XENIUR_BLENDER"]);
let dir: string, g: ObjectGraph, env: ProviderEnv, runner: ValidationRunner;
let readiness: ReadinessEvaluator, worldId: string, objectId: string;

/**
 * Real mesh fixtures, exported from the repo's own .blend at the start of the run.
 *
 * These used to be read from /tmp, which any clean machine — and any tidy one — does not
 * have. A test that depends on a path outside the repository is a test that fails for
 * everyone except the person who wrote it.
 */
let fixtures: string;
let rocketStl: Buffer, rocketGlb: Buffer;
/** Blender's own triangle count for the exported mesh — the number the validator must agree with. */
let blenderPolygons: number;

beforeAll(() => {
  fixtures = mkdtempSync(join(tmpdir(), "xeniur-validator-fixtures-"));
  const script = join(fixtures, "export.py");
  writeFileSync(script, `
import bpy, sys
out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out + "/rocket.glb", export_format="GLB", use_selection=True)
bpy.ops.wm.stl_export(filepath=out + "/rocket.stl", export_selected_objects=True)
# Blender's own count of what the exporters actually write: both GLB and STL triangulate, so
# the number the validator must agree with is the triangle count, not the quad count.
tris = 0
for o in bpy.context.scene.objects:
    if o.type == "MESH":
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
open(out + "/polygons.txt", "w").write(str(tris))
`);
  execFileSync(BLENDER, [
    "--background", join(ROOT, "assets", "rocket.blend"), "--python", script, "--", fixtures,
  ], { stdio: "ignore" });
  if (!existsSync(join(fixtures, "rocket.stl")) || !existsSync(join(fixtures, "rocket.glb"))) {
    throw new Error("Blender did not produce the mesh fixtures; is XENIUR_BLENDER set?");
  }
  rocketStl = readFileSync(join(fixtures, "rocket.stl"));
  rocketGlb = readFileSync(join(fixtures, "rocket.glb"));
  blenderPolygons = Number(readFileSync(join(fixtures, "polygons.txt"), "utf8").trim());
});
afterAll(() => { rmSync(fixtures, { recursive: true, force: true }); });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-validators-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  env = {
    scratchDir: join(dir, "scratch"), rootDir: ROOT,
    binaries: {
      ffmpeg: findExecutable("ffmpeg",process.env["XENIUR_FFMPEG"]),
      blender: findExecutable("blender",process.env["XENIUR_BLENDER"]),
    },
  };
  runner = new ValidationRunner(g, env);
  readiness = new ReadinessEvaluator(g, loadProfiles(ROOT));
  worldId = g.createWorld({ title: "Asteroid Game", emoji: "R" }).id;
  objectId = g.createObject({ worldId, semanticType: "rocket", title: "Rocket" }).object.id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const addForm = (role: string, bytes: Buffer, modality: "mesh" | "image", format: string,
                 provenance: "human" | "mock" | "deterministic" | "imported" | "generated") => {
  const rep = g.addRepresentation({
    objectId, modality, format,
    blobHash: g.putBlob(bytes, "application/octet-stream", format), provenance,
  });
  g.commitVersion({ objectId, forms: [{ role, representationId: rep.id }] });
  return rep;
};

describe("validators measure, they do not judge", () => {
  it("measures a real mesh with Blender and reports the numbers", async () => {
    addForm("print.stl", rocketStl, "mesh", "stl", "deterministic");
    const summary = await runner.validate(objectId, { only: ["mesh.polycount", "mesh.manifold", "mesh.watertight"] });

    const poly = summary.checks.find((c) => c.validator === "mesh.polycount")!;
    expect(poly.status).toBe("pass");
    // Not a magic number: the validator must report what Blender counts in the same file.
    expect(poly.detail["polygons"]).toBe(blenderPolygons);
    expect(poly.summary).toContain(`${blenderPolygons} polygons`);

    // The procedural rocket genuinely is not a clean solid, and the check says so plainly.
    const manifold = summary.checks.find((c) => c.validator === "mesh.manifold")!;
    expect(manifold.status).toBe("fail");
    expect(manifold.summary).toContain("non-manifold");
  }, 120_000);

  it("measures an image with sharp", async () => {
    const png = await sharp({
      create: { width: 2400, height: 1200, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
    }).png().toBuffer();
    addForm("delivery.retail", png, "image", "png", "human");

    const summary = await runner.validate(objectId, { only: ["image.dimensions", "image.filesize"] });
    const dims = summary.checks.find((c) => c.validator === "image.dimensions")!;
    expect(dims.detail["width"]).toBe(2400);
    expect(dims.summary).toBe("2400 x 1200");
    expect(summary.checks.find((c) => c.validator === "image.filesize")!.detail["bytes"])
      .toBeGreaterThan(0);
  }, 60_000);

  it("keeps every measurement rather than overwriting history", async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#fff" } }).png().toBuffer();
    addForm("delivery.web", png, "image", "png", "human");
    await runner.validate(objectId, { only: ["image.dimensions"] });
    await runner.validate(objectId, { only: ["image.dimensions"] });

    // Append-only: a check states what was true of a particular representation at a
    // particular moment, so deleting it would erase the record of a superseded form.
    const rows = g.db.prepare(
      `SELECT COUNT(*) AS n FROM checks WHERE object_id = ? AND validator = 'image.dimensions'`,
    ).get(objectId) as { n: number };
    expect(rows.n).toBe(2);

    // And each one says exactly what it measured.
    const check = g.db.prepare(
      `SELECT subject_kind, subject_id, subject_hash FROM checks
       WHERE object_id = ? AND validator = 'image.dimensions' ORDER BY at DESC LIMIT 1`,
    ).get(objectId) as { subject_kind: string; subject_id: string; subject_hash: string };
    const form = g.currentState(objectId)!.forms.find((f) => f.role === "delivery.web")!;
    expect(check.subject_kind).toBe("representation");
    expect(check.subject_id).toBe(form.representationId);
    expect(check.subject_hash).toBe(g.getRepresentation(form.representationId)!.blobHash);
  }, 60_000);

  it("records the validator version and the environment it ran in", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).png().toBuffer();
    addForm("delivery.web", png, "image", "png", "human");
    const summary = await runner.validate(objectId, { only: ["image.dimensions"] });
    const check = summary.checks[0]!;
    expect(check.validatorVersion).toBeTruthy();
    expect(check.runId).toBeTruthy();
    expect(check.subjectKind).toBe("representation");
  }, 60_000);
});

describe("provenance and human signal are gates, not conventions", () => {
  it("fails Ready for Client Delivery while anything is mock output", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#888" } }).png().toBuffer();
    addForm("art.primary", png, "image", "png", "mock");
    await runner.validate(objectId);

    const report = readiness.evaluate(objectId, "client")!;
    expect(report.ready).toBe(false);
    expect(report.blockers.some((b) => b.detail.includes("mock output"))).toBe(true);
  }, 120_000);

  it("fails only when every recorded root is generated, and passes once yours is in it", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#888" } }).png().toBuffer();
    addForm("art.primary", png, "image", "png", "generated");

    expect(ingredientsOf(g, objectId).humanSignalPresent).toBe(false);
    let summary = await runner.validate(objectId, { only: ["humanSignal.present"] });
    let check = summary.checks.find((c) => c.validator === "humanSignal.present")!;
    expect(check.status).toBe("fail");
    expect(check.summary).toContain("every recorded root is generated");

    addForm("source.primary", Buffer.from("my photograph"), "image", "png", "human");
    summary = await runner.validate(objectId, { only: ["humanSignal.present"] });
    check = summary.checks.find((c) => c.validator === "humanSignal.present")!;
    expect(check.status).toBe("pass");
    expect(ingredientsOf(g, objectId).counts).toMatchObject({ your_observation: 1, ai_suggested: 1 });
  }, 120_000);

  it("never reports unknown origin as AI origin", async () => {
    // A deterministic root: produced by a tool, with nobody recorded behind it.
    addForm("delivery.web", Buffer.from("from some tool"), "image", "png", "deterministic");

    const dna = ideaDna(g, { objectId });
    expect(dna.summary.counts.unattributed).toBe(1);
    expect(dna.summary.counts.ai_suggested).toBe(0);
    expect(dna.statements.some((s) => s.kind === "all_roots_generated")).toBe(false);
    expect(dna.statements.find((s) => s.kind === "origin_unknown")!.text)
      .toContain("Origin unknown");

    const summary = await runner.validate(objectId, { only: ["humanSignal.present"] });
    const check = summary.checks.find((c) => c.validator === "humanSignal.present")!;
    // A gap in the record is not evidence of generation, so it warns rather than failing.
    expect(check.status).toBe("warn");
    expect(check.summary).toContain("cannot tell whether a person made them");
  }, 120_000);

  it("reports a model applied to your own photograph, though the root is human", async () => {
    const mine = addForm("source.primary", Buffer.from("my photograph"), "image", "png", "human");

    // A model transforms it. The root stays human; the operation does not.
    const action = g.beginAction({
      worldId, intent: "restyle", tool: "image.generate",
      plan: { intent: "restyle", objects: [objectId], tool: "image.generate", args: {}, confirmation: false },
      permissionLevel: "CREATE", provenance: "generated", provider: "openai.image",
    });
    g.commitResult({
      actionId: action.id, objectId,
      representations: [{
        objectId, modality: "image", format: "png",
        blobHash: g.putBlob(Buffer.from("restyled"), "image/png", "png"),
        producedByActionId: action.id, provenance: "generated", provider: "openai.image",
      }],
      formRoles: ["art.primary"],
      inputs: [{ representationId: mine.id, role: "source" }],
    });

    const dna = ideaDna(g, { objectId });
    // Root classification alone would have said "1 of your observations" and stopped.
    expect(dna.summary.counts.your_observation).toBe(1);
    expect(dna.summary.modelTouchedSteps).toBe(1);
    expect(dna.statements.find((s) => s.kind === "model_applied")!.text)
      .toBe("A model was applied at 1 step");
    expect(dna.statements.find((s) => s.kind === "model_applied")!.representationIds)
      .toHaveLength(1);
  }, 120_000);

  it("has no verified-fact category to mislabel a well-formed file with", async () => {
    const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#111" } }).png().toBuffer();
    addForm("delivery.figure", png, "image", "png", "deterministic");
    await runner.validate(objectId, { only: ["image.dimensions"] });

    // The image passes its checks and is still not a claim about the world.
    const counts = ingredientsOf(g, objectId).counts as Record<string, number>;
    expect(counts["verified_fact"]).toBeUndefined();
    expect(counts["unattributed"]).toBe(1);
  }, 120_000);

  it("reports composition as counts, never as a percentage", async () => {
    addForm("source.primary", Buffer.from("mine"), "image", "png", "human");
    addForm("art.primary", Buffer.from("model output"), "image", "png", "generated");
    const summary = await runner.validate(objectId, { only: ["humanSignal.present"] });
    const text = summary.checks.find((c) => c.validator === "humanSignal.present")!.summary;
    expect(text).toMatch(/\d+ of your observations/);
    expect(text).not.toMatch(/%/);
  }, 120_000);
});

describe("readiness explains itself", () => {
  it("names the exact unmet requirement and what would move it forward", () => {
    const report = readiness.evaluate(objectId, "godot")!;
    expect(report.ready).toBe(false);
    expect(report.blockers[0]!.detail).toContain('there is no "delivery.godot" yet');
    expect(report.blockers[0]!.remedy).toBe("build delivery.godot");
  });

  it("enforces a numeric bound against what the validator actually measured", async () => {
    addForm("delivery.godot", rocketGlb, "mesh", "glb", "deterministic");
    await runner.validate(objectId, { only: ["mesh.polycount", "mesh.manifold"] });

    // A few hundred triangles is well under 50,000, so the ceiling is satisfied.
    const report = readiness.evaluate(objectId, "godot")!;
    const polycount = report.results.find((r) => JSON.stringify(r.requirement).includes("polycount"))!;
    expect(polycount.met).toBe(true);
    expect(polycount.detail).toContain(`${blenderPolygons} polygons`);
  }, 120_000);

  it("refuses to approve a release that is not ready, and says why", () => {
    expect(() => readiness.approve({ objectId, profileId: "godot" })).toThrow(NotReady);
    try {
      readiness.approve({ objectId, profileId: "godot" });
    } catch (err) {
      expect((err as NotReady).blockers.join(" ")).toContain("delivery.godot");
    }
  });

  it("stores the evidence a release was approved on", async () => {
    addForm("delivery.web", await sharp({ create: { width: 32, height: 32, channels: 3, background: "#fff" } }).png().toBuffer(), "image", "png", "human");
    await runner.validate(objectId);

    const release = readiness.approve({ objectId, profileId: "web", note: "first cut" });
    expect(release.profileId).toBe("web");
    expect(release.versionId).toBe(g.currentState(objectId)!.versionId);
    expect((release.evidence as { ready: boolean }).ready).toBe(true);
    expect(readiness.releasesOf(objectId)).toHaveLength(1);
  }, 120_000);
});

describe("evidence is about a named subject, not an object in general", () => {
  /** Replaces a form's bytes, exactly as a rebuild does. */
  const rebuildForm = async (role: string, marker: string) => {
    const png = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#123" },
    }).png().toBuffer();
    return addForm(role, Buffer.concat([png, Buffer.from(marker)]), "image", "png", "deterministic");
  };

  it("does not let a rebuilt form inherit the previous form's check", async () => {
    await rebuildForm("delivery.web", "v1");
    await runner.validate(objectId);
    expect(readiness.evaluate(objectId, "web")!.ready).toBe(true);

    // The form is rebuilt. The old measurement is still on record, but it is about bytes
    // that are no longer there, so readiness must stop accepting it.
    await rebuildForm("delivery.web", "v2-rebuilt");
    const report = readiness.evaluate(objectId, "web")!;
    expect(report.ready).toBe(false);
    expect(report.blockers.some((b) => b.detail.includes("previous version"))).toBe(true);

    // Re-measuring the new bytes restores it.
    await runner.validate(objectId);
    expect(readiness.evaluate(objectId, "web")!.ready).toBe(true);
  }, 120_000);

  it("says the file changed when the bytes moved under an existing measurement", async () => {
    const rep = await rebuildForm("delivery.web", "original");
    await runner.validate(objectId, { only: ["image.filesize"] });

    // Same representation row, different bytes behind it: the check no longer describes it.
    const other = g.putBlob(Buffer.from("completely different bytes"), "image/png", "png");
    g.db.prepare(`UPDATE representations SET blob_hash = ? WHERE id = ?`).run(other, rep.id);

    const report = readiness.evaluate(objectId, "web")!;
    expect(report.ready).toBe(false);
    expect(report.blockers.some((b) => b.detail.includes("changed after this was measured"))).toBe(true);
  }, 120_000);

  it("refuses a measurement that does not say what it measured", async () => {
    await rebuildForm("delivery.web", "v1");
    await runner.validate(objectId, { only: ["image.filesize"] });
    // Exactly the shape migration 6 leaves behind for pre-existing rows.
    g.db.prepare(
      `UPDATE checks SET subject_kind = 'unbound', subject_id = NULL, subject_hash = NULL`,
    ).run();

    const report = readiness.evaluate(objectId, "web")!;
    expect(report.ready).toBe(false);
    expect(report.blockers.some((b) => b.detail.includes("does not say what it measured"))).toBe(true);
  }, 120_000);

  it("does not let a release on one version approve the next", async () => {
    await rebuildForm("delivery.web", "v1");
    await runner.validate(objectId);
    const first = readiness.approve({ objectId, profileId: "web" });
    expect(first.versionId).toBe(g.currentState(objectId)!.versionId);
    expect(first.checkIds.length).toBeGreaterThan(0);
    expect(first.profileHash).toHaveLength(64);

    // A profile that requires a prior release is satisfied now...
    const requiresRelease = new ReadinessEvaluator(g, [{
      id: "handover", name: "Handover", gates: "artifact", tools: [], description: "", verifies: "",
      requires: [{ release: { profileId: "web" } }],
    }]);
    expect(requiresRelease.evaluate(objectId, "handover")!.ready).toBe(true);

    // ...and stops being satisfied the moment the Object moves on.
    await rebuildForm("delivery.web", "v2");
    const after = requiresRelease.evaluate(objectId, "handover")!;
    expect(after.ready).toBe(false);
    expect(after.blockers[0]!.detail).toContain("an earlier version was released");
  }, 120_000);
});
