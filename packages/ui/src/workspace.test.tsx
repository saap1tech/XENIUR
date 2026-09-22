import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  DecisionDetail, ImpactReport, ObjectState, Representation, Scene,
} from "@xeniur/core";
import { describeEnvelope, planDigest, type CandidateRecord, type ChallengeRecord, type Compliance, type EntryRecord, type JudgingSheetData, type ModeRecord, type Standing as StandingData, type StepWork, type SupportMap as SupportMapData, type TrailRow, type WorkPlan } from "@xeniur/core";
import { SceneRenderer, emptyBindings, presentBindings, IMPLEMENTATION_WORDS, stripTechnical, type SceneBindings } from "./index.js";

const OBJ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ATOM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const REP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORLD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const state = (id: string, title: string, forms: string[]): ObjectState => ({
  object: {
    id, worldId: WORLD, parentId: null, currentVersionId: null,
    currentBranchId: null, createdAt: 0, archivedAt: null,
  },
  versionId: "11111111-1111-4111-8111-111111111111", seq: 3, branchId: null, branchName: "main",
  properties: { title, semanticType: "rocket", traits: ["spatial", "printable", "versioned"], tags: [], dimensions: null, units: null, settings: {} },
  forms: forms.map((role) => ({ role, representationId: REP })),
  recipeId: null,
});

const representation: Representation = {
  id: REP, objectId: OBJ, modality: "mesh", format: "stl", blobHash: "a".repeat(64),
  producedByActionId: null, provenance: "deterministic", provider: "local.blender",
  model: null, toolVersion: "blender 5.2.0", generationParams: {}, createdAt: 0,
};

/** A real-shaped impact report: one mechanical rebuild, one judgement call. */
const impact: ImpactReport = {
  objectId: OBJ,
  rebuild: [{
    stepKey: "print_stl", formRoles: ["print.stl"], state: "stale", actionable: "rebuild",
    estimatedUsd: 0,
    path: [
      { subject: "Print", happened: "its inputs changed since it was built" },
      { subject: "Model", happened: "was built from what came before it, so it follows" },
      { subject: "Source", happened: "is what this was built from" },
    ],
    because: "Print its inputs changed since it was built",
  }],
  review: [{
    objectId: DEC, title: "Use the orange finish",
    causeObjectId: ATOM, causeTitle: "Client brief, paragraph 3",
    relation: "informed_by",
    because: '"Client brief, paragraph 3" changed, and "Use the orange finish" was decided with it in view — review recommended',
    citedVersionId: "22222222-2222-4222-8222-222222222222",
    currentVersionId: "33333333-3333-4333-8333-333333333333",
  }],
  sinceReleaseId: "44444444-4444-4444-8444-444444444444",
  sinceLabel: "Delivery 01",
  headline: "2 things changed since Delivery 01",
};

const decision: DecisionDetail = {
  objectId: DEC, question: "Which finish for the 2027 shell?",
  chosenOption: "orange", rationale: "The client's own returns data points at visibility.",
  state: "needs_review", acceptedBy: "Ada", acceptedAt: 1,
  acceptedVersionId: "22222222-2222-4222-8222-222222222222",
  supersedesDecisionId: null, supersedesVersionId: null, steelman: "recorded",
  options: [
    { key: "orange", label: "Orange", note: "high visibility" },
    { key: "graphite", label: "Graphite", note: "sells better in Europe" },
  ],
  evidence: [{
    sourceVersionId: "55555555-5555-4555-8555-555555555555", atomObjectId: ATOM,
    atomVersionId: null, relation: "informed_by", note: "paragraph 3",
  }],
  assumptions: [{ text: "Cold-weather use dominates", reviewTrigger: "the range moves south", kind: "assumption" }],
};

const bindings = (over: Partial<SceneBindings> = {}): SceneBindings => ({
  ...emptyBindings(),
  states: { [OBJ]: state(OBJ, "Rocket", ["source.primary", "print.stl"]),
            [ATOM]: state(ATOM, "Client brief, paragraph 3", ["atom.text"]),
            [DEC]: state(DEC, "Which finish for the 2027 shell?", ["decision.brief"]) },
  representations: { [REP]: representation },
  impact: { [OBJ]: impact },
  decisions: { [DEC]: decision },
  blobUrl: (h) => `xeniur-blob://${h}`,
  ...over,
});

const scene = (root: Scene["root"]): Scene => ({ worldId: WORLD, title: "t", reason: "r", root });
const render = (root: Scene["root"], b: SceneBindings = bindings()) =>
  renderToStaticMarkup(<SceneRenderer scene={scene(root)} bindings={b} />);

describe("rebuild and review never look like the same kind of thing", () => {
  const html = () => render({ id: "i", component: "ImpactReview", objectId: OBJ, compact: false });

  it("renders them in visually distinct groups", () => {
    const out = html();
    expect(out).toContain("xr-impact__list--rebuild");
    expect(out).toContain("xr-impact__list--review");
    expect(out).toContain(">Rebuild</h2>");
    expect(out).toContain(">Review</h2>");
  });

  it("never offers to rebuild something only a person can judge", () => {
    const out = html();
    const reviewSection = out.slice(out.indexOf("xr-impact__list--review"));
    expect(reviewSection).not.toContain("Rebuild");
    expect(reviewSection).toContain("I have looked");
  });

  it("says out loud that review is a recommendation, not a finding", () => {
    expect(html()).toContain("only you can say whether it still holds");
  });

  it("leads with what changed and since when", () => {
    expect(html()).toContain("2 things changed since Delivery 01");
  });
});

describe("a causal path is generated from the edge that caused it", () => {
  it("names the real form role and what happened to it, hop by hop", () => {
    const out = render({
      id: "c", component: "CausalPath", objectId: OBJ, subject: "print_stl", kind: "rebuild",
    });
    // Human names, in the order the graph produced them.
    expect(out.indexOf("Print")).toBeLessThan(out.indexOf("Model"));
    expect(out.indexOf("Model")).toBeLessThan(out.indexOf("Source"));
    expect(out).toContain("its inputs changed since it was built");
    expect(out).toContain("is what this was built from");
  });

  it("explains a review as two named things and a recommendation", () => {
    const out = render({
      id: "c", component: "CausalPath", objectId: OBJ, subject: DEC, kind: "review",
    });
    expect(out).toContain("Client brief, paragraph 3");
    expect(out).toContain("changed after it was cited");
    expect(out).toContain("not a finding that anything is wrong");
  });

  it("carries no hand-written explanation of its own", () => {
    // Every sentence in the path came from the report; nothing was invented by the view.
    const out = render({
      id: "c", component: "CausalPath", objectId: OBJ, subject: "print_stl", kind: "rebuild",
    });
    for (const hop of impact.rebuild[0]!.path) expect(out).toContain(hop.happened);
  });
});

