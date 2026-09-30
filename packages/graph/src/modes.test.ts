import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvelopeNotShown, describeEnvelope, type ModeEnvelopeInput, type RhythmConfig } from "@xeniur/core";
import { ObjectGraph, RhythmStore, insideWindows, loadRhythmConfig, nextOfferAt } from "./index.js";

let dir: string, g: ObjectGraph, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-modes-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Rainwear", emoji: "R" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const FOCUS: ModeEnvelopeInput = {
  durationMinutes: 25, restrictions: ["no task toasts", "no suggestions"], exitPolicy: "always",
};

describe("a mode is a contract the person read", () => {
  it("does not start from an envelope whose sheet was not shown", () => {
    expect(() => g.modes.start({ kind: "focus_contract", envelope: FOCUS, sheetDigest: "not-a-sheet", worldId }))
      .toThrow(EnvelopeNotShown);
    // A sheet for a *different* envelope does not count either.
    const other = describeEnvelope("focus_contract", { ...FOCUS, durationMinutes: 50 });
    expect(() => g.modes.start({ kind: "focus_contract", envelope: FOCUS, sheetDigest: other.digest, worldId }))
      .toThrow(EnvelopeNotShown);
    expect(g.modes.active()).toHaveLength(0);          // nothing written
  });

  it("renders the sheet with restrictions, the exit, and a verb that is not OK", () => {
    const sheet = describeEnvelope("focus_contract", FOCUS);
    expect(sheet.lines.map((l) => l.label)).toEqual(["Duration", "While it runs", "Exit"]);
    expect(sheet.lines[1]!.value).toBe("no task toasts · no suggestions");
    expect(sheet.verb).toBe("Begin focus");
    expect(sheet.verb).not.toMatch(/^ok$/i);
    expect(sheet.exit).toContain("leave at any moment");
    const m = g.modes.start({ kind: "focus_contract", envelope: FOCUS, sheetDigest: sheet.digest, worldId });
    expect(m.exitReason).toBeNull();
    expect(g.modes.active("focus_contract").map((x) => x.id)).toEqual([m.id]);
  });

  it("enforces restrictions only while running", () => {
    expect(g.modes.restrictions()).toEqual([]);
    const sheet = describeEnvelope("focus_contract", FOCUS);
    const m = g.modes.start({ kind: "focus_contract", envelope: FOCUS, sheetDigest: sheet.digest, worldId });
    expect(g.modes.restrictions()).toEqual(["no task toasts", "no suggestions"]);
    g.modes.end(m.id, "left");
    expect(g.modes.restrictions()).toEqual([]);
  });

  it("has an emergency exit from every kind, recorded and not punished", () => {
    for (const kind of ["focus_contract", "serendipity", "recovery", "discovery"] as const) {
      const env: ModeEnvelopeInput = { durationMinutes: 30, exitPolicy: "always" };
      const m = g.modes.start({ kind, envelope: env, sheetDigest: describeEnvelope(kind, env).digest, worldId });
      const out = g.modes.emergencyExit(m.id)!;
      expect(out.exitReason).toBe("emergency");
      expect(out.endedAt).not.toBeNull();
      expect(g.modes.active(kind)).toHaveLength(0);
    }
    // The record is a fact about the day; nothing else changes.
    expect(g.modes.history(worldId).every((m) => m.exitReason === "emergency")).toBe(true);
  });

  it("completes a mode past its duration when read, without a clock", () => {
    const env: ModeEnvelopeInput = { durationMinutes: 1, exitPolicy: "always" };
    const m = g.modes.start({ kind: "recovery", envelope: env, sheetDigest: describeEnvelope("recovery", env).digest, worldId });
    g.db.prepare(`UPDATE modes SET started_at = ? WHERE id = ?`).run(Date.now() - 2 * 60_000, m.id);
    expect(g.modes.active("recovery")).toHaveLength(0);
    expect(g.modes.get(m.id)!.exitReason).toBe("completed");
  });

  it("keeps the resume slot so Recovery ends where the person was", () => {
    const obj = g.createObject({ worldId, semanticType: "prop", title: "Rocket" }).object.id;
    const env: ModeEnvelopeInput = { durationMinutes: 10, exitPolicy: "always", resumeObjectId: obj };
    const m = g.modes.start({ kind: "recovery", envelope: env, sheetDigest: describeEnvelope("recovery", env).digest, worldId });
    expect(g.modes.end(m.id, "completed")!.envelope.resumeObjectId).toBe(obj);
  });
});

