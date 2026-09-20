import { z } from "zod";
import { UuidSchema } from "./ids.js";
import { sha256Hex } from "./sha256.js";

/**
 * Modes — bounded, visible, leavable contracts.
 *
 * XENIUR may use strong behavioural mechanisms when the person deliberately opts into the
 * mechanism, understands its rules, can bound its authority, and can leave it. What it must
 * not do is secretly optimise those mechanisms for engagement. So a mode is three things and
 * no more: an envelope the person set, a record of when it ran, and an exit that always exists.
 *
 * The envelope is rendered *before* the mode starts, as a sheet, and `start` takes the digest
 * of that sheet back. A mode therefore cannot begin from an envelope nobody saw — the same
 * discipline as `planDigest` binding authorisation to a plan.
 */
export const MODE_KINDS = ["focus_contract", "serendipity", "recovery", "discovery", "sealed_session"] as const;
export const ModeKindSchema = z.enum(MODE_KINDS);
export type ModeKind = z.infer<typeof ModeKindSchema>;

export const MODE_NAMES: Record<ModeKind, string> = {
  focus_contract: "Focus Contract",
  serendipity: "Serendipity",
  recovery: "Recovery",
  discovery: "Discovery",
  sealed_session: "Sealed Session",
};

/** "HH:MM"–"HH:MM", local time. Windows say when a mode may offer anything at all. */
export const WindowSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
}).strict();

export const ModeEnvelopeSchema = z.object({
  /** How long the mode runs. Required; a mode without an end is not a contract. */
  durationMinutes: z.number().int().positive().max(24 * 60),
  /** What is quiet or unavailable while the mode runs — shown before start, enforced only while running. */
  restrictions: z.array(z.string().min(1).max(120)).max(12).default([]),
  /** When the mode may offer anything. Empty means any time inside the duration. */
  windows: z.array(WindowSchema).max(8).default([]),
  /** Upper bound on offers per day. Timing varies inside this; it is never tuned. */
  maxFrequencyPerDay: z.number().int().min(0).max(24).default(0),
  /** What an offer may be drawn from. Empty means the whole graph the person can see. */
  categories: z.array(z.string().min(1).max(40)).max(12).default([]),
  /**
   * The only exit policy XENIUR knows. It is stored rather than assumed so that a future
   * envelope cannot quietly introduce another one.
   */
  exitPolicy: z.literal("always"),
  /** The Object that had the centre slot when the mode began; restored when it ends. */
  resumeObjectId: UuidSchema.nullable().default(null),
  /**
   * Sealed Session only. Whether a remote model may be routed to while the mode runs; false
   * forces local-or-refuse. Stated on the sheet and enforced in routing, never by memory.
   */
  remoteModels: z.boolean().default(true),
  /** Sealed Session only. The entry being made; heartbeats and the record density attach to it. */
  entryObjectId: UuidSchema.nullable().default(null),
  /** Sealed Session only. How often the renderer records a heartbeat; gaps are measured in these. */
  heartbeatSeconds: z.number().int().positive().max(600).default(60),
}).strict();
export type ModeEnvelope = z.infer<typeof ModeEnvelopeSchema>;
export type ModeEnvelopeInput = z.input<typeof ModeEnvelopeSchema>;

export const EXIT_REASONS = ["completed", "left", "emergency"] as const;
export const ExitReasonSchema = z.enum(EXIT_REASONS);
export type ExitReason = z.infer<typeof ExitReasonSchema>;

export interface ModeRecord {
  id: string;
  kind: ModeKind;
  envelope: ModeEnvelope;
  worldId: string | null;
  startedAt: number;
  endedAt: number | null;
  exitReason: ExitReason | null;
  /** Digest of the sheet the person saw before starting. */
  sheetDigest: string;
}

/** One line of the review sheet a person reads before a mode begins. */
export interface EnvelopeLine { label: string; value: string }

/**
 * The sheet, as lines. The verb is the confirmation — never "OK". Rendering this and
 * passing its digest back is how a mode proves its envelope was shown.
 */
export interface EnvelopeSheet {
  kind: ModeKind;
  name: string;
  lines: EnvelopeLine[];
  verb: string;
  /** Always present, always true. Stated on the sheet so the person reads it before starting. */
  exit: "You can leave at any moment. Leaving is recorded, not punished.";
  digest: string;
}

const VERBS: Record<ModeKind, string> = {
  focus_contract: "Begin focus",
  serendipity: "Allow surprises",
  recovery: "Take the break",
  discovery: "Start exploring",
  sealed_session: "Seal the session",
};

