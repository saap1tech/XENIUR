import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalRequired, SEMANTIC_TRAITS } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import { PermissionBroker } from "@xeniur/permissions";
import {
  INTERACTIONS, MEANINGS, TASK_STATES, SituationSchema, chooseProposal, compileSituation,
  layoutScene, meaningsForTraits, modifiersFor, primitiveFor, proposalsFor, type GestureProposal,
} from "./index.js";

const WORLD = "11111111-1111-4111-8111-111111111111";
const FOCUS = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const CONSTRAINT = "44444444-4444-4444-8444-444444444444";

const situation = (over: Record<string, unknown> = {}) => SituationSchema.parse({
  worldId: WORLD, title: "Rainwear 2027", meaning: "relationship", interaction: "connect",
  goal: { kind: "create", description: "Turn research into a delivery-ready jacket", deliverableId: FOCUS },
  scope: { worldId: WORLD, objectIds: [FOCUS, OTHER], externalContextAllowed: false },
  taskStates: ["selected"],
  focus: { kind: "object", id: FOCUS, label: "Jacket" },
  objects: [
    { id: FOCUS, title: "Jacket", semanticType: "object", traits: ["deliverable", "printable", "versioned"], formRoles: ["art.primary"] },
    { id: OTHER, title: "Interview claim", semanticType: "claim", traits: [], formRoles: ["atom.text"] },
  ],
  changes: [], capabilities: ["transform"], constraints: [], choices: [], layer: 2,
  ...over,
});

describe("the three-dimensional grammar", () => {
  it("resolves every meaning and interaction, and every state has a modifier", () => {
    for (const meaning of MEANINGS) for (const interaction of INTERACTIONS) {
      expect(primitiveFor(meaning, interaction).length, `${meaning} + ${interaction}`).toBeGreaterThan(0);
    }
    for (const state of TASK_STATES) expect(modifiersFor(state)).toBeDefined();
    for (const trait of SEMANTIC_TRAITS) expect(meaningsForTraits([trait]), trait).not.toHaveLength(0);
  });

  it("is semantically stable and independent of layout policy", () => {
    const first = compileSituation(situation());
    const second = compileSituation(situation());
    expect(second).toEqual(first);
    const changedLayout = layoutScene(first, { layoutId: "alternate-layout", slotOrder: ["constraints"] });
    expect(compileSituation(situation())).toEqual(first);
    expect(changedLayout.layoutId).toBe("alternate-layout");
  });

  it("keeps slot order stable when only content changes", () => {
    const first = compileSituation(situation({ title: "Rainwear 2027" }));
    const second = compileSituation(situation({ title: "Rainwear 2028" }));
    const a = layoutScene(first, { layoutId: first.layoutId });
    const b = layoutScene(second, { layoutId: first.layoutId, slotOrder: first.concepts.map((c) => c.id) });
    expect(b.slots.map((slot) => slot.nodeId)).toEqual(a.slots.map((slot) => slot.nodeId));
    expect(b.root.component).toBe("Canvas");
  });

  it("always holds the declared focus in the centre slot", () => {
    const semantic = compileSituation(situation());
    const scene = layoutScene(semantic, { layoutId: semantic.layoutId });
    const centre = scene.slots.find((slot) => slot.role === "centre")!;
    const concept = semantic.concepts.find((item) => item.id === centre.nodeId)!;
    expect(scene.focusId).toBe(FOCUS);
    expect(concept.subjectId).toBe(FOCUS);
    expect(scene.slots.filter((slot) => slot.role === "centre")).toHaveLength(1);
  });

  it("makes goal explicit and prevents out-of-scope context from influencing a compile", () => {
    const outside = "55555555-5555-4555-8555-555555555555";
    const scoped = compileSituation(situation({
      objects: [
        { id: FOCUS, title: "Jacket", semanticType: "object", traits: ["deliverable"], formRoles: [] },
        { id: OTHER, title: "Claim", semanticType: "claim", traits: [], formRoles: [] },
        { id: outside, title: "Private note", semanticType: "note", traits: ["priced"], formRoles: [] },
      ],
      capabilities: ["transform", "external:private-search"],
    }));
    expect(scoped.goal.kind).toBe("create");
    expect(scoped.scope.externalContextAllowed).toBe(false);
    expect(scoped.concepts.some((concept) => concept.props["objectIds"] instanceof Array &&
      (concept.props["objectIds"] as string[]).includes(outside))).toBe(false);
  });

  it("rejects a scope that omits either the focus or the declared deliverable", () => {
    expect(() => situation({
      scope: { worldId: WORLD, objectIds: [OTHER], externalContextAllowed: false },
    })).toThrow(/scope must include the focus/);
    expect(() => situation({
      goal: { kind: "deliver", deliverableId: OTHER },
      scope: { worldId: WORLD, objectIds: [FOCUS], externalContextAllowed: false },
    })).toThrow(/scope must include the goal deliverable/);
  });

  it("composes existing primitives from semantic traits", () => {
    const hotel = compileSituation(situation({
      meaning: "relationship", interaction: "choose",
      objects: [
        { id: FOCUS, title: "Hotel", semanticType: "hotel", traits: ["locatable", "priced", "temporal", "bookable"], formRoles: [] },
        { id: OTHER, title: "Alternative", semanticType: "hotel", traits: ["locatable"], formRoles: [] },
      ],
    }));
    expect(hotel.concepts.map((concept) => concept.component)).toContain("SchematicMap");
    expect(hotel.concepts.map((concept) => concept.component)).toContain("ChoiceCards");
  });
});