describe("a decision card shows the choice and the passages behind it", () => {
  const out = () => render({ id: "d", component: "DecisionCard", objectId: DEC, showEvidence: true });

  it("leads with the question and what was chosen", () => {
    expect(out()).toContain("Which finish for the 2027 shell?");
    expect(out()).toContain("Orange");
  });

  it("shows what was weighed, what was assumed, and when to revisit", () => {
    expect(out()).toContain("The client&#x27;s own returns data");
    expect(out()).toContain("Cold-weather use dominates");
    expect(out()).toContain("the range moves south");
  });

  it("offers a source chip that jumps to the cited passage", () => {
    expect(out()).toContain("xr-chip--informed_by");
    expect(out()).toContain("Client brief, paragraph 3");
  });

  it("says a decision needing review needs review, without saying it is wrong", () => {
    const html = out();
    expect(html).toContain("worth another look");
    expect(html).not.toContain("invalid");
    expect(html).not.toContain("wrong");
  });
});

describe("a consequential action shows what it is about to do", () => {
  const plan = {
    tool: "browser.submit",
    args: { action: "Book court", when: "5:00 PM" },
    destination: "tennis.example", estimatedUsd: 18,
  };
  const digest = planDigest(plan);

  const pending = {
    [digest]: {
      plan, level: "PURCHASE", scope: "tennis.example", taskId: null,
      summary: "Book a court at tennis.example", reversible: false,
    },
  };

  it("renders from the same digest that gates the action", () => {
    const out = render({ id: "p", component: "PreviewCard", planDigest: digest },
                       bindings({ pendingPlans: pending }));
    expect(out).toContain("Book a court at tennis.example");
    expect(out).toContain("tennis.example");
    expect(out).toContain("$18.00");
    expect(out).toContain("Book court");
    expect(out).toContain("5:00 PM");
  });

  it("says whether it can be undone, and that approval covers exactly this", () => {
    const out = render({ id: "p", component: "PreviewCard", planDigest: digest },
                       bindings({ pendingPlans: pending }));
    expect(out).toContain("cannot be undone");
    expect(out).toContain("if anything above changes, it will ask again");
  });

  it("shows nothing for a plan whose digest no longer matches", () => {
    const changed = planDigest({ ...plan, args: { ...plan.args, when: "9:00 PM" } });
    const out = render({ id: "p", component: "PreviewCard", planDigest: changed },
                       bindings({ pendingPlans: pending }));
    expect(out).not.toContain("Book court");
    expect(out).not.toContain("xr-preview");
  });
});

describe("the ingredient drawer counts, and does not grade", () => {
  const dna = {
    summary: {
      objectId: OBJ, ingredients: [], rootIds: ["r1", "r2"],
      counts: { your_observation: 1, external_human: 2, previous_object: 0,
                ai_suggested: 0, unattributed: 1 },
      humanSignalPresent: true, modelTouchedSteps: 3, modelTouchedRepresentationIds: ["x"],
    },
    statements: [{ kind: "model_applied" as const, text: "A model was applied at 3 steps",
                   count: 3, representationIds: ["x"] }],
    highestOverlap: 0.4, composition: "1 of your observations, 2 external sources",
    invitation: null,
  };

  it("shows counts and paths you can follow", () => {
    const out = render({ id: "d", component: "IdeaDrawer", objectId: OBJ, open: true },
                       bindings({ dna: { [OBJ]: dna } }));
    expect(out).toContain("your observations");
    expect(out).toContain("model-touched steps");
    expect(out).toContain("A model was applied at 3 steps");
    expect(out).toContain("show which");
  });

  it("contains no score, grade or percentage of originality", () => {
    const out = render({ id: "d", component: "IdeaDrawer", objectId: OBJ, open: true },
                       bindings({ dna: { [OBJ]: dna } }));
    expect(out).not.toMatch(/\d+%/);
    expect(out.toLowerCase()).not.toContain("score");
    expect(out.toLowerCase()).not.toContain("originality");
  });
});

/**
 * The signal is scarce by rule, and the rule is enforced here rather than remembered.
 *
 * A stylesheet is the only place a colour like this can leak into, so the test reads the
 * real stylesheet and checks every selector that reaches for it. Three uses are allowed:
 * a selected Object, a completed trustworthy state, and an action in flight right now.
 */
