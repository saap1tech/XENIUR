import type { ObjectState, Representation, World } from "./object.js";
import type { DecisionDetail, InfluenceReport } from "./decisions.js";
import type { ImpactReport, OutcomeLedger, TrustFacts } from "./impact.js";
import type { EnvelopeSheet, ExitReason, ModeEnvelopeInput, ModeKind, ModeRecord, Reward, Streak } from "./modes.js";
import type { PublisherReport, PublisherView, ReportReason, TrustLevel } from "./publisher.js";
import type { CampaignRecord, OutboundMessage, OutreachEnvelopeInput } from "./outreach.js";

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
import type { ProcessProof } from "./process.js";
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
      targetKind: "claim" | "object" | "print" | "delivery" | "version" | "question_lane";
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
    explore(worldId: string, url: string): Promise<CapturedWebSource & { sourceId: string; atomCount: number }>;
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
  system: { info(): Promise<SystemInfo> };

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

  /* Can I trust this work? — facts the graph can show, never a tick */
  trust: {
    facts(objectId: string): Promise<TrustFacts | null>;
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
    capture(input: {
      worldId: string; kind: string; title: string; text: string;
      url?: string; author?: string;
    }): Promise<{ sourceId: string; atoms: Atom[] }>;
    observe(worldId: string, text: string, about?: string): Promise<Atom>;
    sort(objectId: string, lane: Lane): Promise<Atom | null>;
    rate(objectId: string, confidence: number | null): Promise<Atom | null>;
    link(input: { fromObjectId: string; toObjectId: string; relation: string; note?: string }): Promise<void>;
  };
}

declare global {
  interface Window {
    /** Present only in XENIUR's own renderer. Undefined inside any browsed page. */
    xeniur?: XeniurBridge;
  }
}
