/**
 * The XENIUR asset pipeline, end to end, offline and free.
 *
 *   npm run demo:asset
 *
 * Import a real Blender prop, build its deliverables, validate them, release it, edit the
 * source outside XENIUR, bring it back, watch the right things go stale, rebuild only
 * those, compare, release again, and carry the whole thing out as one portable file.
 *
 * "Type a prompt, receive a 3D model" is a demo. This is the claim: a thing you already
 * own stays alive while you keep working on it.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InputRole, RecipeStepDraft } from "@xeniur/core";
import { formOf } from "@xeniur/core";
import { ObjectGraph, ReadinessEvaluator, exportPackage, importPackage, loadProfiles } from "@xeniur/graph";
import { PermissionBroker } from "@xeniur/permissions";
import { loadProvidersConfig, type ProviderEnv } from "@xeniur/providers";
import { CapabilityRouter, RebuildRunner } from "@xeniur/router";
import { ValidationRunner } from "@xeniur/validators";

const ROOT = process.cwd();
const BLENDER = process.env["XENIUR_BLENDER"] ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const workdir = mkdtempSync(join(tmpdir(), "xeniur-demo-"));

let failures = 0;
let stepNo = 0;

const step = (title: string): void => {
  stepNo += 1;
  console.log(`\n${String(stepNo).padStart(2, " ")}. ${title}`);
};
const check = (label: string, ok: boolean, detail = ""): void => {
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const note = (text: string): void => console.log(`       ${text}`);

async function main(): Promise<void> {
  console.log(`\nXENIUR asset pipeline\nworkdir: ${workdir}\n${"=".repeat(60)}`);

  const graph = ObjectGraph.open({
    dbPath: join(workdir, "xeniur.db"), blobDir: join(workdir, "blobs"),
  });
  const env: ProviderEnv = {
    scratchDir: join(workdir, "scratch"), rootDir: ROOT,
    binaries: { ffmpeg: "/opt/homebrew/bin/ffmpeg", blender: BLENDER },
  };
  const broker = new PermissionBroker(graph.db);
  const router = new CapabilityRouter({
    graph, broker, config: loadProvidersConfig(ROOT), env,
  });
  const rebuild = new RebuildRunner(graph, router);
  const validate = new ValidationRunner(graph, env);
  const readiness = new ReadinessEvaluator(graph, loadProfiles(ROOT));

  // Readiness gates actions in the same place money is gated.
  broker.useReadiness({
    unmet: (tool, objectId) => readiness.guarding(tool)
      .map((p) => readiness.evaluate(objectId, p.id))
      .filter((r) => r !== null && !r.ready)
      .map((r) => ({ profileId: r!.profileId, profileName: r!.profileName, blockers: r!.blockers.map((b) => b.detail) })),
  });

  const world = graph.createWorld({ title: "Asteroid Game", emoji: "R" });
  const source = (id: string) => [{ representationId: id, role: "source" as InputRole }];

  /* 1 -------------------------------------------------------------------- */
  step("Import a real Blender prop");
  const blendPath = join(workdir, "rocket.blend");
  copyFileSync(join(ROOT, "assets", "rocket.blend"), blendPath);

  const rocket = graph.createObject({
    worldId: world.id, semanticType: "rocket", title: "Rocket",
    properties: { units: "mm", tags: ["hero"] },
  });
  const objectId = rocket.object.id;

  const imported = await router.execute(
    { intent: "import the prop", objects: [objectId], tool: "import.file",
      args: { path: blendPath }, confirmation: false },
    { worldId: world.id, objectId, formRoles: ["source.primary", "model.mesh"], label: "imported rocket.blend" },
  );
  check("the .blend came in byte for byte", imported.representations[0]?.format === "blend");
  check("and a viewable mesh was extracted alongside it", imported.representations[1]?.format === "glb");

  /* 2 -------------------------------------------------------------------- */
  step("XENIUR identifies it as one Object");
  const afterImport = graph.currentState(objectId)!;
  check("one Object, two forms", graph.listObjects(world.id).length === 1 && afterImport.forms.length === 2,
    afterImport.forms.map((f) => f.role).join(", "));
  check("the original is kept as the source of truth",
    formOf(afterImport, "source.primary") !== undefined);

  /* 3 -------------------------------------------------------------------- */
  step("Define the recipe and build every deliverable");
  const steps: RecipeStepDraft[] = [
    {
      key: "make_solid", tool: "3d.solidify", replayPolicy: "deterministic",
      args: { targetHeight: 120, mergeDistance: 0.001, shadeSmooth: true },
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
  ];
  const recipe = graph.recipes.saveRecipe({ objectId, name: "asset", steps });
  graph.commitVersion({ objectId, recipeId: recipe.id, label: "pinned the recipe" });
  note(`recipe "${recipe.name}" revision ${recipe.revision}, ${recipe.steps.length} steps`);

  const built = await rebuild.run(objectId, { worldId: world.id });
  check("every deliverable built", built.rebuilt === 4 && built.failed === 0,
    built.outcomes.filter((o) => o.status === "rebuilt").map((o) => o.stepKey).join(" -> "));

  const afterBuild = graph.currentState(objectId)!;
  check("all of it is current simultaneously", afterBuild.forms.length === 6,
    afterBuild.forms.map((f) => f.role).sort().join(", "));

  /* 4 -------------------------------------------------------------------- */
  step("Validate what was produced");
  const validation = await validate.validate(objectId);
  note(`${validation.passed} passed, ${validation.warned} warned, ${validation.failed} failed`);
  for (const c of validation.checks.filter((c) => c.status === "fail")) {
    note(`  ${c.validator}: ${c.summary}`);
  }
  check("the validators actually measured the mesh",
    validation.checks.some((c) => c.validator === "mesh.polycount" && c.status === "pass"));
  check("and the turntable really is a video",
    validation.checks.some((c) => c.validator === "video.duration" && c.status === "pass"),
    validation.checks.find((c) => c.validator === "video.duration")?.summary ?? "");

  /* 5 -------------------------------------------------------------------- */
  step("Approve a release for 3D printing");
  let printReport = readiness.evaluate(objectId, "print3d")!;
  if (!printReport.ready) {
    note(`not ready yet: ${printReport.blockers.map((b) => b.detail).join("; ")}`);
  }
  check("Ready for 3D Print is decided from evidence, not assertion",
    printReport.results.length > 0);

  const release1 = readiness.approve({
    objectId, profileId: printReport.ready ? "print3d" : "godot",
    note: "first cut", force: !printReport.ready,
  });
  check("the release pinned this exact version", release1.versionId === afterBuild.versionId);
  check("and stored the evidence it was approved on",
    Object.keys(release1.evidence).includes("results"));

  /* 6 -------------------------------------------------------------------- */
  step("Modify the mesh outside XENIUR");
  const editScript = join(workdir, "edit.py");
  writeFileSync(editScript, `
import bpy
obj = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
# Widen the fins: exactly the kind of edit someone makes in Blender and brings back.
obj.scale = (1.45, 1.45, 1.0)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.ops.wm.save_mainfile()
print("XENIUR_EDIT:done")
`);
  execFileSync(BLENDER, ["--background", blendPath, "--python", editScript], { encoding: "utf8" });
  note("the .blend was edited in Blender, as a person would");

  /* 7 -------------------------------------------------------------------- */
  step("Return it to XENIUR");
  const reimported = await router.execute(
    { intent: "bring the edited prop back", objects: [objectId], tool: "import.file",
      args: { path: blendPath }, confirmation: false },
    { worldId: world.id, objectId, formRoles: ["source.primary", "model.mesh"], label: "re-imported rocket.blend" },
  );
  check("the same Object, a new version of its source",
    reimported.objectId === objectId &&
    graph.currentState(objectId)!.forms.length === 6);
  check("the source bytes really changed",
    formOf(graph.currentState(objectId)!, "source.primary")?.representationId
      !== formOf(afterImport, "source.primary")?.representationId);

  /* 8 -------------------------------------------------------------------- */
  step("XENIUR shows what is now stale, unprompted");
  const statuses = graph.recipes.statusOf(objectId);
  for (const s of statuses) note(`${s.stepKey.padEnd(12)} ${s.state.padEnd(12)} ${s.reason}`);
  check("everything downstream of the edit is out of date",
    statuses.filter((s) => s.state === "stale").length === 4,
    `${statuses.filter((s) => s.state === "stale").length} of ${statuses.length} steps`);

  /* 9 -------------------------------------------------------------------- */
  step("Preview the rebuild");
  const plan = rebuild.plan(objectId, () => 0);
  note(`will rebuild:   ${plan.willRebuild.map((s) => s.stepKey).join(", ") || "nothing"}`);
  note(`can regenerate: ${plan.canRegenerate.map((s) => s.stepKey).join(", ") || "nothing"}`);
  note(`waiting on you: ${plan.waitingOnYou.map((s) => s.stepKey).join(", ") || "nothing"}`);
  check("it is free, because none of this needs a model",
    plan.estimatedUsd === 0 && plan.canRegenerate.length === 0);

  /* 10 ------------------------------------------------------------------- */
  step("Rebuild only what the change affected");
  const stlBefore = formOf(graph.currentState(objectId)!, "print.stl")!.representationId;
  const rebuilt = await rebuild.run(objectId, { worldId: world.id });
  check("only the affected steps ran", rebuilt.rebuilt === 4 && rebuilt.failed === 0);
  check("nothing was generated on your behalf", rebuilt.candidates === 0);

  /* 11 ------------------------------------------------------------------- */
  step("Compare before and after");
  const stlAfter = formOf(graph.currentState(objectId)!, "print.stl")!.representationId;
  const before = graph.getRepresentation(stlBefore)!;
  const after = graph.getRepresentation(stlAfter)!;
  check("the printable model is genuinely different", before.blobHash !== after.blobHash);
  note(`before ${before.blobHash?.slice(0, 12)}  ->  after ${after.blobHash?.slice(0, 12)}`);

  await validate.validate(objectId);
  const dims = graph.db.prepare(
    `SELECT summary FROM checks WHERE object_id = ? AND validator = 'mesh.dimensions' LIMIT 1`,
  ).get(objectId) as { summary: string } | undefined;
  note(`dimensions now: ${dims?.summary ?? "unmeasured"}`);

  /* 12 ------------------------------------------------------------------- */
  step("Approve the new release");
  const nowReport = readiness.evaluate(objectId, "print3d")!;
  const release2 = readiness.approve({
    objectId, profileId: "print3d", note: "wider fins", force: !nowReport.ready,
  });
  check("a second release, pinned to the new version",
    release2.versionId === graph.currentState(objectId)!.versionId &&
    readiness.releasesOf(objectId).length === 2);
  check("the first release still points at what it approved",
    readiness.releasesOf(objectId)[1]!.versionId === afterBuild.versionId);

  /* 13 ------------------------------------------------------------------- */
  step("Export a portable .xeniur and ordinary delivery files");
  const pkgPath = join(workdir, "rocket.xeniur");
  const pkg = await exportPackage(graph, objectId, pkgPath);
  check("the package carries the whole history",
    pkg.manifest.versions.length >= 4 && pkg.manifest.representations.length >= 6,
    `${pkg.manifest.versions.length} versions, ${pkg.manifest.representations.length} representations, ${(pkg.bytes / 1024).toFixed(0)} KB`);

  const delivery = join(workdir, "delivery");
  mkdirSync(delivery, { recursive: true });
  const state = graph.currentState(objectId)!;
  const names: Record<string, string> = {
    "delivery.godot": "rocket.glb", "print.stl": "rocket.stl",
    "preview.thumbnail": "thumbnail.png", "preview.turntable": "turntable.mp4",
  };
  for (const [role, filename] of Object.entries(names)) {
    const form = formOf(state, role);
    const rep = form ? graph.getRepresentation(form.representationId) : null;
    if (rep?.blobHash) writeFileSync(join(delivery, filename), graph.readBlob(rep.blobHash));
  }
  writeFileSync(join(delivery, "README.txt"),
    [`${state.properties.title}`, ``,
     `Released against ${release2.profileId} on ${new Date(release2.approvedAt).toISOString()}.`,
     `Built from ${pkg.manifest.representations.length} representations across ${pkg.manifest.versions.length} versions.`,
     `Every file here is derived from rocket.blend; rocket.xeniur carries the history.`,
    ].join("\n"));

  // And it comes back into a clean install as the same Object.
  const clean = ObjectGraph.open({
    dbPath: join(workdir, "elsewhere.db"), blobDir: join(workdir, "elsewhere-blobs"),
  });
  const roundTrip = await importPackage(clean, pkgPath);
  check("it opens elsewhere as the same Object, not a copy",
    roundTrip.objectId === objectId && clean.currentState(objectId)!.properties.title === "Rocket");
  check("with its lineage intact", clean.verifyLineageConsistency().ok);
  clean.close();

  console.log(`\n${"=".repeat(60)}`);
  console.log(failures === 0 ? "PASS — the loop held together" : `FAIL (${failures})`);
  console.log(`\ndelivery: ${delivery}`);
  console.log(`package:  ${pkgPath}\n`);
  graph.close();
}

main()
  .then(() => { if (failures > 0) process.exitCode = 1; })
  .catch((err) => { console.error("\ndemo crashed:", err); process.exitCode = 1; });
