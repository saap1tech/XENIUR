import type { PermissionLevel, Task, TaskEvent, Tool } from "@xeniur/core";
import { isApprovalRequired } from "@xeniur/core";
import type { Db } from "@xeniur/graph";
import { TaskStore } from "./store.js";

export interface TaskContext {
  readonly task: Task;
  readonly signal: AbortSignal;
  /** True once a person has explicitly approved this task's parked action. */
  readonly approved: boolean;
  progress(fraction: number, detail?: string): void;
  log(message: string): void;
}

export type TaskHandler = (ctx: TaskContext) => Promise<void>;
export type TaskListener = (event: TaskEvent, task: Task) => void;

export interface QueueOptions { concurrency?: number; }

/**
 * A persistent worker queue backed by the same SQLite database as the graph.
 * No Redis, no Kubernetes, no orchestration platform — those are worth their cost only
 * once usage demands them, and V1 has to prove the paradigm first.
 *
 * "Generate 3D Rocket", "Build Asteroid Game" and "Create Rainwear Deck" progress
 * independently here while the World stays interactive.
 */
export class TaskQueue {
  private readonly store: TaskStore;
  private readonly handlers = new Map<Tool, TaskHandler>();
  private readonly listeners = new Set<TaskListener>();
  private readonly running = new Map<string, AbortController>();
  private readonly concurrency: number;
  private started = false;
  private pumping = false;

  constructor(db: Db, opts: QueueOptions = {}) {
    this.store = new TaskStore(db);
    this.concurrency = Math.max(1, opts.concurrency ?? 3);
  }

  register(tool: Tool, handler: TaskHandler): void { this.handlers.set(tool, handler); }

  subscribe(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(taskId: string, type: TaskEvent["type"], payload: Record<string, unknown> = {}): void {
    const event = this.store.appendEvent(taskId, type, payload);
    const task = this.store.get(taskId);
    if (!task) return;
    for (const l of this.listeners) {
      try { l(event, task); } catch { /* a bad listener must not take down the queue */ }
    }
  }

  /** Requeues anything left mid-flight by a crash, then begins dispatching. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const orphan of this.store.recoverOrphans()) {
      this.emit(orphan.id, "queued", { recovered: true });
    }
    void this.pump();
  }

  async stop(): Promise<void> {
    this.started = false;
    for (const c of this.running.values()) c.abort();
    this.running.clear();
  }

  enqueue(input: { worldId: string; title: string; tool: Tool; payload?: Record<string, unknown> }): Task {
    const task = this.store.create(input);
    this.emit(task.id, "queued");
    void this.pump();
    return task;
  }

  cancel(taskId: string): void {
    this.running.get(taskId)?.abort();
    this.store.update(taskId, { status: "cancelled", detail: "cancelled" });
    this.emit(taskId, "cancelled");
  }

  /**
   * Resumes a task parked at needs_approval. The approval is recorded in the payload so
   * the handler can see it — and so the record of who said yes survives a restart.
   */
  approve(taskId: string): void {
    const task = this.store.get(taskId);
    if (!task || task.status !== "needs_approval") return;
    this.store.update(taskId, {
      status: "queued", detail: null,
      payload: { ...task.payload, __approved: true, __approvedAt: Date.now() },
    });
    this.emit(taskId, "queued", { approved: true });
    void this.pump();
  }

  reject(taskId: string): void {
    const task = this.store.get(taskId);
    if (!task || task.status !== "needs_approval") return;
    this.store.update(taskId, { status: "cancelled", detail: "declined" });
    this.emit(taskId, "cancelled", { declined: true });
  }

  get tasks(): TaskStore { return this.store; }
  get inFlight(): number { return this.running.size; }

  /** Resolves once nothing is queued or running. Test and shutdown helper. */
  async drain(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const counts = this.store.countByStatus();
      if (counts.queued === 0 && counts.running === 0 && this.running.size === 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("queue did not drain in time");
  }

  private async pump(): Promise<void> {
    if (this.pumping || !this.started) return;
    this.pumping = true;
    try {
      while (this.started && this.running.size < this.concurrency) {
        const task = this.store.claimNext();
        if (!task) break;
        void this.run(task);
      }
    } finally { this.pumping = false; }
  }

  private async run(task: Task): Promise<void> {
    const controller = new AbortController();
    this.running.set(task.id, controller);
    this.emit(task.id, "running");

    const ctx: TaskContext = {
      task, signal: controller.signal,
      approved: task.payload["__approved"] === true,
      progress: (fraction, detail) => {
        const clamped = Math.max(0, Math.min(1, fraction));
        this.store.update(task.id, { progress: clamped, detail: detail ?? null });
        this.emit(task.id, "progress", { progress: clamped, detail: detail ?? null });
      },
      log: (message) => { this.emit(task.id, "log", { message }); },
    };

    try {
      const handler = this.handlers.get(task.tool);
      if (!handler) throw new Error(`no handler registered for tool "${task.tool}"`);
      await handler(ctx);
      if (controller.signal.aborted) return;
      this.store.update(task.id, { status: "completed", progress: 1, error: null });
      this.emit(task.id, "completed");
    } catch (err) {
      if (controller.signal.aborted) return;
      if (isApprovalRequired(err)) {
        // Not a failure. The work is correct and waiting on a person.
        const level: PermissionLevel = err.level;
        this.store.update(task.id, {
          status: "needs_approval", detail: err.preview,
          payload: { ...task.payload, __preview: err.preview, __level: level, __detail: err.detail },
        });
        this.emit(task.id, "needs_approval", { preview: err.preview, level, detail: err.detail });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.store.update(task.id, { status: "failed", error: message });
      this.emit(task.id, "failed", { error: message });
    } finally {
      this.running.delete(task.id);
      void this.pump();
    }
  }
}
