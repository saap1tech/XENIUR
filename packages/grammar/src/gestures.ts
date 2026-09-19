import type { ActionPlan, SemanticRelation } from "@xeniur/core";
import type { Interaction } from "./dimensions.js";

export interface DragSubject {
  id: string;
  title: string;
  semanticType: string;
  versionId?: string;
}

export interface DropTarget {
  id: string;
  title: string;
  kind: "claim" | "object" | "print" | "delivery" | "version" | "question_lane" | "decision" | "work";
  semanticType?: string;
  versionId?: string;
}

export interface SemanticLinkDraft {
  kind: "semantic_link";
  fromObjectId: string;
  toObjectId: string;
  relation: SemanticRelation;
  note: string;
}

export interface CompositionDraft {
  kind: "composition";
  fromObjectId: string;
  toObjectId: string;
}

export interface ConstraintDraft {
  kind: "constraint";
  passageId: string;
  questionLaneId: string;
}

export interface DecisionOptionDraft {
  kind: "decision_option";
  decisionId: string;
  label: string;
  note: string;
  fromObjectId: string;
}

export interface NextActionDraft {
  kind: "next_action";
  questionId: string;
  text: string;
}

export interface ActionPlanOutcome { kind: "action"; plan: ActionPlan; }
export type GestureOutcome = ActionPlanOutcome | SemanticLinkDraft | CompositionDraft | ConstraintDraft | DecisionOptionDraft | NextActionDraft;

export interface GestureProposal {
  id: string;
  label: string;
  interaction: Interaction;
  outcome: GestureOutcome;
  reversible: boolean;
  because: string;
}

export interface RuntimeRegistry { targets: readonly DropTarget[]; }

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const idFor = (source: DragSubject, target: DropTarget, label: string): string =>
  `${slug(source.id)}-${slug(target.id)}-${slug(label)}`;
const because = (source: DragSubject, target: DropTarget, relation: string): string =>
  `${source.title} can ${relation} ${target.title}.`;

const semantic = (
  source: DragSubject, target: DropTarget, label: string, relation: SemanticRelation,
): GestureProposal => ({
  id: idFor(source, target, label), label, interaction: "connect",
  outcome: {
    kind: "semantic_link", fromObjectId: source.id, toObjectId: target.id,
    relation, note: because(source, target, label.toLowerCase()),
  },
  reversible: true, because: because(source, target, label.toLowerCase()),
});

