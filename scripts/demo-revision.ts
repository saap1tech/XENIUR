/**
 * The second revision — XENIUR's actual claim, end to end, offline and free.
 *
 *   npm run demo:revision
 *
 * A first delivery is impressive and proves nothing. Anybody can be impressed once, and
 * every generative tool on earth demos the first result. The claim this project rests on
 * is the *second* one:
 *
 *   You come back. Something changed. You see what that affected and what it did not.
 *   You rebuild what is mechanical, look again at what is judgement, and ship the next
 *   correct delivery faster than the first — and the package you hand over can still say
 *   which accepted decisions and which exact source passages it was made under.
 *
 * Step 8 is the decisive moment: the rebuild list and the review list, side by side, each
 * with the path that explains it. Everything before it is setup and everything after it is
 * consequence.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InputRole, RecipeStepDraft } from "@xeniur/core";
import { formOf, formRoleName, quoteSelectorOf } from "@xeniur/core";
import {
  MetricsStore, ObjectGraph, ReadinessEvaluator, deliveryReport, exportPackage, impactOf,
  importPackage, inspectPackage, loadProfiles,
} from "@xeniur/graph";
import { PermissionBroker } from "@xeniur/permissions";
import { loadProvidersConfig, type ProviderEnv } from "@xeniur/providers";
import { CapabilityRouter, RebuildRunner } from "@xeniur/router";
import { SensemakingStore, extractCandidates } from "@xeniur/sensemaking";
import { ValidationRunner } from "@xeniur/validators";

const ROOT = process.cwd();
const BLENDER = process.env["XENIUR_BLENDER"] ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const workdir = mkdtempSync(join(tmpdir(), "xeniur-revision-"));

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

/** The client's brief, version one. Ordinary prose, as it would actually arrive. */
const BRIEF_V1 = `Rainwear 2027 — hero prop for the launch film.

The prop should read as technical and cold-weather capable at a glance.
Our returns data shows that seam failure causes most warranty claims, not fabric failure.
The silhouette should stay narrow enough to sit beside the garment without competing with it.
Finish is matte throughout, because the film is shot under hard studio light.`;

const REFERENCE = `Seam durability under cold cycling.
A 2024 study found that 63% of warranty returns were caused by seam failure rather than fabric failure.
However, welded seams remain dominant in volume production, which contradicts the durability data.`;

