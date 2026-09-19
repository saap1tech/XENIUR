import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InputRole, WorkGoal, WorldSnapshot } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import { PermissionBroker } from "@xeniur/permissions";
import { loadProvidersConfig, type ProviderEnv } from "@xeniur/providers";
import { CapabilityRouter } from "@xeniur/router";
import { World } from "./World.js";

/**
 * The World screen rendered against real router output — the same graph rows the desktop
 * app reads. This is where "the loop produced something" meets "a person can see it".
 */
const ROOT = process.cwd();
let dir: string, graph: ObjectGraph, snapshot: WorldSnapshot, meshRepId: string;

beforeAll(async () => {
  // World.tsx reads window.xeniur for blob URLs and lineage; SSR has no window.
  (globalThis as { window?: unknown }).window = {
    xeniur: {
      blobs: { url: (h: string) => `xeniur-blob://asset/${h}` },
      sense: { map: async () => null, friction: async () => null },
    },
    addEventListener: () => {}, removeEventListener: () => {},
  };

  dir = mkdtempSync(join(tmpdir(), "xeniur-world-"));
  graph = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  const env: ProviderEnv = {
    scratchDir: join(dir, "scratch"), rootDir: ROOT,
    binaries: {
      ffmpeg: "/opt/homebrew/bin/ffmpeg",
      blender: "/Applications/Blender.app/Contents/MacOS/Blender",
    },
  };
  const router = new CapabilityRouter({
    graph, broker: new PermissionBroker(graph.db), config: loadProvidersConfig(ROOT), env,
  });

  const world = graph.createWorld({ title: "Asteroid Game", emoji: "🚀" });
  const rocket = graph.createObject({ worldId: world.id, semanticType: "rocket", title: "Rocket" }).object;

  const image = await router.image({ prompt: "a rocket illustration" }, {
    worldId: world.id, objectId: rocket.id,
    formRoles: ["art.illustration"], label: "rocket illustration",
  });
  const source = (id: string) => [{ representationId: id, role: "source" as InputRole }];
  const mesh = await router.to3D({ prompt: "a rocket", targetHeight: 3 }, {
    worldId: world.id, objectId: rocket.id,
    inputs: source(image.representations[0]!.id),
    formRoles: ["model.mesh"], label: "3D model",
  });
  meshRepId = mesh.representations[0]!.id;

  const states = graph.listStates(world.id);
  snapshot = {
    world, states,
    representations: states.flatMap((s) => graph.listRepresentations(s.object.id)),
    tasks: [], scene: null,
  };
}, 120_000);

afterAll(() => {
  graph.close();
  rmSync(dir, { recursive: true, force: true });
  delete (globalThis as { window?: unknown }).window;
});

const render = (selected?: string) => renderToStaticMarkup(
  <World snapshot={snapshot} tasks={[]} busy={false} initialSelection={selected ?? null}
    onBack={() => {}} onOpenObject={() => {}} onSubmit={() => {}}
    onApprove={() => {}} onReject={() => {}} />,
);

