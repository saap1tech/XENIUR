import type { LineageStep } from "@xeniur/graph";
import type {
  ActionRecord, Atom, Check, DecisionDetail, DnaReport, FrictionState, ImpactReport, Lane,
  ObjectState, PlanShape, ReadinessReport, RebuildPlan, Representation, ResolvedPassage,
  SourceVersion, StepStatus, Task, ThinkingMap,
} from "@xeniur/core";
import { formOf } from "@xeniur/core";

export interface LineageView {
  steps: Array<LineageStep & { representation: Representation | null }>;
  actions: ActionRecord[];
  totalUsd: number;
}

export interface VersionSummary {
  id: string;
  seq: number;
  label: string | null;
  branchId: string | null;
  formCount: number;
  createdAt: number;
}

export interface HistoryView {
  versions: VersionSummary[];
  branches: Array<{ id: string; name: string; headVersionId: string | null }>;
}

/**
 * Everything a Scene needs to render, resolved by the host before rendering. Components
 * never fetch: the renderer is a pure function of Scene JSON plus these bindings, which
 * is what makes generated interfaces predictable.
 */
export interface SceneBindings {
  /** Objects already resolved to their current state — properties and every form. */
  states: Readonly<Record<string, ObjectState>>;
  representations: Readonly<Record<string, Representation>>;
  tasks: Readonly<Record<string, Task>>;
  lineage?: Readonly<Record<string, LineageView>>;

  /* Living Objects */
  stepStates?: Readonly<Record<string, StepStatus[]>>;
  rebuildPlan?: Readonly<Record<string, RebuildPlan>>;
  checks?: Readonly<Record<string, Check[]>>;
  readiness?: Readonly<Record<string, ReadinessReport[]>>;
  history?: Readonly<Record<string, HistoryView>>;

  /* Sensemaking */
  thinkingMap?: Readonly<Record<string, ThinkingMap>>;
  friction?: Readonly<Record<string, FrictionState>>;
  dna?: Readonly<Record<string, DnaReport>>;
  atoms?: Readonly<Record<string, Atom>>;
  /** A stored passage with its surrounding words, keyed by atom object id. */
  passages?: Readonly<Record<string, ResolvedPassage & { sourceTitle: string }>>;
  sourceVersions?: Readonly<Record<string, SourceVersion>>;

  /* The calm workspace */
  impact?: Readonly<Record<string, ImpactReport>>;
  decisions?: Readonly<Record<string, DecisionDetail>>;
  /**
   * Consequential actions awaiting approval, keyed by the digest of the plan they cover.
   *
   * Keyed by digest deliberately: the preview a person reads and the authorisation that
   * gates the action are then the same object, and cannot drift apart.
   */
  pendingPlans?: Readonly<Record<string, {
    plan: PlanShape; level: string; scope: string | null; taskId: string | null;
    summary: string; reversible: boolean;
  }>>;
  /** Which form versions are being compared, resolved to representations. */
  comparisons?: Readonly<Record<string, {
    left: { versionId: string; label: string; representation: Representation | null };
    right: { versionId: string; label: string; representation: Representation | null };
  }>>;

  /** Resolves a content address to something an <img>/<video> can load. */
  blobUrl(blobHash: string): string;
  textOf?(representationId: string): string;
  projectFiles?(objectId: string): Record<string, string>;

  onSelect?(objectId: string): void;
  onSelectForm?(objectId: string, role: string): void;
  onApprove?(taskId: string): void;
  onReject?(taskId: string): void;
  onRun?(objectId: string): void;
  onStop?(objectId: string): void;
  onUndo?(objectId: string): void;
  onRedo?(objectId: string): void;
  onSwitchBranch?(objectId: string, branchId: string): void;
  onRebuild?(objectId: string, includeGeneration: boolean): void;
  onValidate?(objectId: string): void;
  onRelease?(objectId: string, profileId: string): void;
  onImport?(paths: string[], objectId: string | null): void;
  onSort?(objectId: string, lane: Lane): void;
  onDismissFriction?(worldId: string): void;
  onAddObservation?(objectId: string): void;
  onExitFocus?(): void;
  /** Ask to see how something happened — the graphs live behind this, not in front. */
  onShowHow?(objectId: string, subject: string): void;
  onOpenSource?(atomObjectId: string): void;
  onReviewed?(decisionObjectId: string): void;
  onAcceptPlan?(planDigest: string): void;
  onDeclinePlan?(planDigest: string): void;
  onCompare?(objectId: string, formRole: string): void;
  onConvertToDecision?(atomObjectId: string): void;
  onLink?(fromObjectId: string, toObjectId: string): void;
}

export const emptyBindings = (): SceneBindings => ({
  states: {}, representations: {}, tasks: {}, blobUrl: () => "",
});

/**
 * The representation a card or viewport should show, resolved through the head version.
 *
 * Deliberately not "the most recently created representation for this object": that
 * ignores the version pointer entirely, so undoing moves the head and the interface keeps
 * showing the newer form as if nothing happened.
 */
export function displayForm(
  bindings: SceneBindings, objectId: string, preferredRoles?: readonly string[],
): Representation | null {
  const state = bindings.states[objectId];
  if (!state) return null;

  const roles = preferredRoles ?? [
    "preview.thumbnail", "delivery.godot", "delivery.web", "art.primary", "art.illustration",
    "model.mesh", "print.stl", "doc.primary", "atom.text", "code.project", "source.primary",
  ];
  for (const role of roles) {
    const form = formOf(state, role);
    const rep = form ? bindings.representations[form.representationId] : undefined;
    if (rep) return rep;
  }
  // Any current form beats none, but never a form that is not current at this version.
  const first = state.forms[0];
  return first ? bindings.representations[first.representationId] ?? null : null;
}

/** Every form current at this version, with its representation resolved. */
export function currentForms(
  bindings: SceneBindings, objectId: string,
): Array<{ role: string; representation: Representation }> {
  const state = bindings.states[objectId];
  if (!state) return [];
  return state.forms
    .map((f) => ({ role: f.role, representation: bindings.representations[f.representationId] }))
    .filter((f): f is { role: string; representation: Representation } => f.representation !== undefined);
}
