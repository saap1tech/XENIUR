import type { ReviewItem } from "./decisions.js";
import type { StepStatus } from "./recipe.js";

/**
 * What changed, split by what a person can do about it.
 *
 * This is the distinction the whole product turns on, made into a data structure so the
 * interface cannot blur it by accident. Rebuild is arithmetic: a step's inputs differ from
 * what it was built from, so its output is genuinely out of date and XENIUR can produce a
 * correct one. Review is judgement: something a person cited has changed, and only they
 * can say whether it still holds.
 *
 * Nothing in the review list offers a rebuild button, because there is nothing to rebuild;
 * nothing in the rebuild list asks a question, because there is nothing to decide.
 */
export interface RebuildItem {
  stepKey: string;
  /** The form roles this step publishes, in human names where the interface has them. */
  formRoles: string[];
  state: StepStatus["state"];
  /** Whether XENIUR can produce this itself, or is waiting on a person. */
  actionable: "rebuild" | "regenerate" | "waiting_on_you" | "blocked";
  estimatedUsd: number;
  /** Each hop of the causal path, generated from the edge that caused it. */
  path: CausalStep[];
  /** The whole path as one sentence, for somewhere a list will not fit. */
  because: string;
}

/** One hop in an explanation, named rather than described. */
export interface CausalStep {
  /** What this hop is about: a form role, a step key, an Object title. */
  subject: string;
  /** What happened to it, in plain language built from the edge. */
  happened: string;
}

export interface ImpactReport {
  objectId: string;
  /** Mechanically out of date. XENIUR can fix these. */
  rebuild: RebuildItem[];
  /** Worth a person's attention. XENIUR cannot fix these, and must not pretend to. */
  review: ReviewItem[];
  /** Since which release, when there is one to compare against. */
  sinceReleaseId: string | null;
  sinceLabel: string | null;
  /** One line, e.g. "2 things changed since Delivery 01". */
  headline: string;
}

/**
 * Human names for form roles.
 *
 * A person recognises "Print" and "Turntable"; `print.stl` and `preview.turntable` are
 * addresses, and showing an address where a name belongs is how an interface starts
 * looking like its database. Unknown roles fall back to their last segment, title-cased,
 * so a new role reads sensibly before anybody adds it here.
 */
export const FORM_ROLE_NAMES: Record<string, string> = {
  "source.primary": "Source",
  "art.primary": "Artwork",
  "art.illustration": "Artwork",
  "model.mesh": "3D model",
  "delivery.godot": "Game",
  "delivery.web": "Web",
  "delivery.retail": "Retail",
  "delivery.figure": "Figure",
  "delivery.icon": "Icon",
  "print.stl": "Print",
  "preview.thumbnail": "Thumbnail",
  "preview.turntable": "Turntable",
  "doc.primary": "Document",
  "doc.spec": "Specification",
  "doc.proposal": "Proposal",
  "code.project": "Project",
  "atom.text": "Note",
  "decision.brief": "Brief",
};

export function formRoleName(role: string): string {
  const known = FORM_ROLE_NAMES[role];
  if (known) return known;
  const last = role.split(".").pop() ?? role;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/**
 * A semantic type as a person would say it: "3D asset", not "asset3d".
 *
 * Semantic types are slugs because code compares them; nothing about that obliges the
 * interface to read one out. Unknown types are de-slugged rather than passed through,
 * so a type nobody has named here still reads as words.
 */
const SEMANTIC_TYPE_NAMES: Record<string, string> = {
  asset3d: "3D asset",
  rocket: "rocket",
  prop: "prop",
  decision: "decision",
  claim: "claim",
  question: "question",
  evidence: "piece of evidence",
  contradiction: "contradiction",
  moment: "moment",
  concept: "concept",
  brand: "brand",
  figure: "figure",
  campaign: "campaign",
  file: "file",
  object: "object",
};

export function semanticTypeName(type: string): string {
  return SEMANTIC_TYPE_NAMES[type]
    ?? type.replace(/[_-]+/g, " ").replace(/([a-z])([0-9])/gi, "$1 $2").trim();
}

/**
 * "a rocket", "an object", "a 3D asset" — the article for how a noun is *said*.
 *
 * Leading digits are the trap: "an 8-bit", "an 11-frame", "an 18-inch", but "a 3D asset"
 * and "a 2-second clip", because the article follows the spoken sound and not the
 * spelling. Only those three numbers begin with a vowel sound in English.
 */
export const withArticle = (noun: string): string => {
  const vowelSound = /^[aeiou]/i.test(noun) || /^(?:8|11|18)(?!\d)/.test(noun);
  return `${vowelSound ? "an" : "a"} ${noun}`;
};

/* ------------------------------------------------------------ trust facts */

/**
 * "Can I trust this work?" — answered by five cells of facts, never by a tick.
 *
 * Every number here is read from a table that already exists: claim_support, checks,
 * the process ledger, action_receipts, spend. The strip is *settled* — and lime — in exactly
 * one condition: every citation reviewed, every measurement current, no receipt unknown, no
 * decision awaiting review. Anything less is graphite with semantic cells.
 */
export interface TrustFacts {
  objectId: string;
  support: { supported: number; ambiguous: number; unresolved: number; contradicted: number };
  evidence: { current: number; total: number };
  provenance: { human: number; tool: number; model: number };
  actions: { receipted: number; unknown: number };
  cost: { usd: number; escalations: number };
  decisionsNeedingReview: number;
  settled: boolean;
}

/**
 * What a delivery actually cost, joined from records that already exist: spend rows and
 * action costs behind the delivered files, recorded sessions, decisions and source copies.
 * Recorded work is *recorded*, never *total*.
 */
export interface OutcomeLedger {
  objectId: string;
  releaseId: string | null;
  label: string;
  /** Deterministic transforms and generation, from the cost recorded on each lineage action. */
  generation: { usd: number; actions: number; generativeActions: number };
  /** Model calls attributed to the tasks behind this release, from the spend ledger. */
  intelligence: { usd: number; calls: number; escalations: number; failed: number };
  /** Recorded XENIUR sessions on this Object. Recorded, not total. */
  recordedWork: { sessions: number; ms: number };
  decisions: number;
  sourceCopies: number;
  /** One sentence, for the delivery report. */
  summary: string;
}

/** The sentence a screen reader hears for a Trust Strip. Facts, in order, no adjectives. */
export function describeTrust(t: TrustFacts): string {
  const s = t.support;
  const parts = [
    `${s.supported} supported, ${s.unresolved} unresolved, ${s.contradicted} contradicted` +
      (s.ambiguous ? `, ${s.ambiguous} ambiguous` : "") + ".",
    `${t.evidence.current} of ${t.evidence.total} measurements current.`,
    `${t.provenance.human} human, ${t.provenance.tool} tool, ${t.provenance.model} model steps.`,
    `${t.actions.receipted} actions receipted` + (t.actions.unknown ? `, ${t.actions.unknown} unknown.` : "."),
    t.cost.usd > 0
      ? `${(t.cost.usd * 100).toFixed(0)} cents` + (t.cost.escalations ? `, ${t.cost.escalations} escalations.` : ".")
      : "No spend.",
  ];
  if (t.settled) parts.push("Settled.");
  return parts.join(" ");
}