/** Pure, closed resolution over source semantic type x target kind. */
export function proposalsFor(
  source: DragSubject, target: DropTarget, _registry?: RuntimeRegistry,
): GestureProposal[] {
  const type = source.semanticType.toLowerCase();

  // The six nouns — Source · Idea/claim · Question · Alternative · Decision · Outcome — and
  // what dropping one on another proposes. A drop proposes; the person confirms.
  const SOURCE_TYPES = new Set(["source", "article", "paper", "document", "note", "file", "image", "book", "video", "podcast"]);
  if (SOURCE_TYPES.has(type) && target.kind === "claim") return [
    semantic(source, target, "Propose as evidence", "supports"),
    semantic(source, target, "Propose as counter-evidence", "contradicts"),
  ];
  if ((type === "alternative" || type === "option" || type === "claim" || type === "concept") && target.kind === "decision") return [{
    id: idFor(source, target, "Add as an option"), label: "Add as an option", interaction: "choose",
    outcome: { kind: "decision_option", decisionId: target.id, label: source.title, note: "", fromObjectId: source.id },
    reversible: true, because: `"${source.title}" becomes one of the options of "${target.title}", unchosen.`,
  }];
  if (type === "question" && target.kind === "work") return [{
    id: idFor(source, target, "Make it a next action"), label: "Make it a next action", interaction: "commit",
    outcome: { kind: "next_action", questionId: source.id, text: source.title },
    reversible: true, because: `"${source.title}" becomes something to do next on this goal.`,
  }];
  if (type === "decision" && target.kind === "object") return [
    semantic(source, target, "Propose as influence", "satisfies"),
  ];
  if (type === "claim" && target.kind === "claim") return [
    semantic(source, target, "Supports", "supports"),
    semantic(source, target, "Contradicts", "contradicts"),
    semantic(source, target, "Connect", "informed_by"),
  ];
  if (type === "claim" && target.kind === "object") return [
    semantic(source, target, "Inform design decision", "informed_by"),
  ];
  if (target.kind === "print" && type !== "version") return [{
    id: idFor(source, target, "Prepare for print"), label: "Prepare for print", interaction: "commit",
    outcome: { kind: "action", plan: {
      intent: `Prepare ${source.title} for print`, objects: [source.id], tool: "3d.export",
      args: { format: "stl", target: target.id }, confirmation: false,
    } },
    reversible: true, because: because(source, target, "be prepared for"),
  }];
  if (target.kind === "delivery" && type !== "version") return [{
    id: idFor(source, target, "Prepare delivery"), label: "Prepare delivery", interaction: "commit",
    outcome: { kind: "action", plan: {
      intent: `Validate and package ${source.title}`, objects: [source.id], tool: "export.package",
      args: { validate: true, reviewSheet: true, target: target.id }, confirmation: false,
    } },
    reversible: true, because: because(source, target, "be validated and packaged for"),
  }];
  if (type === "version" && target.kind === "version") return [{
    id: idFor(source, target, "Compare"), label: "Compare", interaction: "compare",
    outcome: { kind: "action", plan: {
      intent: `Compare ${source.title} with ${target.title}`, objects: [source.id, target.id],
      tool: "object.update", args: { operation: "compare", left: source.versionId, right: target.versionId },
      confirmation: false,
    } }, reversible: true, because: because(source, target, "be compared with"),
  }];
  if ((type === "image" || type === "file") && target.kind === "object") return [
    semantic(source, target, "Add as source", "informed_by"),
    semantic(source, target, "Add as reference form", "review_on_change"),
  ];
  if (type === "passage" && target.kind === "question_lane") return [{
    id: idFor(source, target, "Create a Knowledge Object"), label: "Create a Knowledge Object",
    interaction: "connect", outcome: { kind: "constraint", passageId: source.id, questionLaneId: target.id },
    reversible: true, because: because(source, target, "become a knowledge object beside"),
  }];
  if (target.kind === "object" && type !== "claim" && type !== "decision") return [{
    id: idFor(source, target, "Compose"), label: "Compose", interaction: "connect",
    outcome: { kind: "composition", fromObjectId: source.id, toObjectId: target.id },
    reversible: true, because: because(source, target, "be composed with"),
  }];
  return [];
}

export function affordancesFor(
  interaction: Interaction, focus: DragSubject, registry: RuntimeRegistry,
): GestureProposal[] {
  if (interaction !== "connect" && interaction !== "commit" && interaction !== "compare") return [];
  return registry.targets.flatMap((target) => proposalsFor(focus, target, registry))
    .filter((proposal) => proposal.interaction === interaction);
}

/** Every outcome is represented as a plan before it may touch state. */
export function planForProposal(proposal: GestureProposal): ActionPlan {
  if (proposal.outcome.kind === "action") return proposal.outcome.plan;
  if (proposal.outcome.kind === "semantic_link") return {
    intent: proposal.label, objects: [proposal.outcome.fromObjectId, proposal.outcome.toObjectId],
    tool: "object.update", args: { operation: "semantic_link", ...proposal.outcome }, confirmation: false,
  };
  if (proposal.outcome.kind === "composition") return {
    intent: proposal.label, objects: [proposal.outcome.fromObjectId, proposal.outcome.toObjectId],
    tool: "object.update", args: { operation: "composition", ...proposal.outcome }, confirmation: false,
  };
  if (proposal.outcome.kind === "decision_option") return {
    intent: proposal.label, objects: [proposal.outcome.decisionId, proposal.outcome.fromObjectId],
    tool: "object.update", args: { operation: "decision_option", ...proposal.outcome }, confirmation: false,
  };
  if (proposal.outcome.kind === "next_action") return {
    intent: proposal.label, objects: [proposal.outcome.questionId],
    tool: "object.update", args: { operation: "next_action", ...proposal.outcome }, confirmation: false,
  };
  return {
    intent: proposal.label, objects: [proposal.outcome.passageId], tool: "object.create",
    args: { operation: "knowledge_object", ...proposal.outcome }, confirmation: false,
  };
}

export interface GestureCommitter<T> {
  guard(plan: ActionPlan): T;
  apply(outcome: GestureOutcome, decision: T): void;
}

/** A proposal is inert until chosen; choosing has one route and that route starts at guard. */
export function chooseProposal<T>(proposal: GestureProposal, committer: GestureCommitter<T>): T {
  const decision = committer.guard(planForProposal(proposal));
  committer.apply(proposal.outcome, decision);
  return decision;
}
