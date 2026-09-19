/**
 * Renders XENIUR's new surfaces to standalone HTML using the real components, the real
 * stylesheet and a real pipeline run — a way to look at the interface without clicking
 * through the app.
 *
 *   npm run preview:ui
 */
import { renderToStaticMarkup } from "react-dom/server";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InputRole, Scene } from "@xeniur/core";
import { planDigest } from "@xeniur/core";
import {
  ObjectGraph, ReadinessEvaluator, applyTemplate, ideaDna, impactOf, loadProfiles,
} from "@xeniur/graph";
import { PermissionBroker } from "@xeniur/permissions";
import { loadProvidersConfig, type ProviderEnv } from "@xeniur/providers";
import { CapabilityRouter, RebuildRunner } from "@xeniur/router";
import { ValidationRunner } from "@xeniur/validators";
import {
  SensemakingStore, buildThinkingMap, extractCandidates,
} from "@xeniur/sensemaking";
import { SceneRenderer, type SceneBindings } from "@xeniur/ui";
import { proposalsFor } from "@xeniur/grammar";

const ROOT = process.cwd();
const OUT = process.argv[2] ?? join(ROOT, "ui-preview.html");
const workdir = mkdtempSync(join(tmpdir(), "xeniur-uiprev-"));

const ARTICLE = `Waterproof membranes are the single largest line item in technical outerwear.
A 2024 study found that 63% of warranty returns were caused by seam failure rather than fabric failure.
However, welded seams remain dominant in volume production, which contradicts the durability data.
Should durability or margin drive the specification?`;

