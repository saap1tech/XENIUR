/**
 * Renders XENIUR's World interface to a standalone HTML file using the real components,
 * the real stylesheet and the real graph — a way to look at the interface without
 * launching the app. Assets are inlined as data: URIs so the file opens anywhere.
 *
 *   npm run preview:world
 *
 * It drives SceneRenderer directly rather than the World component, because World fetches
 * lineage in an effect and effects do not run during server rendering. The components,
 * bindings and Scene JSON are exactly what the app composes; only the data is supplied
 * up front instead of arriving asynchronously.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Representation, Scene } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import { SceneRenderer, type LineageView, type SceneBindings } from "@xeniur/ui";

const ROOT = process.cwd();
const DATA = process.env["XENIUR_DATA"] ?? join(homedir(), "Library", "Application Support", "Xeniur");
const OUT = process.argv[2] ?? join(ROOT, "world-preview.html");

const graph = ObjectGraph.open({ dbPath: join(DATA, "xeniur.db"), blobDir: join(DATA, "blobs") });

const world = graph.listWorlds().find((w) => graph.listObjects(w.id).length > 0);
if (!world) { console.error("no world has objects yet — run `npm run seed:demo` first"); process.exit(1); }

const states = graph.listStates(world.id);
const representations = states.flatMap((st) => graph.listRepresentations(st.object.id));
const selected = states[0]!;
const reps = graph.listRepresentations(selected.object.id);
const head = reps.at(-1)!;
// The mesh, not the STL: a viewport can actually show it.
const mesh = reps.filter((r) => r.format === "glb").at(-1) ?? head;

const lineage: Record<string, LineageView> = {
  [head.id]: {
    steps: graph.ancestryOf(head.id).map((s) => ({
      ...s, representation: graph.getRepresentation(s.representationId),
    })),
    actions: graph.actionsInLineage(head.id),
    totalUsd: graph.costOfLineage(head.id).usd,
  },
};

// Inline every asset so the page is self-contained.
const dataUrls = new Map<string, string>();
for (const rep of representations) {
  if (!rep.blobHash) continue;
  const row = graph.db.prepare(`SELECT mime FROM blobs WHERE sha256 = ?`).get(rep.blobHash) as { mime: string } | undefined;
  if (!row) continue;
  dataUrls.set(rep.blobHash, `data:${row.mime};base64,${graph.readBlob(rep.blobHash).toString("base64")}`);
}

const bindings: SceneBindings = {
  states: Object.fromEntries(states.map((s) => [s.object.id, s])),
  representations: Object.fromEntries(representations.map((r: Representation) => [r.id, r])),
  tasks: {}, lineage,
  blobUrl: (hash) => dataUrls.get(hash) ?? "",
};

const scene: Scene = {
  worldId: world.id, title: world.title, reason: `inspecting ${selected.properties.title} · v${selected.seq}`,
  root: {
    id: "root", component: "Canvas", layout: "column",
    children: [
      { id: "gallery", component: "Gallery", objectIds: states.map((s) => s.object.id), columns: 3 },
      { id: "compare", component: "Comparison", label: "Circle → rocket",
        leftRepresentationId: reps[0]!.id, rightRepresentationId: reps[1]!.id },
      { id: "viewport", component: "Viewport3D", representationId: mesh.id, background: "#0b0d12" },
      { id: "inspector", component: "Inspector", objectId: selected.object.id,
        showLineage: true, showProvenance: true },
    ],
  },
};

const markup = renderToStaticMarkup(<SceneRenderer scene={scene} bindings={bindings} />);
const css = readFileSync(join(ROOT, "apps/desktop/src/renderer/styles.css"), "utf8");

writeFileSync(OUT, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>XENIUR — ${world.title}</title>
<style>${css}</style></head>
<body><main class="xr-world">
  <header class="xr-world__head">
    <button type="button" class="xr-back">← Worlds</button>
    <h1>${world.emoji} ${world.title}</h1>
    <span class="xr-world__reason">${scene.reason}</span>
  </header>
  ${markup}
  <footer class="xr-say">
    <input placeholder="Say what to do with it…" value="">
    <button type="button" class="xr-button xr-button--primary">Go</button>
  </footer>
</main></body></html>`);

console.log(`wrote ${OUT}`);
console.log(`${world.emoji} ${world.title} — ${states.length} object(s), ${representations.length} representations`);
console.log(`lineage: ${lineage[head.id]!.steps.length} steps, ${lineage[head.id]!.actions.length} actions, $${lineage[head.id]!.totalUsd.toFixed(2)}`);
graph.close();
