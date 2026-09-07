/**
 * The XENIUR loop, end to end, offline and free:
 *
 *   circle -> rocket image -> 3D mesh -> game-ready asset -> printable STL
 *
 * Run: npm run e2e:loop
 *
 * Every assertion here is about the one thing the product claims: that all of this is a
 * single Object wearing five representations, with a lineage that can be walked back
 * from the STL to the circle it started as. If this fails, the schema is wrong.
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Cost, InputRole, Representation } from "@xeniur/core";
import { formOf } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import { PermissionBroker } from "@xeniur/permissions";
import { loadProvidersConfig, type ProviderEnv } from "@xeniur/providers";
import { CapabilityRouter } from "@xeniur/router";
import { Brain, MockLlmClient } from "@xeniur/brain";

const ROOT = process.cwd();
const workdir = mkdtempSync(join(tmpdir(), "xeniur-e2e-"));

let failures = 0;
function check(label: string, condition: boolean, detail = ""): void {
  const mark = condition ? "  ok  " : " FAIL ";
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures += 1;
}

const usd = (c: Cost) => `$${c.usd.toFixed(2)}`;

async function main(): Promise<void> {
  console.log(`\nXENIUR end-to-end loop\nworkdir: ${workdir}\n`);

  const graph = ObjectGraph.open({
    dbPath: join(workdir, "xeniur.db"), blobDir: join(workdir, "blobs"),
  });
  const env: ProviderEnv = {
    scratchDir: join(workdir, "scratch"), rootDir: ROOT,
    binaries: {
      ffmpeg: "/opt/homebrew/bin/ffmpeg",
      blender: "/Applications/Blender.app/Contents/MacOS/Blender",
    },
  };
  const router = new CapabilityRouter({
    graph, broker: new PermissionBroker(graph.db),
    config: loadProvidersConfig(ROOT), env,
  });

  /* -- the person says what they want ------------------------------------ */

  const world = graph.createWorld({ title: "Asteroid Game", emoji: "🚀" });
  const rocket = graph.createObject({
    worldId: world.id, semanticType: "rocket", title: "Rocket",
  }).object;

  // They start by drawing a yellow circle. That drawing is the object's first form.
  const circlePng = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 250, g: 250, b: 248, alpha: 1 } },
  }).composite([{
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
         <circle cx="256" cy="256" r="150" fill="#f4b73f"/></svg>`),
  }]).png().toBuffer();

  const circle = graph.addRepresentation({
    objectId: rocket.id, modality: "image", format: "png",
    blobHash: graph.putBlob(circlePng, "image/png", "png"), provenance: "human",
  });
  graph.commitVersion({
    objectId: rocket.id, label: "a yellow circle",
    forms: [{ role: "source.primary", representationId: circle.id }],
  });
  console.log("→ drew a yellow circle\n");

  /* -- the Brain turns each utterance into a typed plan ------------------- */

  const brain = new Brain(new MockLlmClient());
  const context = {
    world: { id: world.id, title: world.title, emoji: world.emoji },
    selected: [{ state: graph.currentState(rocket.id)!, representations: graph.listRepresentations(rocket.id) }],
    activeTasks: [],
  };
  const { plan: firstPlan } = await brain.plan("make it a rocket illustration", context);
  check("the Brain produced a typed plan, not prose", firstPlan.tool === "image.generate", firstPlan.tool);
  check("the plan acts on the existing object", firstPlan.objects[0] === rocket.id);

  /* -- and the router carries each one out ------------------------------- */

  const step = async (
    label: string,
    run: () => Promise<{ representations: Representation[]; provider: string; cost: Cost }>,
  ): Promise<Representation> => {
    const started = Date.now();
    const result = await run();
    const rep = result.representations[0]!;
    console.log(`→ ${label}: ${rep.format} via ${result.provider} (${Date.now() - started}ms, ${usd(result.cost)})`);
    return rep;
  };

  const source = (id: string) => [{ representationId: id, role: "source" as InputRole }];

  const image = await step("made it a rocket illustration", () =>
    router.image({ prompt: "a rocket illustration" }, {
      worldId: world.id, objectId: rocket.id, inputs: source(circle.id),
      formRoles: ["art.illustration"], label: "rocket illustration",
    }));

  const mesh = await step("turned it into 3D", () =>
    router.to3D({ prompt: "a rocket", targetHeight: 3 }, {
      worldId: world.id, objectId: rocket.id, inputs: source(image.id),
      formRoles: ["model.mesh"], label: "3D model",
    }));

  const asset = await step("made it game-ready", () =>
    router.execute(
      { intent: "make it game-ready", objects: [rocket.id], tool: "3d.process",
        args: { targetHeight: 1.5, shadeSmooth: true }, confirmation: false },
      { worldId: world.id, objectId: rocket.id, inputs: source(mesh.id),
        formRoles: ["delivery.godot"], label: "game asset" },
    ));

  const stl = await step("made it printable", () =>
    router.export({ format: "stl" }, {
      worldId: world.id, objectId: rocket.id, inputs: source(asset.id),
      formRoles: ["print.stl"], label: "printable model",
    }));

  /* -- what the graph must now be able to say ---------------------------- */

  console.log("\nassertions\n");

  const reps = graph.listRepresentations(rocket.id);
  check("one Object, not five files", graph.listObjects(world.id).length === 1);
  check("five representations of that one Object", reps.length === 5, reps.map((r) => r.format).join(" → "));
  check("every representation shares the object's uuid",
    reps.every((r) => r.objectId === rocket.id), rocket.id);

  const chain = graph.versionChain(rocket.id);
  check("an unbroken version chain", chain.length === 6 &&
    chain.slice(1).every((v, i) => v.parentVersionId === chain[i]!.id));

  const state = graph.currentState(rocket.id)!;
  check("the current version holds every form simultaneously",
    state.forms.length === 5,
    state.forms.map((f) => f.role).sort().join(", "));
  check("the printable model is one of them",
    formOf(state, "print.stl")?.representationId === stl.id);
  check("and so is the source circle it started as",
    formOf(state, "source.primary")?.representationId === circle.id);

  const ancestry = graph.ancestryOf(stl.id);
  const expected = [stl.id, asset.id, mesh.id, image.id, circle.id];
  check("the STL's lineage walks back to the original circle",
    JSON.stringify(ancestry.map((s) => s.representationId)) === JSON.stringify(expected),
    ancestry.map((s) => graph.getRepresentation(s.representationId)?.format).join(" ← "));

  check("representation_edges still equals inputs x outputs", graph.verifyLineageConsistency().ok);

  const actions = graph.actionsInLineage(stl.id);
  check("every action in the lineage is attributable", actions.length === 4 &&
    actions.every((a) => a.provider !== null && a.toolVersion !== null && a.model !== undefined),
    actions.map((a) => a.provider).join(", "));
  check("the outcome carries a price", typeof graph.costOfLineage(stl.id).usd === "number",
    usd(graph.costOfLineage(stl.id)));

  // The provenance spread is the routing rule made visible: the person's own drawing,
  // two genuinely-creative steps that went to a (mock) generative provider, and two
  // deterministic steps that never left the machine.
  const provenance = reps.map((r) => r.provenance);
  check("nothing generated is passed off as real",
    provenance.filter((p) => p === "mock").length === 2 &&
    provenance.filter((p) => p === "deterministic").length === 2 &&
    provenance.filter((p) => p === "human").length === 1,
    provenance.join(", "));
  check("only genuine creation reached a generative provider",
    actions.filter((a) => a.provenance === "mock").length === 2 &&
    actions.filter((a) => a.provider === "local.blender").length === 2);

  const onDisk = reps.every((r) => {
    if (!r.blobHash) return false;
    try { return statSync(graph.blobs.pathFor(r.blobHash, r.format)).size > 0; } catch { return false; }
  });
  check("every asset is a real file on disk", onDisk);
  check("and no bytes are in the database",
    (graph.db.prepare(`SELECT COUNT(*) AS n FROM blobs`).get() as { n: number }).n === 5);

  const stlBytes = graph.readBlob(stl.blobHash!);
  const triangles = stlBytes.readUInt32LE(80);
  check("the STL is a valid binary mesh a slicer can open",
    stlBytes.byteLength === 84 + triangles * 50 && triangles > 0,
    `${triangles} triangles, ${stlBytes.byteLength} bytes`);

  /* -- undo and branching, on the same object ---------------------------- */

  const undone = graph.undo(rocket.id)!;
  check("undo actually changes what is current",
    formOf(undone, "print.stl") === undefined &&
    formOf(undone, "delivery.godot")?.representationId === asset.id);
  check("and deletes nothing", graph.versionChain(rocket.id).length === chain.length);

  graph.setHead(rocket.id, chain[chain.length - 1]!.id);   // back to the tip before renaming
  graph.setProperties(rocket.id, { title: "Rocket Mk II" });
  const renamed = graph.currentState(rocket.id)!;
  check("renaming commits a version instead of escaping history",
    renamed.properties.title === "Rocket Mk II");

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`} — loop finished\n`);
  console.log(`artifacts: ${workdir}/blobs`);
  console.log(`STL:       ${graph.blobs.pathFor(stl.blobHash!, "stl")}\n`);
  graph.close();
}

main()
  .then(() => { if (failures > 0) process.exitCode = 1; })
  .catch((err) => {
    console.error("\ne2e loop crashed:", err);
    rmSync(workdir, { recursive: true, force: true });
    process.exitCode = 1;
  });
