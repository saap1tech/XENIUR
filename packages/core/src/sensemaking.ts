import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";

export const SOURCE_KINDS = [
  "article", "video", "podcast", "paper", "note", "conversation", "screenshot", "clip", "book",
] as const;
export const SourceKindSchema = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const SourceSchema = z.object({
  id: UuidSchema,
  worldId: UuidSchema.nullable().default(null),
  kind: SourceKindSchema,
  url: z.string().nullable().default(null),
  title: z.string().min(1),
  author: z.string().nullable().default(null),
  publishedAt: TimestampSchema.nullable().default(null),
  retrievedAt: TimestampSchema,
  hash: z.string().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
});
export type Source = z.infer<typeof SourceSchema>;

/* -------------------------------------------------------- source versions */

/** What XENIUR is allowed to do with the stored bytes. Unknown stays visible as unknown. */
export const RIGHTS = ["unknown", "permitted", "restricted"] as const;
export const RightsSchema = z.enum(RIGHTS);
export type Rights = z.infer<typeof RightsSchema>;

/**
 * A Source is a thing in the world; a SourceVersion is the copy XENIUR actually read.
 *
 * Keeping only the reference was the flaw: an atom carried a character range into text
 * that was never stored, so "show me exactly what this came from" had no answer at all,
 * and a page that changed underneath left the claim pointing at nothing. A version stores
 * the normalised text, hashes it, and says plainly whether it is the whole thing.
 */
export const SourceVersionSchema = z.object({
  id: UuidSchema,
  sourceId: UuidSchema,
  retrievedAt: TimestampSchema,
  /** sha256 of the normalised text. Two captures of one article share it. */
  contentHash: z.string(),
  /** The original bytes, when they were available and keeping them was permitted. */
  rawBlobHash: z.string().nullable().default(null),
  /** The normalised text. Always present — this is the copy locators resolve against. */
  textBlobHash: z.string(),
  /** Which extractor produced the text, with its version. */
  extractor: z.string().default("verbatim/1"),
  /** True when this is an excerpt rather than the whole source, and honest about it. */
  partial: z.boolean().default(false),
  canonicalUrl: z.string().nullable().default(null),
  /** Who published it. Two outlets running one wire report are not two sources. */
  publicationId: z.string().nullable().default(null),
  author: z.string().nullable().default(null),
  publishedAt: TimestampSchema.nullable().default(null),
  rights: RightsSchema.default("unknown"),
});
export type SourceVersion = z.infer<typeof SourceVersionSchema>;

/**
 * Where a locator actually landed when it was resolved against stored text.
 *
 * `moved` is the interesting case: the quote was found, but not where the position said it
 * would be — the source was re-extracted and the offsets shifted. The passage is still
 * right, and XENIUR says so rather than pretending nothing happened.
 */
export interface ResolvedPassage {
  text: string;
  start: number;
  end: number;
  /** Characters either side, for showing the passage in context. */
  context: { before: string; after: string };
  moved: boolean;
  sourceVersionId: string;
}

/* ------------------------------------------------------------- candidates */

export const CANDIDATE_STATES = ["proposed", "accepted", "rejected", "edited"] as const;
export const CandidateStateSchema = z.enum(CANDIDATE_STATES);
export type CandidateState = z.infer<typeof CandidateStateSchema>;

/**
 * A suggestion, kept as a suggestion.
 *
 * Extraction used to create atoms directly, which quietly made a pattern match into
 * something the person had said. A candidate stays in its own table until somebody accepts
 * it, rejects it or edits it — and the record of that decision is kept, because "XENIUR
 * proposed this and I rejected it" is information about the person's thinking.
 */
/** A citation a proposal offers for a claim, before anyone has checked it. */
export interface ProposedCitation {
  sourceVersionId: string;
  locator: Locator;
  /** A model's opinion of whether the passage bears on the claim. Never final. */
  proposedStatus: SupportStatus;
}

export interface CandidateRecord {
  id: string;
  worldId: string;
  sourceVersionId: string;
  atomType: AtomType;
  text: string;
  locator: Locator;
  /** What kind of statement the proposal says this is. */
  stance: Stance;
  /** Citations offered in support, each still unresolved until a person reviews it. */
  citations: ProposedCitation[];
  /** Which rule matched, in the words shown to the person. */
  because: string;
  extractor: string;
  state: CandidateState;
  acceptedObjectId: string | null;
  decidedAt: number | null;
  createdAt: number;
}

