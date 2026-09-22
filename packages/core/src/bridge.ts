import type { ObjectState, Representation, World } from "./object.js";
import type { DecisionDetail, InfluenceReport } from "./decisions.js";
import type { ImpactReport, OutcomeLedger, TrustFacts } from "./impact.js";
import type { EnvelopeSheet, ExitReason, ModeEnvelopeInput, ModeKind, ModeRecord, Reward, Streak } from "./modes.js";
import type { SealFacts } from "./seal.js";
import type { AvailabilityReport } from "./availability.js";
import type { Assessment, CriterionMark, JudgingSheetData, Placing, Results, SignedDocument, Ticket } from "./judging.js";
import type { PublisherRef, PublisherReport, PublisherView, ReportReason, TrustLevel } from "./publisher.js";
import type { CampaignRecord, OutboundMessage, OutreachEnvelopeInput } from "./outreach.js";
import type { ChallengeRecord, ChallengeRulesInput, EntryRecord } from "./challenges.js";
import type { TrailRow } from "./trail.js";
import type { Today } from "./today.js";
import type { FinishResult, GoalStatus, WorkGoal } from "./goal.js";
import type { StepDisposition, StepEvidence, StepExecution, StepKind, StepWork, WorkPlan } from "./plan.js";
import type { WorkPosition, WorkPositionInput } from "./position.js";
import type { Standing } from "./standing.js";
import type { SupportMap } from "./support-map.js";
import type { CandidateRecord, ClaimSupport, SupportStatus } from "./sensemaking.js";

/** What the renderer learns about a package before deciding. No manifest, no rows — the shape. */
export interface PackageInspectionView {
  ok: boolean;
  problems: string[];
  intent: "archive" | "delivery" | "share" | "critique" | null;
  relationship: "new" | "identical" | "descendant" | "ancestor" | "divergent";
  contents: { objectId: string | null; title: string; versions: number; decisions: number; sources: number; atoms: number; bytes: number };
  discloses: string[];
  publisher: PublisherView | null;
}
import type { Check, ReadinessReport, Release } from "./readiness.js";
import type { RebuildPlan, StepStatus } from "./recipe.js";
import type { DnaReport } from "./ingredients.js";
import type { Atom, FrictionState, Lane, ResolvedPassage, ThinkingMap } from "./sensemaking.js";
import type { Task, TaskEvent } from "./tasks.js";
import type { ActionRecord } from "./action.js";
import type { Scene } from "./scene.js";
import type { ConstraintRecord, ConstraintValue } from "./constraints.js";
import type { ProcessEvent, ProcessProof } from "./process.js";
import type { ComputeQuote, EconomySnapshot } from "./compute.js";
import type { CapturedWebSource, LiveSiteState, WebSettings } from "./web.js";
import type { WorkflowListing } from "./workflow.js";

export interface Rect { x: number; y: number; width: number; height: number; }

export interface LineagePayload {
  steps: Array<{ representationId: string; actionId: string | null; depth: number; representation: Representation | null }>;
  actions: ActionRecord[];
  totalUsd: number;
}

export interface VersionSummary {
  id: string; seq: number; label: string | null;
  branchId: string | null; formCount: number; createdAt: number;
}

export interface HistoryPayload {
  versions: VersionSummary[];
  branches: Array<{ id: string; name: string; headVersionId: string | null }>;
}

/** Everything the Object view needs, resolved in one round trip. */
export interface ObjectDetail {
  state: ObjectState;
  representations: Representation[];
  steps: StepStatus[];
  rebuildPlan: RebuildPlan | null;
  checks: Check[];
  readiness: ReadinessReport[];
  releases: Release[];
  history: HistoryPayload;
  dna: DnaReport;
  lineage: LineagePayload | null;
}

export interface WorldSnapshot {
  world: World;
  /** Already resolved through each Object's head version — never raw rows. */
  states: ObjectState[];
  representations: Representation[];
  tasks: Task[];
  scene: Scene | null;
}

export interface SystemInfo {
  version: string;
  /** True while plans come from the deterministic stub rather than a model. */
  brainIsMock: boolean;
  brainModel: string | null;
  capabilities: Array<{ id: string; kind: string; available: boolean; reason?: string }>;
  /** True until the person has seen the first-run scenes once (or skipped them). */
  firstRun: boolean;
}

