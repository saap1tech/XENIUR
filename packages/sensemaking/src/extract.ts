import type { AtomType, Locator, ProposedCitation, SourceKind, Stance } from "@xeniur/core";
import { textLocator, timeLocator } from "@xeniur/core";
import { contextAround } from "./locator.js";

export interface Candidate {
  atomType: AtomType;
  text: string;
  locator: Locator;
  /** Which rule matched, shown to the person so they can judge the suggestion. */
  because: string;
  /** What kind of statement the proposer says this is. Defaults to an assertion. */
  stance?: Stance;
  /** Citations offered in support, none settled until a person reviews them. */
  citations?: ProposedCitation[];
}

/**
 * Splits text into sentences, keeping each one's exact position.
 *
 * The position is the point: an atom that cannot be taken back to the characters that
 * produced it is a rumour, and a suggestion nobody can check is worse than no suggestion.
 */
export function sentences(text: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  const pattern = /[^.!?\n]+(?:[.!?]+|\n|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length < 12) continue;
    out.push({
      text: trimmed,
      start: match.index + leading,
      end: match.index + leading + trimmed.length,
    });
    if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
  }
  return out;
}

const EXAMPLE = /\b(for example|for instance|such as|e\.g\.|like when|consider)\b/i;
const EVIDENCE = /\b(\d+(\.\d+)?\s?%|study|studies|data|dataset|measured|survey|experiment|found that|according to|n\s?=\s?\d+)\b/i;
const CONTRADICTION = /\b(however|but in fact|contrary to|contradicts|disagrees|on the other hand|actually,|despite this)\b/i;
const CLAIM = /\b(is|are|will|must|should|always|never|causes|leads to|results in|means that|requires|cannot)\b/i;
const HEDGE = /\b(might|maybe|perhaps|possibly|seems|appears|could be)\b/i;

/**
 * Finds candidate atoms in text using pattern rules.
 *
 * These are *heuristics*, and XENIUR says so everywhere they surface: they match the shape
 * of a sentence, not its meaning. They are offered for review, never written in as
 * understood — an extractor that guesses confidently produces exactly the confident noise
 * this whole feature exists to replace.
 *
 * Every candidate carries the rule that matched and the characters it came from, so a
 * person can dismiss a bad suggestion in one glance.
 */
export function extractCandidates(
  text: string, opts: { kind?: SourceKind; maxCandidates?: number } = {},
): Candidate[] {
  const limit = opts.maxCandidates ?? 60;
  const found: Candidate[] = [];

  for (const s of sentences(text)) {
    if (found.length >= limit) break;
    // Both selectors: the words, so the passage survives re-extraction, and the position,
    // so finding it is exact while the text is unchanged.
    const locator: Locator = textLocator(s.text, s.start, s.end, contextAround(text, s.start, s.end));

    // Ordered by how specific the signal is: a question mark is unambiguous, "is" is not.
    if (s.text.endsWith("?")) {
      found.push({ atomType: "question", text: s.text, locator, because: "it is phrased as a question" });
      continue;
    }
    if (CONTRADICTION.test(s.text)) {
      found.push({ atomType: "contradiction", text: s.text, locator, because: "it signals disagreement with something" });
      continue;
    }
    if (EVIDENCE.test(s.text)) {
      found.push({ atomType: "evidence", text: s.text, locator, because: "it cites a number, a study or a measurement" });
      continue;
    }
    if (EXAMPLE.test(s.text)) {
      found.push({ atomType: "example", text: s.text, locator, because: "it introduces an example" });
      continue;
    }
    if (CLAIM.test(s.text) && !HEDGE.test(s.text)) {
      found.push({ atomType: "claim", text: s.text, locator, because: "it asserts something without hedging" });
    }
  }
  return found;
}

/**
 * Timecoded moments from a transcript, so a useful twelve seconds of video stops being
 * disposable: the clip, its transcript and the idea inside it become one Object that a
 * presentation months later can reuse instead of re-deriving.
 */
export function extractMoments(
  transcript: Array<{ start: number; text: string }>, opts: { maxMoments?: number } = {},
): Candidate[] {
  const limit = opts.maxMoments ?? 20;
  const out: Candidate[] = [];

  for (const line of transcript) {
    if (out.length >= limit) break;
    const trimmed = line.text.trim();
    if (trimmed.length < 20) continue;
    if (!EVIDENCE.test(trimmed) && !CLAIM.test(trimmed) && !trimmed.endsWith("?")) continue;

    out.push({
      atomType: trimmed.endsWith("?") ? "question" : "moment",
      text: trimmed,
      locator: timeLocator(line.start, trimmed),
      because: `at ${formatTimecode(line.start)} in the recording`,
    });
  }
  return out;
}

export const formatTimecode = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const STOPWORDS = new Set([
  "that", "this", "with", "from", "were", "what", "when", "which", "their", "there",
  "have", "been", "than", "then", "they", "them", "into", "over", "most", "some", "such",
  "also", "only", "very", "more", "much", "just", "like", "will", "would", "could",
]);

const contentWords = (text: string): Set<string> => new Set(
  text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
);

const NEGATION = /\b(not|never|no|none|cannot|can't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|won't|rarely|neither|nor|fails? to|without)\b/i;

/** A clause that opens with one of these denies the alternative, not the claim. */
const CONTRASTIVE_OPENER = /^\s*(?:and\s+|but\s+)?(?:not|never|rather than|instead of)\b/i;

/**
 * Whether a statement asserts or denies.
 *
 * Word overlap cannot see this, and the failure is not subtle: *"seams fail first"* and
 * *"seams do not fail first"* share every content word, so containment scores them as the
 * same claim and the map reports a flat contradiction as agreement. Polarity is checked
 * separately and disqualifies a match outright rather than nudging a score, because a
 * denial is not a weaker version of an assertion.
 *
 * The subtlety is contrast. *"Returns are caused by seam failure, not by the fabric"*
 * contains "not" and asserts the seam claim as firmly as a sentence can — the negation
 * belongs to the alternative being ruled out. A clause that opens with one of those
 * markers is therefore read as contrast rather than denial; a negation anywhere else is
 * taken at face value.
 *
 * This is a rule about English clause shape, not an understanding of meaning, and it will
 * be wrong about some sentences. It is applied only to decide whether two wordings group
 * together, never to decide what a person believes.
 */
export const isNegated = (text: string): boolean =>
  text.split(/[,;:—–]/).some((clause) =>
    NEGATION.test(clause) && !CONTRASTIVE_OPENER.test(clause));

/**
 * How much of the smaller statement appears inside the larger one.
 *
 * Containment rather than Jaccard, deliberately. Two sentences can make exactly the same
 * claim at very different lengths — "returns are caused by seam failure" inside a sentence
 * that also cites a study, a year and a sample size — and Jaccard punishes that with the
 * extra words, scoring an identical claim as unrelated. Containment asks the question that
 * actually matters: is the shorter claim already contained in the longer one?
 *
 * Zero when the two disagree in polarity, whatever their wording says.
 */
export function similarity(a: string, b: string): number {
  const wa = contentWords(a), wb = contentWords(b);
  // Below a few content words there is not enough to compare, and short fragments would
  // match everything.
  if (wa.size < 3 || wb.size < 3) return 0;
  if (isNegated(a) !== isNegated(b)) return 0;

  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
}