describe("the signal colour marks three things and nothing else", () => {
  const css = readFileSync(
    join(process.cwd(), "apps/desktop/src/renderer/styles.css"), "utf8",
  );

  const usages = css
    .replace(/\/\*[\s\S]*?\*\//g, "")            // comments explain, they do not style
    .split("}")
    .filter((block) => /var\(--signal(-soft)?\)/.test(block))
    .map((block) => block.split("{")[0]!.trim().replace(/\s+/g, " "))
    .filter((selector) => selector !== ":root" && selector !== "");

  const ALLOWED = [
    /\.is-selected/,          // 1. the currently selected Object
    /\.is-settled/,           // 2. a completed trustworthy state
    /--running/,              // 3. an action being carried out right now
  ];

  it("appears only on selection, a settled state, or work in flight", () => {
    for (const selector of usages) {
      expect(
        ALLOWED.some((allowed) => allowed.test(selector)),
        `"${selector}" uses the signal colour, which is reserved for three things`,
      ).toBe(true);
    }
  });

  it("is actually used, or it is not a signal", () => {
    expect(usages.length).toBeGreaterThan(0);
  });

  it("never dresses headings, links or ordinary buttons", () => {
    for (const selector of usages) {
      expect(selector).not.toMatch(/^h[1-6]/);
      expect(selector).not.toMatch(/^a[,: ]|\.xr-linkish|\.xr-showhow/);
      expect(selector).not.toBe(".xr-button--primary");
    }
  });
});

describe("the interface speaks, rather than printing rows", () => {
  it("says what a thing is in words, with the right article", () => {
    const out = render({ id: "q", component: "InspectorQuestions", objectId: OBJ, open: "what" },
                       bindings({ states: { [OBJ]: {
                         ...state(OBJ, "Rocket", ["source.primary"]),
                         properties: { title: "Rocket", semanticType: "asset3d", traits: ["spatial", "renderable", "versioned"], tags: [],
                                       dimensions: null, units: null, settings: {} },
                       } } }));
    expect(out).toContain("a 3D asset called");
    expect(out).not.toContain("asset3d");
  });

  it("names forms by what they are, never by their role addresses", () => {
    const out = render({
      id: "s", component: "FormStrip", objectId: OBJ, selectedRole: null, showFileNames: false,
    });
    expect(out).toContain("Print");
    expect(out).toContain("Source");
    expect(out).not.toContain("print.stl");
    expect(out).not.toContain("source.primary");
  });

  it("shows the addresses only when a person asks for them", () => {
    const out = render({
      id: "s", component: "FormStrip", objectId: OBJ, selectedRole: null, showFileNames: true,
    });
    expect(out).toContain("xr-form__file");
    expect(out).toContain("stl");
  });
});

describe("support is shown as a glyph and a word, never colour alone", () => {
  const support = (status: "supported" | "contradicted" | "ambiguous" | "unresolved",
                   checkedBy: "human" | "model" | "unchecked") => ({
    id: "99999999-9999-4999-8999-999999999999", claimObjectId: ATOM,
    sourceVersionId: "55555555-5555-4555-8555-555555555555",
    locator: { selectors: [] }, status, checkedBy, checkedAt: null, note: "", createdAt: 0,
  });

  it.each([
    ["supported", "●"], ["contradicted", "◌"], ["ambiguous", "◐"], ["unresolved", "○"],
  ] as const)("renders %s with its glyph and its word", (status, glyph) => {
    const out = render({ id: "p", component: "ClaimPair", leftObjectId: OBJ, rightObjectId: ATOM, relation: "contradicts" },
      bindings({ support: { [ATOM]: [support(status, "human")] } }));
    expect(out).toContain(glyph);
    expect(out).toContain(`>${status}<`);
  });

  it("marks a model's verdict as proposed, not settled", () => {
    const out = render({ id: "p", component: "ClaimPair", leftObjectId: OBJ, rightObjectId: ATOM, relation: "supports" },
      bindings({ support: { [ATOM]: [support("supported", "model")] } }));
    expect(out).toContain("supported · proposed");
    // A proposal still offers the person the review controls.
    expect(out).toContain("Review this citation");
  });

  it("puts both claims and the relation on the page", () => {
    const out = render({ id: "p", component: "ClaimPair", leftObjectId: OBJ, rightObjectId: ATOM, relation: "contradicts" });
    expect(out).toContain("Rocket");
    expect(out).toContain("Client brief, paragraph 3");
    expect(out).toContain("contradicts");
    expect(out).toContain("Your claim");
    expect(out).toContain("Their claim");
  });
});

describe("the Trust Strip is facts, and lime only when settled", () => {
  const facts = (over: Partial<import("@xeniur/core").TrustFacts> = {}) => ({
    objectId: OBJ,
    support: { supported: 12, ambiguous: 2, unresolved: 3, contradicted: 1 },
    evidence: { current: 6, total: 6 },
    provenance: { human: 4, tool: 6, model: 2 },
    actions: { receipted: 3, unknown: 0 },
    cost: { usd: 0.04, escalations: 2 },
    decisionsNeedingReview: 0,
    settled: false,
    ...over,
  });
  const strip = (t: ReturnType<typeof facts>) =>
    render({ id: "t", component: "TrustStrip", objectId: OBJ, compact: false }, bindings({ trust: { [OBJ]: t } }));

  it("shows five cells of counts and no tick", () => {
    const out = strip(facts());
    for (const label of ["Support", "Evidence", "Provenance", "Actions", "Cost"]) expect(out).toContain(label);
    expect(out).toContain("6/6");
    expect(out).toContain("$0.04");
    expect(out).not.toContain("✓");
    expect(out).not.toContain(">Ready<");
  });

  it("is graphite unless settled, and settled only on the strict condition", () => {
    expect(strip(facts())).not.toContain("is-settled");
    expect(strip(facts({
      support: { supported: 12, ambiguous: 0, unresolved: 0, contradicted: 0 }, settled: true,
    }))).toContain("is-settled");
  });

  it("reads as one sentence of facts to a screen reader", () => {
    const out = strip(facts());
    expect(out).toContain("12 supported, 3 unresolved, 1 contradicted, 2 ambiguous.");
    expect(out).toContain("6 of 6 measurements current.");
    expect(out).toContain("4 human, 6 tool, 2 model steps.");
  });

  it("shows unknown outcomes rather than folding them into receipted", () => {
    expect(strip(facts({ actions: { receipted: 3, unknown: 1 } }))).toContain("1 unknown");
  });
});

describe("your models: what a key unlocks, never the key", () => {
  const providers = [
    { id: "anthropic", label: "Anthropic", local: false, keyPresent: false, canStore: true,
      unlocks: { intelligence: ["Claude Sonnet 5", "Claude Haiku 4.5"], generation: [] },
      models: [{ id: "anthropic.sonnet", label: "Claude Sonnet 5", priceVerifiedOn: null, callable: false }] },
    { id: "ollama", label: "Ollama (on this machine)", local: true, keyPresent: true, canStore: true,
      unlocks: { intelligence: ["Llama 3.1 (local)"], generation: [] },
      models: [{ id: "ollama.local", label: "Llama 3.1 (local)", priceVerifiedOn: null, callable: true }] },
    { id: "openai", label: "OpenAI", local: false, keyPresent: true, canStore: true,
      unlocks: { intelligence: ["GPT-5.6 Luna"], generation: [] },
      models: [{ id: "openai.luna", label: "GPT-5.6 Luna", priceVerifiedOn: "2026-09-16", callable: true }] },
  ];
  const setup = (firstRun: boolean) =>
    render({ id: "m", component: "ModelSetup", firstRun }, bindings({ modelProviders: providers }));

  it("lights Unlimited Local on every card whether or not a key exists", () => {
    const out = setup(true);
    const cards = (out.match(/<li class="xr-model[" ]/g) ?? []).length;
    const litLocal = out.split('is-lit"><span>Unlimited Local').length - 1;
    expect(cards).toBe(3);
    expect(litLocal).toBe(3);
  });

  it("offers Skip for now in the same weight as Continue on first run", () => {
    const out = setup(true);
    expect(out).toContain("Skip for now");
    expect(out).toContain("Continue");
    // Both are ordinary buttons; neither is the lime in-flight style.
    expect(out).not.toContain("xr-button--running");
  });

  it("says an unverified price will not be called, in words — and never says it of a local model", () => {
    const out = setup(false);
    expect(out).toContain("price not verified — XENIUR will not call this");
    expect(out).toContain("local · no cost");
    expect(out).toContain("price checked 2026-09-16");
    // The local card carries no "will not call" tag: it is callable by construction.
    const ollamaCard = out.slice(out.indexOf("Ollama (on this machine)"), out.indexOf("OpenAI"));
    expect(ollamaCard).not.toContain("will not call");
  });

  it("never renders a key, and the field is a password field sent once", () => {
    const out = setup(true);
    expect(out).toContain('type="password"');
    expect(out).toContain("it is not shown again");
    expect(out).not.toMatch(/sk-[a-z-]*[A-Za-z0-9]{20,}/);
  });

  it("says verification is free, and what it does instead of a completion", () => {
    expect(setup(false)).toContain("lists models, never a completion");
  });
});

describe("what the model will see is shown, and what was left out is named", () => {
  const digest = "abc123";
  const ctx = {
    included: [
      { kind: "focus", id: OBJ, label: "Rocket", tokens: 12 },
      { kind: "decision", id: DEC, label: "Which finish?", tokens: 80 },
      { kind: "passage", id: "p1", label: "Client brief", tokens: 120 },
    ],
    excluded: [
      { kind: "passage", id: "p2", label: "Internal returns data", why: "restricted_rights" },
      { kind: "constraint", id: "c1", label: "Other project's budget", why: "outside_focus" },
    ],
    tokens: 212, includesRestricted: false, destination: "remote" as const,
    modelLabel: "Claude Sonnet 5", estimatedUsd: 0.004,
  };
  const out = () => render({ id: "c", component: "ContextReview", contextDigest: digest },
                           bindings({ contexts: { [digest]: ctx } }));

  it("lists every included item as a chip, grouped by kind", () => {
    const html = out();
    for (const label of ["Rocket", "Which finish?", "Client brief"]) expect(html).toContain(label);
    expect(html).toContain("what you are working on");
  });

  it("names what was left out and why, in words", () => {
    const html = out();
    expect(html).toContain("Internal returns data");
    expect(html).toContain("marked restricted — stays on this machine");
    expect(html).toContain("not connected to what you are working on");
  });

  it("says where it goes and what it may cost, and offers exactly-this confirmation", () => {
    const html = out();
    expect(html).toContain("to Claude Sonnet 5");
    expect(html).toContain("≤ $0.004");
    expect(html).toContain("Send exactly this");
  });

  it("renders nothing for a digest it does not know — a stale card is not a card", () => {
    expect(render({ id: "c", component: "ContextReview", contextDigest: "other" }, bindings({ contexts: { [digest]: ctx } })))
      .not.toContain("xr-context");
  });
});