/** One provider as the first-run scene shows it: what a key would unlock, never the key. */
export interface ModelProviderView {
  id: string;
  label: string;
  local: boolean;
  keyPresent: boolean;
  /** Whether the keychain can protect a key on this machine at all. */
  canStore: boolean;
  unlocks: { intelligence: string[]; generation: string[] };
  models: Array<{ id: string; label: string; priceVerifiedOn: string | null; callable: boolean }>;
}

export interface IntentResult {
  accepted: boolean;
  taskId: string | null;
  plan: { intent: string; tool: string; objects: string[] } | null;
  error?: string;
  /** Expensive cloud work pauses here. It is not a task until this exact quote is confirmed. */
  quote?: ComputeQuote;
}

/**
 * The entire privileged surface available to XENIUR's own interface.
 *
 * One explicit method per capability — never raw ipcRenderer, and never a generic
 * invoke(channel, payload) passthrough, which would hand the renderer every channel at
 * once and make the allowlist meaningless. Remote pages and generated code get no
 * preload at all and therefore none of this.
 */
export interface XeniurBridge {
  worlds: {
    list(): Promise<World[]>;
    create(input: { title: string; emoji: string; summary?: string }): Promise<World>;
    open(worldId: string): Promise<WorldSnapshot>;
  };
  objects: {
    get(objectId: string): Promise<ObjectState | null>;
    /** "Don't send this to AI" / "Use this for the current task": a versioned processing permission. */
    setAiProcessing(objectId: string, mode: "allowed" | "never"): Promise<ObjectState | null>;
    representations(objectId: string): Promise<Representation[]>;
    lineage(representationId: string): Promise<LineagePayload>;
    undo(objectId: string): Promise<ObjectState | null>;
    redo(objectId: string): Promise<ObjectState | null>;
  };
  intent: {
    submit(input: { worldId: string; utterance: string; selection?: string[] }): Promise<IntentResult>;
  };
  gestures: {
    choose(input: {
      worldId: string; sourceId: string; targetId: string;
      targetKind: "claim" | "object" | "print" | "delivery" | "version" | "question_lane" | "decision" | "work";
      label: string;
    }): Promise<IntentResult>;
  };
  tasks: {
    active(): Promise<Task[]>;
    approve(taskId: string): Promise<void>;
    reject(taskId: string): Promise<void>;
    cancel(taskId: string): Promise<void>;
    onEvent(handler: (event: TaskEvent, task: Task) => void): () => void;
  };
  browser: {
    open(url: string): Promise<{ viewId: string }>;
    navigate(viewId: string, url: string): Promise<void>;
    setBounds(viewId: string, rect: Rect): void;
    close(viewId: string): Promise<void>;
    status(viewId: string): Promise<LiveSiteState | null>;
  };
  web: {
    settings(): Promise<WebSettings>;
    setRiskMode(mode: WebSettings["riskMode"]): Promise<WebSettings>;
    /** Stores the readable copy as a Source and proposes candidates. Nothing is accepted here. */
    explore(worldId: string, url: string): Promise<CapturedWebSource & { sourceId: string; candidateCount: number }>;
  };
  economy: {
    snapshot(): Promise<EconomySnapshot>;
    confirm(quoteId: string): Promise<IntentResult>;
    cancel(quoteId: string): Promise<void>;
  };
  workflows: {
    list(): Promise<WorkflowListing[]>;
    apply(id: string): Promise<string>;
  };
  code: {
    files(objectId: string): Promise<Record<string, string>>;
    run(objectId: string): Promise<{ viewId: string }>;
    stop(objectId: string): Promise<void>;
  };
  blobs: { url(blobHash: string): string };
  system: {
    info(): Promise<SystemInfo>;
    /** What this build, as assembled here, can do — four honest words per feature. Read, never cached. */
    availability(): Promise<AvailabilityReport>;
  };

  /* Living Objects */
  living: {
    detail(objectId: string): Promise<ObjectDetail | null>;
    validate(objectId: string): Promise<Check[]>;
    rebuild(objectId: string, includeGeneration: boolean): Promise<ObjectDetail | null>;
    release(objectId: string, profileId: string, note?: string): Promise<Release | null>;
    switchBranch(objectId: string, branchId: string): Promise<ObjectState | null>;
    importFiles(paths: string[], input: { worldId: string; objectId?: string | null }): Promise<ObjectState[]>;
    exportPackage(objectId: string): Promise<{ path: string; bytes: number } | null>;
    /** What changed since the last delivery, split into rebuild and review. */
    impact(objectId: string): Promise<ImpactReport | null>;
  };

