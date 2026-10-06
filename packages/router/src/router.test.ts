import {findExecutable} from "../../../apps/desktop/src/main/binaries.js";
import { sampleProvidersConfig } from "../../providers/src/test-config.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isApprovalRequired, type ActionPlan } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import { PermissionBroker } from "@xeniur/permissions";
import { loadProvidersConfig, ProviderRegistry, type ProviderEnv } from "@xeniur/providers";
import { CapabilityRouter } from "./index.js";
import { planForProposal, proposalsFor } from "@xeniur/grammar";

const ROOT = process.cwd();
let dir: string, g: ObjectGraph, router: CapabilityRouter, worldId: string, objectId: string;

const plan = (p: Partial<ActionPlan> & Pick<ActionPlan, "tool">): ActionPlan =>
  ({ intent: p.tool, objects: [], args: {}, confirmation: false, ...p });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-router-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  const env: ProviderEnv = {
    scratchDir: join(dir, "scratch"), rootDir: ROOT,
    binaries: { ffmpeg: findExecutable("ffmpeg",process.env["XENIUR_FFMPEG"]), blender: findExecutable("blender",process.env["XENIUR_BLENDER"]) },
  };
  router = new CapabilityRouter({
    graph: g, broker: new PermissionBroker(g.db),
    registry: new ProviderRegistry(), config: sampleProvidersConfig(ROOT), env,
  });
  worldId = g.createWorld({ title: "Test", emoji: "🧪" }).id;
  objectId = g.createObject({ worldId, semanticType: "rocket", title: "Rocket" }).object.id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("deterministic first, cheap model second, expensive generation last", () => {
  it("routes a resize to sharp, never to a generative provider", async () => {
    const { provider } = await router.route("image.transform");
    expect(provider.id).toBe("local.sharp");
    expect(provider.kind).toBe("deterministic");
  });

  it("routes mesh processing and export to local Blender", async () => {
    expect((await router.route("3d.process")).provider.id).toBe("local.blender");
    expect((await router.route("3d.export")).provider.id).toBe("local.blender");
  });

  it("falls through disabled cloud providers to the mock, and says why", async () => {
    const { provider, reason } = await router.route("3d.generate");
    expect(provider.id).toBe("mock.mesh");
    expect(reason).toContain("preferred");     // mock is first in order while cloud is off
  });

  it("refuses to route a deterministic tool to a generative provider, whatever config says", async () => {
    // The scenario the guard exists for: a third-party capability that claims a tool the
    // tool table says never needs to leave the machine.
    const registry = new ProviderRegistry();
    registry.register({
      id: "someones.image.api", kind: "generative", tools: ["image.transform"],
      available: async () => ({ ok: true }),
      execute: async () => { throw new Error("should never be reached"); },
    });
    const config = sampleProvidersConfig(ROOT);
    config.capabilities["transform"] = { order: ["someones.image.api", "local.sharp"] };

    const misconfigured = new CapabilityRouter({
      graph: g, broker: new PermissionBroker(g.db), registry, config,
      env: { scratchDir: join(dir, "s"), rootDir: ROOT, binaries: { ffmpeg: findExecutable("ffmpeg",process.env["XENIUR_FFMPEG"]), blender: findExecutable("blender",process.env["XENIUR_BLENDER"]) } },
    });
    await expect(misconfigured.route("image.transform")).rejects.toThrow("routing rule violated");
  });

  it("reports the tool as unavailable when nothing configured supports it", async () => {
    const config = sampleProvidersConfig(ROOT);
    config.capabilities["transform"] = { order: ["openai.image"] };  // wrong tool entirely
    const empty = new CapabilityRouter({
      graph: g, broker: new PermissionBroker(g.db), registry: new ProviderRegistry(), config,
      env: { scratchDir: join(dir, "s"), rootDir: ROOT, binaries: { ffmpeg: findExecutable("ffmpeg",process.env["XENIUR_FFMPEG"]), blender: findExecutable("blender",process.env["XENIUR_BLENDER"]) } },
    });
    await expect(empty.route("image.transform")).rejects.toThrow("nothing in config supports");
  });

  it("keeps every cloud provider unusable while its key and model are unverified", async () => {
    const registry = new ProviderRegistry();
    const env: ProviderEnv = { scratchDir: dir, rootDir: ROOT, binaries: { ffmpeg: "x", blender: "y" } };
    for (const id of ["openai.image", "meshy", "runway"]) {
      const state = await registry.get(id)!.available(env);
      expect(state.ok, `${id} must not be reachable`).toBe(false);
    }
  });
});

