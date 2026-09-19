import type { Today, TodayRow } from "@xeniur/core";
import { TODAY_GLYPHS, TODAY_LIMIT, TODAY_PRECEDENCE } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";
import { impactOf } from "./impact.js";
import type { RhythmStore } from "./rhythm.js";

/**
 * Today, read from the graph. Every row is a situation that needs a person; nothing that is
 * running or finished. Sources, in precedence: parked approvals and quotes · decisions in
 * needs_review · unresolved support on anything with a delivery · rebuilds pending on a
 * released Object · an active challenge with a deadline · a matching challenge that arrived ·
 * streak state · one rhythm item only if due and only if a mode is on.
 */
export function todayFor(graph: ObjectGraph, opts: { rhythm?: RhythmStore; at?: number } = {}): Today {
  const at = opts.at ?? Date.now();
  const rows: TodayRow[] = [];
  const worldTitle = (id: string | null) => (id ? graph.getWorld(id)?.title ?? null : null);
  const push = (r: Omit<TodayRow, "glyph">) => rows.push({ ...r, glyph: TODAY_GLYPHS[r.kind] });

  // 1. Parked approvals and quotes. PURCHASE / COMMIT first among them.
  const parked = graph.db.prepare(
    `SELECT id, world_id, title, payload FROM tasks WHERE status = 'needs_approval' ORDER BY created_at`,
  ).all() as Array<{ id: string; world_id: string; title: string; payload: string }>;
  const weight = (payload: string) => {
    const level = (JSON.parse(payload || "{}") as { __level?: string }).__level ?? "";
    return level === "PURCHASE" ? 0 : level === "COMMIT" ? 1 : 2;
  };
  for (const t of [...parked].sort((a, b) => weight(a.payload) - weight(b.payload))) {
    const level = (JSON.parse(t.payload || "{}") as { __level?: string }).__level;
    push({ id: `task:${t.id}`, kind: "parked_approval", text: `${t.title} — ${level ? `${level} ` : ""}awaiting you`,
      worldId: t.world_id, worldTitle: worldTitle(t.world_id), objectId: null, zone: "work", verb: "Look at it" });
  }

  // 2. Decisions awaiting review.
  const reviews = graph.db.prepare(
    `SELECT d.object_id, d.question, o.world_id FROM decisions d JOIN objects o ON o.id = d.object_id
     WHERE d.state = 'needs_review' ORDER BY d.accepted_at`,
  ).all() as Array<{ object_id: string; question: string; world_id: string }>;
  for (const d of reviews) {
    push({ id: `decision:${d.object_id}`, kind: "decision_review", text: `Decision "${d.question}" — something it rested on changed`,
      worldId: d.world_id, worldTitle: worldTitle(d.world_id), objectId: d.object_id, zone: "decisions", verb: "Review" });
  }

  // 3. Unresolved support on Objects with a release.
  const released = graph.db.prepare(
    `SELECT DISTINCT o.id, o.world_id FROM releases r JOIN objects o ON o.id = r.object_id`,
  ).all() as Array<{ id: string; world_id: string }>;
  for (const o of released) {
    const linked = [o.id, ...graph.decisions.linksFrom(o.id).map((l) => l.toObjectId), ...graph.decisions.linksTo(o.id).map((l) => l.fromObjectId)];
    let unresolved = 0;
    for (const id of new Set(linked)) unresolved += graph.support.summary(id).counts.unresolved;
    if (unresolved > 0) {
      const title = graph.currentState(o.id)?.properties.title ?? "a delivery";
      push({ id: `support:${o.id}`, kind: "unresolved_support",
        text: `${unresolved} citation${unresolved === 1 ? "" : "s"} unresolved behind "${title}"`,
        worldId: o.world_id, worldTitle: worldTitle(o.world_id), objectId: o.id, zone: "sources", verb: "Check support" });
    }
  }

  // 4. Rebuilds pending on released Objects.
  for (const o of released) {
    const impact = impactOf(graph, o.id);
    if (impact.rebuild.length > 0) {
      const title = graph.currentState(o.id)?.properties.title ?? "a delivery";
      push({ id: `rebuild:${o.id}`, kind: "rebuild_pending",
        text: `"${title}" — ${impact.rebuild.length} form${impact.rebuild.length === 1 ? "" : "s"} out of date since delivery`,
        worldId: o.world_id, worldTitle: worldTitle(o.world_id), objectId: o.id, zone: "deliveries", verb: "Rebuild" });
    }
  }

  // 5. Active challenges the person entered.
  const me = graph.publishers.isSelf.bind(graph.publishers);
  for (const c of graph.challenges.active(at)) {
    const mine = graph.challenges.entries(c.worldId, { at }).find((e) => me(e.publisher.publicKey));
    if (!mine) continue;
    const days = Math.max(0, Math.ceil((c.rules.endsAt - at) / 86_400_000));
    const verdict = mine.compliance.verdict.replaceAll("_", " ");
    push({ id: `challenge:${c.worldId}`, kind: "challenge_deadline",
      text: `${c.rules.title} — ${days} day${days === 1 ? "" : "s"} left · ${c.rules.aiPolicy.replaceAll("_", " ")} · ${verdict}`,
      worldId: c.worldId, worldTitle: c.rules.title, objectId: mine.objectId, zone: "work", verb: "Continue" });
  }

  // 6. A matching challenge that arrived. Once; dismissing is a recorded move.
  for (const c of graph.challenges.matching(at)) {
    if (graph.challenges.entries(c.worldId, { at }).some((e) => me(e.publisher.publicKey))) continue;
    const days = Math.max(0, Math.ceil((c.rules.endsAt - at) / 86_400_000));
    push({ id: `arrival:${c.worldId}`, kind: "challenge_arrival",
      text: `A challenge matching your work opened — ${days} day${days === 1 ? "" : "s"} · ${c.rules.aiPolicy.replaceAll("_", " ")}`,
      worldId: c.worldId, worldTitle: c.rules.title, objectId: null, zone: null, verb: "Look" });
  }

  // 7. Streak state — only when there is one; a zero streak is not a situation.
  if (opts.rhythm) {
    const streak = opts.rhythm.streak(at);
    if (streak.days > 0) {
      push({ id: "streak", kind: "streak", text: streak.summary, worldId: null, worldTitle: null, objectId: null, zone: null, verb: "" });
    }
    // 8. One rhythm item, only if due and only if a mode is on.
    const due = opts.rhythm.due(at);
    if (due.due) {
      push({ id: "rhythm", kind: "rhythm", text: "Something from your own work is ready when you want it",
        worldId: null, worldTitle: null, objectId: null, zone: null, verb: "Show me" });
    }
  }

  // Ordered by consequence, stable within a kind; compressed to seven with the rest counted.
  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => TODAY_PRECEDENCE[a.r.kind] - TODAY_PRECEDENCE[b.r.kind] || a.i - b.i)
    .map((x) => x.r);
  const shown = ordered.slice(0, TODAY_LIMIT);
  return {
    date: new Date(at).toISOString().slice(0, 10),
    rows: shown, more: Math.max(0, ordered.length - shown.length), quiet: shown.length === 0,
  };
}
