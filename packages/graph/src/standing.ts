import type { NextAction, ResumeCard, ResumeFragment, Standing, StandingRef } from "@xeniur/core";
import { MOVE_VERBS } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";
import { impactOf } from "./impact.js";
import { critiquePairs } from "./shared.js";

/**
 * Where you stand, read from rows. No model is called on this path — a test asserts it — and
 * no sentence is written that a row does not back.
 */
export function standingFor(graph: ObjectGraph, goalId: string): Standing | null {
  const goal = graph.goals.get(goalId);
  if (!goal) return null;
  const world = graph.getWorld(goal.worldId);
  const ref = (id: string | null | undefined): StandingRef | null => {
    if (!id) return null;
    const s = graph.currentState(id);
    return s ? { id, title: s.properties.title } : null;
  };
  const refs = (ids: Iterable<string>): StandingRef[] => [...new Set(ids)].map(ref).filter((r): r is StandingRef => r !== null);

  // Knowledge: every claim in the World, laned by what a person has settled about it.
  const claims = (graph.db.prepare(
    `SELECT a.object_id id FROM atoms a JOIN objects o ON o.id = a.object_id
     WHERE o.world_id = ? AND a.atom_type = 'claim' AND a.stance = 'assertion' AND (a.lane IS NULL OR a.lane != 'ignore')`,
  ).all(goal.worldId) as Array<{ id: string }>).map((r) => r.id);
  const known: string[] = [], proposed: string[] = [], disputed: string[] = [];
  for (const id of claims) {
    const s = graph.support.summary(id);
    const critiqued = critiquePairs(graph, id).some((p) => p.relation === "contradicts");
    if (s.hasContradiction || critiqued) disputed.push(id);
    else if (s.reviewedSupported) known.push(id);
    else proposed.push(id);
  }
  const pending = (graph.db.prepare(
    `SELECT COUNT(*) c FROM capture_candidates WHERE world_id = ? AND state = 'proposed'`,
  ).get(goal.worldId) as { c: number }).c;

  // Unknown: open questions, and required outputs without a current form.
  const needed = goal.requiredOutputs.map((output) => {
    if (graph.getObject(output)) {
      const state = graph.currentState(output);
      return { output: state?.properties.title ?? output, satisfied: (state?.forms.length ?? 0) > 0, objectId: output };
    }
    const row = graph.db.prepare(
      `SELECT o.id FROM objects o JOIN versions v ON v.id = o.current_version_id JOIN version_forms f ON f.version_id = v.id
       WHERE o.world_id = ? AND f.role = ? LIMIT 1`,
    ).get(goal.worldId, output) as { id: string } | undefined;
    return { output, satisfied: !!row, objectId: row?.id ?? null };
  });
  const unknown = [...refs(goal.openQuestionIds), ...needed.filter((n) => !n.satisfied).map((n) => ({ id: n.objectId ?? n.output, title: n.output }))];

  // Chosen despite uncertainty: decisions whose assumptions were accepted as such (A6 writes the kind).
  const chosenDespite = (graph.db.prepare(
    `SELECT DISTINCT d.object_id id FROM decisions d JOIN objects o ON o.id = d.object_id
     JOIN decision_assumptions a ON a.decision_id = d.object_id
     WHERE o.world_id = ? AND a.kind = 'accepted_uncertainty'`,
  ).all(goal.worldId) as Array<{ id: string }>).map((r) => r.id);

  // Changed since the person was last here.
  const since = goal.lastActiveAt;
  const newSources = (graph.db.prepare(
    `SELECT id, title FROM sources WHERE world_id = ? AND retrieved_at > ? ORDER BY retrieved_at`,
  ).all(goal.worldId, since) as Array<{ id: string; title: string }>).map((s) => ({ id: s.id, title: s.title }));
  const rebuild: StandingRef[] = [], review: StandingRef[] = [];
  const watched = new Set<string>([...(goal.focusObjectId ? [goal.focusObjectId] : []), ...graph.goals.relevantObjects(goal.id)]);
  for (const id of watched) {
    const impact = impactOf(graph, id);
    if (impact.rebuild.length > 0) { const r = ref(id); if (r) rebuild.push(r); }
    for (const item of impact.review) { const r = ref(item.objectId); if (r && !review.some((x) => x.id === r.id)) review.push(r); }
  }
  const critiques = (graph.db.prepare(
    `SELECT i.object_id id FROM imported_from i JOIN objects o ON o.id = i.object_id WHERE o.world_id = ? AND i.imported_at > ?`,
  ).all(goal.worldId, since) as Array<{ id: string }>).map((r) => r.id);

  const lastMoveRow = graph.db.prepare(
    `SELECT kind, at, object_id FROM moves WHERE world_id = ? ORDER BY at DESC, rowid DESC LIMIT 1`,
  ).get(goal.worldId) as { kind: string; at: number; object_id: string | null } | undefined;

  return {
    goal, worldId: goal.worldId, worldTitle: world?.title ?? "", focus: ref(goal.focusObjectId),
    knowledge: {
      known: refs(known),
      proposed: [...refs(proposed), ...Array.from({ length: pending }, (_, i) => ({ id: `candidate-${i}`, title: "a proposed claim awaiting review" }))],
      disputed: refs(disputed), unknown, chosenDespite: refs(chosenDespite),
    },
    changed: { since, newSources, rebuild, review, critiques: refs(critiques) },
    nextActions: goal.nextActions.filter((a: NextAction) => !a.doneAt),
    needed,
    lastMove: lastMoveRow ? { kind: lastMoveRow.kind, at: lastMoveRow.at, object: ref(lastMoveRow.object_id) } : null,
  };
}

/**
 * "You were comparing two finishes before preparing the next delivery. One decision needs
 * review after a source changed." Templates over rows; each fragment links to its Object.
 */
