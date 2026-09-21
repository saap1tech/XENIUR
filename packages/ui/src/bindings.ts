import type { LineageStep } from "@xeniur/graph";
import type {
  CandidateRecord,
  ActionRecord, Atom, Check, ClaimSupport, DecisionDetail, DnaReport, FrictionState, ImpactReport, Lane,
  ObjectState, PlanShape, ProcessProof, ReadinessReport, RebuildPlan, Representation, ResolvedPassage,
  SourceVersion, StepStatus, Task, ThinkingMap, ConstraintRecord, ConstraintValue,
} from "@xeniur/core";
import type { ChallengeRecord, EntryRecord, EnvelopeSheet, Standing as StandingData, SupportMap as SupportMapData, TrailRow, ExitReason, ModeKind, ModelProviderView, ModeRecord, TrustFacts, JudgingSheetData, CriterionMark, WorkPlan, StepWork, StepDisposition, StepKind, StepExecution } from "@xeniur/core";
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
  /** Support rows per citing Object (claim or decision), keyed by the citing Object's id. */
  support?: Readonly<Record<string, ClaimSupport[]>>;
  /** Who an Object arrived from, keyed by Object id — for "Samir's claim" rather than "their claim". */
  importedFrom?: Readonly<Record<string, { publicKey: string; displayName: string }>>;
  /** Five cells of facts per Object, for the Trust Strip. */
  trust?: Readonly<Record<string, TrustFacts>>;
  /**
   * Compiled contexts awaiting confirmation, keyed by digest — the same key the plan carries,
   * so the review a person reads and the content the model receives cannot drift apart.
   */
  contexts?: Readonly<Record<string, {
    included: Array<{ kind: string; id: string; label: string; tokens: number }>;
    excluded: Array<{ kind: string; id: string; label: string; why: string }>;
    tokens: number;
    includesRestricted: boolean;
    /** Where it would go, and what one attempt would cost. */
    destination: "local" | "remote";
    modelLabel: string | null;
    estimatedUsd: number;
  }>>;
  /** Deterministic connections per Object, for Connect it. */
  connections?: Readonly<Record<string, Array<{ objectId: string; title: string; because: string; by: string }>>>;
  /** Whether a model can be asked right now. Moves that need one are disabled with the reason when it cannot. */
  brainAvailable?: boolean;
  /** A model's proposals awaiting review, per World. */
  candidates?: Readonly<Record<string, CandidateRecord[]>>;
  /** Where you stand, per goal. */
  standings?: Readonly<Record<string, StandingData>>;
  /** The claims behind an Object, laned by support state. */
  supportMaps?: Readonly<Record<string, SupportMapData>>;
  /** Saw · decided · authorised · executed rows per Object. */
  agentTrail?: Readonly<Record<string, TrailRow[]>>;
  /** Challenges by World id, and their entries. */
  challenges?: Readonly<Record<string, ChallengeRecord>>;
  challengeEntries?: Readonly<Record<string, EntryRecord[]>>;
  /** This machine's publisher key, so "your entry" can be told from the rest. */
  selfPublicKey?: string | null;
  /** The Object in the centre, so a challenge can be entered from where the person is. */
  focusObjectId?: string | null;
  /** Envelope sheets awaiting a verb, keyed by digest — what `start` will be asked to echo. */
  modeSheets?: Readonly<Record<string, EnvelopeSheet>>;
  /** Modes by id; only a running one renders. */
  modes?: Readonly<Record<string, ModeRecord>>;
  /** The providers as the first-run scene shows them. Never a key. */
  modelProviders?: readonly ModelProviderView[];
  /** The last verification result per provider, for the tag beside the card. */
  modelVerification?: Readonly<Record<string, { ok: boolean; models: string[]; reason: string | null }>>;
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
  constraints?: Readonly<Record<string, ConstraintRecord>>;
  processProof?: Readonly<Record<string, ProcessProof>>;
  gestureProposals?: Readonly<Record<string, {
    id: string; label: string; because: string; reversible: boolean;
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
  onAddModelKey?(provider: string, key: string): void;
  onRemoveModelKey?(provider: string): void;
  onVerifyModel?(provider: string): void;
  onSkipFirstRun?(): void;
  onConfirmContext?(contextDigest: string): void;
  onEnterChallenge?(challengeWorldId: string, objectId: string): void;
  onNextActionDone?(goalId: string, actionId: string): void;
  onAcceptCandidate?(candidateId: string, edit: { acceptUnreviewed?: boolean }): void;
  /** A thinking move. `basis` and `connect` are deterministic; `challenge` and `test` open Ask with an intent. */
  onThinkingMove?(move: "basis" | "challenge" | "connect" | "test", objectId: string): void;
  /** Propose a link found by Connect it; goes through the gesture route, the person confirms. */
  onProposeConnection?(fromObjectId: string, toObjectId: string): void;
  onRejectCandidate?(candidateId: string): void;
  /** Open the full "what the model sees" sheet from the compact indicator. */
  onOpenContext?(contextDigest: string): void;
  onAddNextAction?(goalId: string, text: string): void;
  /** Finish the goal: the check decides. With `anyway`, the person's reason becomes a Decision. */
  onFinish?(goalId: string, anyway?: { because: string }): void;
  /** Stop a queued or running task. Stopping future work is not undoing what already happened. */
  onCancel?(taskId: string): void;
  /** What the last Finish attempt said was missing, by goal id. Empty once it succeeds. */
  finishRefusals?: Readonly<Record<string, string[]>>;
  onStartMode?(kind: ModeKind, sheetDigest: string): void;
  onDeclineMode?(kind: ModeKind): void;
  /** Ask for the Sealed Session sheet for this entry. Nothing starts until it is read. */
  onSealSession?(challengeWorldId: string, entryObjectId: string): void;
  /** The running Sealed Session, if any, so the board can say so instead of offering another. */
  sealRunning?: ModeRecord | null;
  /** The entry ticket held here for the challenge on screen, when its rules need one. */
  ticketHeld?: { valid: boolean; usedAt: number | null; expiresAt: number } | null;
  /** The plan and the work recorded against it, by goal id. Kept apart on purpose. */
  plans?: Readonly<Record<string, { plan: WorkPlan; work: StepWork[] }>>;
  /** Why the last Mark complete was refused, by step id — the rule's words. */
  stepRefusals?: Readonly<Record<string, string>>;
  onPlanAdoptAll?(goalId: string): void;
  onPlanDisposition?(goalId: string, stepId: string, disposition: StepDisposition): void;
  onPlanEdit?(goalId: string, stepId: string, patch: { purpose?: string; expectedResult?: string }): void;
  onPlanReorder?(goalId: string, order: string[]): void;
  onPlanAddStep?(goalId: string, input: { kind: StepKind; purpose: string }): void;
  /** Change what the record says about a step. Complete goes through the rule; the host shows a refusal. */
  onStepExecution?(goalId: string, stepId: string, execution: StepExecution, note?: string): void;
  /** Put a step in the centre. */
  onStepFocus?(goalId: string, stepId: string): void;
  /** What a judge sees for one entry, by entry id. */
  judgingSheets?: Readonly<Record<string, JudgingSheetData>>;
  /** The judge marks each criterion and writes a note; the host signs and stores it. */
  onRecordAssessment?(challengeWorldId: string, entryId: string, criteria: CriterionMark[], note: string): void;
  /** Move to the next entry in arrival order. */
  onNextEntry?(challengeWorldId: string, entryId: string): void;
  /** The same exit for every mode. "emergency" is Escape; it asks nothing. */
  onExitMode?(modeId: string, reason: ExitReason): void;
  onDeclineContext?(contextDigest: string): void;
  onContinueFirstRun?(): void;
  /** A person reviews one citation. The only thing that settles it. */
  onReviewSupport?(supportId: string, status: "supported" | "contradicted" | "ambiguous"): void;
  /** A drag or its keyboard twin only asks the host for proposals. */
  onGestureTarget?(sourceId: string, targetId: string): void;
  onChooseGesture?(proposalId: string): void;
  onConstraintChange?(constraintId: string, value: ConstraintValue): void;
  onChoose?(choiceId: string): void;
  onReviewApprove?(objectId: string): void;
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

/**
 * Present: the same Scene, read-only. Every binding that could change the graph is dropped;
 * what remains is looking and pointing. A test holds this to "no on* but onSelect".
 */
export function presentBindings(b: SceneBindings): SceneBindings {
  const kept: SceneBindings = { ...emptyBindings(),
    states: b.states, representations: b.representations, tasks: b.tasks, blobUrl: b.blobUrl,
    thinkingMap: b.thinkingMap, decisions: b.decisions, impact: b.impact, constraints: b.constraints,
    processProof: b.processProof, support: b.support, trust: b.trust, passages: b.passages,
    supportMaps: b.supportMaps, agentTrail: b.agentTrail, standings: b.standings, challenges: b.challenges,
    challengeEntries: b.challengeEntries, selfPublicKey: b.selfPublicKey, focusObjectId: b.focusObjectId,
    importedFrom: b.importedFrom, sourceVersions: b.sourceVersions,
    onSelect: b.onSelect,
  };
  for (const key of Object.keys(kept) as Array<keyof SceneBindings>) {
    if (key !== "onSelect" && key.startsWith("on") && typeof kept[key] === "function") delete kept[key];
  }
  return kept;
}