/**
 * The meaningful units a person actually thinks with. Deliberately not "notes" or
 * "highlights": a claim and a question behave differently, and a contradiction is the
 * whole reason to keep any of it.
 */
export const ATOM_TYPES = [
  "claim", "example", "question", "evidence", "contradiction", "person", "concept", "moment",
] as const;
export const AtomTypeSchema = z.enum(ATOM_TYPES);
export type AtomType = z.infer<typeof AtomTypeSchema>;

/* --------------------------------------------------------------- locators */

/**
 * Where an atom came from, in the shapes the W3C Web Annotation model already defines.
 *
 * A private vocabulary was tempting and wrong. Offsets move — a source re-extracted with a
 * better parser shifts every character position in it — so a locator that is *only* a
 * character range silently starts pointing at the wrong sentence. The W3C answer is to
 * carry both: the exact words with a little text either side, and the position. The quote
 * is what survives; the position is what makes finding it cheap and unambiguous.
 *
 * https://www.w3.org/TR/annotation-model/#selectors
 */
export const TextQuoteSelectorSchema = z.object({
  type: z.literal("TextQuoteSelector"),
  exact: z.string().min(1),
  /** Enough context to tell two identical sentences apart. */
  prefix: z.string().default(""),
  suffix: z.string().default(""),
});
export type TextQuoteSelector = z.infer<typeof TextQuoteSelectorSchema>;

export const TextPositionSelectorSchema = z.object({
  type: z.literal("TextPositionSelector"),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type TextPositionSelector = z.infer<typeof TextPositionSelectorSchema>;

/** Seconds into a recording. `end` is null for a point rather than a span. */
export const MediaFragmentSelectorSchema = z.object({
  type: z.literal("MediaFragmentSelector"),
  start: z.number().nonnegative(),
  end: z.number().nonnegative().nullable().default(null),
});
export type MediaFragmentSelector = z.infer<typeof MediaFragmentSelectorSchema>;

export const PageSelectorSchema = z.object({
  type: z.literal("PageSelector"),
  page: z.number().int().positive(),
});

export const SelectorSchema = z.discriminatedUnion("type", [
  TextQuoteSelectorSchema, TextPositionSelectorSchema, MediaFragmentSelectorSchema, PageSelectorSchema,
]);
export type Selector = z.infer<typeof SelectorSchema>;

/**
 * Locators written before selectors existed carried `{ start, end, quote, timecode, page }`.
 * They are upgraded on read rather than migrated in SQL: a lossy UPDATE over everything a
 * person has ever captured is a worse trade than a few lines here, and this way a database
 * that was never opened by the new build still reads correctly.
 */
const upgradeLegacyLocator = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null) return raw;
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o["selectors"])) return o;

  const selectors: unknown[] = [];
  if (typeof o["quote"] === "string" && o["quote"].length > 0) {
    selectors.push({ type: "TextQuoteSelector", exact: o["quote"], prefix: "", suffix: "" });
  }
  if (typeof o["start"] === "number" && typeof o["end"] === "number") {
    selectors.push({ type: "TextPositionSelector", start: o["start"], end: o["end"] });
  }
  if (typeof o["timecode"] === "number") {
    selectors.push({ type: "MediaFragmentSelector", start: o["timecode"], end: null });
  }
  if (typeof o["page"] === "number") selectors.push({ type: "PageSelector", page: o["page"] });
  return { selectors };
};

export const LocatorSchema = z.preprocess(upgradeLegacyLocator, z.object({
  selectors: z.array(SelectorSchema).default([]),
}));
export type Locator = { selectors: Selector[] };

export const emptyLocator = (): Locator => ({ selectors: [] });

export const quoteSelectorOf = (l: Locator): TextQuoteSelector | null =>
  (l.selectors.find((s) => s.type === "TextQuoteSelector") as TextQuoteSelector | undefined) ?? null;

export const positionSelectorOf = (l: Locator): TextPositionSelector | null =>
  (l.selectors.find((s) => s.type === "TextPositionSelector") as TextPositionSelector | undefined) ?? null;

export const timecodeOf = (l: Locator): number | null => {
  const m = l.selectors.find((s) => s.type === "MediaFragmentSelector") as
    MediaFragmentSelector | undefined;
  return m ? m.start : null;
};

/** A locator for a passage of text, carrying both what was said and where it was. */
export const textLocator = (
  exact: string, start: number, end: number, context: { prefix?: string; suffix?: string } = {},
): Locator => ({
  selectors: [
    { type: "TextQuoteSelector", exact, prefix: context.prefix ?? "", suffix: context.suffix ?? "" },
    { type: "TextPositionSelector", start, end },
  ],
});