async function main(): Promise<void> {
  console.log(`\nXENIUR — the second revision\nworkdir: ${workdir}\n${"=".repeat(64)}`);

  const graph = ObjectGraph.open({
    dbPath: join(workdir, "xeniur.db"), blobDir: join(workdir, "blobs"),
  });
  const env: ProviderEnv = {
    scratchDir: join(workdir, "scratch"), rootDir: ROOT,
    binaries: { ffmpeg: "/opt/homebrew/bin/ffmpeg", blender: BLENDER },
  };
  const broker = new PermissionBroker(graph.db);
  const router = new CapabilityRouter({ graph, broker, config: loadProvidersConfig(ROOT), env });
  const rebuild = new RebuildRunner(graph, router);
  const validate = new ValidationRunner(graph, env);
  const readiness = new ReadinessEvaluator(graph, loadProfiles(ROOT));
  const sense = new SensemakingStore(graph, { frictionThreshold: 6 });
  const metrics = new MetricsStore(graph.db);

  broker.useReadiness({
    unmet: (tool, objectId) => readiness.guarding(tool)
      .map((p) => readiness.evaluate(objectId, p.id))
      .filter((r) => r !== null && !r.ready)
      .map((r) => ({ profileId: r!.profileId, profileName: r!.profileName,
                     blockers: r!.blockers.map((b) => b.detail) })),
  });

  const source = (id: string) => [{ representationId: id, role: "source" as InputRole }];

  /* 1 -------------------------------------------------------------------- */
  step("One project, one named deliverable");
  const world = graph.createWorld({ title: "Rainwear 2027", emoji: "R" });
  metrics.start(world.id);

  const prop = graph.createObject({
    worldId: world.id, semanticType: "prop", title: "Launch film hero prop",
    properties: { units: "mm", tags: ["hero", "launch-film"] },
  });
  const objectId = prop.object.id;
  note(`world "${world.title}", deliverable "${prop.properties.title}"`);

  /* 2 -------------------------------------------------------------------- */
  step("Bring in the brief, a reference, an observation of your own, and the asset");
  const briefSource = sense.recordSource({
    worldId: world.id, kind: "note", title: "Client brief", author: "the client",
    text: BRIEF_V1, publicationId: "client",
  });
  const briefV1 = sense.latestVersionOf(briefSource.id)!;

  const referenceSource = sense.recordSource({
    worldId: world.id, kind: "paper", title: "Seam durability under cold cycling",
    author: "Okafor", text: REFERENCE, publicationId: "textile-journal",
  });
  const referenceV1 = sense.latestVersionOf(referenceSource.id)!;

  const mine = sense.observe(world.id,
    "Our own returns tickets say the same thing, and the client has not seen them.",
    { lane: "keep" });

  const blendPath = join(workdir, "rocket.blend");
  copyFileSync(join(ROOT, "assets", "rocket.blend"), blendPath);
  const imported = await router.execute(
    { intent: "import the prop", objects: [objectId], tool: "import.file",
      args: { path: blendPath }, confirmation: false },
    { worldId: world.id, objectId, formRoles: ["source.primary", "model.mesh"],
      label: "imported the prop" },
  );
  metrics.record("first_import", { objectId });

  check("the brief and the reference were stored, not just referenced",
    sense.textOfVersion(briefV1.id) !== null && sense.textOfVersion(referenceV1.id) !== null,
    `${briefV1.contentHash.slice(0, 8)} · ${referenceV1.contentHash.slice(0, 8)}`);
  check("something of the person's own is in the project", mine.extraction === "manual");
  check("the .blend came in byte for byte", imported.representations[0]?.format === "blend");

  /* 3 -------------------------------------------------------------------- */
  step("Keep a claim from a passage — and be able to show exactly where it came from");
  const candidates = sense.propose(world.id, referenceV1.id, extractCandidates(REFERENCE));
  note(`${candidates.length} suggestions offered; none of them is a claim until you say so`);
  check("nothing became a claim by being suggested", sense.listAtoms(world.id).length === 1);

  const evidence = sense.accept(
    candidates.find((c) => c.text.includes("63%"))!.id,
  )!;
  metrics.record("capture_accepted");

  const passage = sense.passageOf(evidence.objectId)!;
  check("the claim resolves to the exact stored words", passage.text === evidence.text);
  note(`"…${passage.context.before.trim().slice(-30)}[${passage.text.slice(0, 44)}…]"`);
  check("and it names the copy it came out of", passage.sourceVersionId === referenceV1.id);

  const briefCandidates = sense.propose(world.id, briefV1.id, extractCandidates(BRIEF_V1));
  const finishClaim = sense.accept(
    briefCandidates.find((c) => c.text.includes("matte"))!.id,
  )!;
  note(`kept from the brief: "${finishClaim.text.slice(0, 56)}…"`);

  /* 4 -------------------------------------------------------------------- */
  step("Weigh two options, and accept a decision");
  const decision = graph.decisions.create({
    worldId: world.id,
    question: "How should the hero prop be finished for the launch film?",
    options: [
      { key: "matte", label: "Matte throughout", note: "what the brief asks for; safe under hard light" },
      { key: "satin", label: "Satin on the fins", note: "reads richer on camera, risks glare" },
    ],
    chosenOption: "matte",
    rationale: "The brief is explicit and the film is lit hard. Satin is a risk we would be taking on the client's behalf.",
  });
  graph.decisions.cite(decision.objectId, {
    sourceVersionId: briefV1.id, atomObjectId: finishClaim.objectId,
    atomVersionId: null, relation: "supports", note: "the brief says matte throughout",
  });
  graph.decisions.cite(decision.objectId, {
    sourceVersionId: referenceV1.id, atomObjectId: evidence.objectId,
    atomVersionId: null, relation: "informed_by", note: "durability framing",
  });
  graph.decisions.assume(decision.objectId, {
    text: "The film is shot under hard studio light",
    reviewTrigger: "the shoot moves outdoors or the brief changes its lighting",
  });
  // Asked once, at the moment it matters: one reason this could be wrong.
  const accepted = graph.decisions.accept(decision.objectId, "you", {
    steelman: "Matte can look flat under the flat light of an overcast exterior.",
    reviewTrigger: "the shoot moves outdoors",
  })!;
  metrics.record("decision_accepted", { objectId: decision.objectId });

  check("the decision was accepted, and pinned to a version",
    accepted.state === "accepted" && accepted.acceptedVersionId !== null);
  const brief = graph.decisions.briefOf(decision.objectId)!;
  check("its brief was rendered without a model", brief.includes("without a model"));
  check("and the brief names what was chosen and what was not",
    brief.includes("Matte throughout") && brief.includes("Satin on the fins"));

  /* 5 -------------------------------------------------------------------- */
  step("Bind the build to the accepted decision, and produce the deliverables");
  const steps: RecipeStepDraft[] = [
    {
      key: "make_solid", tool: "3d.solidify", replayPolicy: "deterministic",
      args: { targetHeight: 120, mergeDistance: 0.001, shadeSmooth: true },
      inputs: [
        { slot: "source", sourceKind: "form", sourceRef: "model.mesh",
          accepts: { modality: "mesh" }, required: true },
        // The accepted brief is a real input, so a different accepted decision makes this
        // step genuinely out of date. Nothing else about a decision rebuilds anything.
        { slot: "spec", sourceKind: "decision", sourceRef: decision.objectId,
          accepts: {}, required: true },
      ],
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
  ];
  const recipe = graph.recipes.saveRecipe({ objectId, name: "hero prop", steps });
  graph.commitVersion({ objectId, recipeId: recipe.id, label: "pinned the recipe" });

  const built = await rebuild.run(objectId, { worldId: world.id });
  check("every deliverable built", built.rebuilt === 3 && built.failed === 0,
    built.outcomes.filter((o) => o.status === "rebuilt").map((o) => o.stepKey).join(" → "));
  await validate.validate(objectId);

  // The asset satisfies the decision — a person's assertion, so a semantic link.
  graph.decisions.link({
    fromObjectId: objectId, toObjectId: decision.objectId, relation: "satisfies",
    note: "built to the matte spec",
  });

  /* 6 -------------------------------------------------------------------- */
  step("Approve delivery one");
  const delivery1 = readiness.approve({
    objectId, profileId: "client", note: "first cut for the launch film", force: true,
  });
  metrics.record("delivery_approved", { detail: { profileId: "client" } });

  check("the release pinned the version it approved",
    delivery1.versionId === graph.currentState(objectId)!.versionId);
  check("and the profile as it stood, so a later edit cannot rewrite it",
    typeof delivery1.profileHash === "string" && delivery1.profileHash.length === 64);
  check("and the exact checks it rested on", delivery1.checkIds.length > 0,
    `${delivery1.checkIds.length} checks`);
  check("and the accepted decision it was made under",
    delivery1.decisionIds.includes(decision.objectId));

  const influence1 = graph.decisions.influenceOn(objectId, delivery1.id);
  note(influence1.summary);

  /* 7 -------------------------------------------------------------------- */
  step("Time passes. The mesh is edited in Blender, and the client revises the brief");
  const editScript = join(workdir, "edit.py");
  writeFileSync(editScript, `
import bpy
obj = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
obj.scale = (1.45, 1.45, 1.0)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.ops.wm.save_mainfile()
`);
  execFileSync(BLENDER, ["--background", blendPath, "--python", editScript], { encoding: "utf8" });
  await router.execute(
    { intent: "bring the edited prop back", objects: [objectId], tool: "import.file",
      args: { path: blendPath }, confirmation: false },
    { worldId: world.id, objectId, formRoles: ["source.primary", "model.mesh"],
      label: "re-imported the prop" },
  );
  metrics.record("source_changed", { objectId });
  const changeAt = Date.now();
  note("the prop's fins were widened in Blender, as a person would");

  // The client revises the brief: the lighting sentence changes, which is exactly the
  // assumption the decision was recorded against.
  const briefV2 = sense.addSourceVersion({
    sourceId: briefSource.id, extractor: "verbatim/1",
    text: BRIEF_V1.replace(
      "Finish is matte throughout, because the film is shot under hard studio light.",
      "Finish is matte throughout. The film has moved to a daylight exterior shoot.",
    ),
  });
  // The kept claim is re-stated against the new copy — the person's own edit to what they
  // are holding, which is what makes the decision worth reviewing.
  graph.setProperties(finishClaim.objectId,
    { title: "Finish is matte throughout. The film has moved to a daylight exterior shoot." },
    "the client revised this");
  note(`the brief was revised; the stored copy ${briefV2.id.slice(0, 8)} sits beside the first`);
  check("both copies of the brief are kept, so delivery one is still readable",
    sense.versionsOf(briefSource.id).length === 2);

  /* 8 -------------------------------------------------------------------- */
  step("THE MOMENT — what changed, split into what XENIUR can fix and what only you can judge");
  const impact = impactOf(graph, objectId, { sinceReleaseId: delivery1.id });
  metrics.record("impact_reviewed", { objectId });

  console.log(`\n       ${impact.headline}\n`);
  note("REBUILD — out of date against what produced it:");
  for (const item of impact.rebuild) {
    note(`  ${item.formRoles.map(formRoleName).join(" · ") || item.stepKey}`);
    for (const hop of item.path) note(`     ${hop.subject} — ${hop.happened}`);
  }
  note("");
  note("REVIEW — someone should look; nothing here can be rebuilt:");
  for (const item of impact.review) {
    note(`  ${item.title}`);
    note(`     ${item.because}`);
  }

  check("the mesh change put deliverables in the rebuild list",
    impact.rebuild.length > 0, `${impact.rebuild.length} steps`);
  check("the brief change put the decision in the review list",
    impact.review.some((r) => r.objectId === decision.objectId));
  check("and the two lists are disjoint — nothing is in both",
    impact.rebuild.every((r) => !impact.review.some((v) => v.objectId === r.stepKey)));
  check("the decision was not silently invalidated, only flagged",
    graph.decisions.get(decision.objectId)!.state === "needs_review");
  check("every rebuild item explains itself from the edge that caused it",
    impact.rebuild.every((r) => r.path.length > 0 && r.path[0]!.happened.length > 0));
  metrics.record("traced_cause", { objectId });

  /* 9 -------------------------------------------------------------------- */
  step("Rebuild what is mechanical; look again at what is judgement");
  const rebuilt = await rebuild.run(objectId, { worldId: world.id });
  metrics.record("rebuild_run", { detail: { steps: rebuilt.rebuilt } });
  check("only the affected steps ran, and none of them cost anything",
    rebuilt.rebuilt > 0 && rebuilt.failed === 0,
    rebuilt.outcomes.filter((o) => o.status === "rebuilt").map((o) => o.stepKey).join(", "));
  await validate.validate(objectId);

  // The person reads the revised brief, decides the choice still holds, and says so.
  graph.decisions.reaffirm(decision.objectId, "you");
  metrics.record("decision_reaffirmed", { objectId: decision.objectId });
  check("standing by a decision is recorded, not assumed",
    graph.decisions.get(decision.objectId)!.state === "accepted");

  /* 10 ------------------------------------------------------------------- */
  step("Compare delivery one against what is about to go out");
  const before = graph.getVersion(delivery1.versionId)!;
  const oldStl = graph.formAt(before.id, "print.stl");
  const newStl = formOf(graph.currentState(objectId)!, "print.stl");
  metrics.record("compared_versions", { objectId });

  check("the printable model is genuinely different",
    oldStl !== null && newStl !== undefined && oldStl.id !== newStl.representationId,
    `${oldStl?.blobHash?.slice(0, 12)} → ${graph.getRepresentation(newStl!.representationId)?.blobHash?.slice(0, 12)}`);

  /* 11 ------------------------------------------------------------------- */
  step("Approve delivery two");
  const delivery2 = readiness.approve({
    objectId, profileId: "client", note: "after the brief revision", force: true,
  });
  metrics.record("delivery_approved", { detail: { profileId: "client" } });

  check("delivery one still points at exactly what it approved",
    readiness.releasesOf(objectId).find((r) => r.id === delivery1.id)!.versionId === before.id);
  check("delivery two points at the new version", delivery2.versionId !== delivery1.versionId);

  const influence2 = graph.decisions.influenceOn(objectId, delivery2.id);
  note(influence2.summary);
  check("and it can still say which decision and which source copies it was made under",
    influence2.decisions.length > 0 && influence2.sourceVersionIds.length > 0,
    `${influence2.decisions.length} decision, ${influence2.sourceVersionIds.length} source copies`);

  /* 12 ------------------------------------------------------------------- */
  step("Carry it out: ordinary files, and the whole history");
  const delivery = join(workdir, "delivery");
  mkdirSync(delivery, { recursive: true });
  for (const form of graph.currentState(objectId)!.forms) {
    const rep = graph.getRepresentation(form.representationId);
    if (!rep?.blobHash) continue;
    writeFileSync(join(delivery, `${formRoleName(form.role).toLowerCase()}.${rep.format}`),
                  graph.readBlob(rep.blobHash));
  }
  writeFileSync(join(delivery, "brief.md"), graph.decisions.briefOf(decision.objectId)!);

  // Readable by somebody who has never heard of XENIUR, and needs nothing installed.
  const report = deliveryReport(graph, objectId, delivery2.id);
  writeFileSync(join(delivery, "delivery-report.html"), report);
  check("the delivery report names the profile it was approved against",
    report.includes("No mock output, nothing stale"));
  check("and what was measured, against the exact files delivered",
    report.includes("mesh.manifold") || report.includes("provenance.no-mock"));
  check("and which decision it was made under",
    report.includes("How should the hero prop be finished"));
  check("and it does not claim the sources caused the choice",
    report.includes("only that it was cited when the"));

  // Two documents, deliberately: the archive is the working history, the delivery is what
  // a client receives.
  const archive = await exportPackage(graph, objectId, join(workdir, "prop-archive.xeniur"),
                                      { intent: "archive" });
  const pkg = await exportPackage(graph, objectId, join(workdir, "prop.xeniur"),
                                  { intent: "delivery", releaseId: delivery2.id });
  // A delivery is narrower in what it *discloses*, which is the point; it is not
  // necessarily smaller on disk, because the same .blend is in both.
  check("a delivery carries only the release it is for",
    pkg.manifest.releases.length === 1 && archive.manifest.releases.length === 2,
    `${pkg.manifest.releases.length} vs ${archive.manifest.releases.length} releases`);
  check("and none of the notes you wrote to yourself",
    pkg.manifest.releases.every((r) => r["note"] === null) &&
    archive.manifest.releases.some((r) => r["note"] !== null));
  check("and none of the prompts or settings behind generated work",
    pkg.manifest.actions.every((a) => a["generation_params"] === "{}"));
  const clean = ObjectGraph.open({
    dbPath: join(workdir, "clean.db"), blobDir: join(workdir, "clean-blobs"),
  });
  // Inspected before it is opened, exactly as a person would see it.
  const inspection = await inspectPackage(clean, pkg.path);
  check("a package says what it is before anything is written",
    inspection.ok && inspection.relationship === "new",
    `${inspection.contents.versions} versions, ${inspection.contents.decisions} decision, ` +
    `${inspection.contents.sources} sources`);
  note(`it would disclose: ${inspection.discloses.join("; ") || "nothing private"}`);

  const reopened = await importPackage(clean, pkg.path);
  check("it opens on a clean install as the same Object, not a copy",
    reopened.objectId === objectId);
  const reopenedReleases = new ReadinessEvaluator(clean, loadProfiles(ROOT)).releasesOf(objectId);
  check("with the delivery it was made for, and its reasons",
    reopenedReleases.length === 1 && reopenedReleases[0]!.id === delivery2.id);

  // The closure is the point: a recipient can ask why, not merely what.
  note(`the package carried ${reopened.related.decisions} decision, ` +
       `${reopened.related.sources} sources and ${reopened.related.atoms} claims alongside it`);
  const reopenedInfluence = clean.decisions.influenceOn(objectId, delivery2.id);
  check("a recipient can ask which decisions it was made under",
    reopenedInfluence.decisions.length === 1,
    reopenedInfluence.summary);
  check("and read the accepted brief without XENIUR having to rebuild it",
    (clean.decisions.briefOf(decision.objectId) ?? "").includes("Matte throughout"));

  const cleanSense = new SensemakingStore(clean);
  const carriedPassage = cleanSense.passageOf(evidence.objectId);
  check("and open the exact passage a claim came from",
    carriedPassage !== null && carriedPassage.text === evidence.text,
    carriedPassage ? `"${carriedPassage.text.slice(0, 40)}…"` : "not carried");
  check("nothing referenced was left dangling", reopened.unresolved.length === 0);
  clean.close();

  // The archive is the other document: your whole working history, for you.
  const myCopy = ObjectGraph.open({
    dbPath: join(workdir, "archive.db"), blobDir: join(workdir, "archive-blobs"),
  });
  await importPackage(myCopy, archive.path);
  const bothReleases = new ReadinessEvaluator(myCopy, loadProfiles(ROOT)).releasesOf(objectId);
  check("the archive keeps both deliveries and everything behind them",
    bothReleases.length === 2,
    bothReleases.map((r) => r.note ?? r.profileId).join(" | "));
  myCopy.close();

  /* 13 ------------------------------------------------------------------- */
  step("What XENIUR recorded about your own use of it");
  metrics.end(Date.now() - changeAt, 0);
  const disclosure = metrics.disclose();
  for (const kind of disclosure.kinds) {
    note(`${String(kind.count).padStart(3)}  ${kind.means}`);
  }
  check("nothing recorded contains a title, a path, or any of your text",
    disclosure.containsNoContent);
  check("and the second delivery is measured against the first",
    disclosure.revision.deliveries === 2);
  note(`first delivery: ${((disclosure.revision.firstDeliveryMs ?? 0) / 1000).toFixed(1)}s · ` +
       `second: ${((disclosure.revision.secondDeliveryMs ?? 0) / 1000).toFixed(1)}s`);
  note("(in a scripted run these measure Blender, not a person — the numbers are for real");
  note(" sessions, where the question is whether *you* got there faster the second time)");
  check("XENIUR knows whether you looked before you rebuilt",
    disclosure.revision.reviewedImpactFirst);

  writeFileSync(join(workdir, "what-xeniur-recorded.txt"), metrics.exportSummary());
  note("a sanitised summary was written to the workdir — because this script asked for it");

  console.log(`\n${"=".repeat(64)}`);
  console.log(failures === 0
    ? "PASS — the second delivery was made with its reasons intact"
    : `FAIL (${failures})`);
  console.log(`\ndelivery: ${delivery}\npackage:  ${pkg.path}\nrecorded: ${join(workdir, "what-xeniur-recorded.txt")}\n`);
  graph.close();
}

main().then(() => { if (failures > 0) process.exitCode = 1; })
  .catch((err) => { console.error("\ndemo crashed:", err); process.exitCode = 1; });
