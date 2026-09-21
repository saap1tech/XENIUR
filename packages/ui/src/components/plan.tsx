import { useState } from "react";
import type { LeafSceneNode, PlanStep, StepExecution, StepKind, StepWork, WorkPlan } from "@xeniur/core";
import { STEP_EXECUTION_WORDS, STEP_KINDS, currentStepOf, planProgress } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Button } from "./primitives.jsx";
import { t } from "../i18n.js";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * The plan, as a rail: named steps in the person's order, each with what the record says
 * about it. Proposed steps are offered, not imposed — adopt, skip, rename, reorder, replace,
 * add. None of those edits touches the work; the execution word beside each step comes from
 * `step_work`, and *complete* is only ever written when the step's rule held or the person
 * confirmed with a note. Skipped is skipped. The header line is counts, never a percentage.
 */
export function PlanBoard({ node, bindings }: { node: Node<"PlanBoard">; bindings: SceneBindings }) {
  const p = bindings.plans?.[node.goalId];
  if (!p) return null;
  return <Board plan={p.plan} work={p.work} editable={node.editable} bindings={bindings} />;
}

const KIND_GLYPH: Record<StepKind, string> = {
  gather: "◌", understand: "◐", compare: "⇄", decide: "◆", make: "▣", check: "✓", deliver: "▶", act: "↗",
};
const EXEC_GLYPH: Record<StepExecution, string> = {
  not_started: "○", in_progress: "◐", waiting: "◔", blocked: "◼", complete: "●", needs_review: "◌",
};

