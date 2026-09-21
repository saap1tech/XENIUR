import type { GoalStatus } from "./goal.js";
import type { PlanStepInput, StepKind } from "./plan.js";

/**
 * A plan from the goal's own words — by rule, not by model.
 *
 * Three shapes cover most work: choosing between things (gather → compare → decide → deliver),
 * making something (gather → make → check → deliver), and finding out (gather → understand →
 * make). The verb in the sentence picks the shape; each required output adds a step whose
 * completion rule is that the form exists. Ids are stable for the same input, so re-proposing
 * the same goal yields the same steps and the work recorded against them survives.
 *
 * Every step arrives `proposed`. Nothing here is adopted for the person.
 */
export interface TemplateInput {
  outcome: string;
  status?: GoalStatus;
  requiredOutputs?: readonly string[];
  hasSources?: boolean;
  hasDecisions?: boolean;
}

export type TemplateShape = "choose" | "make" | "find_out";

const CHOOSE = /\b(choose|decide|pick|select|compare|weigh|which|between|option|alternative)\b/i;
const MAKE = /\b(make|build|design|write|draft|produce|create|prepare|deliver|ship|assemble|model|render|publish)\b/i;

export function templateShapeFor(outcome: string): TemplateShape {
  if (CHOOSE.test(outcome)) return "choose";
  if (MAKE.test(outcome)) return "make";
  return "find_out";
}

const step = (id: string, kind: StepKind, purpose: string, expectedResult: string, rule: PlanStepInput["completionRule"], dependsOn: string[] = []): PlanStepInput =>
  ({ id, kind, purpose, expectedResult, completionRule: rule, dependsOn, disposition: "proposed", inputs: [] });

export function templatePlanFor(input: TemplateInput): { shape: TemplateShape; steps: PlanStepInput[] } {
  const shape = templateShapeFor(input.outcome);
  const outputs = [...(input.requiredOutputs ?? [])];
  const steps: PlanStepInput[] = [];

  const gather = step("t.gather", "gather", "Bring in what there is to know", "The sources this rests on are here, with their exact text", { kind: "person_confirms" });
  const understand = step("t.understand", "understand", "Work out what it means", "The claims that matter are reviewed against their sources", { kind: "claim_reviewed" }, ["t.gather"]);

  switch (shape) {
    case "choose":
      steps.push(gather,
        step("t.compare", "compare", "Compare the options against what matters", "Each option is set beside the requirement it must meet", { kind: "claim_reviewed" }, ["t.gather"]),
        step("t.decide", "decide", "Choose, and say why", "An accepted decision with its reasons and what was assumed", { kind: "decision_accepted" }, ["t.compare"]));
      break;
    case "make":
      steps.push(gather,
        step("t.make", "make", "Make the thing", "The artifact exists in its current form", outputs[0] ? { kind: "form_exists", role: outputs[0] } : { kind: "person_confirms" }, ["t.gather"]),
        step("t.check", "check", "Check it against what it must satisfy", "The checks that apply have run on the current version", { kind: "person_confirms" }, ["t.make"]));
      break;
    case "find_out":
      steps.push(gather, understand,
        step("t.record", "make", "Record what was found", "A finding, a decision, or an accepted open question — written down", { kind: "person_confirms" }, ["t.understand"]));
      break;
  }

  // One step per required output the shape did not already cover, each complete when the form exists.
  const covered = new Set(steps.flatMap((s) => s.completionRule.kind === "form_exists" ? [s.completionRule.role] : []));
  for (const role of outputs) {
    if (covered.has(role)) continue;
    steps.push(step(`t.output.${role}`, "make", `Produce ${role}`, `${role} exists at the current version`, { kind: "form_exists", role }, steps.at(-1) ? [steps.at(-1)!.id] : []));
  }

  if (shape !== "find_out") {
    steps.push(step("t.deliver", "deliver", "Deliver it", "A release of the current version, and the record that goes with it", { kind: "person_confirms" }, [steps.at(-1)!.id]));
  }
  return { shape, steps };
}
