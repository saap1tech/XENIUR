import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectGraph } from "./index.js";

let dir: string, g: ObjectGraph, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-goals-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Rainwear 2027", emoji: "R" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("a goal is one sentence in the person's words", () => {
  it("is stored verbatim, starts exploring, and is the World's current goal", () => {
    const goal = g.goals.create(worldId, "  Choose a jacket finish the client will accept  ");
    expect(goal.outcome).toBe("Choose a jacket finish the client will accept");
    expect(goal.status).toBe("exploring");
    expect(g.goals.current(worldId)?.id).toBe(goal.id);
    expect(() => g.goals.create(worldId, "   ")).toThrow(/cannot be empty/);
  });

  it("moves between ways of working in any order — statuses are not stages", () => {
    const goal = g.goals.create(worldId, "Ship the jacket");
    for (const status of ["making", "exploring", "ready", "understanding", "reviewing"] as const) {
      expect(g.goals.setStatus(goal.id, status)!.status).toBe(status);
    }
    g.goals.setStatus(goal.id, "finished");
    expect(g.goals.current(worldId)).toBeNull();                   // finished goals leave the centre
    expect(g.goals.history(worldId)).toHaveLength(1);
  });

  it("next actions are the person's or accepted proposals, never generated", () => {
    const goal = g.goals.create(worldId, "Ship the jacket");
    const withAction = g.goals.addNextAction(goal.id, { text: "Cost taped seams at volume" })!;
    expect(withAction.nextActions[0]!.origin).toBe("person");
    const accepted = g.goals.addNextAction(goal.id, { text: "Pull Q1 returns", origin: "accepted_proposal" })!;
    expect(accepted.nextActions.map((a) => a.origin)).toEqual(["person", "accepted_proposal"]);
    const done = g.goals.doneNextAction(goal.id, withAction.nextActions[0]!.id)!;
    expect(done.nextActions[0]!.doneAt).not.toBeNull();
    expect(done.nextActions[1]!.doneAt).toBeNull();
  });

  it("touch moves last_active_at, the anchor Continue Work reads from", () => {
    const goal = g.goals.create(worldId, "Ship the jacket");
    g.db.prepare(`UPDATE goals SET last_active_at = 1000 WHERE id = ?`).run(goal.id);
    g.goals.touch(worldId);
    expect(g.goals.get(goal.id)!.lastActiveAt).toBeGreaterThan(1000);
  });

  it("the relevant Objects are the focus, its decisions, their evidence, the outputs and the next actions — not the whole World", () => {
    const focus = g.createObject({ worldId, semanticType: "prop", title: "Jacket" }).object.id;
    const unrelated = g.createObject({ worldId, semanticType: "note", title: "Grocery list" }).object.id;
    const claim = g.createObject({ worldId, semanticType: "claim", title: "Taped seams hold in the cold" }).object.id;
    const decision = g.decisions.create({ worldId, question: "Which seam?", options: [{ key: "t", label: "Taped", note: "" }], chosenOption: "t" });
    g.decisions.cite(decision.objectId, { atomObjectId: claim, relation: "supports", note: "", sourceVersionId: null, atomVersionId: null });
    g.decisions.link({ fromObjectId: focus, toObjectId: decision.objectId, relation: "satisfies" });
    const stl = g.createObject({ worldId, semanticType: "prop", title: "Pattern" }).object.id;
    const rep = g.addRepresentation({ objectId: stl, modality: "mesh", format: "stl",
      blobHash: g.putBlob(Buffer.from("s"), "model/stl", "stl"), provenance: "human" });
    g.commitVersion({ objectId: stl, forms: [{ role: "print.stl", representationId: rep.id }] });

    const goal = g.goals.create(worldId, "Ship the jacket", { focusObjectId: focus, requiredOutputs: ["print.stl"] });
    g.goals.addNextAction(goal.id, { text: "Re-read the study", objectId: claim });
    const relevant = new Set(g.goals.relevantObjects(goal.id));
    expect(relevant).toEqual(new Set([focus, decision.objectId, claim, stl]));
    expect(relevant.has(unrelated)).toBe(false);
  });
});
