/**
 * Today — "What should I do with my time?"
 *
 * At most seven situations that need a person, ordered by consequence. Compression applied
 * to the person's own day. Running and finished work never appears here. "Nothing else needs
 * you" is a valid, calm, common state — it is the product working, not the product empty.
 */
export const TODAY_LIMIT = 7;

export const TODAY_KINDS = [
  "parked_approval",     // a quote or approval awaiting the person — PURCHASE / COMMIT first
  "decision_review",     // a decision in needs_review
  "unresolved_support",  // unresolved citations on something with a delivery
  "rebuild_pending",     // a released Object whose forms are out of date
  "challenge_deadline",  // an active challenge the person entered
  "challenge_arrival",   // a matching challenge opened — once, dismissable
  "streak",              // commitment or streak state
  "rhythm",              // one reward, only if due and only if a mode is on
] as const;
export type TodayKind = (typeof TODAY_KINDS)[number];

/** Precedence: the lower, the higher up. Never reordered while the page is open. */
export const TODAY_PRECEDENCE: Record<TodayKind, number> = {
  parked_approval: 0, decision_review: 1, unresolved_support: 2, rebuild_pending: 3,
  challenge_deadline: 4, challenge_arrival: 5, streak: 6, rhythm: 7,
};

export interface TodayRow {
  id: string;
  kind: TodayKind;
  /** The glyph that names the kind; colour is never the only signal. */
  glyph: string;
  text: string;
  worldId: string | null;
  worldTitle: string | null;
  /** Where clicking lands: the Object to focus and the zone to open. */
  objectId: string | null;
  zone: "sources" | "decisions" | "work" | "deliveries" | null;
  /** The verb on the right. */
  verb: string;
}

export interface Today {
  date: string;
  rows: TodayRow[];
  /** How many situations were compressed away to keep the page at seven. Shown, not hidden. */
  more: number;
  /** True when nothing needs the person — the calm state. */
  quiet: boolean;
}

export const TODAY_GLYPHS: Record<TodayKind, string> = {
  parked_approval: "▲", decision_review: "◌", unresolved_support: "○", rebuild_pending: "↻",
  challenge_deadline: "◷", challenge_arrival: "◷", streak: "·", rhythm: "✦",
};