  /* Your models — keys stay in the keychain; the renderer only ever learns yes or no */
  models: {
    list(): Promise<ModelProviderView[]>;
    add(provider: string, key: string): Promise<ModelProviderView[]>;
    remove(provider: string): Promise<ModelProviderView[]>;
    /** A free call to the provider's models list. Never a completion. */
    verify(provider: string): Promise<{ ok: boolean; models: string[]; reason: string | null }>;
    /** The person has seen (or skipped) the first-run scenes. */
    finishFirstRun(): Promise<void>;
  };

  /* Decisions — the bridge between what was read and what was made */
  decisions: {
    list(worldId: string): Promise<DecisionDetail[]>;
    get(objectId: string): Promise<DecisionDetail | null>;
    create(input: {
      worldId: string; question: string;
      options?: Array<{ key: string; label: string; note?: string }>;
      chosenOption?: string | null; rationale?: string;
    }): Promise<DecisionDetail | null>;
    cite(objectId: string, evidence: {
      sourceVersionId?: string | null; atomObjectId?: string | null;
      relation?: "supports" | "contradicts" | "informed_by"; note?: string;
    }): Promise<DecisionDetail | null>;
    assume(objectId: string, assumption: { text: string; reviewTrigger?: string }): Promise<DecisionDetail | null>;
    /** Returns null when the steelman question still needs answering. */
    accept(objectId: string, answer?: { steelman?: string; reviewTrigger?: string; skipSteelman?: boolean }): Promise<DecisionDetail | null>;
    reaffirm(objectId: string): Promise<DecisionDetail | null>;
    /** The stored passage an atom came from, for a source chip. */
    passage(atomObjectId: string): Promise<(ResolvedPassage & { sourceTitle: string }) | null>;
    /** Which accepted decisions and source copies a delivery was made under. */
    influence(objectId: string, releaseId?: string): Promise<InfluenceReport | null>;
  };

  /* What the person is trying to accomplish — one sentence, theirs */
  goals: {
    current(worldId: string): Promise<WorkGoal | null>;
    create(worldId: string, outcome: string, focusObjectId?: string | null): Promise<WorkGoal>;
    /** Any way of working except finished — that is the outcome of `finish`. */
    setStatus(goalId: string, status: Exclude<GoalStatus, "finished">): Promise<WorkGoal | null>;
    /** Runs the completion check. Refused with what is missing; finishing anyway records a Decision. */
    finish(goalId: string, anyway?: { because: string }): Promise<FinishResult>;
    /** What the work must produce. Changing it marks plan steps that pinned an older version for review. */
    setRequiredOutputs(goalId: string, outputs: string[]): Promise<WorkGoal | null>;
    setOutcome(goalId: string, outcome: string): Promise<WorkGoal | null>;
    setFocus(goalId: string, objectId: string | null): Promise<WorkGoal | null>;
    addNextAction(goalId: string, text: string, objectId?: string | null): Promise<WorkGoal | null>;
    doneNextAction(goalId: string, actionId: string): Promise<WorkGoal | null>;
    /** The Objects the goal is about — what the centre shows around the focus. */
    relevant(goalId: string): Promise<string[]>;
    /** Where you stand: the persistent state of the work, from rows, never a model. */
    standing(goalId: string): Promise<Standing | null>;
  };

  /* What should I do with my time? — at most seven situations, never a feed */
  today: {
    get(): Promise<Today>;
  };

  /* Can I trust this work? — facts the graph can show, never a tick */
  trust: {
    facts(objectId: string): Promise<TrustFacts | null>;
    /** Every Object in a World, summed. Settled only when all are. */
    world(worldId: string): Promise<TrustFacts>;
    /** The claims behind an Object, laned by support state. */
    supportMap(objectId: string): Promise<SupportMap | null>;
    /** One signed, self-contained HTML file: report, agent trail, ledger, process record. */
    auditExport(objectId: string): Promise<{ path: string; rootHash: string }>;
    /** What a delivery cost, joined to its spend rows. Latest release when none is given. */
    outcome(objectId: string, releaseId?: string): Promise<OutcomeLedger | null>;
  };

