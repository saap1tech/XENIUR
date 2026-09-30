import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Becoming, Reward, RhythmConfig, Streak } from "@xeniur/core";
import { RhythmConfigSchema, newId, now } from "@xeniur/core";
import type { Db } from "./db.js";
import type { ObjectGraph } from "./graph.js";
import type { ModeStore } from "./modes.js";

/**
 * Rhythm — cadence predictable, content the surprise.
 *
 * What survived the replication crisis is the opportunity-cost model: effort feels costly
 * when the brain estimates better uses of the time. You do not restore a resource with a
 * reward; you raise the visible expected value of the current work. So every reward here is
 * drawn from the graph and matched to the focus, and unrelated material never appears.
 *
 * RULE, enforced by a test that reads this file: nothing in this module reads the metrics
 * layer. Timing is a function of the config, the person's own skips, and the clock. It is
 * never tuned. (The test names the forbidden words; this comment cannot, or it would fail.)
 */

export function loadRhythmConfig(rootDir: string): RhythmConfig {
  return RhythmConfigSchema.parse(JSON.parse(readFileSync(join(rootDir, "config", "rhythm.json"), "utf8")));
}

/**
 * When the next offer may come. Pure. Each skip multiplies the cadence; the cap keeps the
 * mode from going silent for a week because somebody said no five times.
 */
export function nextOfferAt(lastOfferedAt: number | null, consecutiveSkips: number, config: RhythmConfig): number {
  if (lastOfferedAt === null) return 0;
  const minutes = Math.min(
    config.cadenceMinutes * Math.pow(config.skipLengthens, consecutiveSkips),
    config.maxCadenceMinutes,
  );
  return lastOfferedAt + minutes * 60_000;
}

/** "HH:MM" inside any window; no windows means always. */
export function insideWindows(windows: Array<{ start: string; end: string }>, at: number): boolean {
  if (windows.length === 0) return true;
  const d = new Date(at);
  const minutes = d.getHours() * 60 + d.getMinutes();
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return windows.some((w) => {
    const a = toMin(w.start), b = toMin(w.end);
    return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;   // overnight window
  });
}

export interface Offer { id: string; modeId: string; reward: Reward; offeredAt: number }

export class RhythmStore {
  constructor(private readonly db: Db, private readonly graph: ObjectGraph, private readonly modes: ModeStore,
              private readonly config: RhythmConfig) {}

  /** Offers the person has skipped in a row, most recent first, stopping at the first take. */
  consecutiveSkips(): number {
    const rows = this.db.prepare(
      `SELECT outcome FROM rhythm_offers WHERE outcome IS NOT NULL ORDER BY offered_at DESC LIMIT 20`,
    ).all() as Array<{ outcome: string }>;
    let n = 0;
    for (const r of rows) { if (r.outcome === "skipped") n += 1; else break; }
    return n;
  }

  lastOfferedAt(): number | null {
    const row = this.db.prepare(`SELECT MAX(offered_at) t FROM rhythm_offers`).get() as { t: number | null };
    return row.t;
  }

  /**
   * Whether an offer is due right now. Requires: rhythm on, a serendipity or discovery mode
   * running, the cadence elapsed, inside the envelope's windows, under its daily cap.
   */
  due(at = now()): { due: false; reason: string } | { due: true; modeId: string } {
    if (!this.config.enabled) return { due: false, reason: "rhythm is off" };
    const mode = [...this.modes.active("serendipity"), ...this.modes.active("discovery")][0];
    if (!mode) return { due: false, reason: "no mode is running" };
    if (at < nextOfferAt(this.lastOfferedAt(), this.consecutiveSkips(), this.config)) {
      return { due: false, reason: "cadence has not elapsed" };
    }
    if (!insideWindows(mode.envelope.windows, at)) return { due: false, reason: "outside the mode's windows" };
    if (mode.envelope.maxFrequencyPerDay > 0) {
      const dayStart = new Date(at); dayStart.setHours(0, 0, 0, 0);
      const today = (this.db.prepare(`SELECT COUNT(*) c FROM rhythm_offers WHERE offered_at >= ?`)
        .get(dayStart.getTime()) as { c: number }).c;
      if (today >= mode.envelope.maxFrequencyPerDay) return { due: false, reason: "today's offers are used" };
    }
    return { due: true, modeId: mode.id };
  }