/* M5 Stage 8 — a mode is a contract the person read, and can leave. */
describe("FocusContract", () => {
  const sheet = describeEnvelope("focus_contract", {
    durationMinutes: 25, restrictions: ["no task toasts", "no suggestions"], exitPolicy: "always",
  });
  const MODE = "9d9d9d9d-9d9d-4d9d-8d9d-9d9d9d9d9d9d";
  const running: ModeRecord = {
    id: MODE, kind: "focus_contract", worldId: null, startedAt: Date.now(), endedAt: null, exitReason: null,
    sheetDigest: sheet.digest,
    envelope: { durationMinutes: 25, restrictions: ["no task toasts"], windows: [], maxFrequencyPerDay: 0,
      categories: [], exitPolicy: "always", resumeObjectId: null, remoteModels: true, entryObjectId: null, heartbeatSeconds: 60 },
  };

  it("renders the envelope before anything starts: duration, restrictions, exit, and a verb", () => {
    const html = render({ id: "m", component: "FocusContract", phase: "review", sheetDigest: sheet.digest, modeId: null },
                        bindings({ modeSheets: { [sheet.digest]: sheet } }));
    expect(html).toContain("Focus Contract");
    expect(html).toContain("25 min");
    expect(html).toContain("no task toasts · no suggestions");
    expect(html).toContain("leave at any moment");
    expect(html).toContain("Begin focus");
    expect(html).toContain("Not now");
    expect(html).not.toMatch(/>OK</);
  });

  it("cannot render a sheet it was not given — no envelope, no start button", () => {
    const html = render({ id: "m", component: "FocusContract", phase: "review", sheetDigest: "unknown", modeId: null },
                        bindings({ modeSheets: { [sheet.digest]: sheet } }));
    expect(html).not.toContain("Begin focus");
    expect(html).not.toContain("xr-mode-sheet");
  });

  it("while running shows the name, the clock, and an Exit reachable by keyboard", () => {
    const html = render({ id: "m", component: "FocusContract", phase: "running", sheetDigest: null, modeId: MODE },
                        bindings({ modes: { [MODE]: running } }));
    expect(html).toContain("xr-mode-rule--running");
    expect(html).toContain("Focus Contract");
    expect(html).toMatch(/\d\d?:\d\d/);
    expect(html).toContain(">Exit<");
    expect(html).toContain('aria-keyshortcuts="Escape"');
  });

  it("renders nothing for a mode that has ended — a mode is invisible when it is not running", () => {
    const ended = { ...running, endedAt: Date.now(), exitReason: "emergency" as const };
    const html = render({ id: "m", component: "FocusContract", phase: "running", sheetDigest: null, modeId: MODE },
                        bindings({ modes: { [MODE]: ended } }));
    expect(html).not.toContain("xr-mode-rule");
  });
});