  /* Bounded, visible, leavable contracts */
  modes: {
    /** The sheet to read before starting. Its digest is what `start` requires. */
    describe(kind: ModeKind, envelope: ModeEnvelopeInput): Promise<EnvelopeSheet>;
    start(kind: ModeKind, envelope: ModeEnvelopeInput, sheetDigest: string, worldId?: string | null): Promise<ModeRecord | null>;
    /** The same exit for every mode. */
    exit(modeId: string, reason: ExitReason): Promise<ModeRecord | null>;
    active(): Promise<ModeRecord[]>;
    restrictions(): Promise<string[]>;
  };
  /* The Arena — signed challenge documents, feeds, entry tickets */
  arena?: {
    feeds(): Promise<Array<{ url: string; label: string }>>;
    addFeed(url: string, label: string): Promise<Array<{ url: string; label: string }>>;
    removeFeed(url: string): Promise<Array<{ url: string; label: string }>>;
    /** Fetch every feed through the protected path; verify and quarantine each document. Nothing runs until asked. */
    refresh(): Promise<{ feeds: number; adopted: string[]; alreadyHere: number; refused: Array<{ feed: string; title: string; why: string }>; failed: Array<{ feed: string; why: string }> }>;
    exportChallenge(worldId: string): Promise<{ path: string }>;
    adoptChallengeFile(path: string): Promise<{ worldId: string | null; title: string | null; alreadyHere: boolean }>;
    /** The organizer signs a ticket for one participant; written to a file to send on their own channel. */
    issueTicket(worldId: string, participant: PublisherRef, expiresAt: number): Promise<{ path: string; ticket: Ticket }>;
    adoptTicketFile(path: string): Promise<Ticket>;
    ticketHeld(worldId: string): Promise<{ ticket: Ticket; usedAt: number | null; valid: boolean } | null>;
  };
  /* Judging — invited judges, signed assessments, the publisher's placings as written */
  judging?: {
    status(worldId: string): Promise<{ judgingOpenedAt: number | null; resultsPublishedAt: number | null }>;
    judges(worldId: string): Promise<Array<PublisherRef & { invitedAt: number }>>;
    isJudge(worldId: string): Promise<boolean>;
    invite(worldId: string, judge: PublisherRef): Promise<Array<PublisherRef & { invitedAt: number }>>;
    open(worldId: string): Promise<{ judgingOpenedAt: number | null; resultsPublishedAt: number | null }>;
    sheet(worldId: string, entryId: string): Promise<JudgingSheetData | null>;
    assess(worldId: string, entryId: string, criteria: CriterionMark[], note: string): Promise<Assessment>;
    assessments(worldId: string): Promise<Assessment[]>;
    exportAssessment(assessmentId: string): Promise<{ path: string }>;
    /** A signed judging or results document from elsewhere; verified before anything is written. */
    adoptFile(path: string): Promise<{ kind: string; adopted: string }>;
    publishResults(worldId: string, placings: Placing[], note: string): Promise<SignedDocument<Results>>;
    results(worldId: string): Promise<SignedDocument<Results> | null>;
    exportResults(worldId: string): Promise<{ path: string }>;
  };
  /* Where the person was, exactly. Restoring it grants nothing. */
  position?: {
    save(input: Omit<WorkPositionInput, "savedAt">): Promise<WorkPosition>;
    get(worldId: string): Promise<WorkPosition | null>;
  };
  /* The plan — a versioned proposal of steps, and the work recorded against them, apart */
  plans?: {
    current(goalId: string): Promise<WorkPlan | null>;
    /** A first plan from the goal's words, by template. Every step proposed, none adopted. */
    propose(goalId: string): Promise<WorkPlan>;
    adoptAll(goalId: string): Promise<WorkPlan>;
    setDisposition(goalId: string, stepId: string, disposition: StepDisposition): Promise<WorkPlan>;
    edit(goalId: string, stepId: string, patch: { purpose?: string; expectedResult?: string; kind?: StepKind }): Promise<WorkPlan>;
    reorder(goalId: string, order: string[]): Promise<WorkPlan>;
    addStep(goalId: string, input: { kind: StepKind; purpose: string; expectedResult?: string; after?: string | null }): Promise<WorkPlan>;
    replaceStep(goalId: string, stepId: string, input: { kind: StepKind; purpose: string; expectedResult?: string }): Promise<WorkPlan>;
    setInputs(goalId: string, stepId: string, objectIds: string[]): Promise<WorkPlan>;
    /** Complete is refused in words when the step's rule does not hold in the graph. */
    setExecution(goalId: string, stepId: string, execution: StepExecution, note?: string): Promise<{ work: StepWork | null; refused: string | null }>;
    attachEvidence(goalId: string, stepId: string, evidence: StepEvidence): Promise<StepWork>;
    work(goalId: string): Promise<StepWork[]>;
  };
  /* The Sealed Session — heartbeats while it runs, facts read from them */
  seal?: {
    active(): Promise<ModeRecord | null>;
    beat(modeId: string, focusObjectId: string | null, versionId: string | null): Promise<void>;
    facts(entryObjectId: string): Promise<SealFacts | null>;
    /** A paste, as the surface saw it. A fact about origin, never about a model. */
    paste(objectId: string, versionId: string | null, chars: number, sourceObjectId?: string | null): Promise<ProcessEvent>;
  };
  rhythm: {
    /** One offer if one is due and the graph holds something matched to the focus; else null. */
    offer(worldId: string, objectId: string | null): Promise<{ id: string; reward: Reward } | null>;
    resolve(offerId: string, outcome: "taken" | "skipped"): Promise<void>;
    streak(): Promise<Streak>;
  };