export function describeEnvelope(kind: ModeKind, input: ModeEnvelopeInput): EnvelopeSheet {
  const e = ModeEnvelopeSchema.parse(input);
  const lines: EnvelopeLine[] = [
    { label: "Duration", value: `${e.durationMinutes} min` },
  ];
  if (e.restrictions.length > 0) {
    lines.push({ label: "While it runs", value: e.restrictions.join(" · ") });
  }
  if (e.windows.length > 0) {
    lines.push({ label: "Windows", value: e.windows.map((w) => `${w.start}–${w.end}`).join(", ") });
  }
  if (e.maxFrequencyPerDay > 0) {
    lines.push({ label: "At most", value: `${e.maxFrequencyPerDay} offer${e.maxFrequencyPerDay === 1 ? "" : "s"} a day` });
  }
  if (e.categories.length > 0) {
    lines.push({ label: "Drawn from", value: e.categories.join(", ") });
  }
  if (kind === "sealed_session") {
    // What is recorded is said before it is recorded; what is not is said too.
    lines.push({ label: "Remote models", value: e.remoteModels ? "allowed" : "none — local models or nothing; a request that needs a remote model is refused, not sent" });
    lines.push({ label: "Recorded", value: `a heartbeat every ${e.heartbeatSeconds} s with the Object in the centre and its version; every edit's origin (typed, pasted, imported, generated); every model call` });
    lines.push({ label: "Not recorded", value: "your screen, other applications, other machines, the text you type — only that it was typed" });
    lines.push({ label: "Shown to judges", value: "record density: recorded minutes, gaps, unexplained pastes — words and counts, never a score. Leaving early is shown as a fact." });
  }
  lines.push({ label: "Exit", value: "always — Escape, or the Exit control" });
  return {
    kind, name: MODE_NAMES[kind], lines, verb: VERBS[kind],
    exit: "You can leave at any moment. Leaving is recorded, not punished.",
    digest: digestEnvelope(kind, e),
  };
}

export function digestEnvelope(kind: ModeKind, envelope: ModeEnvelope): string {
  return sha256Hex(JSON.stringify({ kind, envelope }));
}

export class EnvelopeNotShown extends Error {
  constructor(kind: ModeKind) {
    super(`A ${MODE_NAMES[kind]} cannot start from an envelope that was not shown. ` +
      "Render the sheet, then start with its digest.");
    this.name = "EnvelopeNotShown";
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Rhythm — rewards matched from the graph, cadence predictable, content the surprise           */
/* ------------------------------------------------------------------------------------------ */

export const REWARD_KINDS = ["open_question", "review_due", "cited_author", "inspiration"] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

/**
 * A reward is a Living Object the graph already holds, matched to what the person is doing.
 * Unrelated material is the abandonment signal itself, so nothing here is drawn from outside
 * the person's own work.
 */
export interface Reward {
  kind: RewardKind;
  objectId: string;
  label: string;
  /** Why this may connect to the focus — from the two subjects, in words, never a score. */
  whyItMayConnect: string;
  /** Inspiration Objects terminate: the same pair is never offered twice. */
  terminates: boolean;
}

export interface RhythmConfig {
  /** Off by default. A person turns rhythm on by starting a mode that carries it. */
  enabled: boolean;
  /** Minutes between offers when nothing has been skipped. Predictable, never tuned. */
  cadenceMinutes: number;
  /** Each skip multiplies the cadence by this. Skipping is a move; it makes offers rarer. */
  skipLengthens: number;
  /** The cadence never grows past this. */
  maxCadenceMinutes: number;
  streak: {
    /** Missed days that do not break a streak. One: a day off is not a failure. */
    forgivenessDays: number;
  };
}

export const RhythmConfigSchema = z.object({
  enabled: z.boolean(),
  cadenceMinutes: z.number().positive(),
  skipLengthens: z.number().min(1),
  maxCadenceMinutes: z.number().positive(),
  streak: z.object({ forgivenessDays: z.number().int().min(0).max(3) }).strict(),
}).strict();

/** The verbs that count. Becoming, not activity: something exists afterwards that did not before. */
export const BECOMING = [
  "claim_accepted", "decision_made", "rebuild_run", "disagreement_recorded", "delivery_approved",
] as const;
export type Becoming = (typeof BECOMING)[number];

export interface Streak {
  /** Consecutive days, counting today if something became today. */
  days: number;
  /** Whether today already counts. */
  todayCounts: boolean;
  /** What became on the most recent counted day. */
  lastBecoming: Becoming | null;
  /** The sentence for Today. */
  summary: string;
}
