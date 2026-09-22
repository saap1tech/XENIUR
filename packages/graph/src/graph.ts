import type {
  ActionRecord, ActionStatus, Branch, Cost, EdgeKind, InputRole, Modality, ObjectForm,
  ObjectProperties, ObjectState, OutputRole, Provenance, Receipt, Relationship,
  RelationshipKind, Representation, RepresentationEdge, Version, World, XeniurObject,
  ActionPlan, PermissionLevel, SigningKeyStore,
} from "@xeniur/core";
import {
  MAIN_BRANCH, MemorySigningKeyStore, ObjectPropertiesSchema, ReadOnlyOriginal, StaleBaseVersion, addCost, defaultProperties,
  newId, now, zeroCost,
} from "@xeniur/core";
import { BlobStore } from "./blobs.js";
import { RecipeStore } from "./recipe-store.js";
import { DecisionStore } from "./decisions.js";
import { SupportStore } from "./support.js";
import { ConstraintStore } from "./constraints.js";
import { ProcessStore } from "./process.js";
import { ModeStore } from "./modes.js";
import { PublisherStore } from "./publishers.js";
import { CircleStore } from "./shared.js";
import { OutreachStore } from "./outreach.js";
import { ChallengeStore } from "./challenges.js";
import { SealStore } from "./seal.js";
import { JudgingStore } from "./judging.js";
import { TicketStore } from "./tickets.js";
import { PlanStore } from "./plans.js";
import { PositionStore } from "./positions.js";
import { GrantStore } from "./grants.js";
import { DelegatedActionStore } from "./delegated-actions.js";
import { TrailStore } from "./trail.js";
import { GoalStore } from "./goals.js";
import { EnvelopeStore } from "./envelopes.js";
import { ActionReceiptStore } from "./action-receipts.js";
import { json, openDatabase, type Db } from "./db.js";
import * as rows from "./rows.js";

export interface GraphOptions {
  dbPath: string; blobDir: string;
  /** Where this machine's signing key lives. Defaults to memory, which is right for tests only. */
  signingKeys?: SigningKeyStore;
}

export interface NewRepresentation {
  objectId: string; modality: Modality; format: string;
  blobHash?: string | null; producedByActionId?: string | null;
  provenance: Provenance; provider?: string | null; model?: string | null;
  toolVersion?: string | null; generationParams?: Record<string, unknown>;
}

export interface NewAction {
  worldId: string; taskId?: string | null; intent: string; tool: ActionRecord["tool"];
  plan: ActionPlan; permissionLevel: PermissionLevel; provenance: Provenance;
  provider?: string | null; model?: string | null; toolVersion?: string | null;
  generationParams?: Record<string, unknown>;
}

export interface LineageStep {
  representationId: string;
  /** The action that produced the *child* this step was reached from. */
  actionId: string | null;
  depth: number;
}

/**
 * The canonical XENIUR Object Graph.
 *
 * The invariant this class exists to protect: one logical thing has one uuid, forever.
 * A circle that becomes a rocket image, a mesh, a game asset and an STL is a single
 * Object wearing five representations — never five files, never five objects.
 */
export class ObjectGraph {
  /** Recipe DAGs, derivations and staleness. Reads through this graph, never caches. */
  readonly recipes: RecipeStore;
  /** Decisions, their evidence, and the review edges that hang off them. */
  readonly decisions: DecisionStore;
  /** Whether a cited passage bears on the claim or decision citing it. */
  readonly support: SupportStore;
  /** Typed problem constraints, with values committed through Object versions. */
  readonly constraints: ConstraintStore;
  /** Inspectable process history. It never estimates unrecorded human effort. */
  readonly process: ProcessStore;
  /** Durable Living Objects for consequential external effects. */
  readonly actionReceipts: ActionReceiptStore;
  /** Bounded, visible, leavable contracts. The emergency exit is one method for every kind. */
  readonly modes: ModeStore;
  /** Who sent what, how the person trusts them, and this machine's own identity. */
  readonly publishers: PublisherStore;
  /** Opt-in groups around commitments. Counts, never scores. */
  readonly circles: CircleStore;
  /** Bounded campaigns; every send a receipted COMMUNICATE. */
  readonly outreach: OutreachStore;
  /** Explicit Worlds with signed rules and an AI policy the record can be checked against. */
  readonly challenges: ChallengeStore;
  /** The Sealed Session: heartbeats and the record density read from them. */
  readonly seal: SealStore;
  /** Judging: invited judges, signed assessments, the publisher's placings as written. */
  readonly judging: JudgingStore;
  /** Entry tickets: signed by the organizer elsewhere, verified and spent once here. */
  readonly tickets: TicketStore;
  /** Plans: versioned proposals of steps, and the work recorded against them, kept apart. */
  readonly plans: PlanStore;
  /** Where the person was, exactly. Restoring it grants nothing. */
  readonly positions: PositionStore;
  /** What the person allowed, exactly — checked before reading, before sending, at dispatch. */
  readonly grants: GrantStore;
  /** Delegated actions: drafted, approved, dispatched once, and answered in four honest states. */
  readonly delegated: DelegatedActionStore;
  /** Saw · decided · authorised · executed, one row per model call or consequential action. */
  readonly trail: TrailStore;
  /** What the person is trying to accomplish, per World, in their words. */
  readonly goals: GoalStore;
  /** What a model has already been allowed to see, per World and intent. */
  readonly envelopes: EnvelopeStore;