  /** Make one offer if one is due and the graph has something matched to the focus. */
  offer(focus: { worldId: string; objectId: string | null }, at = now()): Offer | null {
    const d = this.due(at);
    if (!d.due) return null;
    const reward = this.selectReward(focus);
    if (!reward) return null;
    const offer: Offer = { id: newId(), modeId: d.modeId, reward, offeredAt: at };
    this.db.prepare(
      `INSERT INTO rhythm_offers (id, mode_id, kind, object_id, pair_key, offered_at, outcome)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    ).run(offer.id, offer.modeId, reward.kind, reward.objectId,
      reward.kind === "inspiration" && focus.objectId ? pairKey(focus.objectId, reward.objectId) : null, at);
    return offer;
  }

  /** The ordinary project rhythm: called only after a meaningful action has stopped. */
  offerAtBreakpoint(focus: { worldId: string; objectId: string | null }, at = now()): { id: string; reward: Reward } | null {
    if (!this.config.enabled) return null;
    const world = this.graph.getWorld(focus.worldId);
    if (!world || at < nextOfferAt(this.lastOfferedAt() ?? world.createdAt, this.consecutiveSkips(), this.config)) return null;
    const dayStart = new Date(at); dayStart.setHours(0, 0, 0, 0);
    const today = (this.db.prepare(`SELECT COUNT(*) c FROM rhythm_offers WHERE offered_at >= ?`)
      .get(dayStart.getTime()) as { c: number }).c;
    if (today >= 2) return null;
    const reward = this.selectReward(focus);
    if (!reward) return null;
    const id = newId();
    this.db.prepare(
      `INSERT INTO rhythm_offers (id, mode_id, kind, object_id, pair_key, offered_at, outcome)
       VALUES (?, NULL, ?, ?, ?, ?, NULL)`,
    ).run(id, reward.kind, reward.objectId,
      reward.kind === "inspiration" && focus.objectId ? pairKey(focus.objectId, reward.objectId) : null, at);
    return { id, reward };
  }

  resolve(offerId: string, outcome: "taken" | "skipped"): void {
    this.db.prepare(`UPDATE rhythm_offers SET outcome = ? WHERE id = ? AND outcome IS NULL`).run(outcome, offerId);
  }

  /**
   * A reward from the graph, matched to the focus, in order of what most raises the value of
   * the current work: an open question in this World, a decision awaiting review, an author
   * the person already cited, and last an Inspiration from another World that shares a
   * subject. Anything unrelated is not a reward; it is the abandonment signal.
   */
  selectReward(focus: { worldId: string; objectId: string | null }): Reward | null {
    const q = this.db.prepare(
      `SELECT a.object_id id FROM atoms a JOIN objects o ON o.id = a.object_id
       WHERE o.world_id = ? AND a.lane = 'question'
         AND NOT EXISTS (SELECT 1 FROM rhythm_offers r WHERE r.kind = 'open_question' AND r.object_id = a.object_id)
       ORDER BY a.stated_at DESC LIMIT 1`,
    ).get(focus.worldId) as { id: string } | undefined;
    if (q) {
      const title = this.graph.currentState(q.id)?.properties.title ?? "an open question";
      return { kind: "open_question", objectId: q.id, label: title,
        whyItMayConnect: "You asked this in this World and it is still open.", terminates: false };
    }

    const r = this.db.prepare(
      `SELECT d.object_id id, d.question FROM decisions d JOIN objects o ON o.id = d.object_id
       WHERE o.world_id = ? AND d.state = 'needs_review'
         AND NOT EXISTS (SELECT 1 FROM rhythm_offers r WHERE r.kind = 'review_due' AND r.object_id = d.object_id)
       ORDER BY d.accepted_at LIMIT 1`,
    ).get(focus.worldId) as { id: string; question: string } | undefined;
    if (r) {
      return { kind: "review_due", objectId: r.id, label: r.question,
        whyItMayConnect: "Something this decision rested on has changed since you accepted it.", terminates: false };
    }

    const a = this.db.prepare(
      `SELECT s.id, s.author, s.title, e.decision_id decisionId FROM sources s
       JOIN source_versions v ON v.source_id = s.id
       JOIN decision_evidence e ON e.source_version_id = v.id
       WHERE s.world_id = ? AND s.author IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM rhythm_offers r WHERE r.kind = 'cited_author' AND r.object_id = e.decision_id)
       ORDER BY v.retrieved_at DESC LIMIT 1`,
    ).get(focus.worldId) as { id: string; author: string; title: string; decisionId: string } | undefined;
    if (a) {
      return { kind: "cited_author", objectId: a.decisionId, label: `${a.author} — ${a.title}`,
        whyItMayConnect: `You cited ${a.author} in this decision; their source may be worth another look.`,
        terminates: false };
    }

    return focus.objectId ? this.inspire(focus.objectId) : null;
  }

  /**
   * One Inspiration Object: something in another World that shares a subject with the focus.
   * Says why it may connect, from the two subjects. Terminates: a pair is offered once.
   */
  inspire(focusObjectId: string): Reward | null {
    const focus = this.graph.currentState(focusObjectId);
    if (!focus) return null;
    const traits = new Set(focus.properties.traits);
    for (const world of this.graph.listWorlds()) {
      if (world.id === focus.object.worldId) continue;
      for (const other of this.graph.listStates(world.id)) {
        const shared = other.properties.traits.filter((t) => traits.has(t));
        const sameType = other.properties.semanticType === focus.properties.semanticType;
        if (shared.length === 0 && !sameType) continue;
        const key = pairKey(focusObjectId, other.object.id);
        const seen = this.db.prepare(`SELECT 1 FROM rhythm_offers WHERE pair_key = ?`).get(key);
        if (seen) continue;
        const why = shared.length > 0
          ? `Both are ${shared[0]}: "${other.properties.title}" in ${world.title} and "${focus.properties.title}" here.`
          : `Both are a ${focus.properties.semanticType}: "${other.properties.title}" in ${world.title} may show a way this one could go.`;
        return { kind: "inspiration", objectId: other.object.id, label: other.properties.title,
          whyItMayConnect: why, terminates: true };
      }
    }
    return null;
  }

  /**
   * Streaks of becoming. A day counts when a claim was accepted, a decision made, a rebuild
   * run, a disagreement recorded or a delivery approved — never when the app was merely open.
   * One missed day is forgiven; two break it.
   */
  streak(at = now()): Streak {
    const days = new Map<string, Becoming>();       // local date → what became
    const dayOf = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const mark = (t: number | null, what: Becoming) => {
      if (t === null) return;
      const k = String(dayOf(t));
      if (!days.has(k)) days.set(k, what);
    };
    const col = (sql: string, what: Becoming) => {
      for (const r of this.db.prepare(sql).all() as Array<{ t: number | null }>) mark(r.t, what);
    };
    col(`SELECT stated_at t FROM atoms WHERE lane IS NOT NULL AND lane != 'ignore'`, "claim_accepted");
    col(`SELECT accepted_at t FROM decisions WHERE accepted_at IS NOT NULL`, "decision_made");
    col(`SELECT started_at t FROM actions WHERE provenance = 'deterministic'`, "rebuild_run");
    col(`SELECT at t FROM moves WHERE kind = 'challenged'`, "disagreement_recorded");
    col(`SELECT approved_at t FROM releases`, "delivery_approved");

    const today = dayOf(at);
    const DAY = 86_400_000;
    const todayCounts = days.has(String(today));
    let cursor = todayCounts ? today : today - DAY;
    let count = 0, misses = 0, last: Becoming | null = days.get(String(today)) ?? null;
    while (true) {
      const what = days.get(String(cursor));
      if (what) { count += 1; misses = 0; last ??= what; }
      else {
        misses += 1;
        if (misses > this.config.streak.forgivenessDays) break;
      }
      cursor -= DAY;
      if (count === 0 && misses > this.config.streak.forgivenessDays) break;
      if (cursor < today - 400 * DAY) break;
    }
    const summary = count === 0
      ? "No streak yet — a decision or a claim starts one."
      : `Streak ${count} — ${todayCounts ? "today counts" : "a decision or a claim keeps it"}.`;
    return { days: count, todayCounts, lastBecoming: last, summary };
  }
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("::");
}
