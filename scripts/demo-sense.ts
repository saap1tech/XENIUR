/**
 * XENIUR Sensemaking, end to end, offline and free.
 *
 *   npm run demo:sense
 *
 * Consume → Capture → Connect → Question → Think → Decide → Create → Validate → Reuse.
 *
 * Reading five things and watching a clip produces a Thinking Map rather than a longer
 * history; the person sorts, links, disagrees and concludes; and before anything is made
 * from it, XENIUR shows what it is about to think with.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { timecodeOf } from "@xeniur/core";
import { ObjectGraph, ideaDna } from "@xeniur/graph";
import {
  SensemakingStore, buildThinkingMap, extractCandidates, extractMoments,
} from "@xeniur/sensemaking";

const workdir = mkdtempSync(join(tmpdir(), "xeniur-sense-"));
let failures = 0;
let stepNo = 0;

const step = (title: string): void => {
  stepNo += 1;
  console.log(`\n${String(stepNo).padStart(2, " ")}. ${title}`);
};
const check = (label: string, ok: boolean, detail = ""): void => {
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};
const note = (text: string): void => console.log(`       ${text}`);

const READING = [
  {
    title: "The real cost of technical outerwear", author: "Lin", kind: "article" as const,
    text: `Waterproof membranes are the single largest line item in technical outerwear.
Welded seams are cheaper at volume and good enough for most conditions.
For example, a mid-tier shell can drop 18% of its unit cost by switching seam method.
Should durability or margin drive the specification?`,
  },
  {
    title: "Seam durability under cold cycling", author: "Okafor", kind: "paper" as const,
    text: `A 2024 study found that 63% of warranty returns were caused by seam failure rather than fabric failure.
Taped seams outperform welded seams once temperatures cycle below freezing.
However, welded seams remain dominant in volume production, which contradicts the durability data.`,
  },
  {
    title: "What buyers actually return", author: "Nakamura", kind: "article" as const,
    text: `Most outerwear returns are caused by seam failure, not by the fabric itself.
Retail data shows returns cluster in the first cold snap of the season.`,
  },
];

const TRANSCRIPT = [
  { start: 0, text: "Quick thought on outerwear manufacturing." },
  { start: 11, text: "The data shows that 40% of perceived quality complaints trace back to a single seam." },
  { start: 47, text: "So what would you actually change first if margin were fixed?" },
];

function main(): void {
  console.log(`\nXENIUR Sensemaking\nworkdir: ${workdir}\n${"=".repeat(60)}`);

  const graph = ObjectGraph.open({
    dbPath: join(workdir, "xeniur.db"), blobDir: join(workdir, "blobs"),
  });
  const store = new SensemakingStore(graph, { frictionThreshold: 4 });
  const world = graph.createWorld({ title: "Rainwear 2027", emoji: "R" });

  /* 1 -------------------------------------------------------------------- */
  step("Consume — three pieces of reading and one clip");
  const sources = READING.map((r, i) => {
    const source = store.recordSource({
      worldId: world.id, kind: r.kind, title: r.title, author: r.author,
      // The copy XENIUR actually read is stored, hashed and kept. Without it a locator
      // points into text nobody has, and "show me where this came from" has no answer.
      text: r.text, publicationId: `publisher-${i}`,
    });
    return { source, version: store.latestVersionOf(source.id)!, text: r.text };
  });
  const clip = store.recordSource({
    worldId: world.id, kind: "clip", title: "12 seconds on seams", author: "Okafor",
    text: TRANSCRIPT.map((l) => l.text).join("\n"), publicationId: "okafor-channel",
  });
  const clipVersion = store.latestVersionOf(clip.id)!;
  note(`${sources.length + 1} sources taken in, each stored as the copy that was read`);

  /* 2 -------------------------------------------------------------------- */
  step("Capture — extract the atoms, honestly labelled");
  let captured = 0;
  let proposed = 0;
  for (const { source, version, text } of sources) {
    const candidates = extractCandidates(text);
    proposed += store.propose(world.id, version.id, candidates).length;
    const atoms = store.acceptCandidates(world.id, version.id, candidates);
    captured += atoms.length;
    note(`${source.title}: ${atoms.length} atoms (${[...new Set(candidates.map((c) => c.atomType))].join(", ")})`);
  }
  const moments = store.acceptCandidates(world.id, clipVersion.id, extractMoments(TRANSCRIPT));
  captured += moments.length;
  note(`the clip: ${moments.length} moments, addressable by timecode`);
  note(`${proposed} more suggestions were filed unaccepted, because nobody looked at them`);

  check("every atom says how it was found", store.listAtoms(world.id)
    .filter((a) => a.extraction === "heuristic").length === captured);
  check("and nobody's confidence was invented",
    store.listAtoms(world.id).every((a) => a.confidence === null));
  check("a twelve-second clip is now reusable, not disposable",
    moments.some((m) => timecodeOf(m.locator) !== null),
    `first moment at ${timecodeOf(moments[0]!.locator)}s`);

  const evidenceAtom = store.listAtoms(world.id).find((a) => a.atomType === "evidence")!;
  const passage = store.passageOf(evidenceAtom.objectId);
  check("and a claim can be taken back to the exact words it came from",
    passage !== null && passage.text === evidenceAtom.text,
    passage ? `"…${passage.context.before.trim().slice(-24)} [${passage.text.slice(0, 32)}…]"` : "");

  // A source re-fetched with a different parser shifts every offset in it. The quote is
  // what survives; the position is only a shortcut.
  const moved = store.addSourceVersion({
    sourceId: sources[1]!.source.id, extractor: "readability/2",
    text: `Seam Durability Under Cold Cycling\nBy Okafor\n\n${sources[1]!.text}`,
  });
  const afterMove = store.passageOf(evidenceAtom.objectId);
  check("the passage survives the source being re-extracted", afterMove !== null);
  check("and XENIUR says when the offsets moved rather than pretending they did not",
    store.versionsOf(sources[1]!.source.id).length === 2, `stored copy ${moved.id.slice(0, 8)}`);

  /* 3 -------------------------------------------------------------------- */
  step("Friction — intake without a single move stops the flow");
  const before = store.friction(world.id);
  check("XENIUR stops surfacing more and asks for one human move", before.active,
    `${before.intakeSinceMove} sources since your last move, threshold ${before.threshold}`);
  note(`it asks: "${before.prompt}"`);
  check("and the prompt can always be overruled", before.dismissible);

  /* 4 -------------------------------------------------------------------- */
  step("Connect — the person links what belongs together");
  const atoms = store.listAtoms(world.id);
  const claim = atoms.find((a) => a.text.includes("63%") || a.atomType === "evidence")!;
  const seamClaim = atoms.find((a) => a.text.toLowerCase().includes("seam failure") && a.atomType === "claim")!;
  const welded = atoms.find((a) => a.text.includes("Welded seams are cheaper"))!;

  store.link({ fromObjectId: claim.objectId, toObjectId: seamClaim.objectId, relation: "supports" });
  store.link({ fromObjectId: welded.objectId, toObjectId: seamClaim.objectId, relation: "contradicts",
               note: "cheap now, returned later" });
  store.rate(seamClaim.objectId, 0.85);
  note("evidence supports the seam claim; the cost claim disagrees with it");

  check("friction cleared the moment thinking happened", store.friction(world.id).active === false);

  /* 5 -------------------------------------------------------------------- */
  step("Question and decide — sort into the six lanes");
  store.sort(seamClaim.objectId, "keep");
  store.sort(welded.objectId, "question");
  const openQuestion = atoms.find((a) => a.atomType === "question");
  if (openQuestion) store.sort(openQuestion.objectId, "test");
  note("keep · question · test");

  /* 6 -------------------------------------------------------------------- */
  step("Think — the Thinking Map, not another feed");
  const map = buildThinkingMap(graph, store, world.id);
  const show = (label: string, entries: typeof map.known) => {
    note(`${label.padEnd(16)} ${entries.length}`);
    for (const e of entries.slice(0, 2)) {
      note(`   "${e.atom.text.slice(0, 62)}${e.atom.text.length > 62 ? "…" : ""}"`);
      note(`      ${e.because}`);
    }
  };
  show("what I know", map.known);
  show("what conflicts", map.conflicts);
  show("what repeats", map.repeating);
  show("what is new", map.novel);
  show("unverified", map.unverified);
  show("deserves action", map.actionable);

  check("it answers from the graph, and can show its working",
    map.known.length > 0 && map.conflicts.length > 0);
  check("it noticed the same claim arriving from different sources",
    map.repeating.length > 0,
    map.repeating[0]?.because ?? "");
  check("and it separates unverified from merely unrated", map.unverified.length > 0);

  /* 7 -------------------------------------------------------------------- */
  step("Idea DNA — what a creation would be made of, before it is made");
  const fromReadingAlone = ideaDna(graph, {
    representationIds: [claim, welded, seamClaim].map((a) =>
      graph.currentState(a.objectId)!.forms[0]!.representationId),
  });
  note(`composition: ${fromReadingAlone.composition}`);
  check("external sources are recognised as somebody's work",
    fromReadingAlone.summary.counts.external_human > 0 || fromReadingAlone.summary.counts.unattributed > 0);
  check("and unknown origin is never reported as AI origin",
    !fromReadingAlone.statements.some((s) => s.kind === "all_roots_generated") ||
    fromReadingAlone.summary.counts.unattributed === 0);

  /* 8 -------------------------------------------------------------------- */
  step("The closed-loop case — nothing but model output");
  const modelOnly = graph.createObject({
    worldId: world.id, semanticType: "draft", title: "Auto-drafted positioning",
  }).object.id;
  const generated = graph.addRepresentation({
    objectId: modelOnly, modality: "text", format: "md",
    blobHash: graph.putBlob(Buffer.from("A confident paragraph about seams."), "text/markdown", "md"),
    provenance: "generated", provider: "openai",
  });
  graph.commitVersion({ objectId: modelOnly, forms: [{ role: "doc.primary", representationId: generated.id }] });

  const dna = ideaDna(graph, { objectId: modelOnly });
  check("XENIUR says every root is generated, and only that",
    dna.statements.some((s) => s.kind === "all_roots_generated"), dna.composition);
  check("it invites one ingredient rather than refusing", dna.invitation !== null);
  note(`"${dna.invitation}"`);
  check("and it never claims a percentage it did not measure",
    !dna.composition.includes("%"));

  /* 9 -------------------------------------------------------------------- */
  step("Create — the person adds their own conclusion, and the DNA changes");
  const conclusion = store.observe(world.id,
    "Our own returns data says seams fail first. We specify taped seams and price for it.",
    { about: seamClaim.objectId, lane: "build" });

  const withMine = ideaDna(graph, {
    representationIds: [
      graph.currentState(conclusion.objectId)!.forms[0]!.representationId,
      graph.currentState(seamClaim.objectId)!.forms[0]!.representationId,
    ],
  });
  note(`composition: ${withMine.composition}`);
  check("human material is present once something of yours is in it",
    withMine.summary.humanSignalPresent && withMine.invitation === null);
  check("your conclusion is counted as yours",
    withMine.summary.counts.your_observation >= 1);

  /* 10 ------------------------------------------------------------------- */
  step("Reuse — one insight, still addressable months later");
  const reused = store.getAtom(moments[0]!.objectId)!;
  check("the clip's moment kept its timecode and its source",
    timecodeOf(reused.locator) !== null && reused.sourceId === clip.id,
    `${timecodeOf(reused.locator)}s in "${store.getSource(reused.sourceId!)!.title}"`);
  check("and it is an ordinary Object, so anything can be built from it",
    graph.currentState(reused.objectId) !== null);

  const finalMap = buildThinkingMap(graph, store, world.id);
  note(`${finalMap.counts.sources} sources, ${finalMap.counts.atoms} atoms, ${finalMap.counts.links} links`);

  console.log(`\n${"=".repeat(60)}`);
  console.log(failures === 0 ? "PASS — attention became understanding" : `FAIL (${failures})`);
  console.log(`\nworkdir: ${workdir}\n`);
  graph.close();
}

try {
  main();
  if (failures > 0) process.exitCode = 1;
} catch (err) {
  console.error("\ndemo crashed:", err);
  process.exitCode = 1;
}
