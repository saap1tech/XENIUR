import type { ModeRecord, SealFacts, SealGap, UnexplainedPaste } from "@xeniur/core";
import { GAP_HEARTBEATS, UNEXPLAINED_PASTE_CHARS, newId, now } from "@xeniur/core";
import type { Db } from "./db.js";
import type { ModeStore } from "./modes.js";

/**
 * The Sealed Session's rows: heartbeats while it runs, and the facts read back from them.
 *
 * This file reads modes, heartbeats, process events and versions. It never reads the metrics
 * layer — a seal is about what was made and when, not about how the person behaved — and a
 * test holds it to that by name.
 */
export class SealStore {
  constructor(private readonly db: Db, private readonly modes: ModeStore) {}

  /** The running Sealed Session, if any. Read on every routing decision; never remembered. */
  active(): ModeRecord | null {
    return this.modes.active("sealed_session")[0] ?? null;
  }

  /** One heartbeat: what is in the centre and at which version. Refused when no seal runs. */
  beat(input: { modeId: string; focusObjectId: string | null; versionId: string | null; at?: number }): void {
    const mode = this.modes.get(input.modeId);
    if (!mode || mode.kind !== "sealed_session" || mode.endedAt !== null) return;
    this.db.prepare(
      `INSERT INTO seal_heartbeats (id, mode_id, at, focus_object_id, version_id) VALUES (?, ?, ?, ?, ?)`,
    ).run(newId(), input.modeId, input.at ?? now(), input.focusObjectId, input.versionId);
  }

  /** Every Sealed Session that named this Object as its entry, most recent first. */
  sessionsFor(entryObjectId: string): ModeRecord[] {
    return this.modes.history(null, 500).filter((m) => m.kind === "sealed_session" && m.envelope.entryObjectId === entryObjectId);
  }

  /** The facts for an entry: the most recent seal that covered it, or null when none did. */
  factsFor(entryObjectId: string): SealFacts | null {
    const mode = this.sessionsFor(entryObjectId)[0];
    return mode ? this.facts(mode.id) : null;
  }

  facts(modeId: string): SealFacts | null {
    const mode = this.modes.get(modeId);
    if (!mode || mode.kind !== "sealed_session") return null;
    const entryObjectId = mode.envelope.entryObjectId ?? "";
    const end = mode.endedAt ?? now();
    const threshold = mode.envelope.heartbeatSeconds * 1000 * GAP_HEARTBEATS;

    const beats = this.db.prepare(
      `SELECT at, version_id FROM seal_heartbeats WHERE mode_id = ? ORDER BY at`,
    ).all(modeId) as Array<{ at: number; version_id: string | null }>;

    // Versions of the entry committed while the mode ran: a gap "changes the version" when one
    // lands inside it, or when the heartbeats on either side name different versions.
    const versions = entryObjectId ? (this.db.prepare(
      `SELECT id, created_at FROM versions WHERE object_id = ? AND created_at >= ? AND created_at <= ? ORDER BY created_at`,
    ).all(entryObjectId, mode.startedAt, end) as Array<{ id: string; created_at: number }>) : [];

    const points = [{ at: mode.startedAt, version_id: null as string | null }, ...beats, { at: end, version_id: null as string | null }];
    const gaps: SealGap[] = [];
    let recorded = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]!, b = points[i]!;
      const span = b.at - a.at;
      if (span > threshold) {
        const changed = (a.version_id !== null && b.version_id !== null && a.version_id !== b.version_id)
          || versions.some((v) => v.created_at > a.at && v.created_at < b.at);
        gaps.push({ from: a.at, to: b.at, minutes: Math.round(span / 60_000), versionChanged: changed });
      } else {
        recorded += span;
      }
    }

    const pastes = entryObjectId ? (this.db.prepare(
      `SELECT id, at, origin_size, origin_source_id FROM process_events
       WHERE object_id = ? AND origin = 'pasted' AND at >= ? AND at <= ? ORDER BY at`,
    ).all(entryObjectId, mode.startedAt, end) as Array<{ id: string; at: number; origin_size: number | null; origin_source_id: string | null }>) : [];
    const unexplainedPastes: UnexplainedPaste[] = pastes
      .filter((p) => (p.origin_size ?? 0) >= UNEXPLAINED_PASTE_CHARS && !p.origin_source_id)
      .map((p) => ({ eventId: p.id, at: p.at, chars: p.origin_size ?? 0 }));

    const modelEvents = entryObjectId ? (this.db.prepare(
      `SELECT COUNT(*) c FROM process_events WHERE object_id = ? AND actor = 'model' AND at >= ? AND at <= ?`,
    ).get(entryObjectId, mode.startedAt, end) as { c: number }).c : 0;

    return {
      modeId, entryObjectId, startedAt: mode.startedAt, endedAt: mode.endedAt, exitReason: mode.exitReason,
      sessionMinutes: Math.round((end - mode.startedAt) / 60_000),
      recordedMinutes: Math.round(recorded / 60_000),
      heartbeats: beats.length, gaps, unexplainedPastes, modelEvents,
      remoteModels: mode.envelope.remoteModels,
    };
  }
}
