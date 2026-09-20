import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeStanding, resumeText } from "@xeniur/core";
import { NotFinishable, ObjectGraph, ReadinessEvaluator, deliveryReport, finishGoal, lastActiveWorld, loadProfiles, resumeCard, standingFor, todayFor } from "./index.js";

const DAY = 86_400_000;
let dir: string, g: ObjectGraph, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-standing-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Rainwear 2027", emoji: "R" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const move = (kind: string, objectId: string | null, at: number) => g.db.prepare(
  `INSERT INTO moves (id, world_id, kind, note, at, object_id, version_id) VALUES (?, ?, ?, '', ?, ?, NULL)`,
).run(crypto.randomUUID(), worldId, kind, at, objectId);

/** Three days ago the person was comparing finishes; since then a source arrived and a decision went stale. */
function threeDaysAgo() {
  const jacket = g.createObject({ worldId, semanticType: "prop", title: "Jacket shell" }).object.id;
  const decision = g.decisions.create({ worldId, question: "Which finish?", options: [{ key: "m", label: "Matte", note: "" }], chosenOption: "m" });
  g.decisions.accept(decision.objectId, "me", { skipSteelman: true });
  g.decisions.link({ fromObjectId: jacket, toObjectId: decision.objectId, relation: "satisfies" });
  const goal = g.goals.create(worldId, "Choose a jacket finish the client will accept", { focusObjectId: jacket, requiredOutputs: ["print.stl"] });
  g.goals.addNextAction(goal.id, { text: "Prepare the next client delivery" });
  const then = Date.now() - 3 * DAY;
  move("rated", jacket, then);
  g.db.prepare(`UPDATE goals SET last_active_at = ? WHERE id = ?`).run(then, goal.id);
  // Since then: a new source, and the decision needs review.
  g.db.prepare(`INSERT INTO sources (id, world_id, kind, title, retrieved_at, metadata) VALUES (?, ?, 'paper', 'Study 4', ?, '{}')`)
    .run(crypto.randomUUID(), worldId, Date.now());
  g.db.prepare(`UPDATE decisions SET state = 'needs_review' WHERE object_id = ?`).run(decision.objectId);
  return { jacket, decision: decision.objectId, goal: g.goals.get(goal.id)! };
}

describe("where you stand is read from rows", () => {
  it("counts the five knowledge states and names what is needed to finish", () => {
    const { goal } = threeDaysAgo();
    const s = standingFor(g, goal.id)!;
    expect(s.knowledge.known).toEqual([]);
    expect(s.needed).toEqual([{ output: "print.stl", satisfied: false, objectId: null }]);
    expect(s.knowledge.unknown.map((u) => u.title)).toEqual(["print.stl"]);
    expect(s.changed.newSources.map((x) => x.title)).toEqual(["Study 4"]);
    expect(s.lastMove?.kind).toBe("rated");
    expect(describeStanding(s)).toContain("Since you left: 1 new source");
    expect(describeStanding(s)).toContain("Next: Prepare the next client delivery.");
    expect(describeStanding(s)).toContain("To finish: print.stl.");
    expect(describeStanding(s)).not.toMatch(/%/);
  });

  it("the resume sentence is templates over facts, each fragment a link", () => {
    const { jacket, goal } = threeDaysAgo();
    const card = resumeCard(g, worldId)!;
    expect(resumeText(card)).toBe('You were weighing "Jacket shell". Next: prepare the next client delivery. One new source was added.');
    expect(card.fragments.find((f) => f.text.includes("Jacket shell"))!.objectId).toBe(jacket);
    expect(card.goalId).toBe(goal.id);
    expect(card.focusObjectId).toBe(jacket);
  });

  it("a World without a goal or moves gets a plain sentence, never an invented one", () => {
    const card = resumeCard(g, worldId)!;
    expect(resumeText(card)).toBe("You were in Rainwear 2027.");
    expect(card.goalId).toBeNull();
  });

  it("Today leads with the last active World", () => {
    threeDaysAgo();
    const other = g.createWorld({ title: "Tokyo", emoji: "T" }).id;
    g.goals.create(other, "Plan the trip");                         // more recent activity
    expect(lastActiveWorld(g)).toBe(other);
    expect(todayFor(g).resume?.worldTitle).toBe("Tokyo");
  });

  it("calls no model and reads no metrics on the resume path", () => {
    const src = readFileSync(join(__dirname, "standing.ts"), "utf8");
    for (const forbidden of ["brain", "Brain", "llm", "Llm", "ask(", "complete(", "session_events", "MetricsStore", "fetch("]) {
      expect(src, `standing.ts must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* M6 A6 — finishing with incomplete knowledge is a decision, never a badge. */
describe("Finish", () => {
  it("refuses while a required output is unmade, and finish-anyway records a decision the report names", async () => {
    const { goal, jacket } = threeDaysAgo();
    expect(() => finishGoal(g, goal.id)).toThrow(NotFinishable);
    expect(g.goals.get(goal.id)!.status).not.toBe("finished");

    const finished = finishGoal(g, goal.id, { anyway: { because: "cost and time: the client needs a decision this week" } });
    expect(finished.status).toBe("finished");
    const decision = g.decisions.list(worldId).find((d) => d.question.startsWith("Finish"))!;
    expect(decision.chosenOption).toBe("finish_anyway");
    const detail = g.decisions.detail(decision.objectId)!;
    expect(detail.assumptions.some((a) => a.kind === "accepted_uncertainty" && a.text.includes("print.stl"))).toBe(true);
    expect(detail.steelman).not.toBe("skipped");
    // The standing now counts it as chosen despite uncertainty…
    expect(standingFor(g, goal.id)!.knowledge.chosenDespite.map((r) => r.id)).toContain(decision.objectId);
    // …and the delivery report for the focus says so in a sentence.
    const rep = g.addRepresentation({ objectId: jacket, modality: "text", format: "md", blobHash: g.putBlob(Buffer.from("j"), "text/markdown", "md"), provenance: "human" });
    g.commitVersion({ objectId: jacket, forms: [{ role: "doc.primary", representationId: rep.id }] });
    const release = new ReadinessEvaluator(g, loadProfiles(process.cwd())).approve({ objectId: jacket, profileId: "client", force: true });
    const html = deliveryReport(g, jacket, release.id);
    expect(html).toContain("Chosen despite uncertainty");
    expect(html).toMatch(/unresolved assumption(s)? (was|were) explicitly accepted for this delivery/);
    expect(html).not.toContain("✓");
  });
});
