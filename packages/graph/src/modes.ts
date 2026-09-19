import type { ExitReason, ModeEnvelope, ModeEnvelopeInput, ModeKind, ModeRecord } from "@xeniur/core";
import { EnvelopeNotShown, ModeEnvelopeSchema, digestEnvelope, newId, now } from "@xeniur/core";
import type { Db } from "./db.js";

/**
 * Modes: start, end, emergency exit.
 *
 * A mode is a contract the person set. Its restrictions are rendered before it starts and
 * enforced only while it runs; `restrictions()` therefore returns nothing when nothing is
 * active. The emergency exit is not a feature of some modes — it is the same method for
 * every mode, it asks nothing, and it records the moment as `emergency`, which is a fact
 * about the day and not a judgement about the person.
 */
export class ModeStore {
  constructor(private readonly db: Db) {}

  /**
   * Start a mode from an envelope whose sheet was shown. The digest comes from
   * `describeEnvelope`; a mismatch means the person saw a different envelope than the one
   * being started, and that is refused before any row is written.
   */
  start(input: { kind: ModeKind; envelope: ModeEnvelopeInput; sheetDigest: string; worldId?: string | null }): ModeRecord {
    const envelope = ModeEnvelopeSchema.parse(input.envelope);
    if (digestEnvelope(input.kind, envelope) !== input.sheetDigest) throw new EnvelopeNotShown(input.kind);

    // One running contract of a kind at a time. Starting again ends the previous one as
    // `left`: the person moved on, which is allowed and recorded.
    for (const running of this.active(input.kind)) this.end(running.id, "left");

    const record: ModeRecord = {
      id: newId(), kind: input.kind, envelope, worldId: input.worldId ?? null,
      startedAt: now(), endedAt: null, exitReason: null, sheetDigest: input.sheetDigest,
    };
    this.db.prepare(
      `INSERT INTO modes (id, kind, envelope, sheet_digest, world_id, started_at, ended_at, exit_reason)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(record.id, record.kind, JSON.stringify(envelope), record.sheetDigest, record.worldId, record.startedAt);
    return record;
  }

  /** End a mode with a reason. Ending an already-ended mode is a no-op that returns the record. */
  end(id: string, reason: ExitReason): ModeRecord | null {
    const current = this.get(id);
    if (!current) return null;
    if (current.endedAt !== null) return current;
    this.db.prepare(`UPDATE modes SET ended_at = ?, exit_reason = ? WHERE id = ?`).run(now(), reason, id);
    return this.get(id);
  }

  /**
   * The exit that always exists. No confirmation, no condition, no argument beyond which
   * mode. Available from every mode kind because it is the same method.
   */
  emergencyExit(id: string): ModeRecord | null {
    return this.end(id, "emergency");
  }

  /** Modes past their duration are completed when read, so a clock is never needed to end them. */
  active(kind?: ModeKind): ModeRecord[] {
    const rows = this.db.prepare(
      kind
        ? `SELECT * FROM modes WHERE ended_at IS NULL AND kind = ? ORDER BY started_at`
        : `SELECT * FROM modes WHERE ended_at IS NULL ORDER BY started_at`,
    ).all(...(kind ? [kind] : [])) as Row[];
    const t = now();
    const out: ModeRecord[] = [];
    for (const row of rows) {
      const record = fromRow(row);
      if (record.startedAt + record.envelope.durationMinutes * 60_000 <= t) {
        this.end(record.id, "completed");
        continue;
      }
      out.push(record);
    }
    return out;
  }

  /** Restrictions in force right now. Empty when no mode runs — nothing is enforced by memory. */
  restrictions(): string[] {
    const seen = new Set<string>();
    for (const m of this.active()) for (const r of m.envelope.restrictions) seen.add(r);
    return [...seen];
  }

  /** Seconds left in a running mode; 0 when it has ended. */
  remainingSeconds(id: string): number {
    const m = this.get(id);
    if (!m || m.endedAt !== null) return 0;
    return Math.max(0, Math.round((m.startedAt + m.envelope.durationMinutes * 60_000 - now()) / 1000));
  }

  get(id: string): ModeRecord | null {
    const row = this.db.prepare(`SELECT * FROM modes WHERE id = ?`).get(id) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  history(worldId?: string | null, limit = 50): ModeRecord[] {
    const rows = (worldId
      ? this.db.prepare(`SELECT * FROM modes WHERE world_id = ? ORDER BY started_at DESC LIMIT ?`).all(worldId, limit)
      : this.db.prepare(`SELECT * FROM modes ORDER BY started_at DESC LIMIT ?`).all(limit)) as Row[];
    return rows.map(fromRow);
  }
}

type Row = {
  id: string; kind: ModeKind; envelope: string; sheet_digest: string; world_id: string | null;
  started_at: number; ended_at: number | null; exit_reason: ExitReason | null;
};

function fromRow(r: Row): ModeRecord {
  return {
    id: r.id, kind: r.kind,
    envelope: ModeEnvelopeSchema.parse(JSON.parse(r.envelope)) as ModeEnvelope,
    worldId: r.world_id, startedAt: r.started_at, endedAt: r.ended_at,
    exitReason: r.exit_reason, sheetDigest: r.sheet_digest,
  };
}
