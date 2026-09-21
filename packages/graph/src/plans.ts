import type { CompletionRule, PlanStep, PlanStepInput, StepDisposition, StepEvidence, StepExecution, StepWork, WorkPlan } from "@xeniur/core";
import { PlanStepSchema, StepWorkSchema, WorkPlanSchema, currentStepOf, newId, now, planProgress, templatePlanFor } from "@xeniur/core";
import type { Db } from "./db.js";
import type { ObjectGraph } from "./graph.js";

/**
 * Plans and the work recorded against them.
 *
 * Every edit is a new revision (rename, reorder, add, replace, adopt, skip). Work state sits in
 * its own table keyed by step id, untouched by any revision. `complete` is written only when
 * the step's completion rule holds in the graph — a form exists, a decision is accepted, a
 * receipt is confirmed — or when the person confirms with a note. A requirement that changed
 * under a step turns that step to `needs_review` and leaves its evidence exactly as it was.
 */
export class PlanStore {
  constructor(private readonly db: Db, private readonly graph: ObjectGraph) {}

  current(goalId: string): WorkPlan | null {
    const r = this.db.prepare(`SELECT * FROM work_plans WHERE goal_id = ? AND superseded_by IS NULL ORDER BY revision DESC LIMIT 1`).get(goalId) as Row | undefined;
    return r ? fromRow(r) : null;
  }

  history(goalId: string): WorkPlan[] {
    return (this.db.prepare(`SELECT * FROM work_plans WHERE goal_id = ? ORDER BY revision`).all(goalId) as Row[]).map(fromRow);
  }

  /** A first plan from the goal's words, by template. Returns the existing one if there is one. */
  propose(goalId: string): WorkPlan {
    const existing = this.current(goalId);
    if (existing) return existing;
    const goal = this.graph.goals.get(goalId);
    if (!goal) throw new Error(`no such goal: ${goalId}`);
    const hasSources = (this.db.prepare(`SELECT COUNT(*) c FROM sources WHERE world_id = ?`).get(goal.worldId) as { c: number }).c > 0;
    const hasDecisions = this.graph.decisions.list(goal.worldId).length > 0;
    const { steps } = templatePlanFor({ outcome: goal.outcome, status: goal.status, requiredOutputs: goal.requiredOutputs, hasSources, hasDecisions });
    return this.#write(goalId, goal.worldId, 1, "template", steps.map((s) => PlanStepSchema.parse(s)), null);
  }

  /** A new revision with these steps. The previous revision is superseded, never changed. */
  revise(goalId: string, steps: readonly PlanStepInput[], origin: WorkPlan["origin"] = "person"): WorkPlan {
    const prev = this.current(goalId);
    const goal = this.graph.goals.get(goalId);
    if (!goal) throw new Error(`no such goal: ${goalId}`);
    const parsed = steps.map((s) => PlanStepSchema.parse(s));
    const ids = new Set(parsed.map((s) => s.id));
    if (ids.size !== parsed.length) throw new Error("step ids must be unique within a plan");
    for (const s of parsed) for (const d of s.dependsOn) if (!ids.has(d)) throw new Error(`step "${s.id}" depends on "${d}", which is not in the plan`);
    return this.db.transaction(() => {
      const next = this.#write(goalId, goal.worldId, (prev?.revision ?? 0) + 1, origin, parsed, null);
      if (prev) this.db.prepare(`UPDATE work_plans SET superseded_by = ? WHERE id = ?`).run(next.id, prev.id);
      return next;
    })();
  }

  setDisposition(goalId: string, stepId: string, disposition: StepDisposition): WorkPlan {
    return this.#edit(goalId, stepId, (s) => ({ ...s, disposition }));
  }

  /** Adopt every proposed step at once — the person's "yes, this plan". */
  adoptAll(goalId: string): WorkPlan {
    const plan = this.#require(goalId);
    return this.revise(goalId, plan.steps.map((s) => s.disposition === "proposed" ? { ...s, disposition: "adopted" as const } : s));
  }