  private constructor(readonly db: Db, readonly blobs: BlobStore, signingKeys: SigningKeyStore) {
    this.recipes = new RecipeStore(db, {
      currentState: (objectId) => this.currentState(objectId),
      blobHashOf: (representationId) => this.getRepresentation(representationId)?.blobHash ?? null,
    });
    this.decisions = new DecisionStore(this);
    this.support = new SupportStore(db);
    this.constraints = new ConstraintStore(db, this);
    this.process = new ProcessStore(db);
    this.actionReceipts = new ActionReceiptStore(db, this);
    this.modes = new ModeStore(db);
    this.seal = new SealStore(db, this.modes);
    this.publishers = new PublisherStore(db, signingKeys);
    this.circles = new CircleStore(db, this);
    this.outreach = new OutreachStore(db, this);
    this.challenges = new ChallengeStore(db, this);
    this.judging = new JudgingStore(db, this);
    this.tickets = new TicketStore(db, this);
    this.plans = new PlanStore(db, this);
    this.positions = new PositionStore(db);
    this.grants = new GrantStore(db);
    this.delegated = new DelegatedActionStore(db, this);
    this.trail = new TrailStore(db);
    this.goals = new GoalStore(db, this);
    this.envelopes = new EnvelopeStore(db);
  }

  static open(opts: GraphOptions): ObjectGraph {
    return new ObjectGraph(openDatabase(opts.dbPath), new BlobStore(opts.blobDir),
      opts.signingKeys ?? new MemorySigningKeyStore());
  }

  close(): void { this.db.close(); }

  /* ---------------------------------------------------------------- worlds */

