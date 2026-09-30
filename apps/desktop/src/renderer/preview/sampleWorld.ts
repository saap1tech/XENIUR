import { sampleJourneyBridge, previewBlob } from "./sampleJourney.js";
import type {
  Atom, DecisionDetail, ObjectState, Representation, Standing, StepWork, ThinkingMap, TrustFacts, WorkGoal, WorkPlan, WorldSnapshot, XeniurBridge,
} from "@xeniur/core";
import { PlanStepSchema, templatePlanFor } from "@xeniur/core";
import { sampleWorkStateBridge } from "./sampleSharpen.js";

/**
 * A realistic World for looking at the Studio without Electron: the Rainwear 2027 fixture —
 * sources, claims, a decision under review, a jacket with two forms, a goal and a standing.
 * Used only by the `?visual-preview=world` route on localhost. Nothing here reaches the graph.
 */
const W = "11111111-1111-4111-8111-111111111111";
const ids = {
  jacket: "aaaaaaaa-1111-4111-8111-111111111111", pattern: "aaaaaaaa-2222-4222-8222-222222222222",
  claim1: "bbbbbbbb-1111-4111-8111-111111111111", claim2: "bbbbbbbb-2222-4222-8222-222222222222",
  claim3: "bbbbbbbb-3333-4333-8333-333333333333", question: "bbbbbbbb-4444-4444-8444-444444444444",
  decision: "cccccccc-1111-4111-8111-111111111111", goal: "dddddddd-1111-4111-8111-111111111111",
  repArt: "eeeeeeee-1111-4111-8111-111111111111", repMesh: "eeeeeeee-2222-4222-8222-222222222222", repDoc: "eeeeeeee-3333-4333-8333-333333333333",
  v: "ffffffff-1111-4111-8111-111111111111",
};
const now = Date.now();
const DAY = 86_400_000;

const state = (id: string, title: string, semanticType: string, traits: ObjectState["properties"]["traits"], forms: Array<[string, string]>, seq = 3): ObjectState => ({
  object: { id, worldId: W, parentId: null, currentVersionId: ids.v, currentBranchId: null, createdAt: now - 20 * DAY, archivedAt: null },
  versionId: ids.v, seq, branchId: null, branchName: "main",
  properties: { title, semanticType, traits, tags: [], dimensions: null, units: null, settings: {} },
  forms: forms.map(([role, representationId]) => ({ role, representationId })), recipeId: null,
});
const rep = (id: string, objectId: string, modality: Representation["modality"], format: string, provenance: Representation["provenance"], extra: Record<string, unknown> = {}): Representation => ({
  id, objectId, modality, format, blobHash: "0".repeat(64), producedByActionId: null, provenance, provider: provenance === "generated" ? "mock.image" : null,
  model: null, toolVersion: null, generationParams: extra, createdAt: now - 10 * DAY,
});

export const sampleStates: ObjectState[] = [
  state(ids.jacket, "Cold-weather shell", "prop", ["deliverable", "printable", "versioned", "renderable"], [["art.primary", ids.repArt], ["model.mesh", ids.repMesh]], 7),
  state(ids.pattern, "Seam specification", "document", ["deliverable", "versioned"], [["doc.primary", ids.repDoc]], 2),
  state(ids.claim1, "Most warranty returns are caused by seam failure, not fabric.", "claim", [], [], 1),
  state(ids.claim2, "Taped seams outperform welded once temperatures cycle below freezing.", "claim", [], [], 1),
  state(ids.claim3, "Welded seams are 18% cheaper at volume.", "claim", [], [], 1),
  state(ids.question, "Does the 63% seam-failure share hold outside cold climates?", "question", [], [], 1),
  state(ids.decision, "Which seam construction for the cold-weather range?", "decision", ["consequential"], [], 2),
];
export const sampleRepresentations: Representation[] = [
  rep(ids.repArt, ids.jacket, "image", "png", "generated"),
  rep(ids.repMesh, ids.jacket, "mesh", "glb", "deterministic"),
  rep(ids.repDoc, ids.pattern, "text", "md", "human", { preview: "# Seam specification\n\nTaped seams throughout the cold-weather range. Tolerance ±0.5 mm at the tape edge." }),
];
export const sampleSnapshot: WorldSnapshot = {
  world: { id: W, title: "Rainwear 2027", emoji: "◒", summary: "Interview → decision → jacket → delivery", createdAt: now - 30 * DAY, lastOpenedAt: now - 3 * DAY, kind: "work", publisherId: null },
  states: sampleStates, representations: sampleRepresentations, tasks: [], scene: null,
};

