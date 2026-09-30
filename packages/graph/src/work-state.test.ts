import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SharpenEffect, SharpenSession } from "@xeniur/core";
import { SensemakingStore } from "@xeniur/sensemaking";
import { ObjectGraph } from "./graph.js";
import { ReadinessEvaluator } from "./readiness.js";
import { assessWorkState, WorkStateStore } from "./work-state.js";

let dir: string, graph: ObjectGraph, store: WorkStateStore, sense: SensemakingStore, worldId: string, goalId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-sharpen-"));
  graph = ObjectGraph.open({ dbPath: join(dir, "work.db"), blobDir: join(dir, "blobs") });
  worldId = graph.createWorld({ title: "Offline architecture", emoji: "O" }).id;
  goalId = graph.goals.create(worldId, "Choose an architecture that works offline").id;
  store = new WorkStateStore(graph); sense = new SensemakingStore(graph, { frictionThreshold: 5 });
});
afterEach(() => { graph.close(); rmSync(dir, { recursive: true, force: true }); });
function decision() {
  const d = graph.decisions.create({ worldId, question: "Which architecture?", rationale: "Lower latency, offline operation, and provider independence.", chosenOption: "local",
    options: [{ key: "local", label: "Local service", note: "Works without a connection" }, { key: "cloud", label: "Cloud service", note: "Simpler deployment" }] });
  graph.decisions.assume(d.objectId, { text: "The device has sufficient memory", reviewTrigger: "When the supported device changes" });
  graph.decisions.accept(d.objectId, "you", { skipSteelman: true });
  graph.goals.setFocus(goalId, d.objectId);
  return graph.decisions.detail(d.objectId)!;
}
function source(text = "Measurements from the supported device") {
  const s = sense.recordSource({ worldId, kind: "paper", title: "Device measurements", text });
  return { source: s, version: sense.latestVersionOf(s.id)! };
}
function reply(s: SharpenSession, effect: SharpenEffect = "reflect", answer = "I checked the current device requirements.") {
  const m = s.moves.find((m) => !m.answeredAt)!;
  return store.answer({ sessionId: s.id, moveId: m.id, answer, effect });
}

describe("observable Work State", () => {
  it("detects unreviewed support, disagreement, and newer source copies without inferring a person's mind", () => {
    const d = decision(), { source: original, version } = source();
    graph.decisions.cite(d.objectId, { sourceVersionId: version.id, atomObjectId: null, atomVersionId: null, relation: "supports", note: "Memory budget" });
    expect(assessWorkState(graph, goalId)!.signals.some((s) => s.kind === "unreviewed_basis")).toBe(true);
    const row = graph.support.of(d.objectId)[0]!;
    graph.support.review(row.id, "supported", "Read the measurements");
    expect(store.assess(goalId)!.signals.some((s) => s.kind === "unreviewed_basis")).toBe(false);
    graph.support.record({ claimObjectId: d.objectId, sourceVersionId: version.id, checkedBy: "human", status: "contradicted" });
    sense.addSourceVersion({ sourceId: original.id, text: "The smaller device exceeded its memory budget." });
    const work = store.assess(goalId)!;
    expect(work.signals[0]!.priority).toBe(0);
    expect(work.signals.map((s) => s.kind)).toContain("changed_basis");
    expect(work.signals.map((s) => s.kind)).toContain("disagreement");
    expect(JSON.stringify(work)).not.toMatch(/understand.*\d+%|mastery|unopened|did not open/);
    expect(graph.support.get(row.id)?.status).toBe("supported");
  });

  it("includes explicit requirements and readiness only for the object's declared profiles", () => {
    const asset = graph.createObject({ worldId, semanticType: "document", title: "Architecture brief", properties: { settings: { profiles: ["brief"] } } });
    graph.goals.setFocus(goalId, asset.object.id); graph.goals.setRequiredOutputs(goalId, ["doc.primary"]);
    const evaluator = new ReadinessEvaluator(graph, [{ id: "brief", name: "Brief", gates: "artifact", tools: [], description: "", verifies: "A current brief", requires: [{ form: { role: "doc.primary" } }] },
      { id: "unrelated", name: "Video delivery", gates: "artifact", tools: [], description: "", verifies: "A video", requires: [{ form: { role: "video.master" } }] }]);
    const checked = new WorkStateStore(graph, (id) => evaluator.evaluateAll(id)).assess(goalId)!;
    expect(checked.signals.some((s) => s.subjectKey === "readiness:brief")).toBe(true);
    expect(checked.signals.some((s) => s.subjectKey === "readiness:unrelated")).toBe(false);
    expect(checked.signals.some((s) => s.subjectKey === "required:doc.primary")).toBe(true);
  });

  it("does not include archived or foreign work and returns null for absent goals", () => {
    const d = decision();
    const other = graph.createWorld({ title: "Another project", emoji: "A" });
    const foreign = graph.createObject({ worldId: other.id, semanticType: "claim", title: "Other work" });
    graph.goals.setRequiredOutputs(goalId, [foreign.object.id]);
    graph.db.prepare(`UPDATE objects SET archived_at = ? WHERE id = ?`).run(Date.now(), d.objectId);
    expect(store.assess(goalId)!.signals).toEqual([]);
    expect(store.assess("missing")).toBeNull();
    expect(() => store.start(goalId, foreign.object.id)).toThrow(/this project/);
  });
});