describe("every action is attributable", () => {
  it("records provider, model, tool version, params and cost on a generated representation", async () => {
    const result = await router.image({ prompt: "a rocket", width: 256, height: 256 }, { worldId, objectId });

    expect(result.provider).toBe("mock.image");
    expect(result.representations).toHaveLength(1);

    const rep = result.representations[0]!;
    expect(rep.provenance).toBe("mock");
    expect(rep.provider).toBe("mock.image");
    expect(rep.model).toBe("mock.image/v1");
    expect(rep.toolVersion).toBe("xeniur mock 0.1.0");
    expect(rep.generationParams["prompt"]).toBe("a rocket");
    expect(rep.blobHash).not.toBeNull();

    const action = result.action;
    expect(action.provider).toBe("mock.image");
    expect(action.toolVersion).not.toBeNull();
    expect(action.status).toBe("completed");
    expect(action.cost.ms).toBeGreaterThanOrEqual(0);
  });

  it("leaves no action without a provider or a tool version", async () => {
    await router.image({ prompt: "x", width: 64, height: 64 }, { worldId, objectId });
    await router.execute(plan({ tool: "object.update", args: { title: "Renamed" } }), { worldId, objectId });

    const rows = g.db.prepare(`SELECT provider, provenance, tool_version, cost FROM actions`).all() as
      Array<{ provider: string | null; provenance: string; tool_version: string | null; cost: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.provider).not.toBeNull();
      expect(r.tool_version).not.toBeNull();
      expect(r.provenance).not.toBe("");
      expect(JSON.parse(r.cost)).toHaveProperty("usd");
    }
  });

  it("marks a failed action failed rather than leaving it running", async () => {
    await expect(router.execute(plan({ tool: "image.transform", args: {} }), { worldId, objectId, inputs: [] }))
      .rejects.toThrow();
    const row = g.db.prepare(`SELECT status, error FROM actions ORDER BY rowid DESC LIMIT 1`)
      .get() as { status: string; error: string | null };
    expect(row.status).toBe("failed");
    expect(row.error).toBeTruthy();
  });
});

describe("the permission gate sits in front of every side effect", () => {
  it("parks a form submission before any provider is consulted", async () => {
    try {
      await router.execute(
        plan({ tool: "browser.submit", args: { action: "Book court", when: "5:00 PM", priceUsd: 18 } }),
        { worldId, objectId },
      );
      expect.unreachable("submitting should require approval");
    } catch (err) {
      expect(isApprovalRequired(err)).toBe(true);
    }
    // Nothing was even recorded as attempted, because the gate is first.
    expect(g.db.prepare(`SELECT COUNT(*) AS n FROM actions`).get()).toEqual({ n: 0 });
  });

  it("lets reversible local work through without asking", async () => {
    const result = await router.execute(
      plan({ tool: "object.move", args: { x: 40, y: 12 } }), { worldId, objectId },
    );
    expect(result.action.status).toBe("completed");
    // A move is a property change, so it commits a version rather than mutating in place.
    expect(g.currentState(objectId)!.properties.settings).toMatchObject({ x: 40, y: 12 });
    expect(g.undo(objectId)!.properties.settings["x"]).toBeUndefined();
  });
});

