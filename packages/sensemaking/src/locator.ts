import type { Locator, ResolvedPassage } from "@xeniur/core";
import { positionSelectorOf, quoteSelectorOf } from "@xeniur/core";

/** Characters of surrounding text kept with a quote, and shown either side of a passage. */
export const CONTEXT_CHARS = 32;

/**
 * Normalises text once, so a locator resolves against the same bytes it was taken from.
 *
 * Line endings and non-breaking spaces are the usual culprits: a source re-fetched over a
 * different connection can differ only in those, and a character range taken against one
 * form lands mid-word in the other.
 */
export function normaliseText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * Finds the passage a locator refers to inside stored text.
 *
 * The position is tried first because it is exact and cheap. When the text at that
 * position is no longer the quote — which is what happens after a source is re-extracted
 * and every offset shifts — the quote itself is searched for, disambiguated by the prefix
 * and suffix that were kept with it. That recovery is why both selectors exist.
 *
 * Returns null only when the words genuinely are not there any more, which is a real
 * answer: the source changed under the claim, and XENIUR should say so rather than
 * highlight whatever now sits at those coordinates.
 */
export function resolvePassage(
  text: string, locator: Locator, sourceVersionId = "",
): ResolvedPassage | null {
  const quote = quoteSelectorOf(locator);
  const position = positionSelectorOf(locator);

  const at = (start: number, end: number, moved: boolean): ResolvedPassage => ({
    text: text.slice(start, end), start, end, moved, sourceVersionId,
    context: {
      before: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
      after: text.slice(end, Math.min(text.length, end + CONTEXT_CHARS)),
    },
  });

  // 1. The position, confirmed by the quote when there is one.
  if (position && position.end <= text.length && position.start < position.end) {
    const there = text.slice(position.start, position.end);
    if (!quote || there === quote.exact) return at(position.start, position.end, false);
  }

  // 2. The quote, wherever it went.
  if (quote) {
    const found = findQuote(text, quote.exact, quote.prefix, quote.suffix);
    if (found !== -1) return at(found, found + quote.exact.length, position !== null);
  }

  // 3. A position with no quote to confirm it is the weakest case, and only usable when
  //    the range is still inside the text at all.
  if (position && !quote && position.end <= text.length) {
    return at(position.start, position.end, false);
  }
  return null;
}

/**
 * The occurrence of `exact` whose surroundings match best.
 *
 * A source can say the same sentence twice; the prefix and suffix are what tell them
 * apart. With no context to go on the first occurrence is the honest answer, because
 * guessing between identical candidates is not something XENIUR can do for a person.
 */
function findQuote(text: string, exact: string, prefix: string, suffix: string): number {
  const hits: number[] = [];
  for (let i = text.indexOf(exact); i !== -1; i = text.indexOf(exact, i + 1)) {
    hits.push(i);
    if (hits.length > 200) break;
  }
  if (hits.length === 0) return -1;
  if (hits.length === 1 || (prefix === "" && suffix === "")) return hits[0]!;

  let best = hits[0]!;
  let bestScore = -1;
  for (const at of hits) {
    const before = text.slice(Math.max(0, at - prefix.length), at);
    const after = text.slice(at + exact.length, at + exact.length + suffix.length);
    const score = commonSuffix(before, prefix) + commonPrefix(after, suffix);
    if (score > bestScore) { bestScore = score; best = at; }
  }
  return best;
}

const commonPrefix = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
};

const commonSuffix = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
};

/** The prefix and suffix worth keeping beside a quote taken from `text` at `start`. */
export const contextAround = (
  text: string, start: number, end: number,
): { prefix: string; suffix: string } => ({
  prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
  suffix: text.slice(end, Math.min(text.length, end + CONTEXT_CHARS)),
});
