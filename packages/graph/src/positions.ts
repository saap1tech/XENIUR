import type { WorkPosition, WorkPositionInput } from "@xeniur/core";
import { WorkPositionSchema, now } from "@xeniur/core";
import type { Db } from "./db.js";

/** One position per World: where the person was, exactly. Nothing here is a permission. */
export class PositionStore {
  constructor(private readonly db: Db) {}

  save(input: Omit<WorkPositionInput, "savedAt">): WorkPosition {
    const p = WorkPositionSchema.parse({ ...input, savedAt: now() });
    this.db.prepare(
      `INSERT INTO work_positions (world_id, goal_id, plan_revision, step_id, object_id, form_role, zone, tab_ids, pending_review_id, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(world_id) DO UPDATE SET goal_id = excluded.goal_id, plan_revision = excluded.plan_revision, step_id = excluded.step_id,
         object_id = excluded.object_id, form_role = excluded.form_role, zone = excluded.zone, tab_ids = excluded.tab_ids,
         pending_review_id = excluded.pending_review_id, saved_at = excluded.saved_at`,
    ).run(p.worldId, p.goalId, p.planRevision, p.stepId, p.objectId, p.formRole, p.zone, JSON.stringify(p.tabIds), p.pendingReviewId, p.savedAt);
    return p;
  }

  get(worldId: string): WorkPosition | null {
    const r = this.db.prepare(`SELECT * FROM work_positions WHERE world_id = ?`).get(worldId) as Row | undefined;
    return r ? WorkPositionSchema.parse({
      worldId: r.world_id, goalId: r.goal_id, planRevision: r.plan_revision, stepId: r.step_id, objectId: r.object_id,
      formRole: r.form_role, zone: r.zone, tabIds: JSON.parse(r.tab_ids), pendingReviewId: r.pending_review_id, savedAt: r.saved_at,
    }) : null;
  }
}

type Row = { world_id: string; goal_id: string | null; plan_revision: number | null; step_id: string | null; object_id: string | null;
  form_role: string | null; zone: string | null; tab_ids: string; pending_review_id: string | null; saved_at: number };
