import type { Stance, SupportStatus, SupportSummary } from "./sensemaking.js";

/**
 * The Support Map — a document or report rendered as its claims.
 *
 * Four lanes, left to right: supported · ambiguous · unresolved · contradicted. A claim with a
 * stance other than assertion sits in its own quiet lane, *the author's own*, never in
 * unresolved. Counts only; the map never shows a percentage.
 */
export const SUPPORT_LANES = ["supported", "ambiguous", "unresolved", "contradicted", "own"] as const;
export type SupportLane = (typeof SUPPORT_LANES)[number];

export const SUPPORT_LANE_WORDS: Record<SupportLane, string> = {
  supported: "supported", ambiguous: "ambiguous", unresolved: "unresolved", contradicted: "contradicted",
  own: "the author's own",
};

export interface SupportMapClaim {
  objectId: string;
  text: string;
  stance: Stance;
  lane: SupportLane;
  /** Who settled the lane: a person, a model's proposal, or nobody. */
  checkedBy: "human" | "model" | "unchecked";
  /** Counts by state for the chips. */
  counts: Record<SupportStatus, number>;
  /** Stored source titles, for Layer 3. */
  sources: string[];
}

export interface SupportMap {
  objectId: string;
  title: string;
  claims: SupportMapClaim[];
  /** Per lane, a count. */
  lanes: Record<SupportLane, number>;
  summary: string;
}

/** Which lane a claim sits in, from its stance and its support summary. Strict, like the strip. */
export function laneFor(stance: Stance, s: SupportSummary): SupportLane {
  if (stance !== "assertion") return "own";
  if (s.hasContradiction) return "contradicted";
  if (s.reviewedSupported) return "supported";
  if (s.counts.ambiguous > 0 && !s.hasUnreviewed) return "ambiguous";
  return "unresolved";
}

export function describeSupportMap(m: SupportMap): string {
  const l = m.lanes;
  return `${m.claims.length} claim${m.claims.length === 1 ? "" : "s"}: ${l.supported} supported, ${l.ambiguous} ambiguous, ` +
    `${l.unresolved} unresolved, ${l.contradicted} contradicted; ${l.own} the author's own.`;
}