  edit(goalId: string, stepId: string, patch: { purpose?: string; expectedResult?: string; kind?: PlanStep["kind"] }): WorkPlan {
    return this.#edit(goalId, stepId, (s) => ({ ...s, ...(patch.purpose !== undefined ? { purpose: patch.purpose } : {}),
      ...(patch.expectedResult !== undefined ? { expectedResult: patch.expectedResult } : {}), ...(patch.kind ? { kind: patch.kind } : {}) }));
  }

  reorder(goalId: string, order: readonly string[]): WorkPlan {
    const plan = this.#require(goalId);
    const byId = new Map(plan.steps.map((s) => [s.id, s]));
    if (order.length !== plan.steps.length || order.some((id) => !byId.has(id))) throw new Error("the order must name every step once");
    return this.revise(goalId, order.map((id) => byId.get(id)!));
  }

  addStep(goalId: string, input: { kind: PlanStep["kind"]; purpose: string; expectedResult?: string; completionRule?: CompletionRule; after?: string | null }): WorkPlan {
    const plan = this.#require(goalId);
    const step: PlanStepInput = {
      id: `p.${newId().slice(0, 8)}`, kind: input.kind, purpose: input.purpose, expectedResult: input.expectedResult ?? "",
      completionRule: input.completionRule ?? { kind: "person_confirms" }, dependsOn: input.after ? [input.after] : [],
      disposition: "adopted", inputs: [],
    };
    const at = input.after ? plan.steps.findIndex((s) => s.id === input.after) + 1 : plan.steps.length;
    const steps = [...plan.steps]; steps.splice(at, 0, PlanStepSchema.parse(step));
    return this.revise(goalId, steps);
  }

  /** Replace a step with a new one: the old is marked replaced and stays; the new follows it. */
  replaceStep(goalId: string, stepId: string, input: { kind: PlanStep["kind"]; purpose: string; expectedResult?: string; completionRule?: CompletionRule }): WorkPlan {
    const plan = this.#require(goalId);
    const old = plan.steps.find((s) => s.id === stepId);
    if (!old) throw new Error(`no such step: ${stepId}`);
    const replacement = PlanStepSchema.parse({
      id: `p.${newId().slice(0, 8)}`, kind: input.kind, purpose: input.purpose, expectedResult: input.expectedResult ?? "",
      completionRule: input.completionRule ?? old.completionRule, dependsOn: old.dependsOn, disposition: "adopted", inputs: old.inputs,
    });
    const steps = plan.steps.flatMap((s) => s.id === stepId ? [{ ...s, disposition: "replaced" as const }, replacement] : [s])
      .map((s) => ({ ...s, dependsOn: s.dependsOn.map((d) => d === stepId ? replacement.id : d) }));
    return this.revise(goalId, steps);
  }

  /** Pin a step to what it works from, at the version that exists now. */
  setInputs(goalId: string, stepId: string, objectIds: readonly string[], role = "input"): WorkPlan {
    return this.#edit(goalId, stepId, (s) => ({
      ...s, inputs: objectIds.map((objectId) => ({ objectId, versionId: this.graph.currentState(objectId)?.versionId ?? null, role })),
    }));
  }

  /* ---------------------------------------------------------------- work state */

  work(goalId: string): StepWork[] {
    return (this.db.prepare(`SELECT * FROM step_work WHERE goal_id = ? ORDER BY updated_at`).all(goalId) as WorkRow[]).map(workFromRow);
  }

  workOf(goalId: string, stepId: string): StepWork | null {
    const r = this.db.prepare(`SELECT * FROM step_work WHERE goal_id = ? AND step_id = ?`).get(goalId, stepId) as WorkRow | undefined;
    return r ? workFromRow(r) : null;
  }

  /**
   * Record how a step stands. `complete` is refused unless the step's rule holds in the graph,
   * or the rule is `person_confirms` and a note is given — a person's word is evidence, and it
   * is recorded as such.
   */
  setExecution(goalId: string, stepId: string, execution: StepExecution, opts: { evidence?: StepEvidence[]; note?: string } = {}): StepWork {
    const plan = this.#require(goalId);
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`no such step: ${stepId}`);
    const evidence = [...(this.workOf(goalId, stepId)?.evidence ?? []), ...(opts.evidence ?? [])];
    if (execution === "complete") {
      const found = this.#ruleEvidence(plan.worldId, step);
      if (found) evidence.push(found);
      else if (step.completionRule.kind === "person_confirms" && (opts.note ?? "").trim().length >= 4) {
        evidence.push({ kind: "note", id: `note-${now()}`, at: now(), by: "person" });
      } else {
        throw new NotComplete(step, this.#ruleWords(step.completionRule));
      }
    }
    const note = opts.note ?? this.workOf(goalId, stepId)?.note ?? "";
    this.db.prepare(
      `INSERT INTO step_work (goal_id, step_id, execution, evidence, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(goal_id, step_id) DO UPDATE SET execution = excluded.execution, evidence = excluded.evidence, note = excluded.note, updated_at = excluded.updated_at`,
    ).run(goalId, stepId, execution, JSON.stringify(evidence), note, now());
    this.graph.goals.touch(plan.worldId);
    return this.workOf(goalId, stepId)!;
  }

  attachEvidence(goalId: string, stepId: string, evidence: StepEvidence): StepWork {
    const current = this.workOf(goalId, stepId);
    return this.setExecution(goalId, stepId, current?.execution ?? "in_progress", { evidence: [evidence] });
  }

  /**
   * A requirement changed. Every adopted step that pinned an older version of it is now
   * `needs_review` — with its evidence untouched and a note saying why. Nothing is un-done.
   */
  onRequirementChanged(goalId: string, objectId: string): string[] {
    const plan = this.current(goalId);
    if (!plan) return [];
    const currentVersion = this.graph.currentState(objectId)?.versionId ?? null;
    const flagged: string[] = [];
    for (const step of plan.steps) {
      if (step.disposition !== "adopted") continue;
      const pinned = step.inputs.find((i) => i.objectId === objectId);
      if (!pinned || pinned.versionId === null || pinned.versionId === currentVersion) continue;
      const work = this.workOf(goalId, step.id);
      if (!work || work.execution === "not_started" || work.execution === "needs_review") continue;
      const title = this.graph.currentState(objectId)?.properties.title ?? "a requirement";
      this.db.prepare(`UPDATE step_work SET execution = 'needs_review', note = ?, updated_at = ? WHERE goal_id = ? AND step_id = ?`)
        .run(`${work.note ? `${work.note}\n` : ""}${title} changed after this step was worked on.`, now(), goalId, step.id);
      flagged.push(step.id);
    }
    return flagged;
  }

  currentStep(goalId: string): PlanStep | null {
    const plan = this.current(goalId);
    return plan ? currentStepOf(plan, this.work(goalId)) : null;
  }

  progress(goalId: string) {
    const plan = this.current(goalId);
    return plan ? planProgress(plan, this.work(goalId)) : null;
  }

  /* ---------------------------------------------------------------- internals */

  #ruleEvidence(worldId: string, step: PlanStep): StepEvidence | null {
    const rule = step.completionRule;
    switch (rule.kind) {
      case "form_exists": {
        const row = this.db.prepare(
          `SELECT v.id FROM objects o JOIN versions v ON v.id = o.current_version_id JOIN version_forms f ON f.version_id = v.id
           WHERE o.world_id = ? AND f.role = ? LIMIT 1`,
        ).get(worldId, rule.role) as { id: string } | undefined;
        return row ? { kind: "version", id: row.id, at: now(), by: "rule" } : null;
      }
      case "decision_accepted": {
        const ids = step.inputs.map((i) => i.objectId);
        const accepted = this.graph.decisions.list(worldId, "accepted").find((d) => ids.length === 0 || ids.includes(d.objectId));
        return accepted ? { kind: "decision", id: accepted.objectId, at: now(), by: "rule" } : null;
      }
      case "claim_reviewed": {
        const row = this.db.prepare(
          `SELECT cs.id FROM claim_support cs JOIN objects o ON o.id = cs.claim_object_id WHERE o.world_id = ? AND cs.checked_by = 'human' LIMIT 1`,
        ).get(worldId) as { id: string } | undefined;
        return row ? { kind: "source_version", id: row.id, at: now(), by: "rule" } : null;
      }
      case "receipt_confirmed": {
        const row = this.db.prepare(
          `SELECT r.object_id FROM action_receipts r JOIN objects o ON o.id = r.object_id WHERE o.world_id = ? AND r.outcome = 'succeeded' LIMIT 1`,
        ).get(worldId) as { object_id: string } | undefined;
        return row ? { kind: "receipt", id: row.object_id, at: now(), by: "rule" } : null;
      }
      case "person_confirms": return null;
    }
  }

  #ruleWords(rule: CompletionRule): string {
    switch (rule.kind) {
      case "form_exists": return `${rule.role} exists at the current version`;
      case "decision_accepted": return "an accepted decision";
      case "claim_reviewed": return "a claim reviewed by a person against its source";
      case "receipt_confirmed": return "a confirmed receipt";
      case "person_confirms": return "your word, with a note of at least a few words";
    }
  }

  #require(goalId: string): WorkPlan {
    const plan = this.current(goalId);
    if (!plan) throw new Error(`no plan for goal ${goalId}`);
    return plan;
  }

  #edit(goalId: string, stepId: string, fn: (s: PlanStep) => PlanStep): WorkPlan {
    const plan = this.#require(goalId);
    if (!plan.steps.some((s) => s.id === stepId)) throw new Error(`no such step: ${stepId}`);
    return this.revise(goalId, plan.steps.map((s) => s.id === stepId ? fn(s) : s));
  }

  #write(goalId: string, worldId: string, revision: number, origin: WorkPlan["origin"], steps: PlanStep[], supersededBy: string | null): WorkPlan {
    const plan = WorkPlanSchema.parse({ id: newId(), goalId, worldId, revision, origin, steps, createdAt: now(), supersededBy });
    this.db.prepare(
      `INSERT INTO work_plans (id, goal_id, world_id, revision, origin, steps, created_at, superseded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(plan.id, goalId, worldId, revision, origin, JSON.stringify(steps), plan.createdAt, supersededBy);
    return plan;
  }
}

/** A step cannot be marked complete: what its rule needs, in words. */
export class NotComplete extends Error {
  constructor(readonly step: PlanStep, readonly needs: string) {
    super(`"${step.purpose}" is not complete: it needs ${needs}.`);
    this.name = "NotComplete";
  }
}

type Row = { id: string; goal_id: string; world_id: string; revision: number; origin: WorkPlan["origin"]; steps: string; created_at: number; superseded_by: string | null };
const fromRow = (r: Row): WorkPlan => WorkPlanSchema.parse({
  id: r.id, goalId: r.goal_id, worldId: r.world_id, revision: r.revision, origin: r.origin,
  steps: JSON.parse(r.steps), createdAt: r.created_at, supersededBy: r.superseded_by,
});
type WorkRow = { goal_id: string; step_id: string; execution: StepExecution; evidence: string; note: string; updated_at: number };
const workFromRow = (r: WorkRow): StepWork => StepWorkSchema.parse({
  goalId: r.goal_id, stepId: r.step_id, execution: r.execution, evidence: JSON.parse(r.evidence), note: r.note, updatedAt: r.updated_at,
});