/** A locator for a moment in a recording. */
export const timeLocator = (seconds: number, exact?: string): Locator => ({
  selectors: [
    { type: "MediaFragmentSelector", start: seconds, end: null },
    ...(exact ? [{ type: "TextQuoteSelector" as const, exact, prefix: "", suffix: "" }] : []),
  ],
});

/** What the person decided to do with it. The six verbs, and nothing else. */
export const LANES = ["keep", "question", "connect", "test", "build", "ignore"] as const;
export const LaneSchema = z.enum(LANES);
export type Lane = z.infer<typeof LaneSchema>;

/** How an atom was found — stated plainly, never dressed up as understanding. */
export const EXTRACTION_METHODS = ["manual", "heuristic", "model"] as const;
export const ExtractionMethodSchema = z.enum(EXTRACTION_METHODS);
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;

/* ----------------------------------------------------------------- stance */

/**
 * What kind of statement an atom is.
 *
 * Not everything a person keeps is an assertion about the world. An opinion, a hypothesis, an
 * observation of their own, a synthesis, a creative direction — each is legitimate and none
 * needs a source to stand on. Demanding one would be the discipline misapplied: "I think the
 * orange reads better on camera" is not unsupported, it is a preference, and it is labelled
 * as one. Only an `assertion` is shown as unsupported when nothing bears on it.
 */
export const STANCES = [
  "assertion", "opinion", "hypothesis", "observation", "synthesis", "direction",
] as const;
export const StanceSchema = z.enum(STANCES);
export type Stance = z.infer<typeof StanceSchema>;

/** The stances that speak for the person rather than about the world. */
export const OWN_STANCES: readonly Stance[] = ["opinion", "hypothesis", "observation", "synthesis", "direction"];

/* ---------------------------------------------------------- claim support */

/**
 * Whether a cited passage actually bears on the claim that cites it.
 *
 * Traceability — a claim resolves to stored words at a locator — was mistaken for support.
 * They are two facts. The passage might contradict the claim, touch it only obliquely, or
 * say nothing relevant. A citation *existing* and a citation *supporting the assertion* are
 * recorded separately, and only the second one is ever shown as green.
 */
export const SUPPORT_STATUSES = ["supported", "contradicted", "ambiguous", "unresolved"] as const;
export const SupportStatusSchema = z.enum(SUPPORT_STATUSES);
export type SupportStatus = z.infer<typeof SupportStatusSchema>;

/** Who checked. A model may propose; it does not settle. */
export const SupportCheckerSchema = z.enum(["human", "model", "unchecked"]);
export type SupportChecker = z.infer<typeof SupportCheckerSchema>;

export const ClaimSupportSchema = z.object({
  id: UuidSchema,
  claimObjectId: UuidSchema,
  /** The exact stored copy the citation points into. */
  sourceVersionId: UuidSchema,
  locator: LocatorSchema.default({ selectors: [] }),
  status: SupportStatusSchema.default("unresolved"),
  checkedBy: SupportCheckerSchema.default("unchecked"),
  checkedAt: TimestampSchema.nullable().default(null),
  note: z.string().default(""),
  createdAt: TimestampSchema,
});
export type ClaimSupport = z.infer<typeof ClaimSupportSchema>;

/** The counts a Trust Strip cell and a source chip are drawn from. */
export interface SupportSummary {
  claimObjectId: string;
  counts: Record<SupportStatus, number>;
  /** True only when at least one citation is human-reviewed as supported and none contradicts. */
  reviewedSupported: boolean;
  /** True when a citation exists that nobody has checked. */
  hasUnreviewed: boolean;
  /** True when any citation, human- or model-checked, contradicts the claim. */
  hasContradiction: boolean;
}

/** The words shown beside each state. Colour is never the only signal. */
export const SUPPORT_GLYPHS: Record<SupportStatus, { glyph: string; word: string }> = {
  supported:    { glyph: "●", word: "supported" },
  ambiguous:    { glyph: "◐", word: "ambiguous" },
  unresolved:   { glyph: "○", word: "unresolved" },
  contradicted: { glyph: "◌", word: "contradicted" },
};