  createWorld(input: {
    title: string; emoji: string; summary?: string;
    kind?: World["kind"]; publisherId?: string | null; id?: string;
  }): World {
    const w: World = {
      id: input.id ?? newId(), title: input.title, emoji: input.emoji,
      summary: input.summary ?? "", createdAt: now(), lastOpenedAt: null,
      kind: input.kind ?? "work", publisherId: input.publisherId ?? null,
    };
    this.db.prepare(
      `INSERT INTO worlds (id, title, emoji, summary, created_at, last_opened_at, kind, publisher_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(w.id, w.title, w.emoji, w.summary, w.createdAt, w.lastOpenedAt, w.kind, w.publisherId);
    return w;
  }

  getWorld(id: string): World | null {
    const r = this.db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(id) as rows.WorldRow | undefined;
    return r ? rows.toWorld(r) : null;
  }

  listWorlds(): World[] {
    return (this.db.prepare(`SELECT * FROM worlds ORDER BY COALESCE(last_opened_at, created_at) DESC, rowid`)
      .all() as rows.WorldRow[]).map(rows.toWorld);
  }

  touchWorld(id: string): void {
    this.db.prepare(`UPDATE worlds SET last_opened_at = ? WHERE id = ?`).run(now(), id);
  }

  /* --------------------------------------------------------------- objects */

  /**
   * Creates the Object, its `main` branch, and version 0 carrying the initial properties.
   * There is no such thing as an Object without a version: properties have to live
   * somewhere Undo can reach, and that somewhere is the version snapshot.
   */
  createObject(input: {
    worldId: string; semanticType: string; title: string;
    properties?: Partial<ObjectProperties>; parentId?: string | null;
  }): ObjectState {
    return this.db.transaction(() => {
      const t = now();
      const objectId = newId();
      this.db.prepare(
        `INSERT INTO objects (id, world_id, parent_id, current_version_id,
                              current_branch_id, created_at, archived_at)
         VALUES (?, ?, ?, NULL, NULL, ?, NULL)`,
      ).run(objectId, input.worldId, input.parentId ?? null, t);

      const branchId = newId();
      this.db.prepare(
        `INSERT INTO branches (id, object_id, name, head_version_id, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
      ).run(branchId, objectId, MAIN_BRANCH, t);
      this.db.prepare(`UPDATE objects SET current_branch_id = ? WHERE id = ?`)
        .run(branchId, objectId);

      const properties = ObjectPropertiesSchema.parse({
        ...defaultProperties(input.title, input.semanticType), ...(input.properties ?? {}),
      });
      this.#writeVersion({
        objectId, seq: 0, parentVersionId: null, branchId, properties,
        recipeId: null, causeActionId: null, label: "created", forms: [], at: t,
      });
      return this.currentState(objectId)!;
    })();
  }

  getObject(id: string): XeniurObject | null {
    const r = this.db.prepare(`SELECT * FROM objects WHERE id = ?`).get(id) as rows.ObjectRow | undefined;
    return r ? rows.toObject(r) : null;
  }

  /**
   * What an Object *is* at a given version: properties and every simultaneous form.
   *
   * This is the only correct meaning of "current" in XENIUR. Resolving it as "the most
   * recently created representation" — which the interface used to do — makes Undo
   * invisible, because undoing moves the head but creates nothing.
   */
  stateAt(versionId: string): ObjectState | null {
    const version = this.getVersion(versionId);
    if (!version) return null;
    const object = this.getObject(version.objectId);
    if (!object) return null;
    const branch = version.branchId ? this.getBranch(version.branchId) : null;
    return {
      object, versionId: version.id, seq: version.seq,
      branchId: version.branchId, branchName: branch?.name ?? null,
      properties: version.properties, forms: this.formsAt(version.id),
      recipeId: version.recipeId,
    };
  }

  currentState(objectId: string): ObjectState | null {
    const object = this.getObject(objectId);
    return object?.currentVersionId ? this.stateAt(object.currentVersionId) : null;
  }

  listObjects(worldId: string): XeniurObject[] {
    return (this.db.prepare(
      `SELECT * FROM objects WHERE world_id = ? AND archived_at IS NULL ORDER BY rowid`,
    ).all(worldId) as rows.ObjectRow[]).map(rows.toObject);
  }

  /** Every Object in a World, already resolved to its current state. */
  listStates(worldId: string): ObjectState[] {
    return this.listObjects(worldId)
      .map((o) => this.currentState(o.id))
      .filter((s): s is ObjectState => s !== null);
  }

  /**
   * Renaming, retagging or changing units commits a version — there is no in-place
   * mutation to escape through. This is the whole reason properties left the objects row.
   */
  setProperties(objectId: string, patch: Partial<ObjectProperties>, label?: string): ObjectState {
    const state = this.commitVersion({ objectId, properties: patch, label: label ?? "edited properties" });
    this.process.record({
      objectId, versionId: state.versionId, kind: "manual_edit", actor: "human",
      label: label ?? "Edited properties", tool: null, model: null,
      inputHashes: [], outputHashes: [], durationMs: 0,
    });
    return state;
  }

  archiveObject(objectId: string): void {
    this.db.prepare(`UPDATE objects SET archived_at = ? WHERE id = ?`).run(now(), objectId);
  }

  relate(fromObjectId: string, toObjectId: string, kind: RelationshipKind,
         metadata: Record<string, unknown> = {}): Relationship {
    const rel: Relationship = {
      id: newId(), fromObjectId, toObjectId, kind, metadata, createdAt: now(),
    };
    this.db.prepare(
      `INSERT OR IGNORE INTO relationships (id, from_object_id, to_object_id, kind, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(rel.id, fromObjectId, toObjectId, kind, json.stringify(metadata), rel.createdAt);
    return rel;
  }

  relationshipsOf(objectId: string): Relationship[] {
    return (this.db.prepare(
      `SELECT * FROM relationships WHERE from_object_id = ? OR to_object_id = ?`,
    ).all(objectId, objectId) as rows.RelationshipRow[]).map(rows.toRelationship);
  }

  /* ------------------------------------------------------- representations */

  /** Stores bytes content-addressed and returns the hash. Bytes never enter SQLite. */
  putBlob(data: Buffer, mime: string, ext: string): string {
    const stored = this.blobs.put(data, mime, ext);
    this.db.prepare(
      `INSERT INTO blobs (sha256, bytes, mime, ext, refcount, created_at) VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(sha256) DO NOTHING`,
    ).run(stored.sha256, stored.bytes, mime, ext, now());
    return stored.sha256;
  }

  readBlob(sha256: string): Buffer {
    const r = this.db.prepare(`SELECT ext FROM blobs WHERE sha256 = ?`).get(sha256) as { ext: string } | undefined;
    if (!r) throw new Error(`unknown blob: ${sha256}`);
    return this.blobs.read(sha256, r.ext);
  }

  addRepresentation(input: NewRepresentation): Representation {
    const rep: Representation = {
      id: newId(), objectId: input.objectId, modality: input.modality, format: input.format,
      blobHash: input.blobHash ?? null, producedByActionId: input.producedByActionId ?? null,
      provenance: input.provenance, provider: input.provider ?? null, model: input.model ?? null,
      toolVersion: input.toolVersion ?? null, generationParams: input.generationParams ?? {},
      createdAt: now(),
    };
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO representations (id, object_id, modality, format, blob_hash,
           produced_by_action_id, provenance, provider, model, tool_version,
           generation_params, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(rep.id, rep.objectId, rep.modality, rep.format, rep.blobHash,
            rep.producedByActionId, rep.provenance, rep.provider, rep.model,
            rep.toolVersion, json.stringify(rep.generationParams), rep.createdAt);
      if (rep.blobHash) {
        this.db.prepare(`UPDATE blobs SET refcount = refcount + 1 WHERE sha256 = ?`).run(rep.blobHash);
      }
    })();
    return rep;
  }

  getRepresentation(id: string): Representation | null {
    const r = this.db.prepare(`SELECT * FROM representations WHERE id = ?`).get(id) as rows.RepresentationRow | undefined;
    return r ? rows.toRepresentation(r) : null;
  }

  /**
   * In insertion order, via rowid. created_at is millisecond-resolution and a fast
   * transformation chain lands several representations in the same tick — sorting by
   * (created_at, uuid) then falls back to random order, and "the current representation"
   * becomes whichever uuid happened to sort last. rowid is the only monotonic column.
   */
  listRepresentations(objectId: string): Representation[] {
    return (this.db.prepare(
      `SELECT * FROM representations WHERE object_id = ? ORDER BY rowid`,
    ).all(objectId) as rows.RepresentationRow[]).map(rows.toRepresentation);
  }

  /* --------------------------------------------------- actions and lineage */

  /**
   * Opens an action. The row exists before any output representation is created, so
   * every representation can point at the action that produced it from the moment
   * it is written. Nothing in XENIUR may produce an unattributed representation.
   */
  beginAction(input: NewAction): ActionRecord {
    const a: ActionRecord = {
      id: newId(), taskId: input.taskId ?? null, worldId: input.worldId,
      intent: input.intent, tool: input.tool, plan: input.plan, status: "running",
      permissionLevel: input.permissionLevel, provenance: input.provenance,
      provider: input.provider ?? null, model: input.model ?? null,
      toolVersion: input.toolVersion ?? null,
      generationParams: input.generationParams ?? {},
      cost: zeroCost(), error: null, receipt: null, startedAt: now(), finishedAt: null,
    };
    this.db.prepare(
      `INSERT INTO actions (id, task_id, world_id, intent, tool, plan, status,
         permission_level, provenance, provider, model, tool_version,
         generation_params, cost, error, receipt, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(a.id, a.taskId, a.worldId, a.intent, a.tool, json.stringify(a.plan), a.status,
          a.permissionLevel, a.provenance, a.provider, a.model, a.toolVersion,
          json.stringify(a.generationParams), json.stringify(a.cost), null, null,
          a.startedAt, null);
    return a;
  }

  /**
   * Closes an action and writes its lineage. action_inputs and action_outputs are
   * canonical; representation_edges is materialised here, in the same transaction,
   * as the cross product of the two. All of it or none of it.
   */
  completeAction(actionId: string, result: {
    inputs?: ReadonlyArray<{ representationId: string; role: InputRole }>;
    outputs?: ReadonlyArray<{ representationId: string; role: OutputRole }>;
    cost?: Cost; receipt?: Receipt | null; edgeKind?: EdgeKind;
    status?: Extract<ActionStatus, "completed" | "needs_approval" | "refused">;
  } = {}): ActionRecord {
    const inputs = result.inputs ?? [];
    const outputs = result.outputs ?? [];

    this.db.transaction(() => {
      const insIn = this.db.prepare(
        `INSERT OR IGNORE INTO action_inputs (action_id, representation_id, role) VALUES (?, ?, ?)`);
      for (const i of inputs) insIn.run(actionId, i.representationId, i.role);

      const insOut = this.db.prepare(
        `INSERT OR IGNORE INTO action_outputs (action_id, representation_id, role) VALUES (?, ?, ?)`);
      for (const o of outputs) insOut.run(actionId, o.representationId, o.role);

      const insEdge = this.db.prepare(
        `INSERT OR IGNORE INTO representation_edges
           (from_representation_id, to_representation_id, action_id, kind) VALUES (?, ?, ?, ?)`);
      for (const i of inputs) {
        for (const o of outputs) {
          if (i.representationId === o.representationId) continue; // never a self-edge
          const kind = result.edgeKind ?? this.inferEdgeKind(i.representationId, o.representationId, inputs.length);
          insEdge.run(i.representationId, o.representationId, actionId, kind);
        }
      }

      this.db.prepare(
        `UPDATE actions SET status = ?, cost = ?, receipt = ?, finished_at = ? WHERE id = ?`,
      ).run(result.status ?? "completed", json.stringify(result.cost ?? zeroCost()),
            result.receipt ? json.stringify(result.receipt) : null, now(), actionId);
    })();

    const a = this.getAction(actionId);
    if (!a) throw new Error(`no such action: ${actionId}`);
    if ((result.status ?? "completed") === "completed" && outputs.length > 0) {
      const objectIds = [...new Set(outputs.map((output) => this.getRepresentation(output.representationId)?.objectId)
        .filter((id): id is string => Boolean(id)))];
      const inputHashes = inputs.map((input) => this.getRepresentation(input.representationId)?.blobHash)
        .filter((hash): hash is string => Boolean(hash));
      const outputHashes = outputs.map((output) => this.getRepresentation(output.representationId)?.blobHash)
        .filter((hash): hash is string => Boolean(hash));
      const actor = a.provenance === "generated" ? "model" : a.provenance === "human" || a.provenance === "imported" ? "human" : "tool";
      const kind = a.tool === "import.file" ? "source_collected" : actor === "model" ? "model_step" : actor === "human" ? "manual_edit" : "tool_used";
      for (const objectId of objectIds) this.process.record({
        objectId, versionId: this.currentState(objectId)?.versionId ?? null,
        kind, actor, label: a.intent, tool: a.tool, model: a.model,
        inputHashes, outputHashes, durationMs: a.finishedAt === null ? 0 : a.finishedAt - a.startedAt,
      });
    }
    if (a.receipt && ["browser.fill", "browser.click", "browser.submit"].includes(a.tool)) {
      this.actionReceipts.record(a.id, a.receipt);
    }
    return a;
  }

  failAction(actionId: string, error: string, cost: Cost = zeroCost()): ActionRecord {
    this.db.prepare(
      `UPDATE actions SET status = 'failed', error = ?, cost = ?, finished_at = ? WHERE id = ?`,
    ).run(error, json.stringify(cost), now(), actionId);
    const a = this.getAction(actionId);
    if (!a) throw new Error(`no such action: ${actionId}`);
    return a;
  }

  /** Same format in and out is an edit; a different format is a conversion; many-to-one composes. */
  private inferEdgeKind(fromRepId: string, toRepId: string, inputCount: number): EdgeKind {
    if (inputCount > 1) return "composed_from";
    const from = this.getRepresentation(fromRepId);
    const to = this.getRepresentation(toRepId);
    if (!from || !to) return "derived_from";
    if (from.modality === to.modality) return from.format === to.format ? "edited_from" : "converted_from";
    return "derived_from";
  }

  getAction(id: string): ActionRecord | null {
    const r = this.db.prepare(`SELECT * FROM actions WHERE id = ?`).get(id) as rows.ActionRow | undefined;
    return r ? rows.toAction(r) : null;
  }

  inputsOf(actionId: string): Array<{ representation: Representation; role: InputRole }> {
    const rs = this.db.prepare(
      `SELECT r.*, ai.role AS __role FROM action_inputs ai
       JOIN representations r ON r.id = ai.representation_id
       WHERE ai.action_id = ? ORDER BY ai.role`,
    ).all(actionId) as Array<rows.RepresentationRow & { __role: string }>;
    return rs.map((r) => ({ representation: rows.toRepresentation(r), role: r.__role as InputRole }));
  }

  outputsOf(actionId: string): Array<{ representation: Representation; role: OutputRole }> {
    const rs = this.db.prepare(
      `SELECT r.*, ao.role AS __role FROM action_outputs ao
       JOIN representations r ON r.id = ao.representation_id
       WHERE ao.action_id = ? ORDER BY ao.role`,
    ).all(actionId) as Array<rows.RepresentationRow & { __role: string }>;
    return rs.map((r) => ({ representation: rows.toRepresentation(r), role: r.__role as OutputRole }));
  }

  /**
   * Walks backwards through representation lineage. This is the query the whole schema
   * exists to make possible: *this STL came from this GLB, generated from this rocket
   * image, which came from that original circle* — across modalities, inside one Object.
   *
   * UNION rather than UNION ALL so a diamond lineage does not blow up exponentially;
   * the depth bound stops anything pathological.
   */
  ancestryOf(representationId: string, maxDepth = 64): LineageStep[] {
    const rs = this.db.prepare(
      `WITH RECURSIVE ancestry(rep_id, action_id, depth) AS (
         SELECT ?, NULL, 0
         UNION
         SELECT e.from_representation_id, e.action_id, a.depth + 1
         FROM representation_edges e
         JOIN ancestry a ON e.to_representation_id = a.rep_id
         WHERE a.depth < ?
       )
       SELECT rep_id, action_id, depth FROM ancestry ORDER BY depth, rep_id`,
    ).all(representationId, maxDepth) as Array<{ rep_id: string; action_id: string | null; depth: number }>;
    return rs.map((r) => ({ representationId: r.rep_id, actionId: r.action_id, depth: r.depth }));
  }

  /** Every action that contributed to a representation, nearest first. */
  actionsInLineage(representationId: string, maxDepth = 64): ActionRecord[] {
    const ids = new Set<string>();
    for (const step of this.ancestryOf(representationId, maxDepth)) {
      if (step.actionId) ids.add(step.actionId);
      // Every root in the ancestry counts, not just the target. A separately generated
      // style reference has no inbound edge but still cost money to make, and dropping it
      // understates what the outcome actually cost.
      const rep = this.getRepresentation(step.representationId);
      if (rep?.producedByActionId) ids.add(rep.producedByActionId);
    }

    const out: ActionRecord[] = [];
    for (const id of ids) { const a = this.getAction(id); if (a) out.push(a); }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }

  /** "This STL cost $0.42 across 4 actions." */
  costOfLineage(representationId: string, maxDepth = 64): Cost {
    return this.actionsInLineage(representationId, maxDepth)
      .reduce<Cost>((acc, a) => addCost(acc, a.cost), zeroCost());
  }

  edgesInto(representationId: string): RepresentationEdge[] {
    return (this.db.prepare(
      `SELECT * FROM representation_edges WHERE to_representation_id = ?`,
    ).all(representationId) as rows.EdgeRow[]).map(rows.toEdge);
  }

  /**
   * representation_edges is an index over action_inputs x action_outputs, not a second
   * source of truth. This recomputes the derivation and compares. It must always be ok.
   */
  verifyLineageConsistency(): { ok: boolean; missing: RepresentationEdge[]; extra: RepresentationEdge[] } {
    const key = (e: { from: string; to: string; action: string }) => `${e.action}|${e.from}|${e.to}`;

    const expected = new Map<string, RepresentationEdge>();
    const derived = this.db.prepare(
      `SELECT i.representation_id AS f, o.representation_id AS t, i.action_id AS a
       FROM action_inputs i JOIN action_outputs o ON o.action_id = i.action_id`,
    ).all() as Array<{ f: string; t: string; a: string }>;
    for (const d of derived) {
      if (d.f === d.t) continue;
      expected.set(key({ from: d.f, to: d.t, action: d.a }),
        { fromRepresentationId: d.f, toRepresentationId: d.t, actionId: d.a, kind: "derived_from" });
    }

    const actual = new Map<string, RepresentationEdge>();
    for (const e of (this.db.prepare(`SELECT * FROM representation_edges`).all() as rows.EdgeRow[]).map(rows.toEdge)) {
      actual.set(key({ from: e.fromRepresentationId, to: e.toRepresentationId, action: e.actionId }), e);
    }

    const missing = [...expected].filter(([k]) => !actual.has(k)).map(([, v]) => v);
    const extra = [...actual].filter(([k]) => !expected.has(k)).map(([, v]) => v);
    return { ok: missing.length === 0 && extra.length === 0, missing, extra };
  }

  /**
   * The entire post-provider commit, in one transaction: representations, lineage, the
   * action's closing row, and the version snapshot.
   *
   * Previously these were five separate transactions, so a crash in the middle left
   * orphan representations and an action stuck at `running`. Blobs are written to disk
   * before this is called — a content-addressed orphan is harmless and collectable, an
   * inconsistent graph is not.
   */
  commitResult(input: {
    actionId: string;
    objectId: string;
    representations: readonly NewRepresentation[];
    /** Which output lands in which Object form role. Index-aligned with representations. */
    formRoles: readonly (string | null)[];
    inputs?: ReadonlyArray<{ representationId: string; role: InputRole }>;
    outputRoles?: readonly OutputRole[];
    cost?: Cost;
    receipt?: Receipt | null;
    model?: string | null;
    toolVersion?: string | null;
    label?: string | null;
    commitVersion?: boolean;
    /**
     * The version the work was built against. If the Object has moved on since, the
     * outputs are still stored — they cost real time and are real material — but they are
     * published to no form role and reported as a conflict rather than taking over.
     */
    expectedBaseVersionId?: string | null;
  }): {
    representations: Representation[]; action: ActionRecord; state: ObjectState | null;
    conflict: StaleBaseVersion | null;
  } {
    this.assertWritable(input.objectId);
    return this.db.transaction(() => {
      const created = input.representations.map((r) => this.addRepresentation(r));

      this.completeAction(input.actionId, {
        inputs: input.inputs ?? [],
        outputs: created.map((rep, i) => ({
          representationId: rep.id,
          role: input.outputRoles?.[i] ?? (i === 0 ? "primary" : "sidecar"),
        })),
        cost: input.cost ?? zeroCost(),
        receipt: input.receipt ?? null,
      });
      this.db.prepare(`UPDATE actions SET model = ?, tool_version = ? WHERE id = ?`)
        .run(input.model ?? null, input.toolVersion ?? null, input.actionId);

      let state: ObjectState | null = this.currentState(input.objectId);
      let conflict: StaleBaseVersion | null = null;

      // Held rather than lost: the representations and their lineage are already written,
      // so the person can look at what the job produced and decide, instead of finding it
      // silently installed over an edit they made while it ran.
      const object = this.getObject(input.objectId);
      if (input.expectedBaseVersionId !== undefined && object &&
          input.expectedBaseVersionId !== object.currentVersionId) {
        conflict = new StaleBaseVersion(
          input.objectId, input.expectedBaseVersionId ?? "(no version)", object.currentVersionId,
        );
      }

      if (conflict === null && input.commitVersion !== false && created.length > 0) {
        const forms: ObjectForm[] = [];
        created.forEach((rep, i) => {
          const role = input.formRoles[i];
          if (role) forms.push({ role, representationId: rep.id });
        });
        if (forms.length > 0) {
          state = this.commitVersion({
            objectId: input.objectId, forms,
            causeActionId: input.actionId, label: input.label ?? null,
          });
        }
      }

      const action = this.getAction(input.actionId);
      if (!action) throw new Error(`no such action: ${input.actionId}`);
      return { representations: created, action, state, conflict };
    })();
  }

  /* --------------------------------------------------- versions & branches */

  /** Raw insert. Every version goes through here so the snapshot is never partial. */
  #writeVersion(v: {
    objectId: string; seq: number; parentVersionId: string | null; branchId: string | null;
    properties: ObjectProperties; recipeId: string | null; causeActionId: string | null;
    label: string | null; forms: readonly ObjectForm[]; at: number;
  }): string {
    const id = newId();
    this.db.prepare(
      `INSERT INTO versions (id, object_id, seq, parent_version_id, branch_id, properties,
                             recipe_id, cause_action_id, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, v.objectId, v.seq, v.parentVersionId, v.branchId,
          json.stringify(v.properties), v.recipeId, v.causeActionId, v.label, v.at);

    const insForm = this.db.prepare(
      `INSERT INTO version_forms (version_id, representation_id, role) VALUES (?, ?, ?)`);
    for (const f of v.forms) insForm.run(id, f.representationId, f.role);

    if (v.branchId) {
      this.db.prepare(`UPDATE branches SET head_version_id = ? WHERE id = ?`).run(id, v.branchId);
    }
    this.db.prepare(`UPDATE objects SET current_version_id = ? WHERE id = ?`).run(id, v.objectId);
    return id;
  }

  /**
   * Commits a complete snapshot, inheriting everything not named from the parent version.
   *
   * That inheritance is the point: changing the thumbnail must not silently drop the GLB,
   * the STL and the turntable. Forms are upserted by role, properties are patched, and
   * anything untouched carries forward unchanged.
   */
  /**
   * An Object that arrived in a critique World is someone else's work. It is read here and
   * linked to; it is never changed here. The reviewer's own Objects in the same World are
   * theirs and are not affected.
   */
  assertWritable(objectId: string): void {
    const row = this.db.prepare(
      `SELECT i.publisher_id, p.display_name FROM imported_from i
       JOIN objects o ON o.id = i.object_id JOIN worlds w ON w.id = o.world_id
       LEFT JOIN publishers p ON p.id = i.publisher_id
       WHERE i.object_id = ? AND w.kind = 'critique'`,
    ).get(objectId) as { publisher_id: string; display_name: string | null } | undefined;
    if (row) throw new ReadOnlyOriginal(objectId, row.display_name ?? "someone");
  }

  commitVersion(input: {
    objectId: string;
    properties?: Partial<ObjectProperties>;
    /** Upserted by role onto the inherited set. */
    forms?: ReadonlyArray<ObjectForm>;
    /** Roles to drop from the inherited set. */
    removeForms?: readonly string[];
    recipeId?: string | null;
    causeActionId?: string | null;
    label?: string | null;
    /** Required to commit while the head is behind the branch tip; see DivergedHistory. */
    branchName?: string;
    /**
     * The version this work was built against. When it is given and no longer current,
     * the commit is refused: a job that started before an edit must not publish into the
     * head that edit created, as though it had seen it. Pass `null` to require that the
     * Object still have no version at all.
     */
    expectedBaseVersionId?: string | null;
  }): ObjectState {
    this.assertWritable(input.objectId);
    return this.db.transaction(() => {
      const object = this.getObject(input.objectId);
      if (!object) throw new Error(`no such object: ${input.objectId}`);

      // Checked inside the transaction, so nothing can move between the check and the write.
      if (input.expectedBaseVersionId !== undefined &&
          input.expectedBaseVersionId !== object.currentVersionId) {
        throw new StaleBaseVersion(
          input.objectId, input.expectedBaseVersionId ?? "(no version)", object.currentVersionId,
        );
      }

      const parent = object.currentVersionId ? this.getVersion(object.currentVersionId) : null;
      let branchId = object.currentBranchId;

      // Committing while the view is behind the branch tip would fork the branch line and
      // make redo ambiguous. Forking is fine — doing it silently is not.
      const branch = branchId ? this.getBranch(branchId) : null;
      if (branch && parent && branch.headVersionId !== parent.id) {
        if (!input.branchName) {
          throw new DivergedHistory(input.objectId, branch.name, parent.id);
        }
        branchId = this.#createBranchRow(input.objectId, input.branchName);
      }

      const properties = ObjectPropertiesSchema.parse({
        ...(parent?.properties ?? defaultProperties("Untitled", "object")),
        ...(input.properties ?? {}),
      });

      const inherited = new Map(
        (parent ? this.formsAt(parent.id) : []).map((f) => [f.role, f.representationId]),
      );
      for (const role of input.removeForms ?? []) inherited.delete(role);
      for (const f of input.forms ?? []) inherited.set(f.role, f.representationId);
      const forms: ObjectForm[] = [...inherited].map(([role, representationId]) => ({ role, representationId }));

      const maxSeq = (this.db.prepare(
        `SELECT COALESCE(MAX(seq), -1) AS s FROM versions WHERE object_id = ?`,
      ).get(input.objectId) as { s: number }).s;

      const id = this.#writeVersion({
        objectId: input.objectId, seq: maxSeq + 1, parentVersionId: parent?.id ?? null,
        branchId, properties,
        recipeId: input.recipeId !== undefined ? input.recipeId : (parent?.recipeId ?? null),
        causeActionId: input.causeActionId ?? null, label: input.label ?? null,
        forms, at: now(),
      });
      if (branchId !== object.currentBranchId) {
        this.db.prepare(`UPDATE objects SET current_branch_id = ? WHERE id = ?`)
          .run(branchId, input.objectId);
      }
      return this.stateAt(id)!;
    })();
  }

  getVersion(id: string): Version | null {
    const r = this.db.prepare(`SELECT * FROM versions WHERE id = ?`).get(id) as rows.VersionRow | undefined;
    return r ? rows.toVersion(r) : null;
  }

  /** Every form current at a version, simultaneously. */
  formsAt(versionId: string): ObjectForm[] {
    return (this.db.prepare(
      `SELECT representation_id, role FROM version_forms WHERE version_id = ? ORDER BY role`,
    ).all(versionId) as rows.VersionFormRow[])
      .map((r) => ({ role: r.role, representationId: r.representation_id }));
  }

  formAt(versionId: string, role: string): Representation | null {
    const row = this.db.prepare(
      `SELECT representation_id FROM version_forms WHERE version_id = ? AND role = ?`,
    ).get(versionId, role) as { representation_id: string } | undefined;
    return row ? this.getRepresentation(row.representation_id) : null;
  }

  versionChain(objectId: string): Version[] {
    return (this.db.prepare(`SELECT * FROM versions WHERE object_id = ? ORDER BY seq`)
      .all(objectId) as rows.VersionRow[]).map(rows.toVersion);
  }

  /** The path from a version back to the root, following parent pointers. */
  versionAncestry(versionId: string): Version[] {
    const out: Version[] = [];
    let cursor: string | null = versionId;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const v: Version | null = this.getVersion(cursor);
      if (!v) break;
      out.push(v);
      cursor = v.parentVersionId;
    }
    return out;
  }

  headOf(objectId: string): Version | null {
    const o = this.getObject(objectId);
    return o?.currentVersionId ? this.getVersion(o.currentVersionId) : null;
  }

  setHead(objectId: string, versionId: string | null): void {
    this.db.prepare(`UPDATE objects SET current_version_id = ? WHERE id = ?`).run(versionId, objectId);
  }

  /**
   * Moves the view back one version. Deletes nothing, and does not move the branch tip —
   * which is exactly what makes redo unambiguous below.
   */
  undo(objectId: string): ObjectState | null {
    const head = this.headOf(objectId);
    if (!head?.parentVersionId) return null;
    const parent = this.getVersion(head.parentVersionId);
    if (!parent) return null;
    this.setHead(objectId, parent.id);
    return this.stateAt(parent.id);
  }

  /**
   * Moves the view forward toward the branch tip.
   *
   * It follows the actual path from the tip back to where you are, rather than guessing
   * at "the last child" — with branches, a version can have several children and picking
   * one arbitrarily silently takes you down a line you never chose.
   */
  redo(objectId: string): ObjectState | null {
    const object = this.getObject(objectId);
    const head = this.headOf(objectId);
    if (!object || !head) return null;
    const branch = object.currentBranchId ? this.getBranch(object.currentBranchId) : null;
    const tip = branch?.headVersionId ? this.getVersion(branch.headVersionId) : null;
    if (!tip || tip.id === head.id) return null;

    // Walk tip -> head; the last hop before head is the child to step onto.
    let cursor: Version | null = tip;
    let child: Version | null = null;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.parentVersionId === head.id) { child = cursor; break; }
      cursor = cursor.parentVersionId ? this.getVersion(cursor.parentVersionId) : null;
    }
    if (!child) return null;   // head is not on this branch's line; refuse rather than guess
    this.setHead(objectId, child.id);
    return this.stateAt(child.id);
  }

  #createBranchRow(objectId: string, name: string): string {
    const id = newId();
    this.db.prepare(
      `INSERT INTO branches (id, object_id, name, head_version_id, created_at) VALUES (?, ?, ?, NULL, ?)`,
    ).run(id, objectId, name, now());
    return id;
  }

  getBranch(id: string): Branch | null {
    const r = this.db.prepare(`SELECT * FROM branches WHERE id = ?`).get(id) as rows.BranchRow | undefined;
    return r ? rows.toBranch(r) : null;
  }

  listBranches(objectId: string): Branch[] {
    return (this.db.prepare(`SELECT * FROM branches WHERE object_id = ? ORDER BY created_at`)
      .all(objectId) as rows.BranchRow[]).map(rows.toBranch);
  }

  currentBranch(objectId: string): Branch | null {
    const o = this.getObject(objectId);
    return o?.currentBranchId ? this.getBranch(o.currentBranchId) : null;
  }

  /** "Keep the wide-winged one too." Names a new line from any past version. */
  branchFrom(input: {
    versionId: string; name: string;
    properties?: Partial<ObjectProperties>;
    forms?: ReadonlyArray<ObjectForm>;
    causeActionId?: string | null; label?: string | null;
  }): ObjectState {
    return this.db.transaction(() => {
      const from = this.getVersion(input.versionId);
      if (!from) throw new Error(`no such version: ${input.versionId}`);

      const branchId = this.#createBranchRow(from.objectId, input.name);
      const properties = ObjectPropertiesSchema.parse({ ...from.properties, ...(input.properties ?? {}) });

      const inherited = new Map(this.formsAt(from.id).map((f) => [f.role, f.representationId]));
      for (const f of input.forms ?? []) inherited.set(f.role, f.representationId);

      const maxSeq = (this.db.prepare(
        `SELECT COALESCE(MAX(seq), -1) AS s FROM versions WHERE object_id = ?`,
      ).get(from.objectId) as { s: number }).s;

      const id = this.#writeVersion({
        objectId: from.objectId, seq: maxSeq + 1, parentVersionId: from.id, branchId,
        properties, recipeId: from.recipeId, causeActionId: input.causeActionId ?? null,
        label: input.label ?? `branched: ${input.name}`,
        forms: [...inherited].map(([role, representationId]) => ({ role, representationId })),
        at: now(),
      });
      this.db.prepare(`UPDATE objects SET current_branch_id = ? WHERE id = ?`)
        .run(branchId, from.objectId);
      return this.stateAt(id)!;
    })();
  }

  switchBranch(objectId: string, branchId: string): ObjectState | null {
    const branch = this.getBranch(branchId);
    if (!branch || branch.objectId !== objectId || !branch.headVersionId) return null;
    this.db.prepare(`UPDATE objects SET current_branch_id = ?, current_version_id = ? WHERE id = ?`)
      .run(branchId, branch.headVersionId, objectId);
    return this.stateAt(branch.headVersionId);
  }

  /** Versions with no children: every surviving tip of an Object. */
  headsOf(objectId: string): Version[] {
    return (this.db.prepare(
      `SELECT v.* FROM versions v
       WHERE v.object_id = ?
         AND NOT EXISTS (SELECT 1 FROM versions c WHERE c.parent_version_id = v.id)
       ORDER BY v.seq`,
    ).all(objectId) as rows.VersionRow[]).map(rows.toVersion);
  }
}

/**
 * Raised when a commit would fork a branch because the view sits behind its tip — after
 * an undo, say. Forking is a perfectly good outcome; doing it without being asked is not,
 * so the caller has to supply a branch name and mean it.
 */
export class DivergedHistory extends Error {
  readonly code = "diverged_history" as const;
  constructor(readonly objectId: string, readonly branchName: string, readonly atVersionId: string) {
    super(
      `this Object is showing an earlier version than the tip of "${branchName}". ` +
      `Committing here creates a branch — pass branchName to name it.`,
    );
    this.name = "DivergedHistory";
  }
}
