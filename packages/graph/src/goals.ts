import type { GoalStatus, NextAction, WorkGoal } from "@xeniur/core";
import { WorkGoalSchema, newId, now } from "@xeniur/core";
import type { Db } from "./db.js";
import type { ObjectGraph } from "./graph.js";

/**
 * Goals: one current goal per World, in the person's words.
 *
 * `last_active_at` is the anchor Continue Work reads from; it moves whenever the person
 * changes the goal or touches its focus. Nothing here is generated: `next_actions` are the
 * person's own or proposals they accepted, and `outcome` is stored verbatim.
 */
export class GoalStore {
  constructor(private readonly db: Db, private readonly graph: ObjectGraph) {}

  /** The World's current goal: the most recently active one that is not finished. */
  current(worldId: string): WorkGoal | null {
    const row = this.db.prepare(
      `SELECT * FROM goals WHERE world_id = ? AND status != 'finished' ORDER BY last_active_at DESC LIMIT 1`,
    ).get(worldId) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  get(id: string): WorkGoal | null {
    const row = this.db.prepare(`SELECT * FROM goals WHERE id = ?`).get(id) as Row | undefined;
    return row ? fromRow(row) : null;
  }

  history(worldId: string): WorkGoal[] {
    return (this.db.prepare(`SELECT * FROM goals WHERE world_id = ? ORDER BY created_at DESC`).all(worldId) as Row[]).map(fromRow);
  }

  /** Verbatim. The status defaults to exploring; the focus to whatever is in the centre. */
  create(worldId: string, outcome: string, opts: { focusObjectId?: string | null; status?: GoalStatus; requiredOutputs?: string[] } = {}): WorkGoal {
    const text = outcome.trim();
    if (text.length === 0) throw new Error("a goal is one sentence in your words; it cannot be empty");
    const t = now();
    const id = newId();
    this.db.prepare(
      `INSERT INTO goals (id, world_id, outcome, status, focus_object_id, required_outputs, open_question_ids, next_actions,
                          created_at, updated_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?)`,
    ).run(id, worldId, text.slice(0, 500), opts.status ?? "exploring", opts.focusObjectId ?? null,
      JSON.stringify(opts.requiredOutputs ?? []), t, t, t);
    return this.get(id)!;
  }

  setOutcome(id: string, outcome: string): WorkGoal | null {
    const text = outcome.trim();
    if (text.length === 0) return this.get(id);
    return this.#update(id, `outcome = ?`, [text.slice(0, 500)]);
  }

  /** A status is a way of working the person chose; any transition is allowed, in any order. */
  setStatus(id: string, status: GoalStatus): WorkGoal | null {
    return this.#update(id, `status = ?`, [status]);
  }

  setFocus(id: string, objectId: string | null): WorkGoal | null {
    return this.#update(id, `focus_object_id = ?`, [objectId]);
  }

  setRequiredOutputs(id: string, outputs: string[]): WorkGoal | null {
    return this.#update(id, `required_outputs = ?`, [JSON.stringify([...new Set(outputs)])]);
  }

  addQuestion(id: string, questionAtomId: string): WorkGoal | null {
    const g = this.get(id); if (!g) return null;
    const ids = [...new Set([...g.openQuestionIds, questionAtomId])];
    return this.#update(id, `open_question_ids = ?`, [JSON.stringify(ids)]);
  }

  resolveQuestion(id: string, questionAtomId: string): WorkGoal | null {
    const g = this.get(id); if (!g) return null;
    return this.#update(id, `open_question_ids = ?`, [JSON.stringify(g.openQuestionIds.filter((q) => q !== questionAtomId))]);
  }

  addNextAction(id: string, input: { text: string; objectId?: string | null; tool?: string | null; origin?: NextAction["origin"] }): WorkGoal | null {
    const g = this.get(id); if (!g) return null;
    const action: NextAction = {
      id: newId(), text: input.text.trim().slice(0, 200), objectId: input.objectId ?? null, tool: input.tool ?? null,
      origin: input.origin ?? "person", doneAt: null,
    };
    return this.#update(id, `next_actions = ?`, [JSON.stringify([...g.nextActions, action])]);
  }

  doneNextAction(id: string, actionId: string): WorkGoal | null {
    const g = this.get(id); if (!g) return null;
    const next = g.nextActions.map((a) => (a.id === actionId ? { ...a, doneAt: now() } : a));
    return this.#update(id, `next_actions = ?`, [JSON.stringify(next)]);
  }

  /** The person did something on this goal's World. Continue Work anchors here. */
  touch(worldId: string): void {
    this.db.prepare(
      `UPDATE goals SET last_active_at = ? WHERE id = (
         SELECT id FROM goals WHERE world_id = ? AND status != 'finished' ORDER BY last_active_at DESC LIMIT 1)`,
    ).run(now(), worldId);
  }

  /**
   * The Objects the goal is about — what the centre shows around the focus. The focus, the
   * decisions linked to it, the claims and sources those decisions cite, the required
   * outputs, and whatever a next action names. The rest of the World stays in the rail.
   */
  relevantObjects(id: string): string[] {
    const g = this.get(id); if (!g) return [];
    const out = new Set<string>();
    const add = (x: string | null | undefined) => { if (x && this.graph.getObject(x)) out.add(x); };
    add(g.focusObjectId);
    if (g.focusObjectId) {
      for (const l of this.graph.decisions.linksFrom(g.focusObjectId)) add(l.toObjectId);
      for (const l of this.graph.decisions.linksTo(g.focusObjectId)) add(l.fromObjectId);
    }
    for (const decisionId of [...out]) {
      const rows = this.db.prepare(`SELECT atom_object_id FROM decision_evidence WHERE decision_id = ?`).all(decisionId) as
        Array<{ atom_object_id: string | null }>;
      for (const r of rows) add(r.atom_object_id);
    }
    for (const q of g.openQuestionIds) add(q);
    for (const a of g.nextActions) add(a.objectId);
    for (const r of g.requiredOutputs) {
      if (this.graph.getObject(r)) add(r);
      else {
        // A form role: every Object in the World that carries it.
        const rows = this.db.prepare(
          `SELECT DISTINCT o.id FROM objects o JOIN versions v ON v.id = o.current_version_id
           JOIN version_forms f ON f.version_id = v.id WHERE o.world_id = ? AND f.role = ?`,
        ).all(g.worldId, r) as Array<{ id: string }>;
        for (const row of rows) add(row.id);
      }
    }
    return [...out];
  }

  #update(id: string, set: string, params: unknown[]): WorkGoal | null {
    const t = now();
    this.db.prepare(`UPDATE goals SET ${set}, updated_at = ?, last_active_at = ? WHERE id = ?`).run(...params, t, t, id);
    return this.get(id);
  }
}

type Row = {
  id: string; world_id: string; outcome: string; status: GoalStatus; focus_object_id: string | null;
  required_outputs: string; open_question_ids: string; next_actions: string;
  created_at: number; updated_at: number; last_active_at: number;
};
const fromRow = (r: Row): WorkGoal => WorkGoalSchema.parse({
  id: r.id, worldId: r.world_id, outcome: r.outcome, status: r.status, focusObjectId: r.focus_object_id,
  requiredOutputs: JSON.parse(r.required_outputs), openQuestionIds: JSON.parse(r.open_question_ids),
  nextActions: JSON.parse(r.next_actions), createdAt: r.created_at, updatedAt: r.updated_at, lastActiveAt: r.last_active_at,
});
