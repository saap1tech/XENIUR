import type { SceneComponentName } from "@xeniur/core";
import { primitiveFor, primitivesForTraits } from "./dimensions.js";
import type { Situation } from "./situation.js";
import { affordancesFor, type DragSubject, type GestureProposal } from "./gestures.js";
import { NEED_REPRESENTATION, needFor, type Need } from "./need.js";
import type { Interaction, Meaning } from "./dimensions.js";

export interface SemanticConcept {
  id: string;
  component: SceneComponentName;
  subjectId: string | null;
  props: Readonly<Record<string, unknown>>;
  role: "focus" | "primary" | "supporting";
}

/** Layout-free output. There are intentionally no slots or coordinates in this type. */
export interface SemanticPlan {
  worldId: string;
  title: string;
  layoutId: string;
  focusId: string;
  focusLabel: string;
  goal: Situation["goal"];
  scope: Situation["scope"];
  /** The next human question the Scene answers. */
  need: Need;
  meaning: Meaning;
  interaction: Interaction;
  disclosure: 1 | 2 | 3 | 4;
  concepts: readonly SemanticConcept[];
  affordances: readonly GestureProposal[];
}

const constraintFor = (situation: Resolved, component: SceneComponentName) => {
  const kind = component === "RangeMeter" ? "range"
    : component === "PriorityBalance" ? "priority"
      : component === "PeopleChips" ? "quantity"
        : component === "Calendar" ? "date_range"
          : component === "Stepper" ? "quantity"
            : component === "SchematicMap" ? "location" : null;
  return situation.constraints.find((constraint) => constraint.definition.kind === kind) ?? null;
};

function propsFor(component: SceneComponentName, situation: Resolved): Record<string, unknown> {
  const focusId = situation.focus.id;
  const objectIds = situation.objects.map((object) => object.id);
  const constraint = constraintFor(situation, component);
  switch (component) {
    case "ObjectOrbit": return {
      focusId, relatedIds: objectIds.filter((id) => id !== focusId),
      state: situation.taskStates[0] ?? "selected", disclosure: situation.layer,
    };
    case "AffordanceRing": return { objectId: focusId, proposalIds: [] };
    case "SpatialCanvas": return {
      focusId, objectIds,
      edges: situation.changes.map((change, index) => ({
        id: `change-${index}`, from: change.objectId, to: focusId,
        relation: change.kind, state: "changed",
      })), disclosure: situation.layer,
    };
    case "ConstraintStrip": return {
      constraintIds: situation.constraints.map((item) => item.objectId), disclosure: situation.layer,
    };
    case "RangeMeter": case "PriorityBalance": case "PeopleChips": case "Calendar": case "Stepper":
      return { constraintId: constraint?.objectId ?? focusId };
    case "SchematicMap": {
      const places = constraint?.definition.kind === "location" ? constraint.definition.places : [];
      return {
        constraintId: constraint?.objectId ?? null,
        placeIds: places.map((place) => place.id),
        selectedPlaceId: typeof constraint?.value === "string" ? constraint.value : null,
      };
    }
    case "ChoiceCards": {
      const budget = situation.constraints.find((item) => item.definition.kind === "range" &&
        item.definition.unit.toLowerCase().includes("eur"));
      const ceiling = typeof budget?.value === "number" ? budget.value : null;
      return {
        meaning: situation.meaning,
        choices: situation.choices.map((choice) => ({
          ...choice, excluded: choice.excluded || (ceiling !== null && choice.cost !== null && choice.cost > ceiling),
        })),
      };
    }
    case "EvidenceMeter": return { objectId: focusId, disclosure: situation.layer };
    case "EmptySlot": return { meaning: situation.meaning, label: situation.knowledge && situation.knowledge.unknown > 0
      ? `${situation.knowledge.unknown} still unknown — a source or a question goes here` : `Add ${situation.meaning}` };
    case "ThinkingTable": return { worldId: situation.worldId, selectedId: situation.focus.kind === "object" ? focusId : null };
    case "SupportMap": return { objectId: focusId, lanes: [], disclosure: situation.layer };
    case "FormStrip": return { objectId: focusId, selectedRole: null, showFileNames: false };
    case "ImpactReview": return { objectId: focusId, compact: situation.layer < 3 };
    case "ReadinessBoard": return { objectId: focusId, showAll: false };
    case "TrustStrip": return { objectId: focusId, compact: situation.layer < 3 };
    case "ReviewSheet": return {
      objectId: focusId, title: `Review ${situation.focus.label}`,
      sections: ["Intent", "Changes", "Evidence", "Process provenance"],
    };
    case "CompareForms": return {
      objectId: focusId, formRole: situation.objects.find((item) => item.id === focusId)?.formRoles[0] ?? "source.primary",
      leftVersionId: null, rightVersionId: null,
    };
    case "Timeline": return { objectIds, durationMs: 0 };
    case "DecisionCard": return { objectId: focusId, showEvidence: true };
    case "FocusView": {
      const focusCapability = situation.capabilities.find((capability) => capability.startsWith("focus:"));
      return { objectId: focusId, minutes: Number(focusCapability?.split(":")[1] ?? 0) };
    }
    case "RecipeGraph": return { objectId: focusId };
    case "CausalPath": {
      const change = situation.changes[0];
      return { objectId: focusId, subject: change?.subject ?? focusId, kind: change?.kind ?? "review" };
    }
    default:
      return { objectId: focusId };
  }
}