describe("budget ceilings", () => {
  it("refuses an action that would exceed the per-action cap", async () => {
    const config = sampleProvidersConfig(ROOT);
    config.budget.perActionUsdMax = 0.0001;
    config.providers["mock.image"] = { enabled: true, kind: "generative", price: { perImageUsd: 5 } };

    const registry = new ProviderRegistry();
    const original = registry.get("mock.image")!;
    registry.register({ ...original, kind: "generative" });   // pretend it costs money

    const tight = new CapabilityRouter({
      graph: g, broker: new PermissionBroker(g.db), registry, config,
      env: { scratchDir: join(dir, "s2"), rootDir: ROOT, binaries: { ffmpeg: findExecutable("ffmpeg",process.env["XENIUR_FFMPEG"]), blender: findExecutable("blender",process.env["XENIUR_BLENDER"]) } },
    });
    await expect(tight.image({ prompt: "expensive" }, { worldId, objectId }))
      .rejects.toThrow("perActionUsdMax");
  });
});

/* M6 A3 — a chosen drop lands. It had been enqueued and committed as an empty version. */
describe("gesture outcomes are applied, not merely versioned", () => {
  it("a semantic link drop creates the link", async () => {
    const claim = g.createObject({ worldId, semanticType: "claim", title: "Taped seams hold" }).object.id;
    const proposal = proposalsFor(
      { id: claim, title: "Taped seams hold", semanticType: "claim" },
      { id: objectId, title: "Rocket", kind: "object" },
    ).find((p) => p.label === "Inform design decision")!;
    await router.execute(planForProposal(proposal), { worldId, objectId: claim });
    expect(g.decisions.linksFrom(claim).map((l) => [l.toObjectId, l.relation])).toEqual([[objectId, "informed_by"]]);
  });

  it("an alternative dropped on a decision becomes an unchosen option", async () => {
    const decision = g.decisions.create({ worldId, question: "Which seam?", options: [{ key: "welded", label: "Welded", note: "" }], chosenOption: null });
    const alt = g.createObject({ worldId, semanticType: "alternative", title: "Taped" }).object.id;
    const proposal = proposalsFor(
      { id: alt, title: "Taped", semanticType: "alternative" },
      { id: decision.objectId, title: "Which seam?", kind: "decision" },
    )[0]!;
    expect(proposal.label).toBe("Add as an option");
    await router.execute(planForProposal(proposal), { worldId, objectId: decision.objectId });
    const detail = g.decisions.detail(decision.objectId)!;
    expect(detail.options.map((o) => o.label)).toEqual(["Welded", "Taped"]);
    expect(detail.chosenOption).toBeNull();
  });

  it("a question dropped on Work becomes a next action on the goal — and refuses without a goal", async () => {
    const q = g.createObject({ worldId, semanticType: "question", title: "Does the 63% hold in mild climates?" }).object.id;
    const proposal = proposalsFor(
      { id: q, title: "Does the 63% hold in mild climates?", semanticType: "question" },
      { id: worldId, title: "Work", kind: "work" },
    )[0]!;
    await expect(router.execute(planForProposal(proposal), { worldId, objectId: q })).rejects.toThrow(/no goal/);
    const goal = g.goals.create(worldId, "Decide the seam");
    await router.execute(planForProposal(proposal), { worldId, objectId: q });
    const next = g.goals.get(goal.id)!.nextActions;
    expect(next.map((a) => [a.text, a.objectId])).toEqual([["Does the 63% hold in mild climates?", q]]);
  });

  it("a source dropped on a claim proposes evidence and counter-evidence, never a fact", () => {
    const labels = proposalsFor(
      { id: objectId, title: "Study 4", semanticType: "paper" },
      { id: "11111111-1111-4111-8111-111111111111", title: "A claim", kind: "claim" },
    ).map((p) => p.label);
    expect(labels).toEqual(["Propose as evidence", "Propose as counter-evidence"]);
  });
});