export const AtomSchema = z.object({
  objectId: UuidSchema,
  atomType: AtomTypeSchema,
  sourceId: UuidSchema.nullable().default(null),
  /** The exact copy this came out of, which is what makes the locator resolvable. */
  sourceVersionId: UuidSchema.nullable().default(null),
  locator: LocatorSchema.default({ selectors: [] }),
  /** The person's confidence. Null means unrated, which is different from uncertain. */
  confidence: z.number().min(0).max(1).nullable().default(null),
  lane: LaneSchema.nullable().default(null),
  extraction: ExtractionMethodSchema.default("manual"),
  /** What kind of statement this is. Only an assertion is ever "unsupported". */
  stance: StanceSchema.default("assertion"),
  statedAt: TimestampSchema,
  /** The text itself, carried alongside for convenience; it lives as a form. */
  text: z.string().default(""),
});
export type Atom = z.infer<typeof AtomSchema>;

export const RELATIONS = [
  "supports", "contradicts", "example_of", "asks_about", "same_as", "derived_from",
] as const;
export const RelationSchema = z.enum(RELATIONS);
export type Relation = z.infer<typeof RelationSchema>;

export const AtomLinkSchema = z.object({
  id: UuidSchema,
  fromObjectId: UuidSchema,
  toObjectId: UuidSchema,
  relation: RelationSchema,
  note: z.string().nullable().default(null),
  createdAt: TimestampSchema,
});
export type AtomLink = z.infer<typeof AtomLinkSchema>;

/* ----------------------------------------------------------- thinking map */

export interface MapEntry {
  atom: Atom;
  /** Why this atom appears under this question, in the words shown to the person. */
  because: string;
  related: string[];
}

/**
 * The anti-feed.
 *
 * Six questions, answered from the graph rather than from a model's impression of what you
 * have been reading. Every entry can be traced back to the sentence that produced it.
 */
export interface ThinkingMap {
  worldId: string;
  generatedAt: number;
  /** Claims the person rated above zero, with something linked in support. */
  known: MapEntry[];
  /** Atoms a person linked as contradicting, or captured as a contradiction. */
  conflicts: MapEntry[];
  /** Closely worded claims from copies with different content. */
  repeating: MapEntry[];
  /** No earlier capture matches the wording. */
  novel: MapEntry[];
  /** Claims with nothing linked to them as support. */
  unverified: MapEntry[];
  /** Sitting in Test or Build with nothing happening. */
  actionable: MapEntry[];
  counts: { sources: number; atoms: number; links: number };
}

/**
 * What each lane of the map is called, in words the evidence can carry.
 *
 * The first drafts asked "What do I now know?" and "What keeps repeating?", which claim
 * knowledge and independence that a wording comparison cannot establish. These names say
 * what was actually computed; the question the person is asking is theirs to hold.
 */
export const MAP_QUESTIONS = [
  { key: "known", question: "Your assessed claims",
    explains: "you gave these a confidence above zero, and linked something in support" },
  { key: "conflicts", question: "Possible disagreements",
    explains: "someone linked these as contradicting, or they were captured as a contradiction" },
  { key: "repeating", question: "Similar wording",
    explains: "closely worded claims from separate copies — whether the sources are independent is another question" },
  { key: "novel", question: "No earlier match found",
    explains: "nothing captured before this says it in similar words" },
  { key: "unverified", question: "Claims without linked support",
    explains: "nothing in this World is linked to these as support" },
  { key: "actionable", question: "Open follow-ups",
    explains: "you put these in Test or Build and nothing has happened since" },
] as const;

/* ------------------------------------------------------ productive friction */

export const FRICTION_PROMPTS = [
  "What changed your mind?",
  "Which two of these belong together?",
  "What would you test?",
  "What is your own conclusion?",
  "What here do you actually disagree with?",
] as const;

export interface FrictionState {
  worldId: string;
  /** Sources taken in since the last human move. */
  intakeSinceMove: number;
  threshold: number;
  /** True when XENIUR should stop surfacing more and ask for one move. */
  active: boolean;
  prompt: string | null;
  /** Always true. Friction the person cannot see or overrule is manipulation. */
  dismissible: true;
  lastMoveAt: number | null;
}

/**
 * A human move: the thing intake is supposed to convert into.
 *
 * Rating something, linking two ideas, writing an observation, challenging a claim,
 * deciding a lane. The friction counter resets on these, because these are the point —
 * not time spent, not items read.
 */
export const MOVE_KINDS = [
  "rated", "linked", "observed", "challenged", "sorted", "concluded", "built", "dismissed_friction",
] as const;
export const MoveKindSchema = z.enum(MOVE_KINDS);
export type MoveKind = z.infer<typeof MoveKindSchema>;
