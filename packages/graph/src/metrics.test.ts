import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetricsStore, ObjectGraph } from "./index.js";

let dir: string, g: ObjectGraph, metrics: MetricsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-metrics-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  metrics = new MetricsStore(g.db);
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("what XENIUR records about your own use of it", () => {
  it("records nothing at all outside a session", () => {
    metrics.record("first_import");
    expect(metrics.events()).toHaveLength(0);
  });

  it("strips anything that could be a title, a path or your text", () => {
    metrics.start();
    metrics.record("delivery_approved", { detail: {
      profileId: "client",                                  // kept: an id
      steps: 4,                                             // kept: a count
      reversible: true,                                     // kept: a fact
      title: "Client Product 04 — final hero render",       // dropped: their work
      path: "/Users/someone/Desktop/client/final.blend",    // dropped: their machine
      note: "the client hated the first one",               // dropped: their words
    } });

    const event = metrics.events().find((e) => e.kind === "delivery_approved")!;
    expect(Object.keys(event.detail).sort()).toEqual(["profileId", "reversible", "steps"]);
    expect(metrics.disclose().containsNoContent).toBe(true);
  });

  it("shows every kind it stored, in the words it will be shown in", () => {
    metrics.start();
    metrics.record("first_import");
    metrics.record("decision_accepted");
    metrics.record("decision_accepted");

    const disclosure = metrics.disclose();
    expect(disclosure.events).toBe(4);   // the three, plus session_started
    const accepted = disclosure.kinds.find((k) => k.kind === "decision_accepted")!;
    expect(accepted.count).toBe(2);
    expect(accepted.means).toBe("you accepted a decision");
    // Every stored kind is explained; nothing is recorded that cannot be described.
    expect(disclosure.kinds.every((k) => k.means.length > 0)).toBe(true);
  });

  it("times the second delivery from the change that started it, not from the first", () => {
    metrics.start();
    const at = (kind: Parameters<MetricsStore["record"]>[0], t: number) => {
      metrics.record(kind);
      const rows = g.db.prepare(`SELECT id FROM session_events ORDER BY rowid DESC LIMIT 1`)
        .get() as { id: string };
      g.db.prepare(`UPDATE session_events SET at = ? WHERE id = ?`).run(t, rows.id);
    };

    at("first_import", 1_000);
    at("delivery_approved", 11_000);      // first delivery took 10s
    at("source_changed", 500_000);        // a week later, in effect
    at("impact_reviewed", 501_000);
    at("rebuild_run", 502_000);
    at("delivery_approved", 504_000);     // second delivery took 4s

    const r = metrics.revision();
    expect(r.deliveries).toBe(2);
    expect(r.firstDeliveryMs).toBe(10_000);
    // The week in between is a person living their life, and counting it would measure
    // how busy they were rather than whether the workspace helped.
    expect(r.secondDeliveryMs).toBe(4_000);
    expect(r.fasterBy).toBe(6_000);
    expect(r.reviewedImpactFirst).toBe(true);
  });

  it("notices when somebody rebuilt without looking at what changed", () => {
    metrics.start();
    metrics.record("rebuild_run");
    expect(metrics.revision().reviewedImpactFirst).toBe(false);
  });

  it("writes a summary only when asked, and says so in the summary", () => {
    metrics.start();
    metrics.record("first_import");
    const summary = metrics.exportSummary();
    expect(summary).toContain("Contains no titles, text or paths: yes");
    expect(summary).toContain("only because you asked for it");
    expect(summary).toContain("has no code that could send it");
    // The export is the same data the disclosure view shows.
    expect(summary).toContain("you brought the first thing into a project");
  });

  it("records the concept for typed fallback and never the words typed", () => {
    metrics.start();
    metrics.record("gesture_used", { detail: { concept: "relationship" } });
    metrics.record("typed_instead", { detail: {
      concept: "cost", typed: "under 1200 near Shinjuku", title: "Tokyo launch",
    } });
    const disclosure = metrics.disclose();
    expect(disclosure.visualPaths.gestureUsed).toBe(1);
    expect(disclosure.visualPaths.typedInstead).toBe(1);
    expect(disclosure.visualPaths.byConcept).toEqual({ cost: 1 });
    const typed = metrics.events().find((event) => event.kind === "typed_instead")!;
    expect(typed.detail).toEqual({ concept: "cost" });
  });
});

describe("a metrics export cannot carry a credential", () => {
  it("strips a key-shaped detail on the way in, and the export checks again anyway", () => {
    metrics.start();
    metrics.record("delivery_approved", { detail: {
      profileId: "client",
      note: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",   // dropped: free text
    } });
    const event = metrics.events().find((e) => e.kind === "delivery_approved")!;
    expect(Object.keys(event.detail)).toEqual(["profileId"]);
    expect(() => metrics.exportSummary()).not.toThrow();
    expect(metrics.exportSummary()).not.toContain("sk-ant");
  });
});
