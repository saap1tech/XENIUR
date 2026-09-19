import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  DecisionDetail, ImpactReport, ObjectState, Representation, Scene,
} from "@xeniur/core";
import { describeEnvelope, planDigest, type ModeRecord } from "@xeniur/core";
import { SceneRenderer, emptyBindings, type SceneBindings } from "./index.js";

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
      categories: [], exitPolicy: "always", resumeObjectId: null },
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
