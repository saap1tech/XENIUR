import type { TrailRow } from "@xeniur/core";
import { newId, now } from "@xeniur/core";
import type { Db } from "./db.js";

/** Writes and reads Agent Trail rows. Columns fill left to right and never out of order. */
export class TrailStore {
  constructor(private readonly db: Db) {}

  /** A new row: something was compiled for the model to see. */
  saw(input: { worldId: string; objectId: string | null; intent: string; digest: string | null; included: number; excluded: number }): TrailRow {
    const id = newId();
    this.db.prepare(
      `INSERT INTO agent_trail (id, world_id, object_id, intent, saw_digest, saw_included, saw_excluded, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.worldId, input.objectId, input.intent, input.digest, input.included, input.excluded, now());
    return this.get(id)!;
  }

  decided(id: string, kind: string, model: string | null): TrailRow | null {
    this.db.prepare(`UPDATE agent_trail SET decided = ?, decided_model = ? WHERE id = ? AND decided IS NULL`).run(kind, model, id);
    return this.get(id);
  }

  /** Only after a decision; a plan that was never decided upon cannot have been authorised. */
  authorized(id: string, planDigest: string, level: string): TrailRow | null {
    this.db.prepare(
      `UPDATE agent_trail SET authorized_digest = ?, authorized_level = ? WHERE id = ? AND decided IS NOT NULL AND authorized_digest IS NULL`,
    ).run(planDigest, level, id);
    return this.get(id);
  }

  /** Only after authorisation. */
  executed(id: string, actionId: string, outcome: string): TrailRow | null {
    this.db.prepare(
      `UPDATE agent_trail SET executed_action_id = ?, executed_outcome = ? WHERE id = ? AND authorized_digest IS NOT NULL AND executed_action_id IS NULL`,
    ).run(actionId, outcome, id);
    return this.get(id);
  }

  get(id: string): TrailRow | null {
    const r = this.db.prepare(`SELECT * FROM agent_trail WHERE id = ?`).get(id) as Row | undefined;
    return r ? fromRow(r) : null;
  }

  forObject(objectId: string, limit = 100): TrailRow[] {
    return (this.db.prepare(`SELECT * FROM agent_trail WHERE object_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`)
      .all(objectId, limit) as Row[]).map(fromRow);
  }

  forWorld(worldId: string, limit = 200): TrailRow[] {
    return (this.db.prepare(`SELECT * FROM agent_trail WHERE world_id = ? ORDER BY at DESC, rowid DESC LIMIT ?`)
      .all(worldId, limit) as Row[]).map(fromRow);
  }
}

type Row = {
  id: string; world_id: string; object_id: string | null; intent: string;
  saw_digest: string | null; saw_included: number; saw_excluded: number;
  decided: string | null; decided_model: string | null;
  authorized_digest: string | null; authorized_level: string | null;
  executed_action_id: string | null; executed_outcome: string | null; at: number;
};
const fromRow = (r: Row): TrailRow => ({
  id: r.id, worldId: r.world_id, objectId: r.object_id, intent: r.intent,
  saw: r.saw_digest ? { digest: r.saw_digest, included: r.saw_included, excluded: r.saw_excluded } : null,
  decided: r.decided ? { kind: r.decided, model: r.decided_model } : null,
  authorized: r.authorized_digest ? { planDigest: r.authorized_digest, level: r.authorized_level ?? "" } : null,
  executed: r.executed_action_id ? { actionId: r.executed_action_id, outcome: r.executed_outcome ?? "unknown" } : null,
  at: r.at,
});
