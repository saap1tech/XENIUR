import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionPlan, ChallengeRulesInput, EntryRecordForCheck } from "@xeniur/core";
import { MemorySigningKeyStore, checkAiPolicy } from "@xeniur/core";
import { ObjectGraph, PublisherIdentity } from "./index.js";

const DAY = 86_400_000;
const rules = (over: Partial<ChallengeRulesInput> = {}): ChallengeRulesInput => ({
  title: "Desk accessory", brief: "A printable desk object under 60 mm.",
  rules: ["one entry per person", "under 60 mm on every axis"],
  startsAt: Date.now() - DAY, endsAt: Date.now() + 6 * DAY,
  deliverable: { formRoles: ["print.stl"], description: "an STL that prints without supports" },
  judging: { criteria: ["prints cleanly", "useful on a desk"], by: "publisher" },
  aiPolicy: "no_generative_geometry",
  ...over,
});

describe("checkAiPolicy is pure, and never rounds the third answer", () => {
  const ev = (actor: "human" | "tool" | "model", kind: EntryRecordForCheck["events"][number]["kind"], tool: string | null = null) =>
    ({ kind, actor, tool, model: actor === "model" ? "m" : null, label: kind });
  const rep = (modality: string, provenance: EntryRecordForCheck["representations"][number]["provenance"], formRole: string | null = null, tool: string | null = null) =>
    ({ id: `${modality}-${provenance}-${formRole}`, modality, provenance, formRole, tool });

  it("an empty record is insufficient_record under every policy — never complies", () => {
    for (const policy of ["unrestricted", "research_only", "no_generative_geometry", "human_only"] as const) {
      const c = checkAiPolicy({ events: [], representations: [] }, policy);
      expect(c.verdict).toBe("insufficient_record");
      expect(c.because[0]).toMatch(/the record does not say/);
    }
  });

  it("a model step under human_only violates, and names the step", () => {
    const c = checkAiPolicy({
      events: [ev("human", "sketch_made"), ev("model", "model_step", "knowledge.propose")],
      representations: [rep("mesh", "human", "print.stl")],
    }, "human_only");
    expect(c.verdict).toBe("violates");
    expect(c.because[0]).toMatch(/model step.*knowledge\.propose/);
  });

  it("research_only allows a model that proposes and forbids a model that makes", () => {
    const research = { events: [ev("human", "manual_edit"), ev("model", "model_step", "knowledge.propose")],
      representations: [rep("mesh", "deterministic", "print.stl")] };
    expect(checkAiPolicy(research, "research_only").verdict).toBe("complies");
    const makes = { ...research, representations: [rep("image", "generated", "art.primary"), rep("mesh", "deterministic", "print.stl")] };
    expect(checkAiPolicy(makes, "research_only").verdict).toBe("violates");
  });

  it("no_generative_geometry allows a generated image and forbids a generated mesh, including a mock one", () => {
    const base = { events: [ev("human", "manual_edit"), ev("model", "model_step", "image.generate")] };
    expect(checkAiPolicy({ ...base, representations: [rep("image", "generated"), rep("mesh", "deterministic", "print.stl")] },
      "no_generative_geometry").verdict).toBe("complies");
    expect(checkAiPolicy({ ...base, representations: [rep("mesh", "generated", "print.stl")] }, "no_generative_geometry").verdict).toBe("violates");
    const mock = checkAiPolicy({ ...base, representations: [rep("mesh", "mock", "print.stl")] }, "no_generative_geometry");
    expect(mock.verdict).toBe("violates");
    expect(checkAiPolicy({ events: [ev("human", "manual_edit"), ev("model", "model_step", "3d.generate")],
      representations: [rep("mesh", "deterministic", "print.stl")] }, "no_generative_geometry").verdict).toBe("violates");
  });

  it("events without forms, or forms without events, are insufficient under a policy about making", () => {
    expect(checkAiPolicy({ events: [ev("human", "manual_edit")], representations: [] }, "human_only").verdict).toBe("insufficient_record");
    expect(checkAiPolicy({ events: [], representations: [rep("mesh", "human", "print.stl")] }, "human_only").verdict).toBe("insufficient_record");
    expect(checkAiPolicy({ events: [], representations: [rep("mesh", "human", "print.stl")] }, "unrestricted").verdict).toBe("complies");
  });
});

