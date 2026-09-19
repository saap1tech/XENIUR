/**
 * Compression — a research answer that arrives as a map of steps, not as a wall of text.
 *
 *   npm run demo:research
 *
 * The plant operator, the grower, the clinician: they ask for recent research and a plan,
 * receive two thousand words, scroll, and act on none of it. The problem is the shape of the
 * answer. Here the model's reply arrives as proposed claims and steps, each claim bound word by
 * word to a stored passage, each a candidate until a person reviews it. One claim cites words
 * the source does not contain — and is shown as exactly that.
 *
 * Offline: the sources are fixtures with stored text, and the model is a script. The point is
 * what XENIUR does with a reply, which is decided entirely by code.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@xeniur/core";
import { compressForScene } from "@xeniur/core";
import { ObjectGraph, SpendLedger } from "@xeniur/graph";
import { GatedBrain, ScriptedLlmClient, bindProposal, type RuntimeRegistry } from "@xeniur/brain";
import { SensemakingStore, acceptStep, proposeFromBound } from "@xeniur/sensemaking";

const workdir = mkdtempSync(join(tmpdir(), "xeniur-research-"));
let failures = 0, stepNo = 0;
const step = (t: string) => { stepNo += 1; console.log(`\n${String(stepNo).padStart(2, " ")}. ${t}`); };
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures += 1;
};
const note = (t: string) => console.log(`       ${t}`);

const STUDY = `Cold-cycling trials on technical outerwear seams.
A 2024 study found that 63% of warranty returns were caused by seam failure rather than fabric failure.
Taped seams outperformed welded seams once temperatures cycled below freezing.
Sample size was 4,000 returned garments across two winters.`;

const RETURNS = `Internal returns, Q1.
Returns cluster in the first cold snap of the season.
Most tickets name a seam, not the fabric.`;

async function main(): Promise<void> {
  console.log(`\nXENIUR — compression\nworkdir: ${workdir}\n${"=".repeat(64)}`);
  const graph = ObjectGraph.open({ dbPath: join(workdir, "x.db"), blobDir: join(workdir, "blobs") });
  const store = new SensemakingStore(graph);
  const world = graph.createWorld({ title: "Rainwear 2027", emoji: "R" });

  /* 1 */ step("Two sources, stored as the copies that were read");
  const study = store.recordSource({ worldId: world.id, kind: "paper", title: "Cold-cycling trials", author: "Okafor", text: STUDY, publicationId: "textile-journal" });
  const returns = store.recordSource({ worldId: world.id, kind: "note", title: "Internal returns, Q1", text: RETURNS, rights: "restricted" });
  const sv1 = store.latestVersionOf(study.id)!, sv2 = store.latestVersionOf(returns.id)!;
  const texts = new Map([[sv1.id, store.textOfVersion(sv1.id)!], [sv2.id, store.textOfVersion(sv2.id)!]]);
  check("both copies are readable at their exact text", texts.get(sv1.id)!.includes("63%") && texts.get(sv2.id)!.includes("cold snap"));

  /* 2 */ step("The model is asked for a plan — and answers in the shape of one");
  // A scripted reply: what a good model produces for this job. One citation is invented.
  const reply = JSON.stringify({
    kind: "executable",
    plan: { intent: "plan the seam decision", objects: [], tool: "knowledge.propose", confirmation: false, args: {
      worldId: world.id, headline: "Seams, not fabric, drive returns — specify taped",
      claims: [
        { text: "Most warranty returns are caused by seam failure, not fabric.", stance: "assertion",
          citations: [{ sourceVersionId: sv1.id, exact: "63% of warranty returns were caused by seam failure rather than fabric failure", bears: "supported" }] },
        { text: "Taped seams hold up better than welded once it freezes.", stance: "assertion",
          citations: [{ sourceVersionId: sv1.id, exact: "Taped seams outperformed welded seams once temperatures cycled below freezing", bears: "supported" }] },
        { text: "Welded seams are 18% cheaper at volume.", stance: "assertion",
          citations: [{ sourceVersionId: sv1.id, exact: "welded seams are 18% cheaper at volume", bears: "supported" }] },
        { text: "Our own tickets point the same way.", stance: "assertion",
          citations: [{ sourceVersionId: sv2.id, exact: "Most tickets name a seam, not the fabric", bears: "supported" }] },
        { text: "The margin is probably worth paying for durability.", stance: "hypothesis", citations: [] },
      ],
      steps: [
        { order: 1, text: "Pull Q1 returns by failure mode and confirm the seam share.", restsOn: [3] },
        { order: 2, text: "Cost taped seams at volume against welded.", restsOn: [2] },
        { order: 3, text: "Specify taped seams for the cold-weather range.", restsOn: [0, 1] },
        { order: 4, text: "Write the decision with the study and the tickets as evidence.", restsOn: [0, 3] },
        { order: 5, text: "Set a review trigger: revisit if the range moves to milder markets.", restsOn: [] },
        { order: 6, text: "Brief the factory on taping tolerances.", restsOn: [1] },
        { order: 7, text: "Plan a second cold-cycle test on the new spec.", restsOn: [1] },
        { order: 8, text: "Update the warranty copy to name seams explicitly.", restsOn: [3] },
        { order: 9, text: "Schedule the price review for after the first season.", restsOn: [] },
      ],
      uncertain: ["whether the 63% holds outside cold climates", "the true cost delta — the study did not price it"],
    } },
    why: "the sources support a seam-first specification; the cost claim needs its own source",
  });

  const ledger = new SpendLedger(graph.db, { perActionUsdMax: 1, perTaskUsdMax: 5, totalUsdMax: 100 });
  const brain = new GatedBrain(new ScriptedLlmClient([reply]), {
    ledger, liveCallsEnabled: true,
    pricing: { inputPerMTok: 0, outputPerMTok: 0, verified: true, verifiedOn: "2026-09-19" },
  });
  const registry: RuntimeRegistry = {
    worldId: world.id, objectIds: new Set(), representationIds: new Set(), versionIds: new Set(),
    formRoles: new Map(), availableTools: new Set<Tool>(["knowledge.propose"]), sourceTexts: texts,
  };
  const result = await brain.ask("research_plan", "what should we do about seam failures?",
    { world: { id: world.id, title: world.title, emoji: "R" }, selected: [], activeTasks: [] }, registry);
  check("the reply is an executable proposal, not prose", result.status === "ok" && result.outcome.kind === "executable");
  if (result.status !== "ok" || result.outcome.kind !== "executable") throw new Error("no proposal");

  /* 3 */ step("Binding — every citation is checked word by word against the stored copy");
  const bound = bindProposal(result.outcome.plan.args, texts);
  check("three claims resolve to real passages", bound.claims.filter((c) => !c.unsupported && c.stance === "assertion").length === 3
    && bound.claims.filter((c) => c.citations.length > 0).length === 3);
  const bad = bound.claims.find((c) => c.text.includes("18% cheaper"))!;
  check("the invented cost citation was dropped and the claim is marked unsupported", bad.unsupported && bad.citations.length === 0);
  check("the hypothesis is the model's own, not unsupported", bound.claims.find((c) => c.stance === "hypothesis")!.unsupported === false);
  check("what the model was unsure about is carried, not smoothed over", bound.uncertain.length === 2);
  note(`dropped citations: ${bound.droppedCitations}`);

  /* 4 */ step("Everything enters as candidates; nothing is a fact yet");
  const out = proposeFromBound(store, world.id, bound, { sourceTexts: texts });
  check("claims and steps are candidates, atoms are zero", out.claimCandidates.length === 5 && out.stepCandidates.length === 9 && store.listAtoms(world.id).length === 0);
  check("the unsupported claim is named", out.unsupportedClaimIds.length === 1);

  /* 5 */ step("Compression — the primary Scene shows seven steps; two sit one layer down; none are lost");
  const { primary, supporting } = compressForScene(out.stepCandidates);
  check("7 primary, 2 supporting, 9 total", primary.length === 7 && supporting.length === 2 && primary.length + supporting.length === 9);
  for (const c of primary) note(`  ${c.text}`);
  note(`  … and ${supporting.length} more behind "Show supporting detail"`);

  /* 6 */ step("A person reviews the support — the only thing that settles a citation");
  const first = out.claimCandidates[0]!;
  let refused = false;
  try { store.accept(first.id); } catch { refused = true; }
  check("an assertion with an unreviewed model citation cannot be accepted yet", refused);
  const atom = store.accept(first.id, { acceptUnreviewed: true })!;
  const row = store.supportOf(atom.objectId)[0]!;
  check("the citation is filed as the model's proposal, traceable to the stored words",
    row.checkedBy === "model" && store.passageOf(atom.objectId)!.text.startsWith("63%"));
  store.reviewSupport(row.id, "supported", "the study says exactly this");
  check("after a human review it is supported — and only now", store.supportSummary(atom.objectId).reviewedSupported);

  /* 7 */ step("Steps become directions in the Build lane");
  const s1 = acceptStep(store, out.stepCandidates[0]!.id)!;
  check("a step needs no source and lands where work happens", s1.stance === "direction" && s1.lane === "build");

  /* 8 */ step("The restricted source stayed on the machine");
  check("the returns note is marked restricted, and a remote context would exclude it", sv2.rights === "restricted");

  writeFileSync(join(workdir, "bound.json"), JSON.stringify(bound, null, 2));
  console.log(`\n${"=".repeat(64)}`);
  console.log(failures === 0 ? "PASS — the answer arrived as a plan, and the invented citation was caught" : `FAIL (${failures})`);
  console.log(`\nworkdir: ${workdir}\n`);
  graph.close();
}

main().then(() => { if (failures > 0) process.exitCode = 1; })
  .catch((err) => { console.error("\ndemo crashed:", err); process.exitCode = 1; });