const CFG: RhythmConfig = { enabled: true, cadenceMinutes: 90, skipLengthens: 1.5, maxCadenceMinutes: 480,
  streak: { forgivenessDays: 1 } };

describe("rhythm: cadence predictable, content the surprise", () => {
  it("ships with a fixed cadence and never interrupts a mode-less session", () => {
    expect(loadRhythmConfig(process.cwd()).enabled).toBe(true);
    expect(new RhythmStore(g.db, g, g.modes, CFG).due().due).toBe(false);
  });

  it("offers a project question only at a breakpoint after the cadence", () => {
    const rhythm = new RhythmStore(g.db, g, g.modes, CFG);
    const started = g.getWorld(worldId)!.createdAt;
    const question = g.createObject({ worldId, semanticType: "atom", title: "Which fabric lasts longer?" }).object.id;
    g.db.prepare(`INSERT INTO atoms (object_id, atom_type, lane, stated_at) VALUES (?, 'question', 'question', ?)`).run(question, started);
    expect(rhythm.offerAtBreakpoint({ worldId, objectId: question }, started + 89 * 60_000)).toBeNull();
    const offer = rhythm.offerAtBreakpoint({ worldId, objectId: question }, started + 91 * 60_000);
    expect(offer?.reward.objectId).toBe(question);
    expect(offer?.reward.kind).toBe("open_question");
    expect(rhythm.offerAtBreakpoint({ worldId, objectId: question }, started + 100 * 60_000)).toBeNull();
  });

  it("lengthens the cadence on every skip and caps it", () => {
    const t0 = 1_000_000;
    expect(nextOfferAt(null, 0, CFG)).toBe(0);
    expect(nextOfferAt(t0, 0, CFG)).toBe(t0 + 90 * 60_000);
    expect(nextOfferAt(t0, 1, CFG)).toBe(t0 + 135 * 60_000);
    expect(nextOfferAt(t0, 2, CFG)).toBe(t0 + 202.5 * 60_000);
    expect(nextOfferAt(t0, 10, CFG)).toBe(t0 + 480 * 60_000);
  });

  it("respects windows, including overnight ones", () => {
    const at = new Date(2026, 8, 16, 14, 30).getTime();
    expect(insideWindows([], at)).toBe(true);
    expect(insideWindows([{ start: "09:00", end: "17:00" }], at)).toBe(true);
    expect(insideWindows([{ start: "18:00", end: "20:00" }], at)).toBe(false);
    expect(insideWindows([{ start: "22:00", end: "06:00" }], new Date(2026, 8, 16, 23, 0).getTime())).toBe(true);
  });

  it("offers nothing unless a mode is on, and only what the graph holds about the focus", () => {
    const rhythm = new RhythmStore(g.db, g, g.modes, CFG);
    expect(rhythm.due()).toEqual({ due: false, reason: "no mode is running" });
    expect(rhythm.offer({ worldId, objectId: null })).toBeNull();

    const env: ModeEnvelopeInput = { durationMinutes: 120, exitPolicy: "always", maxFrequencyPerDay: 2 };
    g.modes.start({ kind: "serendipity", envelope: env, sheetDigest: describeEnvelope("serendipity", env).digest, worldId });
    // Due, but an empty World has no reward — silence, not filler.
    expect(rhythm.due().due).toBe(true);
    expect(rhythm.offer({ worldId, objectId: null })).toBeNull();

    // An open question in this World is a reward.
    const q = g.createObject({ worldId, semanticType: "atom", title: "Why did colour stop mattering above €80?" }).object.id;
    g.db.prepare(`INSERT INTO atoms (object_id, atom_type, lane, stated_at) VALUES (?, 'question', 'question', ?)`).run(q, Date.now());
    const offer = rhythm.offer({ worldId, objectId: null })!;
    expect(offer.reward.kind).toBe("open_question");
    expect(offer.reward.objectId).toBe(q);
    expect(offer.reward.whyItMayConnect).toMatch(/still open/);

    // Cadence: nothing more until 90 minutes pass; a skip makes it 135.
    expect(rhythm.due()).toEqual({ due: false, reason: "cadence has not elapsed" });
    rhythm.resolve(offer.id, "skipped");
    expect(rhythm.consecutiveSkips()).toBe(1);
    const later = offer.offeredAt + 100 * 60_000;
    expect(rhythm.due(later).due).toBe(false);
    expect(rhythm.due(offer.offeredAt + 136 * 60_000).due).toBe(true);
  });

  it("an Inspiration says why it may connect and is offered once", () => {
    const rhythm = new RhythmStore(g.db, g, g.modes, CFG);
    const focus = g.createObject({ worldId, semanticType: "prop", title: "Rocket", properties: { traits: ["printable"] } }).object.id;
    const otherWorld = g.createWorld({ title: "Desk accessory", emoji: "D" }).id;
    const other = g.createObject({ worldId: otherWorld, semanticType: "prop", title: "Pen holder", properties: { traits: ["printable"] } }).object.id;
    const first = rhythm.inspire(focus)!;
    expect(first.objectId).toBe(other);
    expect(first.terminates).toBe(true);
    expect(first.whyItMayConnect).toContain("Pen holder");
    expect(first.whyItMayConnect).toContain("Rocket");
    expect(first.whyItMayConnect).toContain("printable");

    const env: ModeEnvelopeInput = { durationMinutes: 120, exitPolicy: "always" };
    g.modes.start({ kind: "discovery", envelope: env, sheetDigest: describeEnvelope("discovery", env).digest, worldId });
    const offered = rhythm.offer({ worldId, objectId: focus })!;
    expect(offered.reward.kind).toBe("inspiration");
    rhythm.resolve(offered.id, "taken");
    expect(rhythm.inspire(focus)).toBeNull();            // the pair terminates
  });

  it("streaks count becoming, with one day of forgiveness", () => {
    const rhythm = new RhythmStore(g.db, g, g.modes, CFG);
    const DAY = 86_400_000;
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const at = today.getTime();
    expect(rhythm.streak(at).days).toBe(0);
    expect(rhythm.streak(at).summary).toMatch(/No streak yet/);

    const decide = (t: number) => {
      const d = g.decisions.create({ worldId, question: `q${t}`, options: [{ key: "a", label: "A", note: "" }], chosenOption: "a" });
      g.decisions.accept(d.objectId, "me", { skipSteelman: true });
      g.db.prepare(`UPDATE decisions SET accepted_at = ? WHERE object_id = ?`).run(t, d.objectId);
    };
    decide(at - 3 * DAY); decide(at - 2 * DAY);   // gap yesterday, nothing today
    const s = rhythm.streak(at);
    expect(s.days).toBe(2);
    expect(s.todayCounts).toBe(false);
    expect(s.summary).toBe("Streak 2 — a decision or a claim keeps it.");

    decide(at);                                    // today: forgiveness bridged the gap
    expect(rhythm.streak(at).days).toBe(3);
    expect(rhythm.streak(at).todayCounts).toBe(true);

    // One missed day joins (4 days ago bridges to 3); two missed days break (8 and 7 do not join).
    decide(at - 4 * DAY);
    expect(rhythm.streak(at).days).toBe(4);
    decide(at - 8 * DAY); decide(at - 7 * DAY);
    expect(rhythm.streak(at).days).toBe(4);
  });

  it("merely opening the app never counts", () => {
    const rhythm = new RhythmStore(g.db, g, g.modes, CFG);
    g.db.prepare(`INSERT INTO sessions (id, started_at, ended_at, active_ms, waiting_ms, world_id) VALUES ('s', ?, NULL, 99999, 0, ?)`)
      .run(Date.now(), worldId);
    expect(rhythm.streak().days).toBe(0);
  });
});

describe("timing never reads engagement", () => {
  it("the rhythm and mode modules contain no reference to sessions, events, clicks, dwell or return", () => {
    for (const file of ["rhythm.ts", "modes.ts"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      // Everything the metrics layer knows, by name.
      for (const forbidden of [
        "session_events", "SessionEvent", "MetricsStore", "metrics.js", "activeMs", "active_ms",
        "waitingMs", "waiting_ms", "FROM sessions", "dwell", "click", "returned", "gesture_used", "typed_instead",
      ]) {
        expect(src, `${file} must not mention ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
