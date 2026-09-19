import type { OutcomeLedger, TrustFacts } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";

/**
 * What a delivery actually cost, and what it was made under.
 *
 * Businesses cannot connect AI activity to outcomes because nothing joins spend to a
 * delivery. Here the join is a walk over foreign keys that already exist:
 *
 *   release → version → forms → lineage actions → (cost on the action; spend by task)
 *           + process ledger recorded sessions + release.decision_ids
 *
 * The wording keeps the process ledger's discipline: *recorded*, never *total*. Forty-seven
 * recorded minutes is what XENIUR saw; it is not a claim about how long the work took.
 */
export function outcomeOf(graph: ObjectGraph, objectId: string, releaseId?: string): OutcomeLedger {
  const release = (graph.db.prepare(
    releaseId
      ? `SELECT * FROM releases WHERE id = ?`
      : `SELECT * FROM releases WHERE object_id = ? ORDER BY approved_at DESC LIMIT 1`,
  ).get(releaseId ?? objectId) as Record<string, unknown> | undefined) ?? null;

  const versionId = (release?.["version_id"] as string | undefined) ?? graph.currentState(objectId)?.versionId;
  const forms = versionId ? graph.formsAt(versionId) : [];

  // Every action behind every form at the released version, once.
  const actions = new Map<string, ReturnType<ObjectGraph["actionsInLineage"]>[number]>();
  for (const f of forms) {
    for (const a of graph.actionsInLineage(f.representationId)) actions.set(a.id, a);
  }
  const all = [...actions.values()];
  const generation = {
    usd: all.reduce((sum, a) => sum + (a.cost?.usd ?? 0), 0),
    actions: all.length,
    generativeActions: all.filter((a) => a.provenance === "generated" || a.provenance === "mock").length,
  };

  // Intelligence: settled spend on the tasks those actions ran under. A Brain call that ran
  // outside any task is not attributable to a delivery and is not counted here — which is a
  // limit the summary states rather than hides.
  const taskIds = [...new Set(all.map((a) => a.taskId).filter((t): t is string => t !== null))];
  const spend = taskIds.length > 0
    ? graph.db.prepare(
        `SELECT actual_usd, attempt, outcome FROM spend
         WHERE status = 'settled' AND task_id IN (${taskIds.map(() => "?").join(",")})`,
      ).all(...taskIds) as Array<{ actual_usd: number; attempt: number; outcome: string }>
    : [];
  const intelligence = {
    usd: spend.reduce((s, r) => s + (r.actual_usd ?? 0), 0),
    calls: spend.length,
    escalations: spend.filter((r) => r.attempt > 1).length,
    failed: spend.filter((r) => r.outcome !== "ok").length,
  };

  const counts = graph.process.proof(objectId).counts;
  const recordedWork = { sessions: counts.recordedXeniurSessions, ms: counts.recordedSessionMs };

  const influence = graph.decisions.influenceOn(objectId, release?.["id"] as string | undefined);

  const label = release ? labelFor(graph, objectId, release["id"] as string) : "current work";
  const mins = Math.round(recordedWork.ms / 60000);
  const summary = [
    `${label}:`,
    `generation $${generation.usd.toFixed(2)} over ${generation.actions} action${generation.actions === 1 ? "" : "s"}`,
    `intelligence $${intelligence.usd.toFixed(2)} over ${intelligence.calls} call${intelligence.calls === 1 ? "" : "s"}` +
      (intelligence.escalations ? ` (${intelligence.escalations} escalated)` : ""),
    `${recordedWork.sessions} recorded session${recordedWork.sessions === 1 ? "" : "s"} (${mins} min recorded — recorded, not total)`,
    `decided under ${influence.decisions.length} decision${influence.decisions.length === 1 ? "" : "s"} citing ${influence.sourceVersionIds.length} stored source cop${influence.sourceVersionIds.length === 1 ? "y" : "ies"}`,
  ].join(" · ");

  return {
    objectId, releaseId: (release?.["id"] as string | null) ?? null, label,
    generation, intelligence, recordedWork,
    decisions: influence.decisions.length, sourceCopies: influence.sourceVersionIds.length,
    summary,
  };
}

