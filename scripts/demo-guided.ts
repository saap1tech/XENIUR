/**
 * Guided work, end to end — a goal in words, a plan that can be edited, work that is recorded.
 *
 *   npm run demo:guided
 *
 * The plan guides; the person controls; the record says what happened. Every edit here —
 * adopt, skip, rename, reorder, replace — leaves the work exactly as it was. A step is
 * complete only when its rule holds in the graph or the person says so with a note. A changed
 * requirement marks what depended on it for review and rewrites nothing. Finishing runs the
 * check, is refused in words, and finishing anyway is a Decision the report names.
 *
 * Offline: no model is called anywhere, and a check proves it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planProgress, templatePlanFor } from "@xeniur/core";
import { NotComplete, NotFinishable, ObjectGraph, ReadinessEvaluator, deliveryReport, finishGoal, loadProfiles, resumeCard, standingFor } from "@xeniur/graph";

const workdir = mkdtempSync(join(tmpdir(), "xeniur-guided-"));
let failures = 0, stepNo = 0;
const step = (t: string) => { stepNo += 1; console.log(`\n${String(stepNo).padStart(2, " ")}. ${t}`); };
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures += 1;
};
const note = (t: string) => console.log(`       ${t}`);

function main(): void {
  console.log(`\nXENIUR — guided work\nworkdir: ${workdir}\n${"=".repeat(64)}`);
  const graph = ObjectGraph.open({ dbPath: join(workdir, "x.db"), blobDir: join(workdir, "blobs") });
  const worldId = graph.createWorld({ title: "Cold-weather shell", emoji: "◒" }).id;

  /* 1 */ step("A goal in words becomes a plan — by rule, not by a model");
  const goal = graph.goals.create(worldId, "Choose a seam construction the client will accept and deliver the spec", { requiredOutputs: ["doc.spec"] });
  const plan = graph.plans.propose(goal.id);
  note(plan.steps.map((s) => `${s.kind} · ${s.purpose}`).join("\n       "));
  check("every step arrives proposed — none adopted for the person", plan.steps.every((s) => s.disposition === "proposed"));
  check("the same words give the same plan", JSON.stringify(templatePlanFor({ outcome: goal.outcome, requiredOutputs: goal.requiredOutputs }).steps.map((s) => s.id)) === JSON.stringify(plan.steps.map((s) => s.id)));

  /* 2 */ step("The person adopts it, starts a step, and records what they did");
  graph.plans.adoptAll(goal.id);
  graph.plans.setExecution(goal.id, "t.gather", "complete", { note: "both studies and the returns are in" });
  graph.plans.setExecution(goal.id, "t.compare", "in_progress");
  check("gather is complete on the person's word, recorded as their evidence",
    graph.plans.workOf(goal.id, "t.gather")!.evidence.every((e) => e.by === "person"));
  check("the current step is the one in progress", graph.plans.currentStep(goal.id)!.id === "t.compare");

  /* 3 */ step("Editing the plan changes the plan and nothing else");
  const before = graph.db.prepare(`SELECT * FROM step_work WHERE goal_id = ? ORDER BY step_id`).all(goal.id);
  graph.plans.edit(goal.id, "t.compare", { purpose: "Set taped and welded beside the client's requirement" });
  graph.plans.setDisposition(goal.id, "t.deliver", "skipped");
  graph.plans.reorder(goal.id, graph.plans.current(goal.id)!.steps.map((s) => s.id).reverse());
  graph.plans.replaceStep(goal.id, "t.decide", { kind: "decide", purpose: "Choose, and write down why" });
  const after = graph.db.prepare(`SELECT * FROM step_work WHERE goal_id = ? ORDER BY step_id`).all(goal.id);
  check("renaming, skipping, reordering and replacing left the work byte-identical", JSON.stringify(after) === JSON.stringify(before));
  check("the plan is at revision 6, each one immutable", graph.plans.current(goal.id)!.revision === 6 && graph.plans.history(goal.id).length === 6);
  const progress = graph.plans.progress(goal.id)!;
  note(progress.sentence);
  check("skipped is counted as skipped, never as complete", progress.skipped === 1 && progress.complete === 1 && !/%/.test(progress.sentence));

  /* 4 */ step("Complete is refused unless the rule holds");
  let refusal = "";
  try { graph.plans.setExecution(goal.id, "t.output.doc.spec", "complete"); } catch (e) { refusal = (e as NotComplete).message; }
  note(refusal);
  check("a step whose form does not exist cannot be marked complete", /doc\.spec exists at the current version/.test(refusal));
  const spec = graph.createObject({ worldId, semanticType: "document", title: "Seam specification" }).object.id;
  const rep = (t: string) => graph.addRepresentation({ objectId: spec, modality: "text", format: "md", provenance: "human", blobHash: graph.putBlob(Buffer.from(t), "text/markdown", "md") });
  graph.commitVersion({ objectId: spec, forms: [{ role: "doc.spec", representationId: rep("# Seam spec\nTaped, 12 mm tape.").id }] });
  graph.goals.setFocus(goal.id, spec);                       // the thing in the hands, now that it exists
  const done = graph.plans.setExecution(goal.id, "t.output.doc.spec", "complete");
  check("once the form exists, the rule finds it and records the version as evidence", done.evidence.some((e) => e.kind === "version" && e.by === "rule"));

  /* 5 */ step("A requirement changes: what depended on it needs review, and keeps its evidence");
  const requirement = graph.createObject({ worldId, semanticType: "constraint", title: "Client requirement" }).object.id;
  const rq = (t: string) => graph.addRepresentation({ objectId: requirement, modality: "text", format: "md", provenance: "human", blobHash: graph.putBlob(Buffer.from(t), "text/markdown", "md") });
  graph.commitVersion({ objectId: requirement, forms: [{ role: "doc.primary", representationId: rq("taped seams, cold-weather range").id }] });
  graph.plans.setInputs(goal.id, "t.compare", [requirement]);
  graph.plans.attachEvidence(goal.id, "t.compare", { kind: "source_version", id: "sv-1", at: Date.now(), by: "person" });
  const evidenceBefore = graph.plans.workOf(goal.id, "t.compare")!.evidence;
  graph.commitVersion({ objectId: requirement, forms: [{ role: "doc.primary", representationId: rq("welded seams are acceptable below 40 units").id }] });
  const flagged = graph.plans.onRequirementChanged(goal.id, requirement);
  const compared = graph.plans.workOf(goal.id, "t.compare")!;
  note(compared.note.split("\n").at(-1) ?? "");
  check("the comparison is marked for review", flagged.includes("t.compare") && compared.execution === "needs_review");
  check("its evidence is untouched — nothing is undone", JSON.stringify(compared.evidence) === JSON.stringify(evidenceBefore));

  /* 6 */ step("Where you stand, and the sentence you come back to");
  const standing = standingFor(graph, goal.id)!;
  note(resumeCard(graph, worldId)!.fragments.map((f) => f.text).join(""));
  check("standing counts what is needed to finish from rows", standing.needed.every((n) => n.satisfied));
  graph.positions.save({ worldId, goalId: goal.id, planRevision: graph.plans.current(goal.id)!.revision, stepId: "t.compare", objectId: spec, formRole: "doc.spec", zone: "work", tabIds: ["tab-1"], pendingReviewId: null });
  const position = resumeCard(graph, worldId)!.position!;
  check("the position restores the step and the item, and carries no authority",
    position.stepId === "t.compare" && position.objectId === spec && !/grant|auth|token/i.test(JSON.stringify(position)));

  /* 7 */ step("Finish runs the check, is refused in words, and finishing anyway is a Decision");
  let missing: string[] = [];
  try { finishGoal(graph, goal.id); } catch (e) { missing = (e as NotFinishable).missing; }
  note(missing.join(" · "));
  check("refused while the spec has no release of its current version", missing.some((m) => /doc\.spec has no release of its current version/.test(m)));
  // Finishing anyway, with it still missing: that is the case the record has to carry.
  const finished = finishGoal(graph, goal.id, { anyway: { because: "the client asked for the spec this week" } });
  check("the goal is finished", finished.status === "finished");
  const decision = graph.decisions.list(worldId).find((d) => d.question.startsWith("Finish"))!;
  check("finishing anyway is an accepted Decision with the missing thing as an accepted uncertainty",
    decision.state === "accepted" && graph.decisions.detail(decision.objectId)!.assumptions.some((a) => a.kind === "accepted_uncertainty"));
  const release = new ReadinessEvaluator(graph, loadProfiles(process.cwd())).approve({ objectId: spec, profileId: "client", force: true });
  const html = deliveryReport(graph, spec, release.id);
  check("the report names what was chosen despite uncertainty, in a sentence", html.includes("Chosen despite uncertainty") && !html.includes("✓"));

  /* 8 */ step("No model was called");
  const trail = (graph.db.prepare(`SELECT COUNT(*) c FROM agent_trail`).get() as { c: number }).c;
  check("the agent trail is empty", trail === 0, `${trail} rows`);
  check("the plan's progress is counts, never a percentage", !/%/.test(planProgress(graph.plans.current(goal.id)!, graph.plans.work(goal.id)).sentence));

  graph.close();
  console.log(`\n${"=".repeat(64)}\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