  /* Packages from elsewhere — inspected before anything is written */
  packages: {
    /** Everything about a .xeniur file that can be known without opening it. */
    inspect(path: string): Promise<PackageInspectionView>;
    /** Opens it: as someone else's work for review, or into a World of yours. */
    import(path: string, input: { as: "work" | "critique"; worldId?: string | null }): Promise<{
      objectId: string; worldId: string; alreadyPresent: boolean;
    }>;
  };

  /* Challenges — explicit Worlds with signed rules and an AI policy */
  challenges: {
    list(): Promise<ChallengeRecord[]>;
    get(worldId: string): Promise<ChallengeRecord | null>;
    /** Challenges open now whose deliverable overlaps this person's work, not yet dismissed. */
    matching(): Promise<ChallengeRecord[]>;
    dismiss(worldId: string): Promise<void>;
    /** Publish one from this machine, signed by its identity. */
    create(rules: ChallengeRulesInput): Promise<ChallengeRecord>;
    enter(worldId: string, objectId: string): Promise<EntryRecord>;
    /** Entries visible now: yours while open; everyone's, in arrival order, after close. */
    entries(worldId: string): Promise<EntryRecord[]>;
    evaluate(worldId: string, objectId: string): Promise<EntryRecord | null>;
  };

  /* Delegated outreach — one approval over one envelope; every send receipted */
  outreach: {
    /** The sheet: what a campaign would allow, as lines, plus the digest an approval must echo. */
    describe(envelope: OutreachEnvelopeInput): Promise<{ lines: Array<{ label: string; value: string }>; digest: string; needsCampaign: boolean }>;
    /** Creates the campaign from the envelope the sheet showed. The approval is recorded here, once. */
    create(worldId: string, envelope: OutreachEnvelopeInput, digest: string): Promise<CampaignRecord>;
    send(campaignId: string, message: OutboundMessage): Promise<{ outcome: "sent" | "refused" | "failed"; reason: string | null; receiptObjectId: string }>;
    list(worldId: string): Promise<CampaignRecord[]>;
    revoke(campaignId: string): Promise<CampaignRecord | null>;
    /** Whether anything can actually leave. False until a mail key exists. */
    transportConfigured(): Promise<boolean>;
  };

  /* Who sent what — identity, trust the person set, block and report */
  publishers: {
    /** This machine's identity; created on first call. Public key and name only. */
    self(): Promise<{ publicKey: string; displayName: string }>;
    list(): Promise<PublisherView[]>;
    setTrust(publicKey: string, displayName: string, level: TrustLevel): Promise<PublisherView>;
    report(publicKey: string, displayName: string, reason: ReportReason, note?: string): Promise<PublisherReport>;
  };

  constraints: {
    list(worldId: string): Promise<ConstraintRecord[]>;
    setValue(objectId: string, value: ConstraintValue): Promise<ConstraintRecord | null>;
  };

