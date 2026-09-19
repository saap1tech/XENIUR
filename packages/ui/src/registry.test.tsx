import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SCENE_COMPONENTS,
  type ObjectState, type ReadinessReport, type Representation, type Scene, type Task,
} from "@xeniur/core";
import {
  COMPONENT_REGISTRY, SceneRenderer, planScene, validateScene, emptyBindings, requestGesture,
  semanticDescription, type SceneBindings,
} from "./index.js";

const OBJ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORLD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TASK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const state: ObjectState = {
  object: {
    id: OBJ, worldId: WORLD, parentId: null, currentVersionId: null,
    currentBranchId: null, createdAt: 0, archivedAt: null,
  },
  versionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", seq: 2, branchId: null, branchName: "main",
  properties: { title: "Rocket", semanticType: "rocket", traits: ["spatial", "printable", "versioned"], tags: [], dimensions: null, units: null, settings: {} },
  forms: [{ role: "art.primary", representationId: REP }],
  recipeId: null,
};
const representation: Representation = {
  id: REP, objectId: OBJ, modality: "image", format: "png", blobHash: "a".repeat(64),
  producedByActionId: null, provenance: "mock", provider: "mock.image",
  model: "mock.image/v1", toolVersion: "xeniur mock 0.1.0", generationParams: {}, createdAt: 0,
};
const task: Task = {
  id: TASK, worldId: WORLD, title: "Book tennis", status: "needs_approval", tool: "browser.submit",
  payload: {}, progress: 0.4, detail: "Book court · 5:00 PM · $18", error: null,
  attempts: 1, createdAt: 0, updatedAt: 0,
};

const bindings = (): SceneBindings => ({
  ...emptyBindings(),
  states: { [OBJ]: state }, representations: { [REP]: representation }, tasks: { [TASK]: task },
  blobUrl: (h) => `xeniur-blob://${h}`,
});

const scene = (root: Scene["root"]): Scene => ({ worldId: WORLD, title: "t", reason: "r", root });

