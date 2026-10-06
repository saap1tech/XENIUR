import type { ReadinessReport, SharpenAnswer, SharpenEffect, SharpenKind, SharpenMove, SharpenSession, WorkSignal, WorkSignalKind, WorkState } from "@xeniur/core";
import { looksLikeKey, newId, now, sha256Hex, SharpenAnswerSchema } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";
import { standingFor } from "./standing.js";

const MONTH = 30 * 24 * 60 * 60 * 1000;
const assumptionKey = (text: string, trigger: string, kind: string) => `assumption:${sha256Hex(JSON.stringify([text, trigger, kind]))}`;

/** Recorded conditions of the work. No model, mastery estimate, or inferred browsing history. */
export function assessWorkState(graph: ObjectGraph, goalId: string, at = now()): WorkState | null {
  return new WorkStateStore(graph).assess(goalId, at);
}

export class WorkStateStore {
  constructor(private readonly graph: ObjectGraph, private readonly readiness?: (objectId: string) => ReadinessReport[]) {}

  assess(goalId: string, at = now()): WorkState | null {
    const g = this.graph, goal = g.goals.get(goalId);
    if (!goal) return null;
    const signals: WorkSignal[] = [];
    const digests = new Map<string, string>();
    const add = (objectId: string, kind: WorkSignalKind, fact: string, priority: number, subjectKey = kind as string) => {
      const state = g.currentState(objectId);
      if (!state || state.object.archivedAt || state.object.worldId !== goal.worldId) return;
      if (!digests.has(objectId)) digests.set(objectId, this.digest(goalId, objectId));
      const checked = this.lastCheck(objectId, subjectKey, state.versionId, digests.get(objectId)!);
      // A person's check applies only to this basis, for a bounded period. It never settles a citation.
      if ((kind === "assumption" || kind === "recall") && checked && at - checked < MONTH) return;
      const id = sha256Hex(JSON.stringify([goalId, objectId, kind, subjectKey]));
      if (signals.some((s) => s.id === id)) return;
      signals.push({ id, kind, objectId, title: state.properties.title, fact, priority, subjectKey, lastCheckedAt: checked });
    };
    const claimIds = (g.db.prepare(`SELECT a.object_id id FROM atoms a JOIN objects o ON o.id = a.object_id
      WHERE o.world_id = ? AND o.archived_at IS NULL AND a.atom_type = 'claim'
      AND a.stance = 'assertion' AND (a.lane IS NULL OR a.lane != 'ignore') ORDER BY o.created_at, o.id`).all(goal.worldId) as { id: string }[]).map((r) => r.id);
    const decisions = g.decisions.list(goal.worldId).filter((d) => d.state !== "superseded");
    for (const id of [...new Set([...claimIds, ...decisions.map((d) => d.objectId)])]) {
      const support = g.support.summary(id), rows = g.support.of(id);
      if (support.hasContradiction || g.decisions.linksTo(id).some((l) => l.relation === "contradicts")) add(id, "disagreement", "A recorded citation or critique challenges this basis. Review the disagreement before relying on it.", 0);
      else if (support.hasUnreviewed) add(id, "unreviewed_basis", `${rows.filter((r) => r.checkedBy !== "human").length} citation(s) have not had a human support review.`, 2);
      else if (claimIds.includes(id) && !support.reviewedSupported) add(id, "unreviewed_basis", "This claim has no human-reviewed supporting citation.", 2);
      if (this.changedSources(id).length) add(id, "changed_basis", "A cited source has a newer stored copy. The earlier citation remains pinned to its original copy.", 0, "source_changes");
    }
    for (const d of decisions) {
      if (d.state === "needs_review") add(d.objectId, "changed_basis", "This decision is marked for review.", 1, "review_flag");
      for (const a of d.assumptions.filter((a) => a.kind !== "steelman")) {
        add(d.objectId, "assumption", `Assumption to check: ${a.text}${a.reviewTrigger ? ` Revisit when: ${a.reviewTrigger}` : ""}`, 3,
          assumptionKey(a.text, a.reviewTrigger, a.kind));
      }
      if (d.acceptedAt && at - d.acceptedAt >= MONTH) add(d.objectId, "recall", "This choice was recorded more than 30 days ago. Recall your reasons before reviewing the record.", 5, "recall");
    }
    for (const r of g.decisions.reviewQueue(goal.worldId)) add(r.objectId, "changed_basis", r.because, 0, `dependency:${r.causeObjectId}`);
    const standing = standingFor(g, goalId);
    const fallback = goal.focusObjectId ?? decisions[0]?.objectId ?? claimIds[0] ?? g.listStates(goal.worldId).find((s) => !s.properties.tags.includes("sharpen"))?.object.id;
    for (const required of standing?.needed ?? []) {
      if (!required.satisfied && (required.objectId ?? fallback)) add(required.objectId ?? fallback!, "requirement", `Required output is missing a current form: ${required.output}`, 4, `required:${required.output}`);
    }
    for (const id of g.goals.relevantObjects(goalId)) {
      for (const report of this.readinessFor(id)) {
        if (!report.ready) add(id, "requirement", `${report.profileName}: ${report.blockers.map((b) => b.detail).join("; ")}`, 4, `readiness:${report.profileId}`);
      }
      for (const status of g.recipes.statusOf(id).filter((s) => s.state !== "fresh")) {
        add(id, "requirement", `${status.stepKey}: ${status.reason}`, 4, `recipe:${status.stepKey}`);
      }
    }
    const plan = g.plans.current(goalId);
    for (const step of plan?.steps ?? []) {
      if (step.disposition === "skipped" || step.disposition === "replaced") continue;
      for (const input of step.inputs) {
        if (input.versionId && g.currentState(input.objectId)?.versionId !== input.versionId)
          add(input.objectId, "changed_basis", `The input for “${step.purpose}” changed since the plan was recorded.`, 1, `step:${step.id}`);
      }
      const work = g.plans.work(goalId).find((w) => w.stepId === step.id);
      if (work && (work.execution === "blocked" || work.execution === "needs_review") && (step.inputs[0]?.objectId ?? fallback))
        add(step.inputs[0]?.objectId ?? fallback!, "requirement", `“${step.purpose}” is ${work.execution === "blocked" ? "blocked" : "marked for review"}${work.note ? `: ${work.note}` : "."}`, 4, `work:${step.id}`);
    }
    signals.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const latest = g.db.prepare(`SELECT session FROM sharpen_sessions WHERE goal_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(goalId) as { session: string } | undefined;
    return { goalId, worldId: goal.worldId, outcome: goal.outcome, signals, assessedAt: at, latestSession: latest ? JSON.parse(latest.session) as SharpenSession : null };
  }

  session(id: string): SharpenSession | null {
    const row = this.graph.db.prepare(`SELECT session FROM sharpen_sessions WHERE id = ?`).get(id) as { session: string } | undefined;
    return row ? JSON.parse(row.session) as SharpenSession : null;
  }

  start(goalId: string, objectId: string | null = null, signalId: string | null = null,depth:"focused"|"full"="full"): SharpenSession {
    const g = this.graph, work = this.assess(goalId), goal = g.goals.get(goalId);
    if (!work || !goal) throw new Error("This goal no longer exists.");
    if (g.getWorld(goal.worldId)?.kind !== "work") throw new Error("Sharpen is available in your own projects.");
    const signal = signalId ? work.signals.find((s) => s.id === signalId) : work.signals.find((s) => !objectId || s.objectId === objectId);
    if (signalId && (!signal || (objectId && signal.objectId !== objectId))) throw new Error("That observation changed. Refresh the work state.");
    const id = objectId ?? signal?.objectId ?? goal.focusObjectId;
    const state = id ? g.currentState(id) : null;
    if (!state || state.object.worldId !== goal.worldId || state.object.archivedAt) throw new Error("Choose a current piece of work in this project first.");
    g.assertWritable(state.object.id);
    const d = g.decisions.detail(state.object.id), support = g.support.of(state.object.id);
    const recorded = d ? [d.rationale || "No rationale recorded.", `Chosen option: ${d.options.find((o) => o.key === d.chosenOption)?.label ?? d.chosenOption ?? "Not selected"}`,
      ...d.options.filter((o) => o.key !== d.chosenOption).map((o) => `Other option: ${o.label}${o.note ? ` — ${o.note}` : ""}`),
      ...d.assumptions.map((a) => `${a.kind === "steelman" ? "Challenge" : "Assumption"}: ${a.text}`)].join("\n") : `Work: ${state.properties.title}\nGoal: ${goal.outcome}\nCurrent forms: ${state.forms.map((f) => f.role).join(", ") || "None recorded"}`;
    const basis = support.length ? support.map((r) => `${r.status} · ${r.checkedBy === "human" ? "human reviewed" : "not human reviewed"}${r.note ? ` · ${r.note}` : ""}`).join("\n") : "No citation support reviews recorded for this work.";
    const changes = work.signals.filter((s) => s.objectId === state.object.id && s.kind === "changed_basis").map((s) => s.fact);
    const move = (kind: SharpenKind, prompt: string, record: string, effects: SharpenEffect[]): SharpenMove => ({ id: newId(), kind, prompt, recorded: record, changes, effects, answer: null, effect: null, reflectionObjectId: null, answeredAt: null });
    const title = state.properties.title;
    const moves = [
      move("recall", d ? `Why did you choose ${d.options.find((o) => o.key === d.chosenOption)?.label ?? title}? Recall the reasons before opening the record.` : `What is “${title}” meant to achieve for this goal? Explain it in your own words.`, recorded, ["reflect"]),
      move("distinguish", `In “${title}”, what has reviewed support, and what is still an assumption?`, `${basis}\n${recorded}`, ["reflect"]),
      move("challenge", `What evidence or counterexample would make you reconsider “${title}”?${signal?.kind === "assumption" ? `\n${signal.fact}` : ""}`, recorded, ["reflect", "needs_review", "source"]),
      move("apply", signal?.kind === "assumption" ? `How did you check this assumption, or what concrete test would you run?\n${signal.fact}` : `What new case, source, or requirement would you test against “${title}”?`, `${recorded}\n${goal.requiredOutputs.length ? `Required outputs: ${goal.requiredOutputs.join(", ")}` : "No required outputs recorded."}`, signal?.kind === "assumption" ? ["reflect", "test", "checked"] : ["reflect", "test"]),
    ];
    if (d) moves.push(move("decide", `Keep your choice, or reopen “${title}”? Include your reason and compare the other options.`, recorded, ["keep", "needs_review"]));
    if(depth==="focused"){
      const kinds:SharpenKind[]=signal?.kind==="changed_basis"||signal?.kind==="recall"?["recall","apply","decide"]:
        signal?.kind==="disagreement"||signal?.kind==="unreviewed_basis"?["distinguish","challenge","decide"]:["challenge","apply","decide"];
      const selected=moves.filter(m=>kinds.includes(m.kind));moves.splice(0,moves.length,...selected);
    }
    const session: SharpenSession = { id: newId(), goalId, worldId: goal.worldId, objectId: state.object.id, objectVersionId: state.versionId,
      title, subjectKey: signal?.subjectKey ?? "recall", basisDigest: this.digest(goalId, state.object.id), fact: signal?.fact ?? "A short check of the work and the reasons behind it.", moves, createdAt: now() };
    g.db.prepare(`INSERT INTO sharpen_sessions (id, goal_id, world_id, object_id, session, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(session.id, goalId, goal.worldId, state.object.id, JSON.stringify(session), session.createdAt);
    return session;
  }

  answer(input: SharpenAnswer): SharpenSession {
    const a = SharpenAnswerSchema.parse(input), g = this.graph;
    if (looksLikeKey(a.answer)) throw new Error("Keep API keys in model settings, outside project notes.");
    return g.db.transaction(() => {
      const s = this.session(a.sessionId);
      if (!s) throw new Error("This thinking session no longer exists.");
      const move = s.moves.find((m) => m.id === a.moveId);
      if (!move || !move.effects.includes(a.effect)) throw new Error("This action is not available for that thinking move.");
      if (move.answeredAt) {
        if (move.answer === a.answer && move.effect === a.effect) return s;
        throw new Error("This answer is already recorded. Start another check to add a new reflection.");
      }
      if (s.moves.find((m) => !m.answeredAt)?.id !== move.id) throw new Error("Complete the current thinking move first.");
      const state = g.currentState(s.objectId);
      if (!state || state.object.archivedAt || state.versionId !== s.objectVersionId || this.digest(s.goalId, s.objectId) !== s.basisDigest)
        throw new Error("The work or its basis changed. Start a fresh check using the current record.");
      g.assertWritable(s.objectId);
      const note = g.createObject({ worldId: s.worldId, semanticType: "note", title: `${move.kind[0]!.toUpperCase()}${move.kind.slice(1)} · ${s.title}`,
        properties: { tags: ["sharpen"], settings: { sharpenSessionId: s.id, targetObjectId: s.objectId, targetVersionId: s.objectVersionId, effect: a.effect } } });
      const text = `# ${move.kind} · ${s.title}\n\n${move.prompt}\n\n## Your reflection\n${a.answer}\n\n## Recorded basis at start\n${move.recorded}\n\n## Observed changes\n${move.changes.join("\n") || "No recorded changes were detected at the start of this check."}\n\nAction: ${a.effect}\n\nThis is a person's reflection, not a support verdict or a grade.\n`;
      const hash = g.putBlob(Buffer.from(text), "text/markdown", "md");
      const rep = g.addRepresentation({ objectId: note.object.id, modality: "text", format: "md", blobHash: hash, provenance: "human" });
      const committed = g.commitVersion({ objectId: note.object.id, forms: [{ role: "doc.primary", representationId: rep.id }], label: "Sharpen reflection" });
      g.decisions.link({ fromObjectId: note.object.id, fromVersionId: committed.versionId, toObjectId: s.objectId, toVersionId: s.objectVersionId, relation: "informed_by", note: `Sharpen: ${move.kind}` });
      g.process.record({ objectId: note.object.id, versionId: committed.versionId, kind: "manual_edit", actor: "human", label: `Sharpen: ${move.kind}`, tool: null, model: null, inputHashes: [], outputHashes: [hash], durationMs: 0 });
      if (a.effect === "test") g.goals.addNextAction(s.goalId, { text: `Test: ${a.answer}`, objectId: note.object.id });
      if (a.effect === "source") g.goals.addNextAction(s.goalId, { text: `Find another source: ${a.answer}`, objectId: s.objectId });
      if (a.effect === "needs_review") {
        g.decisions.flagForReview(s.objectId);
        g.goals.addNextAction(s.goalId, { text: `Review ${s.title}: ${a.answer}`, objectId: s.objectId });
      }
      // Keep records a deliberate choice. It cannot erase changed evidence or settle citations.
      move.answer = a.answer; move.effect = a.effect; move.reflectionObjectId = note.object.id; move.answeredAt = now();
      s.basisDigest = this.digest(s.goalId, s.objectId);
      g.db.prepare(`INSERT INTO work_understanding_checks (id, session_id, move_id, target_object_id, target_version_id,
        subject_key, basis_digest, effect, reflection_object_id, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(newId(), s.id, move.id, s.objectId, s.objectVersionId, move.kind === "recall" ? "recall" : s.subjectKey, s.basisDigest, a.effect, note.object.id, move.answeredAt);
      g.db.prepare(`UPDATE sharpen_sessions SET session = ? WHERE id = ?`).run(JSON.stringify(s), s.id);
      g.goals.touch(s.worldId);
      return s;
    })();
  }

  private lastCheck(objectId: string, key: string, version: string, digest: string): number | null {
    const row = this.graph.db.prepare(`SELECT checked_at FROM work_understanding_checks WHERE target_object_id = ?
      AND subject_key = ? AND target_version_id = ? AND basis_digest = ?
      AND (effect = 'checked' OR (subject_key = 'recall' AND effect = 'reflect')) ORDER BY checked_at DESC LIMIT 1`).get(objectId, key, version, digest) as { checked_at: number } | undefined;
    return row?.checked_at ?? null;
  }

  private changedSources(objectId: string): string[] {
    return this.graph.support.of(objectId).filter((s) => {
      const row = this.graph.db.prepare(`SELECT latest.id FROM source_versions cited JOIN source_versions latest ON latest.source_id = cited.source_id
        WHERE cited.id = ? ORDER BY latest.retrieved_at DESC, latest.rowid DESC LIMIT 1`).get(s.sourceVersionId) as { id: string } | undefined;
      return !!row && row.id !== s.sourceVersionId;
    }).map((s) => s.sourceVersionId);
  }

  private readinessFor(objectId: string): ReadinessReport[] {
    const settings = this.graph.currentState(objectId)?.properties.settings;
    const ids = [...(Array.isArray(settings?.profiles) ? settings.profiles : []), ...(Array.isArray(settings?.readinessProfiles) ? settings.readinessProfiles : [])];
    return (this.readiness?.(objectId) ?? []).filter((r) => ids.includes(r.profileId));
  }

  private digest(goalId: string, objectId: string): string {
    const g = this.graph, goal = g.goals.get(goalId), support = g.support.of(objectId), decision = g.decisions.detail(objectId);
    const dependencies = g.decisions.linksTo(objectId).filter((l) => !g.currentState(l.fromObjectId)?.properties.tags.includes("sharpen"))
      .map((l) => [l, g.currentState(l.fromObjectId)?.versionId]);
    return sha256Hex(JSON.stringify({ version: g.currentState(objectId)?.versionId, archived: g.getObject(objectId)?.archivedAt,
      goal: goal ? [goal.outcome, goal.requiredOutputs, goal.openQuestionIds] : null, plan: g.plans.current(goalId), planWork: g.plans.work(goalId), decision, dependencies, support,
      readiness: this.readinessFor(objectId), constraints: goal ? g.constraints.list(goal.worldId) : [],
      sources: this.changedSources(objectId).map((id) => [id, (g.db.prepare(`SELECT latest.id FROM source_versions cited JOIN source_versions latest ON latest.source_id = cited.source_id
        WHERE cited.id = ? ORDER BY latest.retrieved_at DESC, latest.rowid DESC LIMIT 1`).get(id) as { id: string }).id]),
      evidenceVersions: decision?.evidence.map((e) => [e.atomObjectId, e.atomObjectId ? g.currentState(e.atomObjectId)?.versionId : null]) }));
  }
}