describe("the World shows what the loop produced", () => {
  it("names the world and lists the object", () => {
    const html = render();
    expect(html).toContain("Asteroid Game");
    expect(html).toContain("Rocket");
  });

  it("holds both forms simultaneously at the current version", () => {
    expect(snapshot.representations).toHaveLength(2);
    const state = snapshot.states[0]!;
    expect(state.forms.map((f) => f.role).sort()).toEqual(["art.illustration", "model.mesh"]);
    expect(state.forms.find((f) => f.role === "model.mesh")!.representationId).toBe(meshRepId);
    // One object, two modalities — the identity claim, straight out of the graph.
    expect(new Set(snapshot.representations.map((r) => r.objectId)).size).toBe(1);
  });

  it("names what it is showing, in the words a person would use", () => {
    const state = snapshot.states[0]!;
    const html = render(state.object.id);

    // The header says which thing, not which row: version numbers belong in History,
    // where somebody is actually asking about them.
    expect(html).toContain("Rocket");
    expect(html).not.toContain(`v${state.seq} ·`);
  });

  it("keeps the three zones in the same place whatever is selected", () => {
    for (const html of [render(), render(snapshot.states[0]!.object.id)]) {
      expect(html).toContain("xr-rail");
      expect(html).toContain("xr-centre");
      for (const zone of ["Sources", "Decisions", "Work", "Deliveries"]) {
        expect(html).toContain(zone);
      }
    }
  });

  it("shows forms by their human names, and no filenames", () => {
    const html = render(snapshot.states[0]!.object.id);
    expect(html).toContain("Artwork");
    expect(html).toContain("Model");
    // The addresses exist in the graph and stay there until somebody asks for them.
    expect(html).not.toContain("art.illustration");
    expect(html).not.toContain("model.mesh");
  });

  it("asks the five questions in the inspector, and no database ones", () => {
    const html = render(snapshot.states[0]!.object.id);
    for (const q of ["What is this?", "Why is it this way?", "What changed?",
                     "Is it ready?", "What can I safely do next?"]) {
      expect(html).toContain(q);
    }
    expect(html).not.toContain("representation");
    expect(html).not.toContain("Lineage");
  });

  it("labels the mock provenance in the interface, not just in the database", () => {
    expect(render()).toContain("MOCK");
  });

  it("offers language as a peer, attached to the situation rather than above it", () => {
    const html = render();
    expect(html).toContain("Use language for this");
    // Language is a shortcut into the same actions, never the centre of the screen.
    expect(html.indexOf("xr-language-dock")).toBeGreaterThan(html.indexOf("xr-scene"));
  });

  it("renders only registered components — no raw markup path exists", () => {
    const html = render();
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("xr-scene");
  });
});

/* M6 A1 — the goal is first-class: the reason above the thing in the hands. */
describe("the World organises around the goal", () => {
  const goal = (over: Partial<WorkGoal> = {}): WorkGoal => ({
    id: "77777777-7777-4777-8777-777777777777", worldId: snapshot.world.id,
    outcome: "Choose a jacket finish the client will accept", status: "making",
    focusObjectId: snapshot.states[0]!.object.id, requiredOutputs: [], openQuestionIds: [], nextActions: [],
    createdAt: 1, updatedAt: 1, lastActiveAt: 1, ...over,
  });
  const renderWith = (g: WorkGoal | null) => renderToStaticMarkup(
    <World snapshot={snapshot} tasks={[]} busy={false} initialSelection={snapshot.states[0]!.object.id} initialGoal={g}
      onBack={() => {}} onOpenObject={() => {}} onSubmit={() => {}} onApprove={() => {}} onReject={() => {}} />,
  );

  it("asks what the person is trying to accomplish when a World has no goal — and asks nothing else", () => {
    const html = renderWith(null);
    expect(html).toContain("What are you trying to accomplish?");
    expect(html).toContain("One sentence, in your words");
    expect(html).toContain(">Set it<");
    expect(html).not.toMatch(/profession|your role|researcher|designer/i);
    expect(html).not.toContain("xr-goalbar");
  });

  it("shows the goal as a sentence with the way of working, above the focus, once one exists", () => {
    const html = renderWith(goal());
    expect(html).toContain("xr-goalbar");
    expect(html).toContain("Choose a jacket finish the client will accept");
    expect(html).toContain('<option value="making" selected="">making</option>');
    expect(html).not.toContain("What are you trying to accomplish?");
    // The reason comes before the thing in the hands.
    expect(html.indexOf("xr-goalbar")).toBeLessThan(html.indexOf("xr-focusbar"));
  });

  it("offers every way of working, in any order — statuses are not stages", () => {
    const html = renderWith(goal({ status: "exploring" }));
    for (const s of ["exploring", "understanding", "making", "reviewing", "ready", "finished"]) {
      expect(html).toContain(`<option value="${s}"`);
    }
  });
});