async function main(): Promise<void> {
  const graph = ObjectGraph.open({
    dbPath: join(workdir, "x.db"), blobDir: join(workdir, "blobs"),
  });
  const env: ProviderEnv = {
    scratchDir: join(workdir, "scratch"), rootDir: ROOT,
    binaries: {
      ffmpeg: "/opt/homebrew/bin/ffmpeg",
      blender: "/Applications/Blender.app/Contents/MacOS/Blender",
    },
  };
  const broker = new PermissionBroker(graph.db);
  const router = new CapabilityRouter({ graph, broker, config: loadProvidersConfig(ROOT), env });
  const rebuild = new RebuildRunner(graph, router);
  const validate = new ValidationRunner(graph, env);
  const readiness = new ReadinessEvaluator(graph, loadProfiles(ROOT));

  /* A real 3D asset World, built through the real pipeline. */
  const applied = applyTemplate(graph, "asset3d", { title: "Rocket" })!;
  const objectId = applied.state.object.id;
  const blend = join(workdir, "rocket.blend");
  copyFileSync(join(ROOT, "assets", "rocket.blend"), blend);

  await router.execute(
    { intent: "import the prop", objects: [objectId], tool: "import.file",
      args: { path: blend }, confirmation: false },
    { worldId: applied.worldId, objectId, formRoles: ["source.primary", "model.mesh"], label: "imported" },
  );
  await rebuild.run(objectId, { worldId: applied.worldId });
  await validate.validate(objectId);

  // Adjust the recipe, so the interface has something genuinely out of date to show.
  // Changing a step's settings is exactly as real a reason to rebuild as changing a source.
  const current = graph.recipes.recipeAtCurrentVersion(objectId)!;
  const adjusted = current.steps.map((step) => ({
    key: step.key, tool: step.tool, replayPolicy: step.replayPolicy,
    capabilityVersion: step.capabilityVersion,
    args: step.key === "make_solid" ? { ...step.args, targetHeight: 180 } : step.args,
    inputs: step.inputs, outputs: step.outputs,
  }));
  const revised = graph.recipes.saveRecipe({ objectId, name: current.name, steps: adjusted });
  graph.commitVersion({ objectId, recipeId: revised.id, label: "made it taller" });

  /* A Reading World with real atoms. */
  const reading = graph.createWorld({ title: "Rainwear 2027", emoji: "R" });
  const sense = new SensemakingStore(graph, { frictionThreshold: 3 });
  const a = sense.recordSource({
    worldId: reading.id, kind: "article", title: "Outerwear economics", author: "Lin",
    text: ARTICLE, publicationId: "economics-weekly",
  });
  const b = sense.recordSource({
    worldId: reading.id, kind: "paper", title: "Seam durability", author: "Okafor",
    text: "A 2024 study measured seam failure across 4,000 returned garments.",
    publicationId: "textile-journal",
  });
  sense.acceptCandidates(reading.id, sense.latestVersionOf(a.id)!.id, extractCandidates(ARTICLE));
  sense.createAtom({
    worldId: reading.id, atomType: "claim", sourceId: b.id,
    sourceVersionId: sense.latestVersionOf(b.id)!.id,
    text: "Most outerwear returns are caused by seam failure, not fabric.",
  });
  const atoms = sense.listAtoms(reading.id);
  const evidence = atoms.find((x) => x.atomType === "evidence")!;
  const claim = atoms.find((x) => x.text.includes("Most outerwear"))!;
  const contra = atoms.find((x) => x.atomType === "contradiction")!;
  sense.link({ fromObjectId: evidence.objectId, toObjectId: claim.objectId, relation: "supports" });
  sense.link({ fromObjectId: contra.objectId, toObjectId: claim.objectId, relation: "contradicts" });
  sense.rate(claim.objectId, 0.85);
  sense.sort(claim.objectId, "keep");
  for (let i = 0; i < 4; i += 1) {
    sense.recordSource({ worldId: reading.id, kind: "video", title: `Clip ${i}`,
                         text: `A short clip about seam construction, number ${i}.` });
  }


  /* A real accepted decision, so the card shows a real brief and real citations. */
  const decision = graph.decisions.create({
    worldId: applied.worldId,
    question: "Which seam method for the 2027 shell?",
    options: [
      { key: "taped", label: "Taped seams", note: "more durable once temperatures cycle" },
      { key: "welded", label: "Welded seams", note: "cheaper at volume" },
    ],
    chosenOption: "taped",
    rationale: "Our own returns data says seams fail before fabric does.",
  });
  const decisionId = decision.objectId;
  graph.decisions.assume(decisionId, {
    text: "Cold-weather use dominates the range",
    reviewTrigger: "the range moves to milder markets",
  });

  /* What a consequential action looks like before it runs. */
  const samplePlan = {
    tool: "browser.submit",
    args: { order: "Seam tape, 40 m", supplier: "Kanto Textiles", when: "Friday" },
    destination: "supplier.example", estimatedUsd: 128.4,
  };
  const digest = planDigest(samplePlan);
  // The decision cites a real passage from a real stored copy, then is accepted — which
  // renders its brief deterministically and gives the card something true to show.
  graph.decisions.cite(decisionId, {
    sourceVersionId: sense.latestVersionOf(a.id)!.id,
    atomObjectId: evidence.objectId, atomVersionId: null,
    relation: "supports", note: "the 63% figure",
  });
  graph.decisions.accept(decisionId, "you", { skipSteelman: true });

  /* Typed fixtures for the full M4 primitive gallery. */
  const constraintObject = (title: string) => graph.createObject({
    worldId: applied.worldId, semanticType: "constraint", title,
  });
  const costObject = constraintObject("Cost ceiling");
  const cost = graph.constraints.define(costObject.object.id,
    { kind: "range", min: 500, max: 2500, step: 100, unit: "EUR" }, "Budget", 1500);
  const priorityObject = constraintObject("Trip priorities");
  const priority = graph.constraints.define(priorityObject.object.id,
    { kind: "priority", dimensions: ["Quiet", "Food", "Nightlife"] }, "Priorities",
    { Quiet: 0.8, Food: 0.65, Nightlife: 0.2 });
  const peopleObject = constraintObject("Party size");
  const people = graph.constraints.define(peopleObject.object.id,
    { kind: "quantity", min: 1, max: 8, unit: "people" }, "Travellers", 2);
  const dateObject = constraintObject("Travel window");
  const start = Date.UTC(2027, 3, 12);
  const end = Date.UTC(2027, 3, 18);
  const dates = graph.constraints.define(dateObject.object.id,
    { kind: "date_range", earliest: Date.UTC(2027, 3, 1), latest: Date.UTC(2027, 3, 30) },
    "Dates", { start, end });
  const locationObject = constraintObject("Neighbourhood");
  const location = graph.constraints.define(locationObject.object.id, { kind: "location", places: [
    { id: "shinjuku", label: "Shinjuku", x: 160, y: 210, district: "West" },
    { id: "asakusa", label: "Asakusa", x: 432, y: 116, district: "East" },
    { id: "koenji", label: "Koenji", x: 82, y: 128, district: "West" },
  ] }, "Where", "shinjuku");
  const visualConstraints = [location, dates, people, cost, priority];
  graph.process.record({
    objectId, versionId: graph.currentState(objectId)!.versionId, kind: "sketch_made", actor: "human",
    label: "Rocket silhouette sketch", tool: null, model: null,
    inputHashes: [], outputHashes: ["a".repeat(64)], durationMs: 180_000,
  });
  const visualProposal = proposalsFor(
    { id: objectId, title: "Rocket", semanticType: "asset" },
    { id: decisionId, title: "Seam decision", kind: "object" },
  )[0]!;

  /* Bindings, exactly as the app assembles them. */
  // (the decision is accepted below, once the reading World has given it something to cite)

  const detailBindings = (): SceneBindings => ({
    states: {
      [objectId]: graph.currentState(objectId)!,
      [decisionId]: graph.currentState(decisionId)!,
    },
    representations: Object.fromEntries(graph.listRepresentations(objectId).map((r) => [r.id, r])),
    tasks: {},
    stepStates: { [objectId]: graph.recipes.statusOf(objectId) },
    rebuildPlan: { [objectId]: graph.recipes.planRebuild(objectId) },
    checks: {
      [objectId]: (graph.db.prepare(`SELECT * FROM checks WHERE object_id = ? ORDER BY at DESC`)
        .all(objectId) as Array<Record<string, unknown>>).map((r) => ({
          id: r["id"] as string, objectId, representationId: null,
          validator: r["validator"] as string, status: r["status"] as never,
          summary: r["summary"] as string, detail: {},
          formRole: (r["form_role"] as string | null) ?? null, at: r["at"] as number,
          subjectKind: (r["subject_kind"] as never) ?? "unbound",
          subjectId: (r["subject_id"] as string | null) ?? null,
          subjectHash: (r["subject_hash"] as string | null) ?? null,
          validatorVersion: (r["validator_version"] as string) ?? "0.0.0",
          params: {}, environment: {},
          runId: (r["run_id"] as string | null) ?? null,
        })),
    },
    readiness: { [objectId]: readiness.evaluateAll(objectId) },
    history: {
      [objectId]: {
        versions: graph.versionChain(objectId).map((v) => ({
          id: v.id, seq: v.seq, label: v.label, branchId: v.branchId,
          formCount: graph.formsAt(v.id).length, createdAt: v.createdAt,
        })),
        branches: graph.listBranches(objectId).map((br) => ({
          id: br.id, name: br.name, headVersionId: br.headVersionId,
        })),
      },
    },
    dna: { [objectId]: ideaDna(graph, { objectId }) },
    impact: { [objectId]: impactOf(graph, objectId) },
    decisions: Object.fromEntries(
      graph.decisions.list(applied.worldId).map((d) => [d.objectId, d]),
    ),
    pendingPlans: { [digest]: {
      plan: samplePlan, level: "PURCHASE", scope: "supplier.example", taskId: null,
      summary: "Order 40 metres of taped seam tape", reversible: false,
    } },
    constraints: Object.fromEntries(visualConstraints.map((item) => [item.objectId, item])),
    processProof: { [objectId]: graph.process.proof(objectId, "filtered") },
    gestureProposals: { [visualProposal.id]: visualProposal },
    blobUrl: (hash) => dataUrls.get(hash) ?? "",
  });

  const senseBindings = (): SceneBindings => ({
    states: Object.fromEntries(
      sense.listAtoms(reading.id).map((a) => [a.objectId, graph.currentState(a.objectId)!]),
    ),
    representations: {}, tasks: {},
    thinkingMap: { [reading.id]: buildThinkingMap(graph, sense, reading.id) },
    friction: { [reading.id]: sense.friction(reading.id) },
    blobUrl: () => "",
  });

  // Inline every asset so the page stands alone.
  const dataUrls = new Map<string, string>();
  for (const rep of graph.listRepresentations(objectId)) {
    if (!rep.blobHash) continue;
    const row = graph.db.prepare(`SELECT mime FROM blobs WHERE sha256 = ?`).get(rep.blobHash) as
      { mime: string } | undefined;
    if (!row || !row.mime.startsWith("image")) continue;
    dataUrls.set(rep.blobHash, `data:${row.mime};base64,${graph.readBlob(rep.blobHash).toString("base64")}`);
  }

  const scene = (title: string, children: Array<Record<string, unknown>>): Scene => ({
    worldId: applied.worldId, title, reason: title,
    root: { id: "root", component: "Canvas", layout: "column", children: children as never },
  });

  const sections: Array<[string, string]> = [
    ["M4 · the fourteen visual primitives", renderToStaticMarkup(<SceneRenderer bindings={detailBindings()} scene={scene("visual grammar", [
      { id: "orbit", component: "ObjectOrbit", focusId: objectId, relatedIds: [decisionId], state: "selected", disclosure: 2 },
      { id: "ring", component: "AffordanceRing", objectId, proposalIds: [visualProposal.id] },
      { id: "spatial", component: "SpatialCanvas", focusId: objectId, objectIds: [objectId, decisionId],
        edges: [{ id: "decision-edge", from: decisionId, to: objectId, relation: "satisfies" }], disclosure: 2 },
      { id: "strip", component: "ConstraintStrip", constraintIds: visualConstraints.map((item) => item.objectId), disclosure: 2 },
      { id: "cost", component: "RangeMeter", constraintId: cost.objectId },
      { id: "priority", component: "PriorityBalance", constraintId: priority.objectId },
      { id: "people", component: "PeopleChips", constraintId: people.objectId },
      { id: "calendar", component: "Calendar", constraintId: dates.objectId },
      { id: "map", component: "SchematicMap", constraintId: location.objectId,
        placeIds: ["shinjuku", "asakusa", "koenji"], selectedPlaceId: "shinjuku" },
      { id: "choices", component: "ChoiceCards", meaning: "where", choices: [
        { id: "one", label: "Shinjuku base", detail: "Quiet side street", selected: true, excluded: false, cost: 1180 },
        { id: "two", label: "Asakusa studio", detail: "Near the river", selected: false, excluded: false, cost: 940 },
      ] },
      { id: "stepper", component: "Stepper", constraintId: people.objectId },
      { id: "evidence", component: "EvidenceMeter", objectId, disclosure: 3 },
      { id: "empty", component: "EmptySlot", meaning: "source", label: "Add first-hand observation" },
      { id: "review", component: "ReviewSheet", objectId, title: "Rocket delivery", sections: ["Forms", "Checks", "Process"] },
    ])} />)],
    ["Object · Forms and what changed", renderToStaticMarkup(<SceneRenderer bindings={detailBindings()} scene={scene("forms", [
      { id: "s", component: "FormStrip", objectId, selectedRole: null, showFileNames: false },
      { id: "i", component: "ImpactReview", objectId, compact: false },
      { id: "b", component: "ReadinessBoard", objectId, showAll: false },
      { id: "d", component: "IdeaDrawer", objectId, open: true },
    ])} />)],
    ["Inspector · five questions", renderToStaticMarkup(<SceneRenderer bindings={detailBindings()} scene={scene("inspector", [
      { id: "q", component: "InspectorQuestions", objectId, open: "what" },
    ])} />)],
    ["Decision", renderToStaticMarkup(<SceneRenderer bindings={detailBindings()} scene={scene("decision", [
      { id: "dc", component: "DecisionCard", objectId: decisionId, showEvidence: true },
    ])} />)],
    ["Before a consequential action", renderToStaticMarkup(<SceneRenderer bindings={detailBindings()} scene={scene("preview", [
      { id: "pc", component: "PreviewCard", planDigest: digest },
    ])} />)],
    ["Behind “Show how this happened”", renderToStaticMarkup(<SceneRenderer bindings={detailBindings()} scene={scene("recipe", [
      { id: "g", component: "RecipeGraph", objectId },
    ])} />)],
    ["Object · Evidence", renderToStaticMarkup(<SceneRenderer bindings={detailBindings()} scene={scene("evidence", [
      { id: "c", component: "ChecksPanel", objectId, formRole: null },
    ])} />)],
    ["Object · History", renderToStaticMarkup(<SceneRenderer bindings={detailBindings()} scene={scene("history", [
      { id: "t", component: "VersionTimeline", objectId },
    ])} />)],
    ["Object · Made of", renderToStaticMarkup(<SceneRenderer bindings={detailBindings()} scene={scene("dna", [
      { id: "d", component: "IngredientPanel", objectId },
    ])} />)],
    ["World · Thinking table", renderToStaticMarkup(<SceneRenderer bindings={senseBindings()} scene={{
      worldId: reading.id, title: "Thinking", reason: "thinking",
      root: { id: "root", component: "Canvas", layout: "column",
              children: [{ id: "t", component: "ThinkingTable", worldId: reading.id,
                           selectedId: null } as never] },
    }} />)],
  ];

  const css = readFileSync(join(ROOT, "apps/desktop/src/renderer/styles.css"), "utf8");
  writeFileSync(OUT, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>XENIUR | interface</title>
<style>${css}
.prev { max-width: 960px; margin: 0 auto; padding: 40px 24px 80px; }
.prev h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em;
           color: var(--dim); margin: 40px 0 12px; border-top: 1px solid var(--line); padding-top: 20px; }
</style></head><body><div class="prev">
${sections.map(([title, html]) => `<h2>${title}</h2>${html}`).join("\n")}
</div></body></html>`);

  console.log(`wrote ${OUT}`);
  console.log(`object: ${graph.currentState(objectId)!.forms.length} forms, ` +
              `${graph.recipes.statusOf(objectId).filter((s) => s.state !== "fresh").length} stale`);
  graph.close();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
