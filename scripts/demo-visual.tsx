/**
 * M4 flagship. Pure fixture data, no network, no provider and no key.
 * Renders each compiled Scene into one standalone, scrollable HTML proof.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import type { ConstraintRecord, ImpactReport, ObjectState, ReadinessReport, Scene } from "@xeniur/core";
import { SceneSchema } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import {
  SituationSchema, compileSituation, layoutScene, proposalsFor, type Situation,
} from "@xeniur/grammar";
import { SceneRenderer, type SceneBindings } from "@xeniur/ui";

const ROOT = process.cwd();
const OUT = process.argv[2] ?? join(ROOT, "visual-demo.html");
const temp = mkdtempSync(join(tmpdir(), "xeniur-visual-"));

const stateObject = (state: ObjectState) => ({
  id: state.object.id, title: state.properties.title, semanticType: state.properties.semanticType,
  traits: state.properties.traits,
  formRoles: state.forms.map((form) => form.role), states: [],
});

function main(): void {
  const graph = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(temp, "blobs") });
  const rain = graph.createWorld({ title: "Rainwear 2027", emoji: "R" });
  const make = (title: string, semanticType: string) => graph.createObject({ worldId: rain.id, title, semanticType });
  const interview = make("Customer interview", "source");
  const weather = make("Weather report", "source");
  const sketch = make("Shell sketch", "image");
  const jacket = make("Orange jacket", "object");
  const presentation = make("Range presentation", "object");
  const claim = make("Visibility matters in sudden rain", "claim");

  const addForm = (state: ObjectState, role: string, format: string, provenance: "human" | "imported" = "human") => {
    const rep = graph.addRepresentation({
      objectId: state.object.id, modality: format === "md" ? "text" : "image", format,
      provenance, blobHash: null, generationParams: {},
    });
    return graph.commitVersion({ objectId: state.object.id, forms: [{ role, representationId: rep.id }], label: `added ${role}` });
  };
  addForm(interview, "source.primary", "md", "imported");
  addForm(weather, "source.primary", "md", "imported");
  addForm(sketch, "art.primary", "png");
  let jacketState = addForm(jacket, "art.primary", "png");
  jacketState = addForm(jacketState, "model.mesh", "glb");
  jacketState = addForm(jacketState, "preview.thumbnail", "png");
  jacketState = addForm(jacketState, "preview.turntable", "mp4");
  jacketState = addForm(jacketState, "print.stl", "stl");
  addForm(presentation, "doc.primary", "pdf");
  addForm(claim, "atom.text", "md");

  const decision = graph.decisions.create({
    worldId: rain.id, question: "Which finish should lead the 2027 shell?",
    options: [
      { key: "orange", label: "High-visibility orange", note: "Visible in sudden rain" },
      { key: "black", label: "Minimal black", note: "Quieter on shelf" },
    ],
    chosenOption: "orange", rationale: "The customer interview made visibility the safer choice.",
  });
  graph.decisions.accept(decision.objectId, "creator", { skipSteelman: true });
  graph.decisions.link({
    fromObjectId: claim.object.id, fromVersionId: graph.currentState(claim.object.id)!.versionId,
    toObjectId: decision.objectId, toVersionId: graph.currentState(decision.objectId)!.versionId,
    relation: "informed_by", note: "The selected passage informed the finish decision.",
  });
  graph.decisions.link({
    fromObjectId: decision.objectId, fromVersionId: graph.currentState(decision.objectId)!.versionId,
    toObjectId: jacket.object.id, toVersionId: graph.currentState(jacket.object.id)!.versionId,
    relation: "satisfies", note: "The jacket satisfies the accepted finish decision.",
  });

  graph.process.record({
    objectId: jacket.object.id, versionId: jacketState.versionId, kind: "sketch_made", actor: "human",
    label: "Shell sketch recorded as user-created", tool: null, model: null,
    inputHashes: [], outputHashes: ["a".repeat(64)], durationMs: 0,
  });
  graph.process.record({
    objectId: jacket.object.id, versionId: jacketState.versionId, kind: "manual_edit", actor: "human",
    label: "Adjusted cuff and hood", tool: null, model: null,
    inputHashes: ["a".repeat(64)], outputHashes: ["b".repeat(64)], durationMs: 0,
  });
  graph.process.record({
    objectId: jacket.object.id, versionId: jacketState.versionId, kind: "model_step", actor: "model",
    label: "Cleaned the product cutout", tool: "image.transform", model: "recorded-fixture",
    inputHashes: ["b".repeat(64)], outputHashes: ["c".repeat(64)], durationMs: 1200,
  });

  const travel = graph.createWorld({ title: "Tokyo in April", emoji: "T" });
  const trip = graph.createObject({ worldId: travel.id, title: "Tokyo plan", semanticType: "trip" });
  const define = (title: string, definition: Parameters<typeof graph.constraints.define>[1], appliesTo: string, value: unknown) => {
    const state = graph.createObject({ worldId: travel.id, title, semanticType: "constraint" });
    return graph.constraints.define(state.object.id, definition, appliesTo, value);
  };
  const cost = define("Cost", { kind: "range", min: 600, max: 2000, step: 100, unit: "EUR" }, "Stay budget", 1500);
  const people = define("People", { kind: "quantity", min: 1, max: 8, unit: "people" }, "Travellers", 2);
  const dates = define("Dates", { kind: "date_range", earliest: Date.UTC(2027, 3, 1), latest: Date.UTC(2027, 3, 30) },
    "Travel dates", { start: Date.UTC(2027, 3, 12), end: Date.UTC(2027, 3, 18) });
  const location = define("Place", { kind: "location", places: [
    { id: "shinjuku", label: "Shinjuku", district: "West", x: 170, y: 214 },
    { id: "kanda", label: "Kanda", district: "East", x: 388, y: 142 },
    { id: "nakameguro", label: "Nakameguro", district: "South", x: 286, y: 292 },
  ] }, "Base", "shinjuku");
  const priority = define("Priorities", { kind: "priority", dimensions: ["Quiet", "Food", "Nightlife"] },
    "Trip balance", { Quiet: 0.8, Food: 0.7, Nightlife: 0.25 });
  const travelConstraints = graph.constraints.list(travel.id);

  const currentStates = () => [...graph.listStates(rain.id), ...graph.listStates(travel.id)];
  const byId = () => Object.fromEntries(currentStates().map((state) => [state.object.id, state]));
  const rebuildImpact: ImpactReport = {
    objectId: jacket.object.id, headline: "3 forms changed since delivery", sinceReleaseId: null, sinceLabel: null,
    rebuild: [{
      stepKey: "mesh_to_delivery", formRoles: ["preview.thumbnail", "preview.turntable", "print.stl"],
      state: "stale", actionable: "rebuild", estimatedUsd: 0,
      path: [{ subject: "Model", happened: "the mesh changed" }, { subject: "Delivery", happened: "was built from the earlier mesh" }],
      because: "The thumbnail, turntable and print were built from the earlier mesh.",
    }], review: [],
  };
  const reviewImpact: ImpactReport = {
    objectId: decision.objectId, headline: "1 decision is worth reviewing", sinceReleaseId: null, sinceLabel: null,
    rebuild: [], review: [{
      objectId: decision.objectId, title: "Use high-visibility orange", causeObjectId: claim.object.id,
      causeTitle: "Customer interview", relation: "informed_by",
      because: "The interview changed after this decision cited it.",
      citedVersionId: graph.currentState(claim.object.id)!.versionId,
      currentVersionId: graph.currentState(claim.object.id)!.versionId,
    }],
  };
  const readiness: ReadinessReport = {
    profileId: "delivery", profileName: "Delivery evidence", verifies: "The current forms were checked.",
    gates: "artifact", ready: true,
    results: [
      { requirement: { fresh: true }, met: true, detail: "mesh is current", remedy: null },
      { requirement: { fresh: true }, met: true, detail: "preview is current", remedy: null },
      { requirement: { fresh: true }, met: true, detail: "print is current", remedy: null },
    ], blockers: [],
  };

  const baseBindings: SceneBindings = {
    states: byId(), representations: {}, tasks: {},
    constraints: Object.fromEntries(travelConstraints.map((item) => [item.objectId, item])),
    decisions: { [decision.objectId]: graph.decisions.detail(decision.objectId)! },
    impact: { [jacket.object.id]: rebuildImpact, [decision.objectId]: reviewImpact },
    readiness: { [jacket.object.id]: [readiness] },
    processProof: { [jacket.object.id]: graph.process.proof(jacket.object.id, "filtered") },
    blobUrl: () => "",
  };

  const rainObjects = graph.listStates(rain.id).map(stateObject);
  const sceneFor = (input: Omit<Situation, "worldId" | "title" | "goal" | "scope"> & { title: string }): Scene => {
    const situation = SituationSchema.parse({
      worldId: rain.id,
      goal: { kind: input.interaction === "commit" ? "deliver" : input.interaction === "review" ? "validate" : "create",
        description: input.title, ...(input.interaction === "commit" ? { deliverableId: input.focus.id } : {}) },
      scope: { worldId: rain.id, objectIds: input.objects.map((object) => object.id), externalContextAllowed: false },
      ...input,
    });
    const semanticA = compileSituation(situation);
    const semanticB = compileSituation(situation);
    assert.deepEqual(semanticB, semanticA, "semantic compile must be deterministic");
    const scene = layoutScene(semanticA, { layoutId: semanticA.layoutId });
    assert.equal(scene.slots[0]?.role, "centre");
    assert.equal(scene.focusId, semanticA.focusId);
    SceneSchema.parse(scene);
    return scene;
  };
  const focus = (state: ObjectState, kind: "object" | "decision" = "object") => ({
    kind, id: state.object.id, label: state.properties.title,
  });
  const common = { capabilities: [], constraints: [], choices: [], layer: 2 as const };

  const claimToJacket = proposalsFor(
    { id: claim.object.id, title: claim.properties.title, semanticType: "claim" },
    { id: jacket.object.id, title: jacket.properties.title, kind: "object" },
  );
  assert.deepEqual(claimToJacket.map((proposal) => proposal.label), ["Inform design decision"]);
  const gestureBindings: SceneBindings = {
    ...baseBindings,
    gestureProposals: Object.fromEntries(claimToJacket.map((proposal) => [proposal.id, proposal])),
  };

  const decisionState = graph.currentState(decision.objectId)!;
  const scenes: Array<{ title: string; note: string; scene: Scene; bindings?: SceneBindings }> = [
    {
      title: "The material arrives", note: "Five real subjects share one spatial field.",
      scene: sceneFor({ title: "Rainwear canvas", meaning: "relationship", interaction: "connect",
        taskStates: ["selected"], focus: focus(jacketState), objects: rainObjects,
        changes: [], ...common }), bindings: gestureBindings,
    },
    {
      title: "A sentence becomes a claim", note: "The selected passage is now a durable Object.",
      scene: sceneFor({ title: "Selected claim", meaning: "relationship", interaction: "connect",
        taskStates: ["selected"], focus: focus(graph.currentState(claim.object.id)!), objects: rainObjects,
        changes: [], ...common }), bindings: gestureBindings,
    },
    {
      title: "The drop proposes", note: "Inform design decision is offered. Nothing executes here.",
      scene: sceneFor({ title: "Proposed connection", meaning: "relationship", interaction: "connect",
        taskStates: ["selected"], focus: focus(graph.currentState(claim.object.id)!), objects: rainObjects,
        changes: [], ...common }), bindings: gestureBindings,
    },
    {
      title: "The finish is chosen", note: "Two options, one accepted human decision.",
      scene: sceneFor({ title: "Finish decision", meaning: "priority", interaction: "choose",
        taskStates: ["selected"], focus: focus(decisionState, "decision"), objects: rainObjects,
        changes: [], ...common, choices: [
          { id: "orange", label: "High-visibility orange", cost: null, detail: "Chosen from the interview", selected: true, excluded: false },
          { id: "black", label: "Minimal black", cost: null, detail: "Not chosen", selected: false, excluded: false },
        ] }), bindings: baseBindings,
    },
    {
      title: "The decision joins the jacket", note: "Interview to claim to decision to Living Object.",
      scene: sceneFor({ title: "Decision lineage", meaning: "relationship", interaction: "connect",
        taskStates: ["selected"], focus: focus(jacketState), objects: rainObjects,
        changes: [], ...common }), bindings: baseBindings,
    },
    {
      title: "The source changes", note: "Review appears on the decision. The jacket forms remain current.",
      scene: sceneFor({ title: "Review the finish", meaning: "relationship", interaction: "review",
        taskStates: ["selected", "changed"], focus: focus(decisionState, "decision"), objects: rainObjects,
        changes: [{ objectId: decision.objectId, kind: "review", subject: claim.object.id,
          because: reviewImpact.review[0]!.because }], ...common, layer: 3 }), bindings: baseBindings,
    },
    {
      title: "The mesh changes", note: "Thumbnail, turntable and print move to rebuild. The decision is untouched.",
      scene: sceneFor({ title: "Rebuild delivery forms", meaning: "relationship", interaction: "review",
        taskStates: ["selected", "changed"], focus: focus(jacketState), objects: rainObjects,
        changes: [{ objectId: jacket.object.id, kind: "rebuild", subject: "mesh_to_delivery",
          because: rebuildImpact.rebuild[0]!.because }], ...common, layer: 3 }), bindings: baseBindings,
    },
    {
      title: "Delivery waits for approval", note: "The final review sheet includes process provenance.",
      scene: sceneFor({ title: "Delivery review", meaning: "relationship", interaction: "commit",
        taskStates: ["selected", "ready"], focus: focus(jacketState), objects: rainObjects,
        changes: [], ...common, layer: 3 }), bindings: baseBindings,
    },
  ];

  const travelObjects = graph.listStates(travel.id).map(stateObject);
  const travelScene = (meaning: Situation["meaning"], interaction: Situation["interaction"], extra: Partial<Situation> = {}) => {
    const situation = SituationSchema.parse({
      worldId: travel.id, title: "Tokyo in April", meaning, interaction,
      goal: { kind: interaction === "commit" ? "act" : interaction === "choose" ? "decide" : "understand",
        description: "Shape a Tokyo plan within the recorded constraints" },
      scope: { worldId: travel.id, objectIds: travelObjects.map((object) => object.id), externalContextAllowed: false },
      taskStates: ["selected", ...(extra.taskStates ?? [])], focus: focus(trip),
      objects: travelObjects, changes: [], capabilities: [], constraints: graph.constraints.list(travel.id),
      choices: [
        { id: "quiet", label: "Quiet Shinjuku", detail: "Garden side", cost: 1400 },
        { id: "compact", label: "Compact Kanda", detail: "Near the rail loop", cost: 900 },
      ], layer: 2, ...extra,
    });
    const semantic = compileSituation(situation);
    return layoutScene(semantic, { layoutId: semantic.layoutId });
  };
  const travelBindings: SceneBindings = { ...baseBindings, states: byId(),
    constraints: Object.fromEntries(graph.constraints.list(travel.id).map((item) => [item.objectId, item])) };
  const high = travelScene("where", "choose");
  graph.constraints.setValue(cost.objectId, 1000);
  const low = travelScene("where", "choose");
  const choicesIn = (scene: Scene) => {
    if (scene.root.component !== "Canvas") return [];
    const node = scene.root.children.find((child) => child.component === "ChoiceCards") as Extract<typeof scene.root.children[number], { component: "ChoiceCards" }>;
    return node.choices.filter((choice) => !choice.excluded).map((choice) => choice.id);
  };
  assert.deepEqual(choicesIn(high), ["quiet", "compact"]);
  assert.deepEqual(choicesIn(low), ["compact"]);

  const universal = [
    ["Where to stay", low],
    ["Places in relation", travelScene("where", "review")],
    ["Dates", travelScene("when", "adjust")],
    ["People", travelScene("who", "adjust")],
    ["Cost", travelScene("cost", "adjust")],
    ["Quantity", travelScene("quantity", "adjust")],
    ["Priorities", travelScene("priority", "adjust")],
    ["Evidence and an empty value", travelScene("relationship", "review", { taskStates: ["ready", "missing"] })],
  ] as const;

  const css = readFileSync(join(ROOT, "apps/desktop/src/renderer/styles.css"), "utf8");
  const logo = readFileSync(join(ROOT, "brand/XR_logo_vector.svg"), "utf8")
    .replace(/<\?xml[^>]*>/, "");
  const section = (title: string, note: string, scene: Scene, bindings: SceneBindings) =>
    `<section class="demo-step"><header><h2>${title}</h2><p>${note}</p></header>${renderToStaticMarkup(
      <SceneRenderer scene={scene} bindings={bindings} />,
    )}</section>`;
  writeFileSync(OUT, `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>XENIUR M4 visual proof</title>
<style>${css}
body{min-width:0}.demo{max-width:1180px;margin:auto;padding:48px 28px 120px}.demo>header{margin-bottom:64px}
.demo-brand{display:flex;align-items:center;gap:14px;margin-bottom:46px}.demo-brand svg{width:52px;height:auto}.demo-brand strong{font:700 18px var(--font-display);letter-spacing:.12em}
.demo>header h1{font-size:clamp(42px,7vw,82px);line-height:.9;margin:12px 0}.demo>header p{color:var(--dim);max-width:58ch}
.demo-step{margin:0 0 84px}.demo-step>header{display:grid;grid-template-columns:1fr 1fr;gap:20px;border-top:1px solid var(--line);padding-top:14px}
.demo-step>header h2{margin:0;font-size:22px}.demo-step>header p{margin:0;color:var(--dim)}
@media(max-width:760px){.demo{padding:28px 14px}.demo-step>header{grid-template-columns:1fr}.xr-canvas--free{grid-template-columns:1fr}.xr-scene-slot--primary,.xr-scene-slot--supporting{grid-column:1}}
</style></head><body><main class="demo"><div class="demo-brand">${logo}<strong>XENIUR</strong></div><header><small>THE VISUAL INTENT COMPILER</small><h1>Rainwear 2027</h1>
<p>Thinking, decision, creation, revision and delivery in one inspectable visual language.</p></header>
${scenes.map((item) => section(item.title, item.note, item.scene, item.bindings ?? baseBindings)).join("\n")}
<header><small>THE SAME GRAMMAR</small><h1>Tokyo in April</h1><p>Schematic fixtures only. Nothing booked, no network used.</p></header>
${universal.map(([title, scene]) => section(title, "The same closed registry resolves a different domain.", scene, travelBindings)).join("\n")}
</main></body></html>`);

  const compiledComponents = new Set<string>([...scenes.map((item) => item.scene), ...universal.map(([, scene]) => scene)]
    .flatMap((scene) => scene.root.component === "Canvas" ? scene.root.children.map((node) => node.component) : []));
  for (const component of ["ObjectOrbit", "AffordanceRing", "SpatialCanvas", "ConstraintStrip", "RangeMeter",
    "PriorityBalance", "PeopleChips", "Calendar", "SchematicMap", "ChoiceCards", "Stepper",
    "EvidenceMeter", "EmptySlot", "ReviewSheet"]) {
    assert(compiledComponents.has(component), `${component} must appear in the universal proof`);
  }
  console.log(`wrote ${OUT}`);
  console.log(`asserted ${scenes.length} Rainwear scenes and ${universal.length} universal scenes`);
  console.log("network calls: 0");
  graph.close(); rmSync(temp, { recursive: true, force: true });
}

try { main(); } catch (error) {
  rmSync(temp, { recursive: true, force: true });
  console.error(error); process.exitCode = 1;
}