describe("Sharpen changes real work", () => {
  it("resumes the stored answers and linked notes after reopening the project database", () => {
    const d = decision(), s = reply(store.start(goalId, d.objectId), "reflect", "Offline operation was essential for this project.");
    const noteId = s.moves[0]!.reflectionObjectId!;
    graph.close();
    graph = ObjectGraph.open({ dbPath: join(dir, "work.db"), blobDir: join(dir, "blobs") });
    store = new WorkStateStore(graph);
    const restored = store.session(s.id)!;
    expect(restored.moves[0]!.answer).toContain("Offline operation");
    expect(graph.currentState(noteId)?.forms[0]?.role).toBe("doc.primary");
    expect(reply(restored).moves[1]!.reflectionObjectId).not.toBeNull();
  });

  it("persists a pinned recall, linked note, process event, and resumable session exactly once", () => {
    const d = decision(), s = store.start(goalId, d.objectId);
    expect(s.moves).toHaveLength(5);
    expect(s.moves[0]!.recorded).toContain("provider independence");
    expect(s.moves[0]!.recorded).toContain("Cloud service");
    const result = reply(s, "reflect", "I remembered the lower latency.");
    const first = result.moves[0]!;
    expect(store.assess(goalId)!.latestSession?.moves[0]!.answer).toBe("I remembered the lower latency.");
    const note = graph.currentState(first.reflectionObjectId!)!;
    expect(note.properties.tags).toContain("sharpen");
    expect(graph.readBlob(graph.getRepresentation(note.forms[0]!.representationId)!.blobHash!).toString()).toContain("lower latency");
    expect(graph.decisions.linksFrom(note.object.id)[0]?.toVersionId).toBe(s.objectVersionId);
    expect(graph.process.proof(note.object.id).events[0]?.actor).toBe("human");
    const count = graph.listStates(worldId).length;
    const again = store.answer({ sessionId: s.id, moveId: s.moves[0]!.id, answer: "I remembered the lower latency.", effect: "reflect" });
    expect(again).toEqual(result); expect(graph.listStates(worldId)).toHaveLength(count);
    expect(() => store.answer({ sessionId: s.id, moveId: s.moves[0]!.id, answer: "An answer that changed", effect: "reflect" })).toThrow(/already recorded/);
  });

  it("saves review and test requests without clearing evidence or accepting a choice", () => {
    const d = decision(), v = source().version;
    const support = graph.support.record({ claimObjectId: d.objectId, sourceVersionId: v.id, checkedBy: "human", status: "contradicted" });
    let s = store.start(goalId, d.objectId);
    s = reply(s); s = reply(s); s = reply(s, "needs_review", "Ask a colleague to critique memory assumptions.");
    expect(graph.decisions.get(d.objectId)?.state).toBe("needs_review");
    s = reply(s, "test", "Run the offline app on the smallest supported device.");
    s = reply(s, "keep", "Keep the local option pending the device test.");
    expect(s.moves.every((m) => m.answeredAt)).toBe(true);
    const actions = graph.goals.get(goalId)!.nextActions;
    expect(actions.map((a) => a.text).join("\n")).toContain("Run the offline app");
    expect(actions.map((a) => a.text).join("\n")).toContain("Ask a colleague");
    expect(graph.support.get(support.id)?.status).toBe("contradicted");
    expect(graph.decisions.get(d.objectId)?.state).toBe("needs_review");
    expect(store.assess(goalId)!.signals.some((s) => s.kind === "disagreement")).toBe(true);
  });

  it("records an explicit assumption check for this basis and resurfaces it when changed or old", () => {
    const d = decision();
    const signal = store.assess(goalId)!.signals.find((s) => s.kind === "assumption")!;
    let s = store.start(goalId, d.objectId, signal.id);
    s = reply(s); s = reply(s); s = reply(s); s = reply(s, "checked", "I tested the memory use on a four gigabyte device."); s = reply(s, "keep");
    expect(store.assess(goalId)!.signals.some((s) => s.kind === "assumption")).toBe(false);
    expect(store.assess(goalId, Date.now() + 31 * 86_400_000)!.signals.some((s) => s.kind === "assumption")).toBe(true);
    graph.decisions.update(d.objectId, { rationale: "The workload increased." });
    expect(store.assess(goalId)!.signals.some((s) => s.kind === "assumption")).toBe(true);
  });

  it("does not count a plan for a test as an assumption check", () => {
    const d = decision();
    const signal = store.assess(goalId)!.signals.find((s) => s.kind === "assumption")!;
    let s = store.start(goalId, d.objectId, signal.id);
    s = reply(s); s = reply(s); s = reply(s, "source", "Find an independent device memory benchmark."); s = reply(s, "test");
    expect(store.assess(goalId)!.signals.some((s) => s.kind === "assumption")).toBe(true);
    expect(graph.goals.get(goalId)!.nextActions.some((a) => a.text.startsWith("Find another source:"))).toBe(true);
  });

  it("refuses stale rationale, source changes, target edits, and invalid actions before writing", () => {
    const d = decision(), { source: original, version } = source();
    graph.decisions.cite(d.objectId, { sourceVersionId: version.id, atomObjectId: null, atomVersionId: null, relation: "supports", note: "" });
    let s = store.start(goalId, d.objectId);
    const count = graph.listStates(worldId).length;
    graph.decisions.update(d.objectId, { rationale: "New evidence changed the tradeoff." });
    expect(() => reply(s)).toThrow(/basis changed/); expect(graph.listStates(worldId)).toHaveLength(count);
    s = store.start(goalId, d.objectId);
    sense.addSourceVersion({ sourceId: original.id, text: "New device measurements" });
    expect(() => reply(s)).toThrow(/basis changed/);
    s = store.start(goalId, d.objectId);
    graph.setProperties(d.objectId, { title: "A changed question" });
    expect(() => reply(s)).toThrow(/basis changed/);
    s = store.start(goalId, d.objectId);
    expect(() => reply(s, "checked")).toThrow(/not available/);
    expect(() => store.answer({ sessionId: s.id, moveId: s.moves[2]!.id, answer: "This should not skip recall.", effect: "reflect" })).toThrow(/current thinking move/);
  });

  it("refuses imported review worlds and credential-shaped reflections", () => {
    const d = decision(), s = store.start(goalId, d.objectId);
    expect(() => reply(s, "reflect", "sk-proj-" + "A".repeat(70))).toThrow(/API keys/);
    graph.db.prepare(`UPDATE worlds SET kind = 'critique' WHERE id = ?`).run(worldId);
    expect(() => store.start(goalId, d.objectId)).toThrow(/own projects/);
  });
});
