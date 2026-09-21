import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentStepOf, planProgress, templatePlanFor, templateShapeFor } from "@xeniur/core";
import { NotComplete, ObjectGraph } from "./index.js";

/**
 * The plan guides the work; the person controls the work; the record says what happened.
 * Editing a plan cannot write work. Skipped is not complete. Complete needs the rule to hold.
 */
let dir: string, g: ObjectGraph, worldId: string, goalId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-plans-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Cold-weather shell", emoji: "◒" }).id;
  goalId = g.goals.create(worldId, "Choose a seam construction the client will accept", { requiredOutputs: ["doc.spec"] }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("templates are deterministic and propose, never adopt", () => {
  it("reads the verb: choose → compare and decide; make → make and check; otherwise find out", () => {
    expect(templateShapeFor("Choose a seam construction")).toBe("choose");
    expect(templateShapeFor("Build the leak finder prototype")).toBe("make");
    expect(templateShapeFor("What drives the energy cost of a litre of desalinated water?")).toBe("find_out");
  });

  it("same words, same steps, same ids; every step proposed; each required output has a form_exists step", () => {
    const a = templatePlanFor({ outcome: "Choose a seam construction", requiredOutputs: ["doc.spec"] });
    const b = templatePlanFor({ outcome: "Choose a seam construction", requiredOutputs: ["doc.spec"] });
    expect(a).toEqual(b);
    expect(a.steps.every((s) => s.disposition === "proposed")).toBe(true);
    expect(a.steps.map((s) => s.id)).toEqual(["t.gather", "t.compare", "t.decide", "t.output.doc.spec", "t.deliver"]);
    expect(a.steps.find((s) => s.id === "t.output.doc.spec")!.completionRule).toEqual({ kind: "form_exists", role: "doc.spec" });
  });

  it("propose() writes revision 1 from the template and returns the same plan on a second call", () => {
    const p1 = g.plans.propose(goalId);
    expect(p1.revision).toBe(1);
    expect(p1.origin).toBe("template");
    expect(g.plans.propose(goalId).id).toBe(p1.id);
  });
});

describe("editing the plan never asserts work", () => {
  it("adopt, rename, reorder and replace each make a new immutable revision and leave step_work untouched", () => {
    g.plans.propose(goalId);
    g.plans.adoptAll(goalId);
    g.plans.setExecution(goalId, "t.gather", "in_progress", { note: "reading the two studies" });
    const before = g.db.prepare(`SELECT * FROM step_work WHERE goal_id = ? ORDER BY step_id`).all(goalId);

    g.plans.edit(goalId, "t.gather", { purpose: "Read the two studies" });
    g.plans.reorder(goalId, ["t.compare", "t.gather", "t.decide", "t.output.doc.spec", "t.deliver"]);
    g.plans.replaceStep(goalId, "t.compare", { kind: "compare", purpose: "Set both seams beside the client's requirement" });

    const after = g.db.prepare(`SELECT * FROM step_work WHERE goal_id = ? ORDER BY step_id`).all(goalId);
    expect(after).toEqual(before);
    const history = g.plans.history(goalId);
    expect(history.map((p) => p.revision)).toEqual([1, 2, 3, 4, 5]);
    expect(history.slice(0, -1).every((p) => p.supersededBy !== null)).toBe(true);
    expect(history.at(-1)!.supersededBy).toBeNull();
    const current = g.plans.current(goalId)!;
    expect(current.steps.find((s) => s.id === "t.compare")!.disposition).toBe("replaced");
    expect(current.steps.some((s) => s.purpose.startsWith("Set both seams") && s.disposition === "adopted")).toBe(true);
  });

  it("skipped is counted as skipped, never as complete", () => {
    g.plans.propose(goalId); g.plans.adoptAll(goalId);
    g.plans.setDisposition(goalId, "t.compare", "skipped");
    const progress = g.plans.progress(goalId)!;
    expect(progress.skipped).toBe(1);
    expect(progress.complete).toBe(0);
    expect(progress.sentence).toBe("0 of 4 complete · 1 skipped");
    expect(progress.sentence).not.toMatch(/%/);
  });

  it("refuses a dependency on a step that is not in the plan", () => {
    g.plans.propose(goalId);
    expect(() => g.plans.revise(goalId, [{ id: "x", kind: "make", purpose: "x", completionRule: { kind: "person_confirms" }, dependsOn: ["ghost"] }])).toThrow(/not in the plan/);
  });
});

describe("complete needs the rule to hold, or a person's word", () => {
  it("form_exists: refused until the form exists, then complete with the version as evidence", () => {
    g.plans.propose(goalId); g.plans.adoptAll(goalId);
    expect(() => g.plans.setExecution(goalId, "t.output.doc.spec", "complete")).toThrow(NotComplete);
    const spec = g.createObject({ worldId, semanticType: "document", title: "Seam spec" }).object.id;
    const rep = g.addRepresentation({ objectId: spec, modality: "text", format: "md", provenance: "human", blobHash: g.putBlob(Buffer.from("# spec"), "text/markdown", "md") });
    g.commitVersion({ objectId: spec, forms: [{ role: "doc.spec", representationId: rep.id }] });
    const w = g.plans.setExecution(goalId, "t.output.doc.spec", "complete");
    expect(w.execution).toBe("complete");
    expect(w.evidence.some((e) => e.kind === "version" && e.by === "rule")).toBe(true);
  });

  it("decision_accepted: refused without an accepted decision; complete with it", () => {
    g.plans.propose(goalId); g.plans.adoptAll(goalId);
    expect(() => g.plans.setExecution(goalId, "t.decide", "complete")).toThrow(/an accepted decision/);
    const d = g.decisions.create({ worldId, question: "Which seam?", options: [{ key: "t", label: "Taped", note: "" }], chosenOption: "t" });
    g.decisions.accept(d.objectId, "me", { skipSteelman: true });
    expect(g.plans.setExecution(goalId, "t.decide", "complete").evidence.some((e) => e.kind === "decision" && e.id === d.objectId)).toBe(true);
  });

  it("person_confirms: refused without a note; a note is recorded as the person's evidence", () => {
    g.plans.propose(goalId); g.plans.adoptAll(goalId);
    expect(() => g.plans.setExecution(goalId, "t.gather", "complete")).toThrow(/your word/);
    const w = g.plans.setExecution(goalId, "t.gather", "complete", { note: "both studies are in" });
    expect(w.evidence).toEqual([expect.objectContaining({ kind: "note", by: "person" })]);
  });
});

describe("a changed requirement marks dependants for review and keeps their evidence", () => {
  it("flags only adopted steps that pinned an older version and had work; nothing is undone", () => {
    g.plans.propose(goalId); g.plans.adoptAll(goalId);
    const requirement = g.createObject({ worldId, semanticType: "constraint", title: "Client requirement" }).object.id;
    const rep = (t: string) => g.addRepresentation({ objectId: requirement, modality: "text", format: "md", provenance: "human", blobHash: g.putBlob(Buffer.from(t), "text/markdown", "md") });
    g.commitVersion({ objectId: requirement, forms: [{ role: "doc.primary", representationId: rep("v1").id }] });
    g.plans.setInputs(goalId, "t.compare", [requirement]);
    g.plans.setInputs(goalId, "t.decide", [requirement]);
    g.plans.setExecution(goalId, "t.compare", "in_progress", { note: "compared both seams" });
    const evidenceBefore = g.plans.attachEvidence(goalId, "t.compare", { kind: "source_version", id: "sv-1", at: 1, by: "person" }).evidence;

    // The requirement changes.
    g.commitVersion({ objectId: requirement, forms: [{ role: "doc.primary", representationId: rep("v2").id }] });
    const flagged = g.plans.onRequirementChanged(goalId, requirement);
    expect(flagged).toEqual(["t.compare"]);                       // t.decide had no work yet: nothing to review
    const w = g.plans.workOf(goalId, "t.compare")!;
    expect(w.execution).toBe("needs_review");
    expect(w.evidence).toEqual(evidenceBefore);
    expect(w.note).toContain("Client requirement changed after this step was worked on.");
    expect(g.plans.workOf(goalId, "t.decide")).toBeNull();
    // A second change with nothing new to flag is quiet.
    expect(g.plans.onRequirementChanged(goalId, requirement)).toEqual([]);
  });

  it("the current step is the one in progress, else needing review, else the first not started", () => {
    const plan = g.plans.adoptAll((g.plans.propose(goalId), goalId));
    expect(currentStepOf(plan, [])!.id).toBe("t.gather");
    g.plans.setExecution(goalId, "t.gather", "complete", { note: "sources are in" });
    expect(g.plans.currentStep(goalId)!.id).toBe("t.compare");
    g.plans.setExecution(goalId, "t.decide", "in_progress");
    expect(g.plans.currentStep(goalId)!.id).toBe("t.decide");
    expect(planProgress(g.plans.current(goalId)!, g.plans.work(goalId)).sentence).toBe("1 of 5 complete");
  });
});
