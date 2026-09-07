/**
 * Runs the rocket loop into the desktop app's own database, so a freshly launched XENIUR
 * opens on something real rather than an empty World.
 *
 *   npm run seed:demo        (quit the app first — it holds the database open)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { InputRole } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import { PermissionBroker } from "@xeniur/permissions";
import { loadProvidersConfig, type ProviderEnv } from "@xeniur/providers";
import { CapabilityRouter } from "@xeniur/router";

const ROOT = process.cwd();
const DATA = process.env["XENIUR_DATA"] ?? join(homedir(), "Library", "Application Support", "Xeniur");

async function main(): Promise<void> {
  const graph = ObjectGraph.open({ dbPath: join(DATA, "xeniur.db"), blobDir: join(DATA, "blobs") });
  const env: ProviderEnv = {
    scratchDir: join(DATA, "scratch"), rootDir: ROOT,
    binaries: {
      ffmpeg: process.env["XENIUR_FFMPEG"] ?? "/opt/homebrew/bin/ffmpeg",
      blender: process.env["XENIUR_BLENDER"] ?? "/Applications/Blender.app/Contents/MacOS/Blender",
    },
  };
  const router = new CapabilityRouter({
    graph, broker: new PermissionBroker(graph.db), config: loadProvidersConfig(ROOT), env,
  });

  const world = graph.listWorlds().find((w) => w.title === "Asteroid Game")
    ?? graph.createWorld({ title: "Asteroid Game", emoji: "🚀" });

  if (graph.listObjects(world.id).length > 0) {
    console.log("Asteroid Game already has objects; nothing to seed.");
    graph.close();
    return;
  }

  const rocket = graph.createObject({ worldId: world.id, semanticType: "rocket", title: "Rocket" }).object;
  const circlePng = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 250, g: 250, b: 248, alpha: 1 } },
  }).composite([{
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
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

  const source = (id: string) => [{ representationId: id, role: "source" as InputRole }];
  console.log("→ rocket illustration");
  const image = await router.image({ prompt: "a rocket illustration" }, {
    worldId: world.id, objectId: rocket.id, inputs: source(circle.id), formRoles: ["art.illustration"], label: "rocket illustration",
  });
  console.log("→ 3D model");
  const mesh = await router.to3D({ prompt: "a rocket", targetHeight: 3 }, {
    worldId: world.id, objectId: rocket.id,
    inputs: source(image.representations[0]!.id), formRoles: ["model.mesh"], label: "3D model",
  });
  console.log("→ game asset");
  const asset = await router.execute(
    { intent: "make it game-ready", objects: [rocket.id], tool: "3d.process",
      args: { targetHeight: 1.5, shadeSmooth: true }, confirmation: false },
    { worldId: world.id, objectId: rocket.id,
      inputs: source(mesh.representations[0]!.id), formRoles: ["delivery.godot"], label: "game asset" },
  );
  console.log("→ printable model");
  await router.export({ format: "stl" }, {
    worldId: world.id, objectId: rocket.id,
    inputs: source(asset.representations[0]!.id), formRoles: ["print.stl"], label: "printable model",
  });

  const reps = graph.listRepresentations(rocket.id);
  console.log(`\nseeded: 1 object, ${reps.length} representations — ${reps.map((r) => r.format).join(" → ")}`);
  graph.close();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