/* M5 Stage 12 — a challenge shows its rules before entry and never rounds a verdict. */
describe("ChallengeBoard", () => {
  const CW = "5c5c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c";
  const ME = "M".repeat(43);
  const challenge: ChallengeRecord = {
    worldId: CW, publisher: { publicKey: "P".repeat(43), displayName: "Blender Club" },
    rules: { title: "Desk accessory", brief: "A printable desk object under 60 mm.", rules: ["one entry per person"],
      startsAt: Date.now() - 86_400_000, endsAt: Date.now() + 4 * 86_400_000,
      deliverable: { formRoles: ["print.stl"], description: "an STL that prints without supports" },
      judging: { criteria: ["prints cleanly"], by: "publisher", scale: "one_to_five" }, aiPolicy: "no_generative_geometry", entry: "open", entryNote: "" },
    signature: { publicKey: "P".repeat(43), displayName: "Blender Club", signedAt: 1, rootHash: "a".repeat(64), signature: "s".repeat(86) },
    deadlineConstraintId: OBJ, policyConstraintId: OBJ, createdAt: 1, dismissedAt: null,
  };
  const entry = (verdict: Compliance["verdict"], who = ME): EntryRecord => ({
    id: `e-${verdict}-${who.slice(0, 2)}`, challengeWorldId: CW, objectId: OBJ,
    publisher: { publicKey: who, displayName: who === ME ? "You" : "Samir" }, packageRoot: null, submittedAt: 1,
    compliance: { verdict, policy: "no_generative_geometry",
      because: verdict === "violates" ? ["geometry was generated: model step (3d.generate) by m"] : ["the record does not say: no forms are recorded"],
      over: { events: 0, modelEvents: 0, representations: 0, generated: 0 } },
  });
  const board = (entries: EntryRecord[], over: Partial<ChallengeRecord["rules"]> = {}) => render(
    { id: "c", component: "ChallengeBoard", worldId: CW },
    bindings({ challenges: { [CW]: { ...challenge, rules: { ...challenge.rules, ...over } } },
      challengeEntries: { [CW]: entries }, selfPublicKey: ME, focusObjectId: OBJ, onEnterChallenge: () => {} }),
  );

  it("shows rules, dates, deliverable, judging and the policy as a tag before anything is entered", () => {
    const html = board([]);
    for (const s of ["Desk accessory", "one entry per person", "prints without supports", "prints cleanly", "no generative geometry", "days left"]) {
      expect(html).toContain(s);
    }
    expect(html).toContain("Enter what is in the centre");
    expect(html).toContain("Other entries appear after the challenge closes");
  });

  it("an empty record renders the record does not say — never ready green", () => {
    const html = board([entry("insufficient_record")]);
    expect(html).toContain("the record does not say");
    expect(html).toContain("xr-tag--blocked");
    expect(html).not.toContain("xr-tag--ok");
  });

  it("a violation names the violating event beside the tag", () => {
    const html = board([entry("violates")]);
    expect(html).toContain("◌");
    expect(html).toContain("violates");
    expect(html).toContain("3d.generate");
  });

  /* M6 B1 — the Sealed Session, offered from the board; density shown with the verdict, never as a score. */
  it("offers to seal the session while open, and says so instead when one is running", () => {
    const offered = render({ id: "c", component: "ChallengeBoard", worldId: CW },
      bindings({ challenges: { [CW]: challenge }, challengeEntries: { [CW]: [] }, selfPublicKey: ME, focusObjectId: OBJ, onSealSession: () => {} }));
    expect(offered).toContain("Seal the session");
    const running = render({ id: "c", component: "ChallengeBoard", worldId: CW },
      bindings({ challenges: { [CW]: challenge }, challengeEntries: { [CW]: [] }, selfPublicKey: ME, focusObjectId: OBJ, onSealSession: () => {},
        sealRunning: { id: OBJ, kind: "sealed_session", worldId: CW, startedAt: 1, endedAt: null, exitReason: null, sheetDigest: "d",
          envelope: { durationMinutes: 60, restrictions: [], windows: [], maxFrequencyPerDay: 0, categories: [], exitPolicy: "always", resumeObjectId: null, remoteModels: false, entryObjectId: OBJ, heartbeatSeconds: 60 } } }));
    expect(running).toContain("A Sealed Session is running");
    expect(running).not.toContain("Seal the session");
  });

  it("shows record density as a sentence with the limit stated, and no score", () => {
    const dense = entry("insufficient_record");
    dense.compliance.density = { sessionMinutes: 40, recordedMinutes: 20, gaps: 1, gapsAcrossVersionChange: 1, unexplainedPastes: 0, exitReason: "completed",
      sentence: "20 of 40 minutes recorded · 1 gap (1 across a version change) · no unexplained pastes · ran to the end" };
    const html = board([dense]);
    expect(html).toContain("20 of 40 minutes recorded");
    expect(html).toContain("Activity outside the recorded environment is not independently verified.");
    expect(html).not.toMatch(/\d+%|score/i);
  });

  it("hides other entries while open and lists them in arrival order, unranked, after close", () => {
    const open = board([entry("complies"), entry("complies", "S".repeat(43))]);
    expect(open).not.toContain("Samir");
    const closed = board([entry("complies"), entry("complies", "S".repeat(43))], { endsAt: Date.now() - 1 });
    expect(closed).toContain("Samir");
    expect(closed).toContain("in the order they arrived");
    expect(closed).not.toMatch(/#\d|rank|score|1st|winner/i);
  });
});

/* UI layer — the seven lenses are one Scene family. */
describe("SupportMap", () => {
  const claim = (id: string, text: string, lane: SupportMapData["claims"][number]["lane"], stance: SupportMapData["claims"][number]["stance"] = "assertion"): SupportMapData["claims"][number] => ({
    objectId: id, text, stance, lane, checkedBy: lane === "supported" ? "human" : lane === "contradicted" ? "model" : "unchecked",
    counts: { supported: lane === "supported" ? 1 : 0, ambiguous: 0, unresolved: lane === "unresolved" ? 1 : 0, contradicted: lane === "contradicted" ? 1 : 0 },
    sources: ["Study 4"],
  });
  const data: SupportMapData = {
    objectId: OBJ, title: "Colour strategy",
    claims: [
      claim(ATOM, "Consumers prefer orange.", "supported"),
      claim(DEC, "Colour stops mattering above €80.", "contradicted"),
      claim(REP, "The margin is probably worth paying.", "own", "hypothesis"),
    ],
    lanes: { supported: 1, ambiguous: 0, unresolved: 0, contradicted: 1, own: 1 },
    summary: "3 claims: 1 supported, 0 ambiguous, 0 unresolved, 1 contradicted; 1 the author's own.",
  };
  const map = (lanes: Array<"supported" | "ambiguous" | "unresolved" | "contradicted" | "own"> = []) =>
    render({ id: "s", component: "SupportMap", objectId: OBJ, lanes, disclosure: 3 }, bindings({ supportMaps: { [OBJ]: data } }));

  it("lays claims in lanes by support state, with a glyph and a word on every lane", () => {
    const html = map();
    for (const w of ["supported", "ambiguous", "unresolved", "contradicted", "the author"]) expect(html).toContain(w);
    for (const g of ["●", "◐", "○", "◌"]) expect(html).toContain(g);
    expect(html).toContain("Consumers prefer orange.");
    expect(html).toContain("checked by you");
    expect(html).toContain("proposed by a model");
  });

  it("puts a hypothesis in the author's own lane, never in unresolved", () => {
    const html = map();
    const own = html.slice(html.indexOf("xr-smlane--own"));
    expect(own).toContain("The margin is probably worth paying.");
    const unresolved = html.slice(html.indexOf("xr-smlane--unresolved"), html.indexOf("xr-smlane--contradicted"));
    expect(unresolved).not.toContain("The margin");
  });

  it("contains no percentage", () => {
    expect(map()).not.toMatch(/\d+\s?%/);
  });

  it("a lens can show a subset of lanes", () => {
    const html = map(["unresolved", "ambiguous"]);
    expect(html).not.toContain("xr-smlane--supported");
    expect(html).toContain("xr-smlane--unresolved");
  });
});

describe("AgentTrail", () => {
  const row = (over: Partial<TrailRow>): TrailRow => ({
    id: "r1", worldId: "w", objectId: OBJ, intent: "research_plan", at: 1,
    saw: { digest: "c".repeat(64), included: 7, excluded: 2 }, decided: null, authorized: null, executed: null, ...over,
  });
  const trail = (rows: TrailRow[]) => render({ id: "t", component: "AgentTrail", objectId: OBJ }, bindings({ agentTrail: { [OBJ]: rows } }));

  it("an unsupported or gated outcome leaves the last two columns empty, not inferred", () => {
    const html = trail([row({ decided: { kind: "gated", model: null } })]);
    expect(html).toContain("7 items · 2 excl.");
    expect(html).toContain("gated");
    expect((html.match(/is-empty/g) ?? []).length).toBe(2);
    expect((html.match(/is-filled/g) ?? []).length).toBe(2);
    expect(html).not.toContain("CREATE");
  });

  it("a full row shows every digest, in order", () => {
    const html = trail([row({
      id: "r2", decided: { kind: "executable", model: "gpt-4o-mini" },
      authorized: { planDigest: "p".repeat(64), level: "CREATE" }, executed: { actionId: "a".repeat(36), outcome: "succeeded" },
    })]);
    const cell = (t: string) => html.indexOf(`xr-trail__word">${t}`);
    const digest = (d: string) => html.indexOf(`xr-mono">${d}`);
    expect(digest("cccccccccccc")).toBeLessThan(cell("executable"));
    expect(cell("executable")).toBeLessThan(digest("pppppppppppp"));
    expect(digest("pppppppppppp")).toBeLessThan(cell("succeeded"));
    expect((html.match(/is-empty/g) ?? []).length).toBe(0);
  });

  it("says plainly when nothing has been asked", () => {
    expect(trail([])).toContain("No model has been asked anything about this yet.");
  });
});

/* M6 A2 — where you stand: rows, not prose. */
describe("Standing", () => {
  const GOAL = "8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a";
  const data: StandingData = {
    goal: { id: GOAL, worldId: "w", outcome: "Choose a jacket finish the client will accept", status: "making", focusObjectId: OBJ,
      requiredOutputs: ["print.stl"], openQuestionIds: [], nextActions: [
        { id: "a1", text: "Prepare the next client delivery", objectId: null, tool: null, origin: "person", doneAt: null },
        { id: "a2", text: "Pull Q1 returns", objectId: ATOM, tool: null, origin: "accepted_proposal", doneAt: null },
      ], createdAt: 1, updatedAt: 1, lastActiveAt: 1 },
    worldId: "w", worldTitle: "Rainwear 2027", focus: { id: OBJ, title: "Rocket" },
    knowledge: { known: [{ id: ATOM, title: "Consumers prefer orange." }], proposed: [{ id: "candidate-0", title: "a proposed claim awaiting review" }],
      disputed: [], unknown: [{ id: "print.stl", title: "print.stl" }], chosenDespite: [] },
    changed: { since: 1, newSources: [{ id: "s", title: "Study 4" }], rebuild: [], review: [{ id: DEC, title: "Which finish for the 2027 shell?" }], critiques: [] },
    nextActions: [], needed: [{ output: "print.stl", satisfied: false, objectId: null }], lastMove: null,
  };
  data.nextActions = data.goal.nextActions;
  const out = () => render({ id: "st", component: "Standing", goalId: GOAL }, bindings({ standings: { [GOAL]: data }, onAddNextAction: () => {}, onNextActionDone: () => {} }));

  it("shows the goal, the five states with glyph, count and word, and no percentage", () => {
    const html = out();
    expect(html).toContain("Choose a jacket finish the client will accept");
    for (const w of ["known", "proposed", "disputed", "unknown", "chosen despite"]) expect(html).toContain(w);
    for (const g of ["●", "◐", "◌", "○", "▲"]) expect(html).toContain(g);
    expect(html).not.toMatch(/\d+\s?%/);
  });

  it("names what changed, what is next, and what is needed — each from a row", () => {
    const html = out();
    expect(html).toContain("Which finish for the 2027 shell?");
    expect(html).toContain("Study 4");
    expect(html).toContain("Prepare the next client delivery");
    expect(html).toContain("accepted proposal");
    expect(html).toContain("print.stl");
    expect(html).toContain("not yet made");
  });

  /* Gate 0 — Finish runs the check; refusals are words; finishing anyway needs a reason. */
  it("offers Finish, shows what is missing, and asks for a reason before finishing anyway", () => {
    const html = render({ id: "st", component: "Standing", goalId: GOAL },
      bindings({ standings: { [GOAL]: data }, onFinish: () => {}, finishRefusals: { [GOAL]: ["print.stl has no release of its current version", "1 claim still disputed"] } }));
    expect(html).toContain(">Finish<");
    expect(html).toContain("Not finished yet:");
    expect(html).toContain("print.stl has no release of its current version");
    expect(html).toContain("Finish anyway — because");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Finish anyway<\/button>/);
    expect(html).not.toContain("✓");
  });

  it("without a refusal there is Finish and nothing about finishing anyway", () => {
    const html = render({ id: "st", component: "Standing", goalId: GOAL }, bindings({ standings: { [GOAL]: data }, onFinish: () => {} }));
    expect(html).toContain(">Finish<");
    expect(html).not.toContain("Finish anyway");
  });

  it("carries no generated sentence: the aria label is the describeStanding template", () => {
    const html = out();
    expect(html).toContain("1 known, 1 proposed, 0 disputed, 1 unknown.");
    expect(html).toContain("Since you left: 1 new source, 1 decision to review.");
  });
});