const focusComponent = (situation: Resolved): SceneComponentName =>
  situation.capabilities.some((capability) => capability.startsWith("focus:")) ? "FocusView"
    : situation.focus.kind === "decision" ? "DecisionCard"
    : situation.focus.kind === "constraints" ? "ConstraintStrip" : "ObjectOrbit";

type Resolved = Situation & { meaning: Meaning; interaction: Interaction };

/** Pure semantic compiler: it chooses the question, then concepts and affordances, never geometry. */
export function compileSituation(situationInput: Situation): SemanticPlan {
  const allowed = situationInput.scope.objectIds ? new Set(situationInput.scope.objectIds) : null;
  const scopedObjects = allowed
    ? situationInput.objects.filter((object) => allowed.has(object.id))
    : situationInput.objects;
  // Which question the person is at. The zone's meaning/interaction, when given, still win.
  const need: Need = situationInput.need ?? needFor({
    status: situationInput.goal.status, goalKind: situationInput.goal.kind, focusKind: situationInput.focus.kind,
    knowledge: situationInput.knowledge, changes: situationInput.changes.length, hasChoices: situationInput.choices.length > 0,
  });
  const representation = NEED_REPRESENTATION[need];
  const situation: Resolved = {
    ...situationInput,
    meaning: situationInput.meaning ?? representation.meaning,
    interaction: situationInput.interaction ?? representation.interaction,
    objects: scopedObjects,
    changes: allowed ? situationInput.changes.filter((change) => allowed.has(change.objectId)) : situationInput.changes,
    constraints: allowed
      ? situationInput.constraints.filter((constraint) => allowed.has(constraint.objectId))
      : situationInput.constraints,
    capabilities: situationInput.scope.externalContextAllowed
      ? situationInput.capabilities
      : situationInput.capabilities.filter((capability) => !capability.startsWith("external:")),
  };
  const focus = situation.objects.find((object) => object.id === situation.focus.id);
  const focusDrag: DragSubject = {
    id: situation.focus.id, title: situation.focus.label,
    semanticType: focus?.semanticType ?? situation.focus.kind,
  };
  const affordances = affordancesFor(situation.interaction, focusDrag, {
    targets: situation.objects.filter((object) => object.id !== situation.focus.id).map((object) => ({
      id: object.id, title: object.title,
      kind: object.semanticType.toLowerCase() === "claim" ? "claim" : "object",
      semanticType: object.semanticType,
    })),
  });

  const focusName = focusComponent(situation);
  const concepts: SemanticConcept[] = [{
    id: `focus-${focusName}`, component: focusName, subjectId: situation.focus.id,
    props: propsFor(focusName, situation), role: "focus",
  }];

  const traitPrimitives = focus ? primitivesForTraits(focus.traits, situation.interaction) : [];
  const primitives = [...new Set([...primitiveFor(situation.meaning, situation.interaction), ...traitPrimitives])];
  for (const [index, component] of primitives.entries()) {
    if (component === focusName) continue;
    concepts.push({
      id: `primitive-${component}-${index}`, component, subjectId: situation.focus.id,
      props: component === "AffordanceRing"
        ? { objectId: situation.focus.id, proposalIds: affordances.map((proposal) => proposal.id) }
        : propsFor(component, situation),
      role: index === 0 ? "primary" : "supporting",
    });
  }

  if (affordances.length > 0 && !concepts.some((concept) => concept.component === "AffordanceRing")) {
    concepts.push({
      id: "affordances", component: "AffordanceRing", subjectId: situation.focus.id,
      props: { objectId: situation.focus.id, proposalIds: affordances.map((proposal) => proposal.id) },
      role: "supporting",
    });
  }

  if (situation.constraints.length > 0 && !concepts.some((concept) => concept.component === "ConstraintStrip")) {
    concepts.push({
      id: "constraints", component: "ConstraintStrip", subjectId: situation.focus.id,
      props: propsFor("ConstraintStrip", situation), role: "supporting",
    });
  }
  if (situation.taskStates.includes("ready") && !concepts.some((concept) => concept.component === "EvidenceMeter")) {
    concepts.push({
      id: "evidence", component: "EvidenceMeter", subjectId: situation.focus.id,
      props: propsFor("EvidenceMeter", situation), role: "supporting",
    });
  }
  if (situation.taskStates.includes("missing")) {
    concepts.push({ id: "missing", component: "EmptySlot", subjectId: null,
      props: propsFor("EmptySlot", situation), role: "supporting" });
  }
  if (situation.taskStates.includes("changed") && situation.changes.length > 0) {
    concepts.push({ id: "cause", component: "CausalPath", subjectId: situation.focus.id,
      props: propsFor("CausalPath", situation), role: "supporting" });
  }
  if (situation.layer === 4 && situation.focus.kind === "object") {
    concepts.push({ id: "machinery", component: "RecipeGraph", subjectId: situation.focus.id,
      props: propsFor("RecipeGraph", situation), role: "supporting" });
  }

  // The question's own representations, laid beside the focus. Once each; the focus is never repeated.
  for (const component of representation.components) {
    if (concepts.some((concept) => concept.component === component)) continue;
    if (component === "EmptySlot" && !(situation.knowledge && situation.knowledge.unknown > 0)) continue;
    if (component === "SupportMap" && !(situation.knowledge && situation.knowledge.disputed + situation.knowledge.proposed > 0)) continue;
    if (component === "CausalPath" && situation.changes.length === 0) continue;
    if (component === "ChoiceCards" && situation.choices.length === 0) continue;
    concepts.push({
      id: `need-${component}`, component, subjectId: component === "ThinkingTable" ? null : situation.focus.id,
      props: propsFor(component, situation), role: "supporting",
    });
  }

  return {
    worldId: situation.worldId, title: situation.title,
    layoutId: `${situation.goal.kind}.${situation.meaning}.${situation.interaction}.${situation.focus.kind}`,
    focusId: situation.focus.id, focusLabel: situation.focus.label,
    goal: situation.goal, scope: situation.scope, need,
    meaning: situation.meaning, interaction: situation.interaction,
    disclosure: situation.layer as 1 | 2 | 3 | 4, concepts, affordances,
  };
}