function labelFor(graph: ObjectGraph, objectId: string, releaseId: string): string {
  const all = graph.db.prepare(
    `SELECT id FROM releases WHERE object_id = ? ORDER BY approved_at, rowid`,
  ).all(objectId) as Array<{ id: string }>;
  return `Delivery ${String(all.findIndex((r) => r.id === releaseId) + 1).padStart(2, "0")}`;
}

/**
 * "Can I trust this work?" — the five cells, read from tables that exist.
 *
 * Settled — and lime — in exactly one condition: every citation reviewed, every measurement
 * current, no receipt with an unknown outcome, no decision awaiting review. Anything less is
 * graphite with semantic cells.
 */
export function trustFactsFor(graph: ObjectGraph, objectId: string): TrustFacts {
  const state = graph.currentState(objectId);
  const worldId = state?.object.worldId ?? "";

  // Support: over this Object's own citations and those of decisions linked to it.
  const citing = new Set<string>([objectId]);
  for (const l of graph.decisions.linksFrom(objectId)) citing.add(l.toObjectId);
  for (const l of graph.decisions.linksTo(objectId)) citing.add(l.fromObjectId);
  const support = { supported: 0, ambiguous: 0, unresolved: 0, contradicted: 0 };
  let unreviewed = false;
  for (const id of citing) {
    for (const row of graph.support.of(id)) {
      support[row.status] += 1;
      if (row.checkedBy !== "human") unreviewed = true;
    }
  }

  // Evidence: current measurements across profiles, from readiness rows already stored.
  const checks = graph.db.prepare(
    `SELECT subject_id, subject_hash, validator FROM checks WHERE object_id = ? AND subject_kind != 'unbound'`,
  ).all(objectId) as Array<{ subject_id: string; subject_hash: string; validator: string }>;
  const currentHashes = new Map<string, string>();
  for (const f of state?.forms ?? []) {
    const rep = graph.getRepresentation(f.representationId);
    if (rep?.blobHash) currentHashes.set(rep.id, rep.blobHash);
  }
  const byValidator = new Map<string, boolean>();
  for (const c of checks) {
    const current = currentHashes.get(c.subject_id) === c.subject_hash;
    byValidator.set(c.validator, (byValidator.get(c.validator) ?? false) || current);
  }
  const evidence = { current: [...byValidator.values()].filter(Boolean).length, total: byValidator.size };

  const counts = graph.process.proof(objectId).counts;
  const provenance = {
    human: counts.userCreatedSketches + counts.acceptedHumanDecisions + counts.manualRevisions,
    tool: counts.toolSteps,
    model: counts.modelTouchedSteps,
  };

  const receipts = graph.db.prepare(
    `SELECT r.outcome FROM action_receipts r JOIN objects o ON o.id = r.object_id
     WHERE o.parent_id = ? OR r.object_id = ?`,
  ).all(objectId, objectId) as Array<{ outcome: string }>;
  const actions = {
    receipted: receipts.length,
    unknown: receipts.filter((r) => r.outcome === "unknown").length,
  };

  const ledger = outcomeOf(graph, objectId);
  const cost = { usd: ledger.generation.usd + ledger.intelligence.usd, escalations: ledger.intelligence.escalations };

  const decisionsNeedingReview = graph.decisions.list(worldId, "needs_review")
    .filter((d) => citing.has(d.objectId)).length;

  const settled = !unreviewed && support.contradicted === 0 &&
    evidence.current === evidence.total && actions.unknown === 0 && decisionsNeedingReview === 0;

  return { objectId, support, evidence, provenance, actions, cost, decisionsNeedingReview, settled };
}