export function resumeCard(graph: ObjectGraph, worldId: string): ResumeCard | null {
  const world = graph.getWorld(worldId);
  if (!world) return null;
  const goal = graph.goals.current(worldId);
  const standing = goal ? standingFor(graph, goal.id) : null;
  const fragments: ResumeFragment[] = [];
  const focus = standing?.focus ?? null;

  if (standing?.lastMove) {
    const verb = MOVE_VERBS[standing.lastMove.kind] ?? "working on";
    const subject = standing.lastMove.object ?? focus;
    fragments.push({ text: `You were ${verb} `, objectId: null });
    fragments.push({ text: subject ? `"${subject.title}"` : "this World", objectId: subject?.id ?? null });
  } else if (focus) {
    fragments.push({ text: "You were working on ", objectId: null });
    fragments.push({ text: `"${focus.title}"`, objectId: focus.id });
  } else {
    fragments.push({ text: `You were in ${world.title}`, objectId: null });
  }
  fragments.push({ text: ".", objectId: null });
  // The next action is the person's own words; it is quoted, not conjugated.
  const next = standing?.nextActions[0];
  if (next) fragments.push({ text: ` Next: ${lower(next.text)}.`, objectId: next.objectId });

  if (standing) {
    const c = standing.changed;
    if (c.review.length > 0) {
      fragments.push({ text: c.review.length === 1 ? ` One decision needs review after something it rested on changed.` : ` ${c.review.length} decisions need review after something they rested on changed.`, objectId: c.review[0]!.id });
    }
    if (c.newSources.length > 0) {
      fragments.push({ text: ` ${c.newSources.length === 1 ? "One new source was" : `${c.newSources.length} new sources were`} added.`, objectId: null });
    }
    if (c.rebuild.length > 0) {
      fragments.push({ text: ` "${c.rebuild[0]!.title}" is out of date since the last delivery.`, objectId: c.rebuild[0]!.id });
    }
    if (c.critiques.length > 0) {
      fragments.push({ text: ` ${c.critiques.length === 1 ? "A critique" : `${c.critiques.length} critiques`} arrived.`, objectId: c.critiques[0]!.id });
    }
  }
  return {
    worldId, worldTitle: world.title, goalId: goal?.id ?? null, fragments,
    focusObjectId: goal?.focusObjectId ?? null,
    lastActiveAt: goal?.lastActiveAt ?? world.lastOpenedAt ?? world.createdAt,
  };
}

/** The most recently active World with a goal — what Today leads with. */
export function lastActiveWorld(graph: ObjectGraph): string | null {
  const row = graph.db.prepare(
    `SELECT g.world_id id FROM goals g JOIN worlds w ON w.id = g.world_id
     WHERE g.status != 'finished' AND w.kind = 'work' ORDER BY g.last_active_at DESC LIMIT 1`,
  ).get() as { id: string } | undefined;
  if (row) return row.id;
  const fallback = graph.db.prepare(
    `SELECT id FROM worlds WHERE kind = 'work' AND summary != '__xeniur_settings__' ORDER BY COALESCE(last_opened_at, created_at) DESC LIMIT 1`,
  ).get() as { id: string } | undefined;
  return fallback?.id ?? null;
}

const lower = (s: string) => (s.length > 0 ? s[0]!.toLowerCase() + s.slice(1) : s).replace(/\.$/, "");

export class NotFinishable extends Error {
  readonly code = "not_finishable" as const;
  constructor(readonly missing: string[]) {
    super(`not finished: ${missing.join("; ")}. Finish anyway to record that as a decision.`);
    this.name = "NotFinishable";
  }
}

/**
 * Finish: the goal's `ready → finished` transition.
 *
 * Requires every required output to have a current form and a release. Otherwise it is
 * refused — unless the person finishes anyway, which is a Decision with the uncertainty
 * named and the reason for proceeding, so the delivery report can say so.
 */
export function finishGoal(graph: ObjectGraph, goalId: string, opts: { anyway?: { because: string } } = {}): import("@xeniur/core").WorkGoal {
  const standing = standingFor(graph, goalId);
  if (!standing) throw new Error(`no such goal: ${goalId}`);
  const missing: string[] = [];
  for (const n of standing.needed) {
    if (!n.satisfied) { missing.push(`${n.output} has not been made`); continue; }
    if (n.objectId) {
      const released = (graph.db.prepare(`SELECT COUNT(*) c FROM releases WHERE object_id = ?`).get(n.objectId) as { c: number }).c;
      if (released === 0) missing.push(`${n.output} has no release`);
    }
  }
  if (standing.knowledge.disputed.length > 0) missing.push(`${standing.knowledge.disputed.length} claim${standing.knowledge.disputed.length === 1 ? "" : "s"} still disputed`);
  if (missing.length > 0) {
    if (!opts.anyway) throw new NotFinishable(missing);
    const decision = graph.decisions.create({
      worldId: standing.worldId, question: `Finish "${standing.goal.outcome}" with unresolved requirements?`,
      options: [{ key: "finish_anyway", label: "Finish anyway", note: opts.anyway.because }, { key: "wait", label: "Wait", note: "" }],
      chosenOption: "finish_anyway", rationale: opts.anyway.because,
    });
    for (const m of missing) graph.decisions.acceptUncertainty(decision.objectId, m, opts.anyway.because);
    graph.decisions.accept(decision.objectId, "you", { steelman: `Finishing now may mean ${missing[0]} is never resolved.` });
    if (standing.focus) graph.decisions.link({ fromObjectId: standing.focus.id, toObjectId: decision.objectId, relation: "satisfies" });
  }
  return graph.goals.setStatus(goalId, "finished")!;
}
