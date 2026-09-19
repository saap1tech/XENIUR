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

/* M5 Stage 13 — new kinds, same gate: no row carries content, and no timing reads engagement. */
describe("the M5 kinds pass through the same content-stripping gate", () => {
  const CONTENT = {
    title: "Rainwear 2027 — colour strategy for the Okafor account",
    text: "Consumers prefer orange when price is under €80.",
    path: "/Users/dev/Documents/secret-brief.pdf",
    email: "ana@example.com",
    prompt: "Summarise the attached interview and propose three steps",
  };

  it("keeps the kind, the enum-shaped detail and the counts, and drops every sentence, path and address", () => {
    metrics.start();
    const kinds = [
      "model_routed", "context_reviewed", "context_excluded", "support_reviewed", "proposal_accepted", "proposal_rejected",
      "steelman_recorded", "steelman_skipped", "mode_started", "mode_exited", "mode_emergency_exit",
      "reward_offered", "reward_taken", "reward_skipped", "streak_day", "critique_received", "package_imported", "outreach_sent",
    ] as const;
    for (const kind of kinds) {
      metrics.record(kind, { detail: { ...CONTENT, status: "supported", model: "gpt-4o-mini", escalation: 1, count: 3, ok: true } });
    }
    const rows = metrics.events().filter((r) => r.kind !== "session_started");
    expect(rows.map((r) => r.kind)).toEqual([...kinds]);
    const dump = JSON.stringify(rows);
    for (const leak of Object.values(CONTENT)) expect(dump).not.toContain(leak);
    expect(rows[0]!.detail).toEqual({ status: "supported", model: "gpt-4o-mini", escalation: 1, count: 3, ok: true });
    // And the export, the only way any of this leaves the table, says the same.
    const summary = metrics.exportSummary();
    for (const leak of Object.values(CONTENT)) expect(summary).not.toContain(leak);
  });

  it("every kind has a meaning a person can read beside its count", async () => {
    const { EVENT_MEANINGS, SESSION_EVENT_KINDS } = await import("@xeniur/core");
    for (const kind of SESSION_EVENT_KINDS) expect(EVENT_MEANINGS[kind], kind).toMatch(/\w+ \w+/);
  });
});

describe("the agent trail fills left to right and never out of order", () => {
  it("cannot authorise what was not decided, nor execute what was not authorised", () => {
    const worldId = g.createWorld({ title: "W", emoji: "W" }).id;
    const row = g.trail.saw({ worldId, objectId: null, intent: "research_plan", digest: "d".repeat(64), included: 7, excluded: 2 });
    expect(row.decided).toBeNull();
    // Skipping the decision: nothing happens.
    expect(g.trail.authorized(row.id, "p".repeat(64), "CREATE")!.authorized).toBeNull();
    expect(g.trail.executed(row.id, "no-action", "ok")!.executed).toBeNull();
    // In order: each fills once.
    expect(g.trail.decided(row.id, "gated", null)!.decided).toEqual({ kind: "gated", model: null });
    expect(g.trail.decided(row.id, "executable", "m")!.decided).toEqual({ kind: "gated", model: null });
    expect(g.trail.authorized(row.id, "p".repeat(64), "CREATE")!.authorized).toEqual({ planDigest: "p".repeat(64), level: "CREATE" });
  });
});
