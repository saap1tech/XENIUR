import type { NextAction, WorkGoal } from "./goal.js";

/**
 * Where you stand — the actual persistent state of the work, as a representation.
 *
 * Not a transcript summary, not a motivational dashboard, not a generated answer that forgets
 * the previous one. Every number here is a count of rows; every sentence is a template over
 * facts, and every fragment links to the Object it came from.
 */
export const KNOWLEDGE_STATES = ["known", "proposed", "disputed", "unknown", "chosenDespite"] as const;
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

export const KNOWLEDGE_GLYPHS: Record<KnowledgeState, { glyph: string; word: string; means: string }> = {
  known:         { glyph: "●", word: "known",          means: "claims whose support a person reviewed" },
  proposed:      { glyph: "◐", word: "proposed",       means: "suggested by a model or a source, not yet reviewed" },
  disputed:      { glyph: "◌", word: "disputed",       means: "contradicted by a source or by someone's critique" },
  unknown:       { glyph: "○", word: "unknown",        means: "open questions and outputs not yet made" },
  chosenDespite: { glyph: "▲", word: "chosen despite", means: "decided with the uncertainty named and accepted" },
};

export interface StandingRef { id: string; title: string }

export interface Standing {
  goal: WorkGoal;
  worldId: string;
  worldTitle: string;
  focus: StandingRef | null;
  knowledge: Record<KnowledgeState, StandingRef[]>;
  /** What moved since the person was last here. */
  changed: {
    since: number;
    newSources: StandingRef[];
    rebuild: StandingRef[];
    review: StandingRef[];
    critiques: StandingRef[];
  };
  nextActions: NextAction[];
  /** What is needed to finish: each required output and whether a current form satisfies it. */
  needed: Array<{ output: string; satisfied: boolean; objectId: string | null }>;
  /** The last thing the person did here, from the moves ledger. */
  lastMove: { kind: string; at: number; object: StandingRef | null } | null;
}

/** The sentence for a screen reader and for the resume card: facts in order, no adjectives. */
export function describeStanding(s: Standing): string {
  const k = s.knowledge;
  const parts = [
    `${s.goal.outcome} — ${s.goal.status}.`,
    `${k.known.length} known, ${k.proposed.length} proposed, ${k.disputed.length} disputed, ${k.unknown.length} unknown` +
      (k.chosenDespite.length ? `, ${k.chosenDespite.length} chosen despite uncertainty.` : "."),
  ];
  const c = s.changed;
  const changes = [
    c.newSources.length ? `${c.newSources.length} new source${c.newSources.length === 1 ? "" : "s"}` : null,
    c.review.length ? `${c.review.length} decision${c.review.length === 1 ? "" : "s"} to review` : null,
    c.rebuild.length ? `${c.rebuild.length} form${c.rebuild.length === 1 ? "" : "s"} out of date` : null,
    c.critiques.length ? `${c.critiques.length} critique${c.critiques.length === 1 ? "" : "s"} arrived` : null,
  ].filter((x): x is string => x !== null);
  parts.push(changes.length ? `Since you left: ${changes.join(", ")}.` : "Nothing changed since you left.");
  const open = s.nextActions.filter((a) => !a.doneAt);
  if (open[0]) parts.push(`Next: ${open[0].text}.`);
  const missing = s.needed.filter((n) => !n.satisfied);
  if (missing.length) parts.push(`To finish: ${missing.map((m) => m.output).join(", ")}.`);
  return parts.join(" ");
}

/* ------------------------------------------------------------------------------------------ */
/* The resume card — "You were comparing two finishes before preparing the next delivery."      */
/* ------------------------------------------------------------------------------------------ */

export interface ResumeFragment { text: string; objectId: string | null }

export interface ResumeCard {
  worldId: string;
  worldTitle: string;
  goalId: string | null;
  /** The sentence, as fragments so each one can be a link to the Object it came from. */
  fragments: ResumeFragment[];
  /** Where Continue lands: the goal's focus. */
  focusObjectId: string | null;
  lastActiveAt: number;
}

/** The verb for a move, in the past continuous the card speaks in. */
export const MOVE_VERBS: Record<string, string> = {
  rated: "weighing", linked: "connecting", observed: "noting something about", challenged: "challenging",
  sorted: "sorting", concluded: "deciding on", built: "building", dismissed_friction: "working on",
};

export function resumeText(card: ResumeCard): string {
  return card.fragments.map((f) => f.text).join("");
}