function Board({ plan, work, editable, bindings }: { plan: WorkPlan; work: StepWork[]; editable: boolean; bindings: SceneBindings }) {
  const byStep = new Map(work.map((w) => [w.stepId, w]));
  const current = currentStepOf(plan, work);
  const progress = planProgress(plan, work);
  const proposed = plan.steps.filter((s) => s.disposition === "proposed").length;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newPurpose, setNewPurpose] = useState("");
  const [newKind, setNewKind] = useState<StepKind>("make");
  const g = plan.goalId;
  const visible = plan.steps.filter((s) => s.disposition !== "replaced");

  return (
    <section className="xr-plan" aria-label={t("plan.aria", { sentence: progress.sentence })}>
      <p className="xr-sr">{t("sr.plan", { total: progress.total, complete: progress.complete, review: progress.needsReview, skipped: progress.skipped, proposed })}</p>
      <header className="xr-plan__head">
        <span className="xr-plan__title">{t("plan.title")}</span>
        <span className="xr-plan__progress xr-mono">{progress.sentence}</span>
      </header>
      {proposed > 0 && editable && (
        <p className="xr-plan__offer">
          {t("plan.proposed", { count: proposed })}{" "}
          <button type="button" className="xr-text-action" onClick={() => bindings.onPlanAdoptAll?.(g)}>{t("plan.adoptall")}</button>
        </p>
      )}
      <ol className="xr-plan__steps">
        {visible.map((s, i) => {
          const w = byStep.get(s.id);
          const exec: StepExecution = w?.execution ?? "not_started";
          const isCurrent = current?.id === s.id;
          return (
            <li key={s.id} className={`xr-pstep is-${s.disposition} exec-${exec}${isCurrent ? " is-current" : ""}`}>
              <button type="button" className="xr-pstep__main" onClick={() => bindings.onStepFocus?.(g, s.id)} aria-current={isCurrent ? "step" : undefined}>
                <span className="xr-pstep__glyph" aria-hidden="true">{KIND_GLYPH[s.kind]}</span>
                {editing === s.id ? (
                  <input className="xr-pstep__edit" autoFocus value={draft} aria-label={t("plan.rename")}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && draft.trim()) { bindings.onPlanEdit?.(g, s.id, { purpose: draft.trim() }); setEditing(null); }
                      if (e.key === "Escape") setEditing(null);
                    }} onBlur={() => setEditing(null)} />
                ) : <span className="xr-pstep__purpose">{s.purpose}</span>}
                <span className={`xr-pstep__exec is-${exec}`}><span aria-hidden="true">{EXEC_GLYPH[exec]}</span> {s.disposition === "skipped" ? t("plan.skipped") : s.disposition === "proposed" ? t("plan.proposedword") : STEP_EXECUTION_WORDS[exec]}</span>
              </button>
              {editable && (
                <div className="xr-pstep__tools" aria-label={t("plan.tools", { purpose: s.purpose })}>
                  {s.disposition === "proposed" && <button type="button" onClick={() => bindings.onPlanDisposition?.(g, s.id, "adopted")}>{t("plan.adopt")}</button>}
                  {s.disposition !== "skipped" && <button type="button" onClick={() => bindings.onPlanDisposition?.(g, s.id, "skipped")}>{t("plan.skip")}</button>}
                  {s.disposition === "skipped" && <button type="button" onClick={() => bindings.onPlanDisposition?.(g, s.id, "adopted")}>{t("plan.unskip")}</button>}
                  <button type="button" onClick={() => { setDraft(s.purpose); setEditing(s.id); }}>{t("plan.rename")}</button>
                  {i > 0 && <button type="button" onClick={() => bindings.onPlanReorder?.(g, move(plan.steps.map((x) => x.id), s.id, -1))}>↑</button>}
                  {i < visible.length - 1 && <button type="button" onClick={() => bindings.onPlanReorder?.(g, move(plan.steps.map((x) => x.id), s.id, +1))}>↓</button>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {editable && (adding ? (
        <form className="xr-plan__add" onSubmit={(e) => {
          e.preventDefault();
          if (!newPurpose.trim()) return;
          bindings.onPlanAddStep?.(g, { kind: newKind, purpose: newPurpose.trim() });
          setNewPurpose(""); setAdding(false);
        }}>
          <select value={newKind} onChange={(e) => setNewKind(e.target.value as StepKind)} aria-label={t("plan.kind")}>
            {STEP_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input autoFocus value={newPurpose} onChange={(e) => setNewPurpose(e.target.value)} placeholder={t("plan.addplaceholder")} aria-label={t("plan.addplaceholder")} />
          <Button type="submit">{t("plan.add")}</Button>
          <Button onClick={() => setAdding(false)}>{t("firstrun.notnow")}</Button>
        </form>
      ) : <button type="button" className="xr-text-action xr-plan__addlink" onClick={() => setAdding(true)}>{t("plan.addstep")}</button>)}
    </section>
  );
}

function move(ids: string[], id: string, by: -1 | 1): string[] {
  const at = ids.indexOf(id); const to = at + by;
  if (at < 0 || to < 0 || to >= ids.length) return ids;
  const out = [...ids]; out.splice(at, 1); out.splice(to, 0, id);
  return out;
}

/**
 * One step, in the centre's language: its purpose, what it expects, what the record says,
 * and the verbs that change the record — never the plan. *Mark complete* goes through the
 * rule; when the rule does not hold the refusal is shown in words and, only for a step that
 * takes the person's word, a note field.
 */
export function StepFocus({ node, bindings }: { node: Node<"StepFocus">; bindings: SceneBindings }) {
  const p = bindings.plans?.[node.goalId];
  if (!p) return null;
  const step = node.stepId ? p.plan.steps.find((s) => s.id === node.stepId) ?? null : currentStepOf(p.plan, p.work);
  if (!step) return <p className="xr-stepfocus__quiet">{t("plan.none")}</p>;
  return <Focus step={step} work={p.work.find((w) => w.stepId === step.id) ?? null} goalId={node.goalId} refused={bindings.stepRefusals?.[step.id] ?? null} bindings={bindings} />;
}

function Focus({ step, work, goalId, refused, bindings }: { step: PlanStep; work: StepWork | null; goalId: string; refused: string | null; bindings: SceneBindings }) {
  const [note, setNote] = useState("");
  const exec = work?.execution ?? "not_started";
  return (
    <section className="xr-stepfocus" aria-label={t("sr.step", { purpose: step.purpose, state: STEP_EXECUTION_WORDS[exec] })}>
      <header className="xr-stepfocus__head">
        <small className="xr-mono">{step.kind.toUpperCase()} · {STEP_EXECUTION_WORDS[exec]}</small>
        <h3>{step.purpose}</h3>
        {step.expectedResult && <p className="xr-stepfocus__expects">{step.expectedResult}</p>}
      </header>
      {work && work.evidence.length > 0 && (
        <ul className="xr-stepfocus__evidence">
          {work.evidence.map((e, i) => <li key={`${e.id}-${i}`}><span className="xr-mono">{e.kind}</span> {e.id.slice(0, 12)} · {e.by === "rule" ? t("plan.byrule") : t("plan.byperson")}</li>)}
        </ul>
      )}
      {work?.note && <p className="xr-stepfocus__note">{work.note}</p>}
      {refused && <p className="xr-stepfocus__refused" role="status">{refused}</p>}
      <div className="xr-stepfocus__verbs">
        {exec !== "in_progress" && exec !== "complete" && <Button onClick={() => bindings.onStepExecution?.(goalId, step.id, "in_progress")}>{t("plan.start")}</Button>}
        {exec !== "complete" && <Button variant="primary" onClick={() => bindings.onStepExecution?.(goalId, step.id, "complete", step.completionRule.kind === "person_confirms" ? note : undefined)}>{t("plan.complete")}</Button>}
        {exec === "complete" && <Button onClick={() => bindings.onStepExecution?.(goalId, step.id, "in_progress")}>{t("plan.reopen")}</Button>}
        {exec !== "blocked" && exec !== "complete" && <Button onClick={() => bindings.onStepExecution?.(goalId, step.id, "blocked")}>{t("plan.block")}</Button>}
      </div>
      {step.completionRule.kind === "person_confirms" && exec !== "complete" && (
        <input className="xr-stepfocus__confirm" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("plan.confirmplaceholder")} aria-label={t("plan.confirmplaceholder")} />
      )}
      <p className="xr-stepfocus__rule">{t("plan.rule")} {ruleWords(step)}</p>
    </section>
  );
}

function ruleWords(step: PlanStep): string {
  const r = step.completionRule;
  switch (r.kind) {
    case "form_exists": return t("plan.rule.form", { role: r.role });
    case "decision_accepted": return t("plan.rule.decision");
    case "claim_reviewed": return t("plan.rule.claim");
    case "receipt_confirmed": return t("plan.rule.receipt");
    case "person_confirms": return t("plan.rule.person");
  }
}