describe("direct manipulation", () => {
  it("offers exactly Supports, Contradicts and Connect for Claim onto Claim", () => {
    const proposals = proposalsFor(
      { id: FOCUS, title: "Dry in storms", semanticType: "claim" },
      { id: OTHER, title: "Bright colors feel safer", kind: "claim" },
    );
    expect(proposals.map((proposal) => proposal.label)).toEqual(["Supports", "Contradicts", "Connect"]);
  });

  it("proposes without mutation and guards before applying a chosen proposal", () => {
    let mutations = 0;
    const proposals = proposalsFor(
      { id: FOCUS, title: "Claim", semanticType: "claim" },
      { id: OTHER, title: "Jacket", kind: "object" },
    );
    expect(mutations).toBe(0);
    const order: string[] = [];
    chooseProposal(proposals[0]!, {
      guard: () => { order.push("guard"); return "allowed"; },
      apply: () => { order.push("apply"); mutations += 1; },
    });
    expect(order).toEqual(["guard", "apply"]);
    expect(mutations).toBe(1);
  });

  it("cannot apply a purchase-level proposal without authorisation", () => {
    const dir = mkdtempSync(join(tmpdir(), "xeniur-gesture-"));
    const graph = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
    const broker = new PermissionBroker(graph.db);
    const apply = vi.fn();
    const purchase: GestureProposal = {
      id: "purchase", label: "Book", interaction: "commit", reversible: false,
      because: "The itinerary can be booked.",
      outcome: { kind: "action", plan: {
        intent: "Book stay", objects: [], tool: "browser.submit",
        args: { totalUsd: 1200 }, confirmation: true,
      } },
    };
    expect(() => chooseProposal(purchase, {
      guard: (plan) => broker.guard({ tool: plan.tool, args: plan.args, plan }), apply,
    })).toThrow(ApprovalRequired);
    expect(apply).not.toHaveBeenCalled();
    graph.close(); rmSync(dir, { recursive: true, force: true });
  });
});

describe("constraint-driven recompilation", () => {
  const travel = (budget: number) => situation({
    title: "Tokyo plan", meaning: "where", interaction: "choose",
    scope: { worldId: WORLD, objectIds: [FOCUS, OTHER, CONSTRAINT], externalContextAllowed: false },
    constraints: [{
      objectId: CONSTRAINT,
      definition: { kind: "range", min: 600, max: 2000, step: 100, unit: "EUR" },
      value: budget, appliesTo: "Stay budget", createdAt: 1, updatedAt: 1,
    }],
    choices: [
      { id: "quiet", label: "Quiet Shinjuku", detail: "Garden side", cost: 1400 },
      { id: "compact", label: "Compact Kanda", detail: "Near the rail loop", cost: 900 },
    ],
  });

  it("drops options excluded by a changed constraint without changing scene structure", () => {
    const high = compileSituation(travel(1500));
    const low = compileSituation(travel(1000));
    const choices = (plan: typeof high) => plan.concepts.find((c) => c.component === "ChoiceCards")!.props["choices"] as Array<{ id: string; excluded: boolean }>;
    expect(choices(high).filter((choice) => !choice.excluded).map((choice) => choice.id)).toEqual(["quiet", "compact"]);
    expect(choices(low).filter((choice) => !choice.excluded).map((choice) => choice.id)).toEqual(["compact"]);
    expect(low.concepts.map((concept) => concept.component)).toEqual(high.concepts.map((concept) => concept.component));
  });
});

/* M6 A1 — the goal is the reason; the compiler derives what to do from how the person is working. */
describe("a WorkGoal in the Situation", () => {
  it("derives the compiler's kind from the status when none is given", () => {
    const s = situation({ goal: { id: "77777777-7777-4777-8777-777777777777", outcome: "Ship the jacket", status: "making", deliverableId: FOCUS } });
    expect(s.goal.kind).toBe("create");
    expect(s.goal.outcome).toBe("Ship the jacket");
    expect(situation({ goal: { outcome: "Understand the returns", status: "exploring" } }).goal.kind).toBe("understand");
    expect(situation({ goal: { outcome: "Check it", status: "reviewing" } }).goal.kind).toBe("validate");
    expect(situation({ goal: { outcome: "Send it", status: "ready" } }).goal.kind).toBe("deliver");
  });

  it("keeps an explicit kind when a host gives one", () => {
    expect(situation({ goal: { kind: "decide", outcome: "Pick a finish", status: "making" } }).goal.kind).toBe("decide");
  });

  it("the layout id follows the goal's kind, so the same World compiles differently as the way of working changes", () => {
    const making = compileSituation(situation({ goal: { outcome: "Ship it", status: "making", deliverableId: FOCUS } }));
    const exploring = compileSituation(situation({ goal: { outcome: "Ship it", status: "exploring", deliverableId: FOCUS } }));
    expect(making.layoutId.startsWith("create.")).toBe(true);
    expect(exploring.layoutId.startsWith("understand.")).toBe(true);
    expect(making.layoutId).not.toBe(exploring.layoutId);
  });

  it("scope narrows the centre to what the goal is about; the rest of the World stays out of the Scene", () => {
    const plan = compileSituation(situation({ scope: { worldId: WORLD, objectIds: [FOCUS], externalContextAllowed: false } }));
    expect(plan.concepts.some((c) => c.subjectId === OTHER)).toBe(false);
  });
});
