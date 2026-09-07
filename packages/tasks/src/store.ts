import type { Task, TaskEvent, TaskStatus, Tool } from "@xeniur/core";
import { newId, now } from "@xeniur/core";
import { json, rows, type Db } from "@xeniur/graph";

/** Persistence for the queue. Tasks survive a crash because they are rows, not memory. */
export class TaskStore {
  constructor(private readonly db: Db) {}

  create(input: { worldId: string; title: string; tool: Tool; payload?: Record<string, unknown> }): Task {
    const t = now();
    const task: Task = {
      id: newId(), worldId: input.worldId, title: input.title, status: "queued",
      tool: input.tool, payload: input.payload ?? {}, progress: 0, detail: null,
      error: null, attempts: 0, createdAt: t, updatedAt: t,
    };
    this.db.prepare(
      `INSERT INTO tasks (id, world_id, title, status, tool, payload, progress, detail,
                          error, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(task.id, task.worldId, task.title, task.status, task.tool,
          json.stringify(task.payload), 0, null, null, 0, t, t);
    return task;
  }

  get(id: string): Task | null {
    const r = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as rows.TaskRow | undefined;
    return r ? rows.toTask(r) : null;
  }

  list(worldId?: string): Task[] {
    const rs = worldId
      ? this.db.prepare(`SELECT * FROM tasks WHERE world_id = ? ORDER BY created_at DESC, rowid DESC`).all(worldId)
      : this.db.prepare(`SELECT * FROM tasks ORDER BY created_at DESC, rowid DESC`).all();
    return (rs as rows.TaskRow[]).map(rows.toTask);
  }

  /** The Active area on the Home screen: everything not yet finished. */
  active(): Task[] {
    return (this.db.prepare(
      `SELECT * FROM tasks WHERE status IN ('queued','running','needs_approval')
       ORDER BY created_at DESC, rowid DESC`,
    ).all() as rows.TaskRow[]).map(rows.toTask);
  }

  claimNext(): Task | null {
    const r = this.db.prepare(
      `SELECT * FROM tasks WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1`,
    ).get() as rows.TaskRow | undefined;
    if (!r) return null;
    const changed = this.db.prepare(
      `UPDATE tasks SET status = 'running', attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    ).run(now(), r.id);
    if (changed.changes === 0) return null;   // lost the race to another worker
    return this.get(r.id);
  }

  update(id: string, patch: Partial<Pick<Task, "status" | "progress" | "detail" | "error" | "payload">>): void {
    const t = this.get(id);
    if (!t) return;
    this.db.prepare(
      `UPDATE tasks SET status = ?, progress = ?, detail = ?, error = ?, payload = ?, updated_at = ?
       WHERE id = ?`,
    ).run(patch.status ?? t.status, patch.progress ?? t.progress,
          patch.detail === undefined ? t.detail : patch.detail,
          patch.error === undefined ? t.error : patch.error,
          json.stringify(patch.payload ?? t.payload), now(), id);
  }

  /**
   * A task that was mid-flight when the process died is requeued, not lost and not
   * silently marked done. Handlers must therefore tolerate being run twice.
   */
  recoverOrphans(): Task[] {
    const orphans = (this.db.prepare(`SELECT * FROM tasks WHERE status = 'running'`)
      .all() as rows.TaskRow[]).map(rows.toTask);
    this.db.prepare(`UPDATE tasks SET status = 'queued', updated_at = ? WHERE status = 'running'`)
      .run(now());
    return orphans;
  }

  appendEvent(taskId: string, type: TaskEvent["type"], payload: Record<string, unknown> = {}): TaskEvent {
    const ev: TaskEvent = { id: newId(), taskId, type, payload, createdAt: now() };
    this.db.prepare(
      `INSERT INTO task_events (id, task_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(ev.id, ev.taskId, ev.type, json.stringify(ev.payload), ev.createdAt);
    return ev;
  }

  /**
   * Ordered by rowid, not by created_at. Timestamps are millisecond-resolution, so a
   * fast task emits several events within one tick; sorting by (created_at, uuid) then
   * falls back to random order and the event stream arrives scrambled. rowid is
   * SQLite's insertion counter and is the only monotonic thing on the row.
   */
  events(taskId: string): TaskEvent[] {
    return (this.db.prepare(
      `SELECT * FROM task_events WHERE task_id = ? ORDER BY rowid`,
    ).all(taskId) as rows.TaskEventRow[]).map(rows.toTaskEvent);
  }

  countByStatus(): Record<TaskStatus, number> {
    const out = { queued: 0, running: 0, needs_approval: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const r of this.db.prepare(`SELECT status, COUNT(*) AS n FROM tasks GROUP BY status`)
      .all() as Array<{ status: TaskStatus; n: number }>) out[r.status] = r.n;
    return out;
  }
}