const atom = (objectId: string, text: string, lane: Atom["lane"], stance: Atom["stance"] = "assertion"): Atom => ({
  objectId, atomType: objectId === ids.question ? "question" : "claim", sourceId: "55555555-5555-4555-8555-555555555555", sourceVersionId: "66666666-6666-4666-8666-666666666666",
  locator: { selectors: [] }, confidence: 0.7, lane, extraction: "manual", stance, statedAt: now - 5 * DAY, text,
} as Atom);
export const sampleMap: ThinkingMap = {
  worldId: W, generatedAt: now,
  known: [{ atom: atom(ids.claim1, sampleStates[2]!.properties.title, "keep"), because: "rated 0.8, one source linked in support", related: [] }],
  conflicts: [{ atom: atom(ids.claim3, sampleStates[4]!.properties.title, "test"), because: "Samir's claim contradicts it: colour preference disappeared above €80", related: [] }],
  repeating: [], novel: [{ atom: atom(ids.claim2, sampleStates[3]!.properties.title, "keep"), because: "no earlier capture matches the wording", related: [] }],
  unverified: [{ atom: atom(ids.claim3, sampleStates[4]!.properties.title, "test"), because: "nothing linked as support", related: [] }],
  actionable: [{ atom: atom(ids.question, sampleStates[5]!.properties.title, "question"), because: "sitting in Question with nothing happening", related: [] }],
  counts: { sources: 3, atoms: 4, links: 2 },
};

export const sampleDecision: DecisionDetail = {
  objectId: ids.decision, worldId: W, question: "Which seam construction for the cold-weather range?",
  options: [{ key: "taped", label: "Taped seams", note: "18% dearer at volume; held in every cold cycle" }, { key: "welded", label: "Welded seams", note: "cheaper; failed two of five cold cycles" }],
  chosenOption: "taped", rationale: "Returns are seam failures. Durability is worth the margin for this range.",
  state: "needs_review", acceptedBy: "you", acceptedAt: now - 8 * DAY, acceptedVersionId: ids.v, steelman: null,
  evidence: [{ id: "77777777-7777-4777-8777-777777777777", decisionId: ids.decision, sourceVersionId: "66666666-6666-4666-8666-666666666666", atomObjectId: ids.claim1, relation: "supports", note: "", createdAt: now - 8 * DAY, atomVersionId: null }],
  assumptions: [{ id: "88888888-8888-4888-8888-888888888888", decisionId: ids.decision, text: "The 63% share holds outside cold climates.", reviewTrigger: "if the range moves to milder markets", kind: "assumption" }],
} as unknown as DecisionDetail;

export const sampleGoal: WorkGoal = {
  id: ids.goal, worldId: W, outcome: "Choose a seam construction the client will accept and deliver the spec", status: "making",
  focusObjectId: ids.jacket, requiredOutputs: ["doc.primary", "model.mesh"], openQuestionIds: [ids.question],
  nextActions: [{ id: "n1", text: "Cost taped seams at volume against welded", objectId: ids.claim3, tool: null, origin: "person", doneAt: null },
    { id: "n2", text: "Pull Q1 returns by failure mode", objectId: null, tool: null, origin: "accepted_proposal", doneAt: null }],
  createdAt: now - 20 * DAY, updatedAt: now - 3 * DAY, lastActiveAt: now - 3 * DAY,
};
/** The plan for the sample goal — from the template, with one step adopted and worked on, one proposed. */
export const samplePlan: WorkPlan = {
  id: "99999999-9999-4999-8999-999999999999", goalId: ids.goal, worldId: W, revision: 2, origin: "person", createdAt: now - 19 * DAY, supersededBy: null,
  steps: templatePlanFor({ outcome: sampleGoal.outcome, requiredOutputs: sampleGoal.requiredOutputs }).steps.map((s, i) =>
    PlanStepSchema.parse({ ...s, disposition: i < 4 ? "adopted" : "proposed" })),
};
export const sampleWork: StepWork[] = [
  { goalId: ids.goal, stepId: "t.gather", execution: "complete", evidence: [{ kind: "note", id: "n-1", at: now - 10 * DAY, by: "person" }], note: "both studies and the returns are in", updatedAt: now - 10 * DAY },
  { goalId: ids.goal, stepId: "t.compare", execution: "needs_review", evidence: [{ kind: "source_version", id: "sv-1", at: now - 6 * DAY, by: "person" }], note: "Client requirement changed after this step was worked on.", updatedAt: now - 3 * DAY },
  { goalId: ids.goal, stepId: "t.decide", execution: "in_progress", evidence: [], note: "", updatedAt: now - 2 * DAY },
];
export const sampleStanding: Standing = {
  goal: sampleGoal, worldId: W, worldTitle: "Rainwear 2027", focus: { id: ids.jacket, title: "Cold-weather shell" },
  knowledge: { known: [{ id: ids.claim1, title: sampleStates[2]!.properties.title }], proposed: [{ id: ids.claim2, title: sampleStates[3]!.properties.title }],
    disputed: [{ id: ids.claim3, title: sampleStates[4]!.properties.title }], unknown: [{ id: ids.question, title: sampleStates[5]!.properties.title }], chosenDespite: [] },
  changed: { since: now - 3 * DAY, newSources: [{ id: "s", title: "Q1 warranty tickets" }], rebuild: [], review: [{ id: ids.decision, title: sampleDecision.question }], critiques: [] },
  nextActions: sampleGoal.nextActions, needed: [{ output: "doc.primary", satisfied: true, objectId: ids.pattern }, { output: "model.mesh", satisfied: true, objectId: ids.jacket }],
  lastMove: { kind: "rated", at: now - 3 * DAY, object: { id: ids.claim1, title: sampleStates[2]!.properties.title } },
};
const trust = (objectId: string, over: Partial<TrustFacts> = {}): TrustFacts => ({
  objectId, support: { supported: 1, ambiguous: 0, unresolved: 1, contradicted: 1 }, evidence: { current: 2, total: 2 },
  provenance: { human: 4, tool: 3, model: 1 }, actions: { receipted: 1, unknown: 0 }, cost: { usd: 0.04, escalations: 1 }, decisionsNeedingReview: 1, settled: false, ...over,
});