/* M6 A4 — proposals are not knowledge; the indicator interrupts nobody. */
describe("ProposalsTray", () => {
  const W = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const SV = "44444444-4444-4444-8444-444444444444";
  const cand = (id: string, text: string, over: Partial<CandidateRecord> = {}): CandidateRecord => ({
    id, worldId: W, sourceId: null, sourceVersionId: null, atomType: "claim", text, locator: { selectors: [] },
    stance: "assertion", citations: [], extraction: "model/research_plan", state: "proposed", createdAt: 1, ...over,
  } as CandidateRecord);
  const tray = (items: CandidateRecord[]) => render({ id: "p", component: "ProposalsTray", worldId: W },
    bindings({ candidates: { [W]: items }, onAcceptCandidate: () => {}, onRejectCandidate: () => {} }));

  it("an unsupported assertion says so and shows no green chip; a hypothesis is the model's own", () => {
    const html = tray([cand("c1", "Welded seams are 18% cheaper."), cand("c2", "The margin is worth paying.", { stance: "hypothesis" })]);
    expect(html).toContain("unsupported by the sources given");
    expect(html).not.toContain("is-supported");
    expect(html).toContain("hypothesis");
    expect(html).toContain("None of this is knowledge until you accept it.");
  });

  it("an assertion with unreviewed citations offers Accept anyway, never Accept", () => {
    const html = tray([cand("c1", "Most returns are seam failures.", {
      citations: [{ sourceVersionId: SV, locator: { selectors: [] }, proposedStatus: "supported" }] })]);
    expect(html).toContain("Accept anyway");
    expect(html).toContain("supported · proposed");
    expect(html).not.toMatch(/>Accept</);
    expect(html).toContain("its citations have not been reviewed");
  });

  it("compresses steps to seven primary with the rest behind Show supporting detail", () => {
    const steps = Array.from({ length: 9 }, (_, i) => cand(`s${i}`, `Step ${i + 1}`, { atomType: "moment", stance: "direction" }));
    const html = tray(steps);
    expect(html).toContain("Step 7");
    expect(html).not.toContain("Step 8");
    expect(html).toContain("Show supporting detail · 2 more");
  });

  it("renders nothing when there is nothing proposed", () => {
    expect(tray([])).not.toContain("xr-proposals");
  });
});

describe("ContextIndicator", () => {
  it("says how much, what was left out, and where it goes — in one line", () => {
    const digest = "d".repeat(64);
    const html = render({ id: "i", component: "ContextIndicator", contextDigest: digest }, bindings({ contexts: { [digest]: {
      included: [{ kind: "focus", id: "a", label: "Rocket", tokens: 40 }, { kind: "decision", id: "b", label: "Which finish?", tokens: 80 }],
      excluded: [{ kind: "passage", id: "c", label: "Internal returns data", why: "restricted_rights" }],
      tokens: 120, includesRestricted: false, destination: "local", modelLabel: "llama3", estimatedUsd: 0,
    } } }));
    expect(html).toContain("2 items");
    expect(html).toContain("1 left out");
    expect(html).toContain("stays on this machine");
    expect(html).toContain("what it sees");
  });
});

/* M6 A5 — thinking moves make something persistent; none makes "a longer answer". */
describe("ThinkingMoves", () => {
  const claim: ObjectState = { ...state(ATOM, "Consumers prefer orange.", ["atom.text"]),
    properties: { ...state(ATOM, "Consumers prefer orange.", ["atom.text"]).properties, semanticType: "claim", traits: [] } };
  const moves = (over: Partial<SceneBindings> = {}) => render({ id: "m", component: "ThinkingMoves", objectId: ATOM },
    bindings({ states: { ...bindings().states, [ATOM]: claim }, brainAvailable: false, onThinkingMove: () => {}, onProposeConnection: () => {}, ...over }));

  it("shows the four moves beside a claim and disables the two that need a model, with the reason", () => {
    const html = moves();
    for (const m of ["Find the basis", "Challenge it", "Connect it", "Test it"]) expect(html).toContain(m);
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
    expect(html).toContain("needs a model — none is connected");
    expect(html).not.toMatch(/think deeper|elaborate|longer/i);
  });

  it("enables every move when a model is available", () => {
    expect(moves({ brainAvailable: true })).not.toContain('disabled=""');
  });

  it("lists connections found in the graph with why they may connect, each a proposal", () => {
    const html = moves({ connections: { [ATOM]: [{ objectId: DEC, title: "Which finish for the 2027 shell?", because: "This decision cites \"Study 4\" too.", by: "linked_decision" }] } });
    expect(html).toContain("Which finish for the 2027 shell?");
    expect(html).toContain("cites");
    expect(html).toContain("Propose link");
  });

  it("renders nothing beside an Object that is not an idea", () => {
    expect(render({ id: "m", component: "ThinkingMoves", objectId: OBJ }, bindings({ brainAvailable: true }))).not.toContain("xr-moves");
  });
});