describe("a challenge is a signed World with typed rules", () => {
  let dir: string, g: ObjectGraph;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "xeniur-challenge-"));
    g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  });
  afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

  it("creates a challenge World whose dates and policy are Constraint Objects, signed by its publisher", () => {
    const c = g.challenges.create(rules(), g.publishers.self());
    const world = g.getWorld(c.worldId)!;
    expect(world.kind).toBe("challenge");
    expect(world.publisherId).toBe(g.publishers.self().publicKey);
    expect(g.constraints.get(c.deadlineConstraintId)!.definition.kind).toBe("date_range");
    expect(g.constraints.get(c.policyConstraintId)!.value).toBe("no_generative_geometry");
    expect(c.signature.publicKey).toBe(g.publishers.self().publicKey);
    expect(g.challenges.active()).toHaveLength(1);
  });

  it("refuses to adopt rules that do not verify against the claimed publisher", () => {
    const c = g.challenges.create(rules(), g.publishers.self());
    const other = PublisherIdentity.load(new MemorySigningKeyStore(), "Someone");
    expect(() => g.challenges.adopt({ ...c.rules, title: "Changed" }, c.publisher, c.signature)).toThrow(/do not verify/);
    expect(() => g.challenges.adopt(c.rules, other.ref(), c.signature)).toThrow(/do not verify/);
  });

  it("an entry with an empty record is insufficient_record, never complies; the record fills and the verdict follows", () => {
    const c = g.challenges.create(rules(), g.publishers.self());
    const worldId = g.createWorld({ title: "Mine", emoji: "M" }).id;
    const objectId = g.createObject({ worldId, semanticType: "prop", title: "Pen holder" }).object.id;
    const entry = g.challenges.enter(c.worldId, objectId, g.publishers.self().ref());
    expect(entry.compliance.verdict).toBe("insufficient_record");

    // A deterministic export from a human source: complies.
    const src = g.addRepresentation({ objectId, modality: "image", format: "png",
      blobHash: g.putBlob(Buffer.from("sketch"), "image/png", "png"), provenance: "human" });
    g.commitVersion({ objectId, forms: [{ role: "source.primary", representationId: src.id }] });
    g.process.record({ objectId, versionId: null, kind: "sketch_made", actor: "human", label: "sketch",
      tool: null, model: null, inputHashes: [], outputHashes: [], durationMs: 0 });
    const plan: ActionPlan = { intent: "export", objects: [objectId], tool: "3d.export", args: {}, confirmation: false };
    const exp = g.beginAction({ worldId, intent: "export", tool: "3d.export", plan, permissionLevel: "CREATE",
      provenance: "deterministic", provider: "local.blender" });
    g.commitResult({ actionId: exp.id, objectId, formRoles: ["print.stl"],
      representations: [{ objectId, modality: "mesh", format: "stl", blobHash: g.putBlob(Buffer.from("stl"), "model/stl", "stl"),
        producedByActionId: exp.id, provenance: "deterministic", provider: "local.blender" }],
      inputs: [{ representationId: src.id, role: "source" }] });
    g.process.record({ objectId, versionId: null, kind: "tool_used", actor: "tool", label: "export",
      tool: "3d.export", model: null, inputHashes: [], outputHashes: [], durationMs: 0 });
    expect(g.challenges.evaluate(c.worldId, objectId)!.compliance.verdict).toBe("complies");

    // Then a generated mesh replaces the form: violates, naming the form.
    const gen = g.beginAction({ worldId, intent: "imagine a mesh", tool: "3d.generate",
      plan: { ...plan, tool: "3d.generate" }, permissionLevel: "CREATE", provenance: "generated", provider: "mock.3d", model: "m" });
    g.commitResult({ actionId: gen.id, objectId, formRoles: ["print.stl"],
      representations: [{ objectId, modality: "mesh", format: "stl", blobHash: g.putBlob(Buffer.from("gen"), "model/stl", "stl"),
        producedByActionId: gen.id, provenance: "generated", provider: "mock.3d" }],
      inputs: [{ representationId: src.id, role: "source" }] });
    g.process.record({ objectId, versionId: null, kind: "model_step", actor: "model", label: "generated mesh",
      tool: "3d.generate", model: "m", inputHashes: [], outputHashes: [], durationMs: 0 });
    const after = g.challenges.evaluate(c.worldId, objectId)!;
    expect(after.compliance.verdict).toBe("violates");
    expect(after.compliance.because.join(" ")).toMatch(/print\.stl|3d\.generate/);
  });

  it("other entries are hidden until close, then listed in submission order with no rank", () => {
    const c = g.challenges.create(rules(), g.publishers.self());
    const worldId = g.createWorld({ title: "Mine", emoji: "M" }).id;
    const mine = g.createObject({ worldId, semanticType: "prop", title: "Mine" }).object.id;
    const theirs = g.createObject({ worldId, semanticType: "prop", title: "Theirs" }).object.id;
    g.challenges.enter(c.worldId, mine, g.publishers.self().ref());
    g.challenges.enter(c.worldId, theirs, { publicKey: "B".repeat(43), displayName: "Samir" });
    const me = g.publishers.self().publicKey;
    expect(g.challenges.entries(c.worldId, { self: me }).map((e) => e.objectId)).toEqual([mine]);
    const closed = g.challenges.entries(c.worldId, { self: me, at: c.rules.endsAt + 1 });
    expect(closed.map((e) => e.objectId)).toEqual([mine, theirs]);
    expect(JSON.stringify(closed)).not.toMatch(/rank|score|place/);
  });

  it("arrives once for matching work, and a dismissal is recorded", () => {
    const c = g.challenges.create(rules(), g.publishers.self());
    expect(g.challenges.matching()).toHaveLength(0);              // nothing printable here yet
    const worldId = g.createWorld({ title: "Mine", emoji: "M" }).id;
    const objectId = g.createObject({ worldId, semanticType: "prop", title: "Rocket" }).object.id;
    const rep = g.addRepresentation({ objectId, modality: "mesh", format: "stl",
      blobHash: g.putBlob(Buffer.from("stl"), "model/stl", "stl"), provenance: "human" });
    g.commitVersion({ objectId, forms: [{ role: "print.stl", representationId: rep.id }] });
    expect(g.challenges.matching().map((x) => x.worldId)).toEqual([c.worldId]);
    g.challenges.dismiss(c.worldId);
    expect(g.challenges.matching()).toHaveLength(0);
    expect(g.challenges.get(c.worldId)!.dismissedAt).not.toBeNull();
  });
});