/** The localhost preview. Writes are no-ops or in-memory demonstrations, never persisted. */
export function sampleBridge(opts: { firstRun?: boolean; research?:boolean } = {}): XeniurBridge {
  const noop = async () => undefined;
  const snapshot=opts.research?{...sampleSnapshot,world:{...sampleSnapshot.world,title:"CO₂ electrolysis · sample",summary:"A research review"},states:[],representations:[]}:sampleSnapshot;
  return {
    journey: sampleJourneyBridge(),
    code:{files:async()=>({}),run:async()=>{throw new Error("Run this project in the desktop app. This is a sample preview.");},stop:noop,setBounds:noop},
    blobs: { url: (h: string) => previewBlob(h) || `xeniur-blob://asset/${h}` },
    system: { info: async () => ({ version: "0.1", brainIsMock: true, brainModel: null, capabilities: [], firstRun: opts.firstRun ?? false }) },
    workState: sampleWorkStateBridge(),
    models: { list: async () => [{ id:"openrouter", label:"OpenRouter", local:false, keyPresent:false, canStore:true,
      verified:false, unlocks:{intelligence:["Thinking"],generation:["Drawing"]}, models:[] }],
      budget:async()=>({perActionUsdMax:1,monthlyUsdMax:100,monthlySpentUsd:0}),finishFirstRun:noop,
      add:async()=>{throw new Error("Add your OpenRouter key in the desktop app. This is a sample preview.");} },
    worlds: { list: async () => [snapshot.world], open: async () => snapshot, create: async () => snapshot.world },
    sense: {
      map: async () => sampleMap,
      friction: async () => ({ worldId: W, intakeSinceMove: 1, threshold: 5, active: false, prompt: null, dismissable: true }),
      pendingCandidates: async () => [], reviewSupport: async () => null, acceptCandidate: async () => null, rejectCandidate: noop,
      basis: async () => ({ passage: null, support: [] }), connections: async () => [],
    },
    decisions: { list: async () => [sampleDecision], get: async () => sampleDecision, influence: async () => null },
    constraints: { list: async () => [] },
    living: { detail: async () => null, exportPackage: async () => null, rebuild: async () => null, validate: async () => [], importFiles: async () => [], impact: async (id: string) => ({ objectId: id, rebuild: [], review: id === ids.jacket ? [{ objectId: ids.decision, title: sampleDecision.question, because: "a source it cited changed", causeObjectId: ids.claim1 }] : [], sinceReleaseId: null, sinceLabel: null, headline: "1 thing to review" }) },
    process: { proof: async (id: string) => ({ objectId: id, summary: "4 human, 3 tool, 1 model steps recorded", counts: { human: 4, tool: 3, model: 1, total: 8, durationMs: 47 * 60_000 }, events: [], disclosedHashes: [], rootHash: "0".repeat(64), privacy: "private", generatedAt: now }) },
    trust: { facts: async (id: string) => trust(id), world: async () => trust(W), supportMap: async () => null },
    brain: { trail: async () => [], resolve: async (u: string) => ({ intent: null, objects: [], interpretation: `I did not read "${u}"`, by: "unresolved", nearest: [] }) },
    goals: { current: async () => sampleGoal, relevant: async () => [ids.jacket, ids.decision, ids.claim1, ids.pattern, ids.question, ids.claim3], standing: async () => sampleStanding,
      setFocus: async () => sampleGoal, setStatus: async () => sampleGoal, setOutcome: async () => sampleGoal, create: async () => sampleGoal, addNextAction: async () => sampleGoal, doneNextAction: async () => sampleGoal },
    plans: { current: async () => samplePlan, propose: async () => samplePlan, adoptAll: async () => samplePlan, setDisposition: async () => samplePlan, edit: async () => samplePlan,
      reorder: async () => samplePlan, addStep: async () => samplePlan, replaceStep: async () => samplePlan, setInputs: async () => samplePlan,
      setExecution: async () => ({ work: null, refused: '"Compare the options against what matters" is not complete: it needs a claim reviewed by a person against its source.' }),
      attachEvidence: async () => sampleWork[0]!, work: async () => sampleWork },
    metrics: { record: noop }, publishers: { self: async () => ({ publicKey: "P".repeat(43), displayName: "You" }) },
    tasks: { active: async () => [], approve: noop, reject: noop, onEvent: () => () => undefined },
    economy: { snapshot: async () => ({ local: { metered: false, label: "Unlimited Local" }, intelligence: { configured: false, rollingRemaining: 0, rollingLimit: 0, reserveRemaining: 0, reserveLimit: 0, resetsAt: now }, compute: { configured: false, balance: 0, usdPerCompute: 0, held: 0 } }), cancel: noop },
    today: { get: async () => ({ date: "2026-09-28", resume: { worldId: W, worldTitle: sampleSnapshot.world.title, goalId: sampleGoal.id, fragments: [{ text: "You were comparing seam construction. One choice needs review.", objectId: null }], focusObjectId: ids.jacket, lastActiveAt: now, position: null }, rows: [], more: 0, quiet: true }) },
    workflows: { list: async () => [
      { id: "preview-research", name: "An evidence-led choice", author: "Studio Adrar", summary: "Gather sources, compare your options, and record a reason you can return to.", source: "installed", steps: 5, delivers: ["Decision record", "Finished document"] },
      { id: "asset3d", name: "3D asset", author: "XENIUR", summary: "A model you own, kept deliverable as you keep working on it.", source: "bundled", steps: 4, emoji: "🚀", expects: "a .blend, .glb, .stl or .obj", delivers: ["Game-ready model", "3D-print file", "Preview image", "Turntable video"] },
      { id: "brand", name: "Brand identity", author: "XENIUR", summary: "A logo, and every size and surface it has to survive.", source: "bundled", steps: 4, emoji: "🎨", expects: "a logo as PNG or SVG", delivers: ["Web logo", "App icon", "One-colour logo", "Print-ready logo"] },
      { id: "figure", name: "Scientific figure", author: "XENIUR", summary: "A figure a journal will accept, and that says where its numbers came from.", source: "bundled", steps: 1, emoji: "📊", expects: "a chart or plot as PNG or SVG", delivers: ["Journal-ready figure"] },
      { id: "onepager", name: "Document one-pager", author: "XENIUR", summary: "A plan or proposal, kept honest about what is in it before it goes out.", source: "bundled", steps: 1, emoji: "📄", expects: "a Markdown or text draft", delivers: ["Finished document"] },
    ], apply: async () => W },
    web: { settings: async () => ({ riskMode: "local_only", lookupConfigured: false, disclosure: "Saved pages remain available in your project." }) },
    arena: { feeds: async () => [] },
    browser: { setFullscreen:async()=>false, onShortcut:()=>()=>{}, profiles: async () => [{ id: "preview-public", label: "Public browsing", kind: "signed_out", createdAt: now }], tabs: async () => [], downloads: async () => [], onEvent: () => () => undefined },
    intent: { submit: async () => ({ accepted: false, taskId: null, plan: null, error: "preview" }) },
    challenges: { get: async () => null, entries: async () => [] }, objects: { readText: async (id:string) => ({text:sampleStates.find(s=>s.object.id===id)?.properties.title??"Sample resource. Open a saved source in the desktop app to read its captured text.",format:"txt",partial:true}), setAiProcessing: async () => null },
    gestures: { choose: async () => ({ accepted: false, taskId: null, plan: null, error: "preview" }) },
  } as unknown as XeniurBridge;
}