/* M6 A6 — Present cannot change anything; Paper keeps the lime rule. */
describe("presentBindings", () => {
  it("keeps looking and pointing and drops every mutating binding", () => {
    const full = bindings({ onSort: () => {}, onAcceptPlan: () => {}, onRebuild: () => {}, onAcceptCandidate: () => {}, onStartMode: () => {}, onSelect: () => {} });
    const p = presentBindings(full);
    const handlers = Object.keys(p).filter((k) => k.startsWith("on") && typeof (p as unknown as Record<string, unknown>)[k] === "function");
    expect(handlers).toEqual(["onSelect"]);
    expect(p.states).toBe(full.states);
  });
});

describe("the signal colour under Paper", () => {
  it("[data-paper] redefines surfaces and ink only — never the signal, never the semantic ramp", () => {
    const css = readFileSync(join(process.cwd(), "apps/desktop/src/renderer/styles.css"), "utf8");
    const block = css.slice(css.indexOf("[data-paper] {"), css.indexOf("}", css.indexOf("[data-paper] {")));
    expect(block).not.toMatch(/--signal|--brand-lime|--review|--rebuild|--ok|--blocked|--danger/);
    expect(block).toContain("--bg: #fbfaf7");
  });
});

/* M6 B2 — judging as a Scene: one surface, the record's limits on every entry, no rank. */
describe("JudgingSheet", () => {
  const CW = "5c5c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c";
  const E1 = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
  const sheet = (over: Partial<JudgingSheetData> = {}): JudgingSheetData => ({
    challengeWorldId: CW, entryId: E1, entryObjectId: OBJ, entryNumber: 7, entryCount: 12,
    title: "Leak finder", participant: { publicKey: "P".repeat(43), displayName: "Team Adrar" },
    criteria: ["works on the stated problem", "the making is inspectable"], scale: "one_to_five",
    forms: [{ role: "doc.proposal", provenance: "human", modality: "text" }],
    research: { sources: 4, claims: 6, supported: 3, contradicted: 1, unresolved: 2 },
    decisions: { accepted: 2, withSteelman: 1, chosenDespite: 1 },
    build: { versions: 9, human: 14, tool: 3, model: 1 },
    delivery: { released: true, verdict: "insufficient_record", because: ["the record does not say: 20 min with no heartbeat across a version change"] },
    aiActivity: [{ at: 1_700_000_000_000, kind: "model_step", tool: "knowledge.propose", model: "llama", label: "proposed three claims" }],
    observation: { verdict: "insufficient_record", density: "20 of 40 minutes recorded · 1 gap (1 across a version change) · no unexplained pastes · ran to the end", gaps: 1, unexplainedPastes: 0, exitReason: "completed" },
    proofRoot: "a".repeat(64), own: null, ...over,
  });
  const html = (over: Partial<JudgingSheetData> = {}) => render(
    { id: "j", component: "JudgingSheet", challengeWorldId: CW, entryId: E1 },
    bindings({ judgingSheets: { [E1]: sheet(over) }, onRecordAssessment: () => {}, onNextEntry: () => {} }),
  );

  it("is one surface: the entry, how it came together, recorded AI activity, observation status, the limits, the marks, three verbs", () => {
    const out = html();
    expect(out).toContain("ARENA · ENTRY 07 of 12 · Process review");
    for (const h of ["How this came together", "Recorded AI activity", "Observation status", "What the record cannot establish", "Your assessment"]) expect(out).toContain(h);
    for (const slot of ["Research", "Decisions", "Build", "Delivery"]) expect(out).toContain(`<h4>${slot}</h4>`);
    expect(out).toContain("knowledge.propose");
    expect(out).toContain("20 of 40 minutes recorded");
    for (const verb of ["Inspect evidence", "Record assessment", "Next entry"]) expect(out).toContain(verb);
  });

  it("carries the cannot-establish line and the three-row table on every entry, whatever the verdict", () => {
    for (const verdict of ["complies", "violates", "insufficient_record"] as const) {
      const out = html({ delivery: { released: true, verdict, because: [] }, observation: { verdict, density: null, gaps: 0, unexplainedPastes: 0, exitReason: null } });
      expect(out).toContain("Activity outside the recorded environment is not independently verified.");
      for (const row of ["Recorded provenance", "Record integrity", "Independent human contribution"]) expect(out).toContain(row);
      expect(out).toContain("No Sealed Session covered this entry.");
    }
  });

  it("marks on the publisher's scale, and the entry number is arrival order — no rank, score or leaderboard", () => {
    const five = html();
    expect(five.match(/role="radio"/g)?.length).toBe(10);                    // 2 criteria × 5 marks
    const check = html({ scale: "check" });
    expect(check.match(/role="radio"/g)?.length).toBe(4);
    expect(check).toContain("met or not");
    expect(five).not.toMatch(/\brank|score|leaderboard|winner|#\d/i);
  });

  it("shows the judge's own recorded assessment as recorded and signed, and offers to record again", () => {
    const out = html({ own: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", challengeDigest: "a".repeat(64), entryId: E1, entryObjectId: OBJ,
      judge: { publicKey: "J".repeat(43), displayName: "You" }, criteria: [{ criterion: "works on the stated problem", mark: 4, note: "" }], note: "",
      inspected: { proofRoot: null, verdict: "complies", density: null, modelEvents: 0 }, recordedAt: 1_700_000_000_000 } });
    expect(out).toContain("signed by you");
    expect(out).toContain("Record again");
    expect(out).toContain('aria-checked="true"');
  });
});

