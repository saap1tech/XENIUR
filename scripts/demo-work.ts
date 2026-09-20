/**
 * The Human Work Interface, end to end — one goal in words, to a finished delivery.
 *
 *   npm run demo:work
 *
 * A person opens XENIUR with something to accomplish, not with a profession or a model.
 * Two sources disagree; the disagreement is a pair of claims, not a paragraph. *Challenge it*
 * resolves by rule and yields a proposal, never an atom. The decision is made with one
 * uncertainty explicitly accepted, and the goal is finished with a second one — recorded as a
 * Decision, named in the delivery report. Where you stand is read from rows the whole way.
 *
 * Offline: no model is called anywhere in this script, and a check proves it.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KNOWLEDGE_GLYPHS, describeStanding, resumeText } from "@xeniur/core";
import { ObjectGraph, ReadinessEvaluator, deliveryReport, finishGoal, loadProfiles, resumeCard, standingFor, todayFor } from "@xeniur/graph";
import { needFor } from "@xeniur/grammar";
import { resolveAsk } from "@xeniur/brain";
import { SensemakingStore } from "@xeniur/sensemaking";

const workdir = mkdtempSync(join(tmpdir(), "xeniur-work-"));
let failures = 0, stepNo = 0;
const step = (t: string) => { stepNo += 1; console.log(`\n${String(stepNo).padStart(2, " ")}. ${t}`); };
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures += 1;
};
const note = (t: string) => console.log(`       ${t}`);

const STUDY = `Cold-cycling trials on technical outerwear seams.
Taped seams outperformed welded seams once temperatures cycled below freezing.
Sample size was 4,000 returned garments across two winters.`;

const SUPPLIER = `Supplier note, welded seams.
Welded seams held through our freezer test with no failures at minus twenty.
Test batch was 40 garments.`;

async function main(): Promise<void> {
  console.log(`\nXENIUR — the work, end to end\nworkdir: ${workdir}\n${"=".repeat(64)}`);
  const graph = ObjectGraph.open({ dbPath: join(workdir, "x.db"), blobDir: join(workdir, "blobs") });
  const store = new SensemakingStore(graph);
  const world = graph.createWorld({ title: "Cold-weather shell", emoji: "◒" });
  const worldId = world.id;

  /* 1 */ step("A goal in words — no profession, no workflow, no model");
  const goal = graph.goals.create(worldId, "Choose a seam construction the client will accept for the cold-weather shell");
  check("the goal is the person's sentence, verbatim", graph.goals.current(worldId)!.outcome.startsWith("Choose a seam"));
  check("its way of working is exploring, not a stage", goal.status === "exploring");
  const need0 = needFor({ status: goal.status, goalKind: "understand", focusKind: "object", knowledge: { known: 0, proposed: 0, disputed: 0, unknown: 0, chosenDespite: 0 }, changes: 0, hasChoices: false });
  check("the centre's first question is: I don't know enough yet", need0 === "know_more", need0);

  /* 2 */ step("Two sources, stored as the copies that were read");
  const study = store.recordSource({ worldId, kind: "paper", title: "Cold-cycling trials", author: "Okafor", text: STUDY, publicationId: "textile-journal" });
  const supplier = store.recordSource({ worldId, kind: "note", title: "Supplier freezer test", text: SUPPLIER, rights: "restricted" });
  const sv1 = store.latestVersionOf(study.id)!, sv2 = store.latestVersionOf(supplier.id)!;
  check("both texts are readable at their exact words", !!store.textOfVersion(sv1.id)?.includes("Taped seams outperformed") && !!store.textOfVersion(sv2.id)?.includes("no failures"));

  /* 3 */ step("Two claims, and the disagreement as a pair — not a paragraph");
  const taped = store.createAtom({ worldId, atomType: "claim", text: "Taped seams hold up better than welded once it freezes.", sourceId: study.id, sourceVersionId: sv1.id, provenance: "imported" });
  const welded = store.createAtom({ worldId, atomType: "claim", text: "Welded seams hold at minus twenty without failures.", sourceId: supplier.id, sourceVersionId: sv2.id, provenance: "imported" });
  // Each claim cites its own passage; a person reviews both. Then the supplier's passage is
  // recorded against the taped claim as *contradicted* — the disagreement is a row, not prose.
  const s1 = store.recordSupport({ claimObjectId: taped.objectId, sourceVersionId: sv1.id });
  const s2 = store.recordSupport({ claimObjectId: welded.objectId, sourceVersionId: sv2.id });
  store.reviewSupport(s1.id, "supported"); store.reviewSupport(s2.id, "supported");
  const s3 = store.recordSupport({ claimObjectId: taped.objectId, sourceVersionId: sv2.id });
  store.reviewSupport(s3.id, "contradicted", "40 garments at a fixed temperature, against 4,000 cycled");
  store.link({ fromObjectId: welded.objectId, toObjectId: taped.objectId, relation: "contradicts", note: "40 garments against 4,000" });
  graph.goals.setFocus(goal.id, taped.objectId);
  graph.goals.setStatus(goal.id, "understanding");
  let standing = standingFor(graph, goal.id)!;
  check("the standing counts one claim as known and the contradicted one as disputed", standing.knowledge.known.length === 1 && standing.knowledge.disputed.length === 1,
    `${standing.knowledge.known.length} known · ${standing.knowledge.disputed.length} disputed`);
  const need1 = needFor({ status: "understanding", goalKind: "understand", focusKind: "object", knowledge: { known: 1, proposed: 0, disputed: 1, unknown: 0, chosenDespite: 0 }, changes: 0, hasChoices: false });
  check("the centre now answers: I need to understand conflicting information", need1 === "understand_conflict", need1);

  /* 4 */ step("Challenge it — resolved by rule, shown as an interpretation, and it proposes");
  const asked = resolveAsk("Challenge this claim", [{ id: taped.objectId, title: taped.text, semanticType: "claim" }]);
  check("the request reads as challenge_claim without a picker", asked.intent === "challenge_claim" && asked.by === "rule", asked.interpretation);
  note(asked.interpretation);
  // With no model connected the move still works: the counter-claim is proposed, never recorded.
  store.propose(worldId, sv2.id, [{ atomType: "claim", text: "Freezer tests at a fixed temperature do not reproduce the cycling that fails taped seams.",
    locator: { selectors: [] }, because: "challenge_claim: a counterargument, proposed", stance: "hypothesis", citations: [] }], "brain/challenge_claim");
  const pending = store.pendingCandidates(worldId);
  check("the counter-claim is a candidate, not an atom", pending.length === 1 && store.listAtoms(worldId).length === 2, `${pending.length} pending · ${store.listAtoms(worldId).length} atoms`);
  standing = standingFor(graph, goal.id)!;
  check("the standing counts it as proposed (◐), not known (●)", standing.knowledge.proposed.length === 1 && standing.knowledge.known.length === 1);

  /* 5 */ step("Decide — with one uncertainty accepted, in words, as part of the decision");
  const decision = graph.decisions.create({
    worldId, question: "Which seam construction for the cold-weather shell?",
    options: [{ key: "taped", label: "Taped", note: "4,000 garments, two winters" }, { key: "welded", label: "Welded", note: "40 garments, one freezer" }],
    chosenOption: "taped", rationale: "The larger sample cycled through real winters.",
  });
  graph.decisions.cite(decision.objectId, { atomObjectId: taped.objectId, sourceVersionId: sv1.id, atomVersionId: null, relation: "supports", note: "" });
  graph.decisions.acceptUncertainty(decision.objectId, "Welded seams were never cycled; they may match taped under cycling.", "cost and time: the factory slot closes this month");
  graph.decisions.accept(decision.objectId, "you", { steelman: "Welded is cheaper at volume and the supplier's test was clean." });
  const detail = graph.decisions.detail(decision.objectId)!;
  check("the decision is accepted with a steelman and an accepted uncertainty",
    detail.state === "accepted" && detail.assumptions.some((a) => a.kind === "accepted_uncertainty"));
  check("the brief says 'Chosen despite'", (graph.decisions.briefOf(decision.objectId) ?? "").includes("Chosen despite"));

  /* 6 */ step("Make — the artifact, its link to the decision, and what is required to finish");
  const shell = graph.createObject({ worldId, semanticType: "garment", title: "Cold-weather shell" }).object.id;
  graph.decisions.link({ fromObjectId: shell, toObjectId: decision.objectId, relation: "satisfies" });
  graph.goals.setFocus(goal.id, shell);
  graph.goals.setRequiredOutputs(goal.id, ["doc.spec"]);
  graph.goals.setStatus(goal.id, "making");
  const rep = graph.addRepresentation({ objectId: shell, modality: "text", format: "md", provenance: "human",
    blobHash: graph.putBlob(Buffer.from("# Seam spec\nTaped seams, 12 mm tape, cold-weather range.\n"), "text/markdown", "md") });
  graph.commitVersion({ objectId: shell, forms: [{ role: "doc.spec", representationId: rep.id }] });
  standing = standingFor(graph, goal.id)!;
  check("the required output is satisfied by a current form", standing.needed.every((n) => n.satisfied), standing.needed.map((n) => `${n.output}:${n.satisfied}`).join(" "));
  check("▲ counts the decision as chosen despite uncertainty", standing.knowledge.chosenDespite.some((r) => r.id === decision.objectId));

  /* 7 */ step("Leave, and come back: the resume card is templates over rows");
  const card = resumeCard(graph, worldId)!;
  note(resumeText(card));
  check("every fragment that names a thing links to it", card.fragments.filter((f) => f.text.includes("Cold-weather shell")).every((f) => f.objectId === shell));
  check("Today leads with this World", todayFor(graph).resume?.worldId === worldId);
  note(describeStanding(standing));
  check("the standing sentence has no percentages and no adjectives of praise", !/%|great|excellent|strong/i.test(describeStanding(standing)));

  /* 8 */ step("Finish — refused while a claim is disputed; finish-anyway is a Decision the report names");
  let refused = false;
  try { finishGoal(graph, goal.id); } catch (e) { refused = true; note(`refused: ${(e as Error).message}`); }
  check("finishing is refused while the pair is still disputed", refused);
  const finished = finishGoal(graph, goal.id, { anyway: { because: "the client asked for the spec this week; the dispute is noted in the report" } });
  check("the goal is finished", finished.status === "finished");
  const finishDecision = graph.decisions.list(worldId).find((d) => d.question.startsWith("Finish"))!;
  check("finish-anyway is an accepted Decision with the missing things as accepted uncertainties",
    finishDecision.state === "accepted" && graph.decisions.detail(finishDecision.objectId)!.assumptions.some((a) => a.kind === "accepted_uncertainty" && /disputed/.test(a.text)));

  /* 9 */ step("The delivery report says what was chosen despite uncertainty — in a sentence, not a badge");
  const release = new ReadinessEvaluator(graph, loadProfiles(process.cwd())).approve({ objectId: shell, profileId: "client", force: true });
  const html = deliveryReport(graph, shell, release.id);
  check("the report has the section", html.includes("Chosen despite uncertainty"));
  check("…and the sentence", /unresolved assumption(s)? (was|were) explicitly accepted for this delivery/.test(html));
  check("…and no green tick anywhere", !html.includes("✓"));

  /* 10 */ step("No model was called");
  const trail = (graph.db.prepare(`SELECT COUNT(*) c FROM agent_trail`).get() as { c: number }).c;
  check("the agent trail is empty", trail === 0, `${trail} rows`);
  const glyphs = Object.values(KNOWLEDGE_GLYPHS).map((g) => g.glyph).join(" ");
  note(`knowledge glyphs: ${glyphs}`);

  graph.close();
  console.log(`\n${"=".repeat(64)}\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
