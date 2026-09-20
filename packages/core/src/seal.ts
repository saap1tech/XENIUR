/**
 * Sealed Session — what the record can say about how an entry was made, and no more.
 *
 * A Sealed Session records three things while it runs: a heartbeat with the Object in the
 * centre and its version, the origin of every edit, and every model call. From those rows
 * `SealFacts` is read — never inferred. A gap is a span with no heartbeat; a gap across a
 * version change is a span *the record does not say* about. A paste with no Source Object
 * behind it is *unexplained material*. Neither is evidence of a model: a verdict can be
 * lowered to `insufficient_record` by them and can never be raised to `violates`.
 */
export interface SealGap {
  from: number;
  to: number;
  minutes: number;
  /** The entry's version differs on the two sides of the gap: something was made in the dark. */
  versionChanged: boolean;
}

export interface UnexplainedPaste {
  eventId: string;
  at: number;
  chars: number;
}

export interface SealFacts {
  modeId: string;
  entryObjectId: string;
  startedAt: number;
  endedAt: number | null;
  exitReason: "completed" | "left" | "emergency" | null;
  /** Minutes the mode ran, start to end (or now). */
  sessionMinutes: number;
  /** Minutes covered by heartbeats no farther apart than the gap threshold. */
  recordedMinutes: number;
  heartbeats: number;
  gaps: SealGap[];
  unexplainedPastes: UnexplainedPaste[];
  /** Model calls recorded while the mode ran. Counted, not judged here. */
  modelEvents: number;
  remoteModels: boolean;
}

/** A paste at or above this size with no Source Object behind it is unexplained material. */
export const UNEXPLAINED_PASTE_CHARS = 400;
/** A span longer than this many heartbeats is a gap. */
export const GAP_HEARTBEATS = 3;

/** Record density: words and counts for a judge, never a score. */
export interface RecordDensity {
  sessionMinutes: number;
  recordedMinutes: number;
  gaps: number;
  gapsAcrossVersionChange: number;
  unexplainedPastes: number;
  exitReason: SealFacts["exitReason"];
  sentence: string;
}

export function recordDensity(f: SealFacts): RecordDensity {
  const across = f.gaps.filter((g) => g.versionChanged).length;
  const parts = [
    `${f.recordedMinutes} of ${f.sessionMinutes} minutes recorded`,
    f.gaps.length === 0 ? "no gaps" : `${f.gaps.length} gap${f.gaps.length === 1 ? "" : "s"}${across ? ` (${across} across a version change)` : ""}`,
    f.unexplainedPastes.length === 0 ? "no unexplained pastes" : `${f.unexplainedPastes.length} unexplained paste${f.unexplainedPastes.length === 1 ? "" : "s"}`,
    f.exitReason === "emergency" ? "left by the emergency exit" : f.exitReason === "left" ? "left before the end" : f.exitReason === null ? "still running" : "ran to the end",
  ];
  return {
    sessionMinutes: f.sessionMinutes, recordedMinutes: f.recordedMinutes, gaps: f.gaps.length,
    gapsAcrossVersionChange: across, unexplainedPastes: f.unexplainedPastes.length, exitReason: f.exitReason,
    sentence: parts.join(" · "),
  };
}

/** The sentence every judging surface carries. It is a limit, stated, not a disclaimer. */
export const CANNOT_ESTABLISH = "Activity outside the recorded environment is not independently verified.";