/* M6 Part C — the plan guides; the person controls; the record says what happened. */
describe("PlanBoard and StepFocus", () => {
  const GOAL = "77777777-7777-4777-8777-777777777777";
  const plan: WorkPlan = {
    id: "88888888-8888-4888-8888-888888888888", goalId: GOAL, worldId: WORLD, revision: 3, origin: "person", createdAt: 1, supersededBy: null,
    steps: [
      { id: "t.gather", kind: "gather", purpose: "Bring in what there is to know", inputs: [], expectedResult: "", completionRule: { kind: "person_confirms" }, dependsOn: [], disposition: "adopted" },
      { id: "t.compare", kind: "compare", purpose: "Compare the options", inputs: [], expectedResult: "Each option beside the requirement", completionRule: { kind: "claim_reviewed" }, dependsOn: ["t.gather"], disposition: "adopted" },
      { id: "t.decide", kind: "decide", purpose: "Choose, and say why", inputs: [], expectedResult: "", completionRule: { kind: "decision_accepted" }, dependsOn: ["t.compare"], disposition: "skipped" },
      { id: "t.old", kind: "make", purpose: "An old step", inputs: [], expectedResult: "", completionRule: { kind: "person_confirms" }, dependsOn: [], disposition: "replaced" },
      { id: "t.deliver", kind: "deliver", purpose: "Deliver it", inputs: [], expectedResult: "", completionRule: { kind: "person_confirms" }, dependsOn: [], disposition: "proposed" },
    ],
  };
  const work: StepWork[] = [
    { goalId: GOAL, stepId: "t.gather", execution: "complete", evidence: [{ kind: "note", id: "n1", at: 1, by: "person" }], note: "both studies are in", updatedAt: 1 },
    { goalId: GOAL, stepId: "t.compare", execution: "needs_review", evidence: [], note: "Requirement changed after this step was worked on.", updatedAt: 2 },
  ];
  const board = (over: Partial<SceneBindings> = {}) => render({ id: "p", component: "PlanBoard", goalId: GOAL, editable: true }, bindings({ plans: { [GOAL]: { plan, work } }, onPlanAdoptAll: () => {}, ...over }));

  it("lists the steps in order with the record's word beside each; skipped is skipped, not complete; replaced is hidden", () => {
    const html = board();
    expect(html.indexOf("Bring in what there is to know")).toBeLessThan(html.indexOf("Compare the options"));
    expect(html).toContain("1 of 2 complete · 1 needs review · 1 skipped");
    expect(html).toMatch(/ skipped<\/span>/);
    expect(html).not.toContain("An old step");
    expect(html).not.toMatch(/\d+%/);
  });

  it("offers proposed steps for adoption and never adopts them itself", () => {
    const html = board();
    expect(html).toContain("1 steps proposed from your goal");
    expect(html).toContain(">Adopt all<");
    expect(html).toMatch(/ proposed<\/span>/);
  });

  it("marks the current step: the one needing review comes before the first not started", () => {
    const html = board();
    expect(html).toMatch(/xr-pstep is-adopted exec-needs_review is-current/);
  });

  it("StepFocus shows the rule in words, the evidence, and a note field only for a step that takes the person's word", () => {
    const gather = render({ id: "s", component: "StepFocus", goalId: GOAL, stepId: "t.gather" }, bindings({ plans: { [GOAL]: { plan, work } }, onStepExecution: () => {} }));
    expect(gather).toContain("Complete when:");
    expect(gather).toContain("you say so, with a note.");
    expect(gather).toContain("your word");
    expect(gather).toContain(">Reopen<");
    const compare = render({ id: "s", component: "StepFocus", goalId: GOAL, stepId: "t.compare" }, bindings({ plans: { [GOAL]: { plan, work } }, onStepExecution: () => {}, stepRefusals: { "t.compare": '"Compare the options" is not complete: it needs a claim reviewed by a person against its source.' } }));
    expect(compare).toContain("a claim is reviewed by a person against its source.");
    expect(compare).toContain("is not complete: it needs");
    expect(compare).not.toContain("xr-stepfocus__confirm");
    expect(compare).toContain(">Mark complete<");
  });
});

/* M6 Part C — the components say project, item, suggestion. */
describe("terminology in the components", () => {
  it("Standing, ProposalsTray, ThinkingMoves, PlanBoard and ChallengeBoard say none of the implementation's nouns", () => {
    const outs: string[] = [];
    const GOAL = "77777777-7777-4777-8777-777777777777";
    outs.push(render({ id: "p", component: "PlanBoard", goalId: GOAL, editable: true }, bindings({ plans: { [GOAL]: { plan: { id: "88888888-8888-4888-8888-888888888888", goalId: GOAL, worldId: WORLD, revision: 1, origin: "template", createdAt: 1, supersededBy: null,
      steps: [{ id: "t.g", kind: "gather", purpose: "Bring in what there is to know", inputs: [], expectedResult: "", completionRule: { kind: "person_confirms" }, dependsOn: [], disposition: "proposed" }] }, work: [] } } })));
    outs.push(render({ id: "m", component: "ThinkingMoves", objectId: OBJ }, bindings({ states: { [OBJ]: (() => { const st = state(OBJ, "Taped seams hold", ["source.primary"]); return { ...st, properties: { ...st.properties, semanticType: "claim" } }; })() } })));
    for (const html of outs) {
      const text = stripTechnical(html);
      const hit = text.match(IMPLEMENTATION_WORDS);
      expect(hit, hit ? text.slice(Math.max(0, hit.index! - 80), hit.index! + 40) : "").toBeNull();
    }
  });
});

/* M6 Part C — the plan a person approves, and what became of it. */
describe("ActionReviewCard and ActionReceiptCard", () => {
  const ACTION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const description = {
    destination: "https://receiver.example/hook", accountLabel: "My receiver",
    effect: "Sends these fields to receiver.example, as one request you approved.",
    actionClass: "api_post" as const, route: "service_api" as const,
    items: [{ title: "Seam spec", objectId: OBJ, versionId: "v-7", digest: "c".repeat(64) }],
    fields: [{ name: "order", chars: 16 }],
    amount: 240, currency: "USD",
    verification: "The endpoint answers with an id, and can be asked again afterwards what became of it.",
  };

  it("shows where it goes, as whom, what it carries, the amount and the digest — never a value", () => {
    const html = render({ id: "a", component: "ActionReviewCard", actionId: ACTION },
      bindings({ actionReviews: { [ACTION]: { description, reviewDigest: "d".repeat(64), accountVerifiedByPerson: true } }, onApproveAction: () => {} }));
    expect(html).toContain("https://receiver.example/hook");
    expect(html).toContain("My receiver");
    expect(html).toContain("Seam spec");
    expect(html).toContain("240 USD");
    expect(html).toContain("dddddddddddd…");
    expect(html).toContain("Approve this exact action");
    expect(html).toContain("can be asked again afterwards");
    expect(html).toContain("16 characters");                       // the size, not the value
  });

  it("says when the account was not confirmed by a person", () => {
    const html = render({ id: "a", component: "ActionReviewCard", actionId: ACTION },
      bindings({ actionReviews: { [ACTION]: { description, reviewDigest: "d".repeat(64), accountVerifiedByPerson: false } } }));
    expect(html).toContain("you have not confirmed this is the right account");
  });

  it("the receipt keeps every attempt as it was, and offers Check status — never a retry", () => {
    const attempts = [
      { id: "at-1", actionId: ACTION, idempotencyKey: "at-1", state: "uncertain" as const, reference: "ord-9", responseDigest: null, detail: "timed out", startedAt: 1, endedAt: 2 },
    ];
    const html = render({ id: "r", component: "ActionReceiptCard", actionId: ACTION },
      bindings({ actionReceipts: { [ACTION]: { description, attempts, checks: { "at-1": [{ id: "c-1", attemptId: "at-1", result: "unsupported", detail: "this endpoint cannot be asked afterwards", at: 3 }] } } }, onCheckStatus: () => {} }));
    expect(html).toContain("uncertain");
    expect(html).toContain("Check the status; do not send it again");
    expect(html).toContain(">Check status<");
    expect(html).not.toMatch(/Try again|Retry/);
    expect(html).toContain("this endpoint cannot be asked afterwards");
    expect(html).toContain("never written over it");
  });
});
