import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RhythmConfig } from "@xeniur/core";
import { ObjectGraph, RhythmStore, todayFor } from "./index.js";

let dir: string, g: ObjectGraph, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-today-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Rainwear 2027", emoji: "R" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const task = (title: string, status: string, level?: string) => g.db.prepare(
  `INSERT INTO tasks (id, world_id, title, status, tool, payload, progress, attempts, created_at, updated_at)
   VALUES (?, ?, ?, ?, 'x', ?, 0, 1, ?, ?)`,
).run(crypto.randomUUID(), worldId, title, status, JSON.stringify(level ? { __level: level } : {}), Date.now(), Date.now());

describe("Today answers what should I do with my time", () => {
  it("is quiet when nothing needs a person — and says so as the product working", () => {
    task("rendering turntable", "running");
    task("exported STL", "completed");
    const t = todayFor(g);
    expect(t.quiet).toBe(true);
    expect(t.rows).toEqual([]);
  });

  it("never shows running or finished work, and puts PURCHASE before CREATE among parked approvals", () => {
    task("rendering", "running"); task("done", "completed"); task("cancelled", "cancelled");
    task("a $0.12 render", "needs_approval", "CREATE");
    task("order the print", "needs_approval", "PURCHASE");
    const t = todayFor(g);
    expect(t.rows.map((r) => r.kind)).toEqual(["parked_approval", "parked_approval"]);
    expect(t.rows[0]!.text).toMatch(/order the print — PURCHASE/);
    expect(JSON.stringify(t.rows)).not.toMatch(/rendering|done|cancelled/);
  });

  it("orders by consequence — approvals, then reviews, then support, then rebuilds — and never by recency", () => {
    const d = g.decisions.create({ worldId, question: "Which finish?", options: [{ key: "a", label: "Matte", note: "" }], chosenOption: "a" });
    g.decisions.accept(d.objectId, "me", { skipSteelman: true });
    g.db.prepare(`UPDATE decisions SET state = 'needs_review' WHERE object_id = ?`).run(d.objectId);
    task("a $0.12 render", "needs_approval", "CREATE");        // added after the decision; still first
    const t = todayFor(g);
    expect(t.rows.map((r) => r.kind)).toEqual(["parked_approval", "decision_review"]);
    expect(t.rows[1]!.text).toContain("Which finish?");
    expect(t.rows[1]!.zone).toBe("decisions");
  });

  it("shows at most seven and counts the rest — nothing is discarded", () => {
    for (let i = 0; i < 10; i += 1) task(`approval ${i}`, "needs_approval", "CREATE");
    const t = todayFor(g);
    expect(t.rows).toHaveLength(7);
    expect(t.more).toBe(3);
  });

  it("carries a streak and a due reward only through rhythm, and only when a mode is on", () => {
    const cfg: RhythmConfig = { enabled: true, cadenceMinutes: 90, skipLengthens: 1.5, maxCadenceMinutes: 480, streak: { forgivenessDays: 1 } };
    const rhythm = new RhythmStore(g.db, g, g.modes, cfg);
    expect(todayFor(g, { rhythm }).rows).toEqual([]);        // no streak, no mode: nothing
    const d = g.decisions.create({ worldId, question: "q", options: [{ key: "a", label: "A", note: "" }], chosenOption: "a" });
    g.decisions.accept(d.objectId, "me", { skipSteelman: true });
    const rows = todayFor(g, { rhythm }).rows;
    expect(rows.map((r) => r.kind)).toEqual(["streak"]);
    expect(rows[0]!.text).toMatch(/Streak 1/);
    expect(rows.some((r) => r.kind === "rhythm")).toBe(false);   // no mode running: no reward row
  });
});