  process: {
    proof(objectId: string): Promise<ProcessProof>;
    publish(objectId: string, privacy?: "filtered" | "public"): Promise<ProcessProof>;
    exportPage(input: { objectId: string; eventIds: string[]; discloseHashes: boolean; discloseTiming: boolean }): Promise<{ path: string; rootHash: string }>;
  };

  metrics: {
    record(kind: "gesture_used" | "typed_instead", concept: string): Promise<void>;
  };

  /* Sensemaking */
  sense: {
    map(worldId: string): Promise<ThinkingMap | null>;
    friction(worldId: string): Promise<FrictionState>;
    dismissFriction(worldId: string, reason?: string): Promise<void>;
    /** Stores the copy as a Source version and proposes candidates. Accepting is a separate act. */
    capture(input: {
      worldId: string; kind: string; title: string; text: string;
      url?: string; author?: string;
    }): Promise<{ sourceId: string; candidates: CandidateRecord[] }>;
    observe(worldId: string, text: string, about?: string): Promise<Atom>;
    sort(objectId: string, lane: Lane): Promise<Atom | null>;
    rate(objectId: string, confidence: number | null): Promise<Atom | null>;
    link(input: { fromObjectId: string; toObjectId: string; relation: string; note?: string }): Promise<void>;
    /** Settle whether a cited passage bears on its claim. A person's answer; a model only proposed. */
    reviewSupport(supportId: string, status: SupportStatus, note?: string): Promise<ClaimSupport | null>;
    pendingCandidates(worldId: string): Promise<CandidateRecord[]>;
    /** Find the basis: the passage behind a claim, with a support row to review for each cited copy. */
    basis(claimObjectId: string): Promise<{ passage: (ResolvedPassage & { sourceTitle: string }) | null; support: ClaimSupport[] }>;
    /** Connect it: relationships the graph already knows, each with why it may connect. */
    connections(objectId: string): Promise<Array<{ objectId: string; title: string; because: string; by: string }>>;
    /** Returns null when the candidate is an assertion whose citations are unreviewed and the person did not say so. */
    acceptCandidate(candidateId: string, edit?: { acceptUnreviewed?: boolean }): Promise<Atom | null>;
    rejectCandidate(candidateId: string): Promise<void>;
  };

  /* The Brain, behind its gates — what it would see, then what it did */
  brain: {
    /** Reads a request into one of the things XENIUR can do, by rule. Null intent: choose from `nearest`. */
    resolve(utterance: string, selection: string[]): Promise<{
      intent: string | null; objects: string[]; interpretation: string; by: "rule" | "unresolved"; nearest: string[];
    }>;
    /**
     * Compiles what the model would see for this focus and intent, routes it, and opens a
     * trail row. Nothing is sent. The person reads the ContextReview and confirms the digest.
     */
    prepare(input: { worldId: string; objectId: string; intent: string; question: string }): Promise<{
      trailId: string;
      context: {
        included: Array<{ kind: string; id: string; label: string; tokens: number }>;
        excluded: Array<{ kind: string; id: string; label: string; why: string }>;
        tokens: number; includesRestricted: boolean; contextDigest: string;
        destination: "local" | "remote"; modelLabel: string | null; estimatedUsd: number;
      };
      planDigest: string;
      /** ordinary: within what was approved before · expanded: `delta` is new · consequential: acts outward. */
      level: "ordinary" | "expanded" | "consequential";
      delta: string[];
      /** True when the destination is remote and no key exists: the sheet offers model setup. */
      needsKey: boolean;
    }>;
    /** Runs exactly the prepared call. Refused if the digest is not the one shown. Approving grows the envelope. */
    ask(input: { trailId: string; contextDigest: string; planDigest: string }): Promise<{
      status: "ok" | "gated" | "refused" | "over_budget";
      reason: string | null;
      /** For research_plan: what entered as candidates. Never atoms. */
      proposed: { claims: number; steps: number; unsupported: number } | null;
      trail: TrailRow | null;
    }>;
    trail(objectId: string): Promise<TrailRow[]>;
  };
}

declare global {
  interface Window {
    /** Present only in XENIUR's own renderer. Undefined inside any browsed page. */
    xeniur?: XeniurBridge;
  }
}
