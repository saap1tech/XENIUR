import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalRequired } from "@xeniur/core";
import { ObjectGraph } from "@xeniur/graph";
import { TaskQueue } from "./index.js";

let dir: string, g: ObjectGraph, q: TaskQueue, worldId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-tasks-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "W", emoji: "🌍" }).id;
  q = new TaskQueue(g.db, { concurrency: 3 });
});
afterEach(async () => { await q.stop(); g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("independent progress", () => {
  it("runs unrelated tasks concurrently, as the Active list implies", async () => {
    const order: string[] = [];
    const gate = new Map<string, () => void>();
    q.register("3d.generate", async (ctx) => {
      order.push(`start:${ctx.task.title}`);
      await new Promise<void>((r) => gate.set(ctx.task.title, r));
      order.push(`end:${ctx.task.title}`);
    });
    q.start();

    for (const title of ["Generate 3D Rocket", "Build Asteroid Game", "Create Rainwear Deck"]) {
      q.enqueue({ worldId, title, tool: "3d.generate" });
    }
    await new Promise((r) => setTimeout(r, 60));

    // All three are in flight before any of them finishes.
    expect(order).toEqual([
      "start:Generate 3D Rocket", "start:Build Asteroid Game", "start:Create Rainwear Deck",
    ]);
    expect(q.inFlight).toBe(3);

    for (const release of gate.values()) release();
    await q.drain();
    expect(q.tasks.countByStatus().completed).toBe(3);
  });

  it("respects the concurrency ceiling", async () => {
    const small = new TaskQueue(g.db, { concurrency: 2 });
    let peak = 0, live = 0;
    small.register("image.generate", async () => {
      live += 1; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 20));
      live -= 1;
    });
    small.start();
    for (let i = 0; i < 6; i += 1) small.enqueue({ worldId, title: `t${i}`, tool: "image.generate" });
    await small.drain();
    expect(peak).toBe(2);
    await small.stop();
  });
});

describe("approval parking", () => {
  it("parks at needs_approval instead of failing, and resumes only on an explicit yes", async () => {
    const attempts: boolean[] = [];
    q.register("browser.submit", async (ctx) => {
      attempts.push(ctx.approved);
      if (!ctx.approved) throw new ApprovalRequired("Book court · 5:00 PM · $18", "COMMIT", "Riverside Tennis");
    });
    q.start();
    const task = q.enqueue({ worldId, title: "Book tennis", tool: "browser.submit" });
    await new Promise((r) => setTimeout(r, 40));

    const parked = q.tasks.get(task.id)!;
    expect(parked.status).toBe("needs_approval");
    expect(parked.detail).toBe("Book court · 5:00 PM · $18");
    expect(parked.payload["__level"]).toBe("COMMIT");
    expect(attempts).toEqual([false]);           // it did not proceed

    q.approve(task.id);
    await q.drain();
    expect(attempts).toEqual([false, true]);     // and only then did it
    expect(q.tasks.get(task.id)!.status).toBe("completed");
  });

  it("declining cancels the task and never runs the side effect", async () => {
    let ran = 0;
    q.register("browser.submit", async (ctx) => {
      if (!ctx.approved) throw new ApprovalRequired("Buy · $412", "PURCHASE");
      ran += 1;
    });
    q.start();
    const task = q.enqueue({ worldId, title: "Buy table", tool: "browser.submit" });
    await new Promise((r) => setTimeout(r, 40));
    q.reject(task.id);
    await q.drain();
    expect(q.tasks.get(task.id)!.status).toBe("cancelled");
    expect(ran).toBe(0);
  });
});

describe("durability", () => {
  it("requeues a task that was mid-flight when the process died", async () => {
    const task = q.enqueue({ worldId, title: "interrupted", tool: "3d.generate" });
    g.db.prepare(`UPDATE tasks SET status = 'running' WHERE id = ?`).run(task.id);

    const revived = new TaskQueue(g.db, { concurrency: 1 });
    let ran = false;
    revived.register("3d.generate", async () => { ran = true; });
    revived.start();
    await revived.drain();

    expect(ran).toBe(true);
    expect(revived.tasks.get(task.id)!.status).toBe("completed");
    await revived.stop();
  });

  it("records every status transition as a durable event", async () => {
    q.register("image.generate", async (ctx) => { ctx.progress(0.5, "halfway"); });
    q.start();
    const task = q.enqueue({ worldId, title: "gen", tool: "image.generate" });
    await q.drain();

    const types = q.tasks.events(task.id).map((e) => e.type);
    expect(types).toEqual(["queued", "running", "progress", "completed"]);
  });

  it("surfaces a missing handler as a failure, not a silent hang", async () => {
    q.start();
    const task = q.enqueue({ worldId, title: "orphan", tool: "video.generate" });
    await q.drain();
    const failed = q.tasks.get(task.id)!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("no handler registered");
  });
});