describe("the registry is closed", () => {
  it("implements every declared component", () => {
    const implemented = new Set(Object.keys(COMPONENT_REGISTRY));
    for (const name of SCENE_COMPONENTS) {
      if (name === "Canvas") continue;   // the renderer itself is the only container
      expect(implemented.has(name), `${name} is declared but not implemented`).toBe(true);
    }
    expect(implemented.size).toBe(SCENE_COMPONENTS.length - 1);
  });

  it("contains exactly the 51 reviewed primitives", () => {
    // M5: Stage 1 added ClaimPair and TrustStrip; Stage 3 ModelSetup; Stage 5 ContextReview; Stage 8 FocusContract.
    // Growing this number is a deliberate act: what should grow is the combination table.
    expect(SCENE_COMPONENTS).toHaveLength(51);
  });

  it("refuses a node naming a component that does not exist", () => {
    const plan = planScene({ id: "x", component: "ShellExec", objectId: OBJ } as never);
    expect(plan.renderable).toHaveLength(0);
    expect(plan.refusals).toEqual([
      { id: "x", component: "ShellExec", reason: "not in the XENIUR component registry" },
    ]);
  });

  it("renders nothing for a refused node and reports it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refused: unknown[] = [];
    const html = renderToStaticMarkup(
      <SceneRenderer
        scene={scene({ id: "root", component: "Canvas", layout: "free",
          children: [
            { id: "ok", component: "ObjectCard", objectId: OBJ, x: 0, y: 0, width: 200, selected: false },
            { id: "bad", component: "ArbitraryHtml", html: "<script>alert(1)</script>" } as never,
          ] })}
        bindings={bindings()}
        onRefusal={(r) => refused.push(...r)}
      />,
    );
    expect(html).toContain("Rocket");
    expect(html).not.toContain("script");
    expect(html).not.toContain("ArbitraryHtml");
    expect(refused).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects Scene JSON that fails the schema before anything renders", () => {
    expect(validateScene({ worldId: "not-a-uuid", root: {} }).ok).toBe(false);
    expect(validateScene({
      worldId: WORLD, title: "", reason: "",
      root: { id: "r", component: "ObjectCard", objectId: OBJ },
    }).ok).toBe(true);
  });

  it("rejects unknown props on a known component, so a node cannot smuggle fields", () => {
    const result = validateScene({
      worldId: WORLD, root: { id: "r", component: "ObjectCard", objectId: OBJ, onClick: "fetch('http://x')" },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Unrecognized key");
  });
});

describe("visual interaction has a semantic twin", () => {
  it("routes pointer and keyboard gestures to the same proposal request", () => {
    const onGestureTarget = vi.fn();
    const wired = { ...bindings(), onGestureTarget };
    requestGesture(wired, OBJ, WORLD, "pointer");
    requestGesture(wired, OBJ, WORLD, "keyboard");
    expect(onGestureTarget.mock.calls).toEqual([[OBJ, WORLD], [OBJ, WORLD]]);
  });

  it("names subjects and values without exposing component names", () => {
    const compiled: Scene = {
      ...scene({ id: "r", component: "ObjectOrbit", focusId: OBJ, relatedIds: [], state: "selected", disclosure: 2 }),
      focusId: OBJ,
    };
    const words = semanticDescription(compiled, bindings());
    expect(words).toContain("Focused on Rocket");
    expect(words).not.toContain("ObjectOrbit");
  });
});

describe("provenance is always visible", () => {
  it("labels a mock representation MOCK on the card", () => {
    const html = renderToStaticMarkup(
      <SceneRenderer
        scene={scene({ id: "r", component: "ObjectCard", objectId: OBJ, x: 0, y: 0, width: 200, selected: false })}
        bindings={bindings()} />,
    );
    expect(html).toContain("MOCK");
    expect(html).toContain("xr-badge--mock");
  });

  it("shows the model and tool version in the Inspector", () => {
    const html = renderToStaticMarkup(
      <SceneRenderer
        scene={scene({ id: "r", component: "Inspector", objectId: OBJ, showLineage: true, showProvenance: true })}
        bindings={bindings()} />,
    );
    expect(html).toContain("mock.image/v1");
    expect(html).toContain("xeniur mock 0.1.0");
  });
});

describe("approval is stated in words a person can judge", () => {
  it("shows the preview line and what the level actually means", () => {
    const html = renderToStaticMarkup(
      <SceneRenderer
        scene={scene({ id: "r", component: "ApprovalDialog", taskId: TASK, level: "PURCHASE",
                       preview: "Book court · 5:00 PM · $18", detail: "Riverside Tennis" })}
        bindings={bindings()} />,
    );
    expect(html).toContain("Book court · 5:00 PM · $18");
    expect(html).toContain("This spends your money.");
    expect(html).toContain("Approve");
    expect(html).toContain("Decline");
  });

  it("offers approve and decline on a parked task in the Active list", () => {
    const html = renderToStaticMarkup(
      <SceneRenderer scene={scene({ id: "r", component: "TaskProgress", taskIds: [TASK] })} bindings={bindings()} />,
    );
    expect(html).toContain("xr-task--needs_approval");
    expect(html).toContain("Book court · 5:00 PM · $18");
  });
});

describe("untrusted surfaces stay empty in XENIUR's own renderer", () => {
  it("renders the browser as a bounds slot, never as embedded content", () => {
    const html = renderToStaticMarkup(
      <SceneRenderer
        scene={scene({ id: "r", component: "Browser", url: "https://example.com", viewId: "v1" })}
        bindings={bindings()} />,
    );
    expect(html).toContain('data-view-id="v1"');
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<webview");
  });
});

describe("readiness reads as a measurement, not a verdict", () => {
  const report = (over: Partial<ReadinessReport> = {}): ReadinessReport => ({
    profileId: "print3d", profileName: "Passes print geometry checks",
    verifies: "That an STL exists and its geometry is watertight. Wall thickness is not measured.",
    gates: "artifact", ready: true,
    results: [
      { requirement: { fresh: true }, met: true, detail: "every step is up to date", remedy: null },
      { requirement: { fresh: true }, met: true, detail: "watertight: true", remedy: null },
      { requirement: { fresh: true }, met: true, detail: "manifold: true", remedy: null },
    ],
    blockers: [], ...over,
  });

  const render = (r: ReadinessReport) => renderToStaticMarkup(
    <SceneRenderer
      bindings={{ ...bindings(), readiness: { [OBJ]: [r] } }}
      scene={scene({ id: "b", component: "ReadinessBoard", objectId: OBJ, showAll: false })}
    />,
  );

  it("counts the current measurements rather than showing a bare tick", () => {
    const html = render(report());
    expect(html).toContain("3/3 current measurements");
    expect(html).not.toContain(">Ready<");
    expect(html).not.toContain("✓");
  });

  it("says what a met profile establishes, beside the name", () => {
    const html = render(report());
    expect(html).toContain("Passes print geometry checks");
    expect(html).toContain("Wall thickness is not measured");
  });

  it("counts down the moment a measurement stops applying", () => {
    const results = report().results;
    const stale = {
      requirement: results[1]!.requirement, met: false,
      detail: "measured on a previous version of print.stl", remedy: "re-check print.stl",
    };
    const html = render(report({
      ready: false, results: [results[0]!, stale, results[2]!], blockers: [stale],
    }));
    expect(html).toContain("2/3 current measurements");
    expect(html).toContain("measured on a previous version of print.stl");
  });
});
