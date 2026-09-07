import type { ObjectState, Representation, World } from "./object.js";
import type { DecisionDetail, InfluenceReport } from "./decisions.js";
import type { ImpactReport } from "./impact.js";
import type { Check, ReadinessReport, Release } from "./readiness.js";
import type { RebuildPlan, StepStatus } from "./recipe.js";
import type { DnaReport } from "./ingredients.js";
import type { Atom, FrictionState, Lane, ResolvedPassage, ThinkingMap } from "./sensemaking.js";
import type { Task, TaskEvent } from "./tasks.js";
import type { ActionRecord } from "./action.js";
import type { Scene } from "./scene.js";

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
}

export interface IntentResult {
  accepted: boolean;
  taskId: string | null;
  plan: { intent: string; tool: string; objects: string[] } | null;
  error?: string;
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
    accept(objectId: string): Promise<DecisionDetail | null>;
    reaffirm(objectId: string): Promise<DecisionDetail | null>;
    /** The stored passage an atom came from, for a source chip. */
    passage(atomObjectId: string): Promise<(ResolvedPassage & { sourceTitle: string }) | null>;
    /** Which accepted decisions and source copies a delivery was made under. */
    influence(objectId: string, releaseId?: string): Promise<InfluenceReport | null>;
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
