import type {
  ActionRecord, Branch, Cost, Provenance, Receipt, Relationship, Representation,
  RepresentationEdge, Task, TaskEvent, Version, World, XeniurObject,
} from "@xeniur/core";
import { ObjectPropertiesSchema, zeroCost } from "@xeniur/core";
import { json } from "./db.js";

/* Row shapes as SQLite returns them: snake_case, JSON-as-TEXT, no booleans. */

export interface WorldRow { id: string; title: string; emoji: string; summary: string; created_at: number; last_opened_at: number | null; kind: "work" | "critique" | "challenge"; publisher_id: string | null; }
export interface ObjectRow { id: string; world_id: string; parent_id: string | null; current_version_id: string | null; current_branch_id: string | null; created_at: number; archived_at: number | null; }
export interface RepresentationRow { id: string; object_id: string; modality: string; format: string; blob_hash: string | null; produced_by_action_id: string | null; provenance: string; provider: string | null; model: string | null; tool_version: string | null; generation_params: string; created_at: number; }
export interface VersionRow { id: string; object_id: string; seq: number; parent_version_id: string | null; branch_id: string | null; properties: string; recipe_id: string | null; cause_action_id: string | null; label: string | null; created_at: number; }
export interface BranchRow { id: string; object_id: string; name: string; head_version_id: string | null; created_at: number; }
export interface VersionFormRow { version_id: string; representation_id: string; role: string; }
export interface ActionRow { id: string; task_id: string | null; world_id: string; intent: string; tool: string; plan: string; status: string; permission_level: string; provenance: string; provider: string | null; model: string | null; tool_version: string | null; generation_params: string; cost: string; error: string | null; receipt: string | null; started_at: number; finished_at: number | null; }
export interface RelationshipRow { id: string; from_object_id: string; to_object_id: string; kind: string; metadata: string; created_at: number; }
export interface EdgeRow { from_representation_id: string; to_representation_id: string; action_id: string; kind: string; }
export interface TaskRow { id: string; world_id: string; title: string; status: string; tool: string; payload: string; progress: number; detail: string | null; error: string | null; attempts: number; created_at: number; updated_at: number; }
export interface TaskEventRow { id: string; task_id: string; type: string; payload: string; created_at: number; }

type Rec = Record<string, unknown>;

export const toWorld = (r: WorldRow): World => ({
  id: r.id, title: r.title, emoji: r.emoji, summary: r.summary,
  createdAt: r.created_at, lastOpenedAt: r.last_opened_at,
  kind: r.kind ?? "work", publisherId: r.publisher_id ?? null,
});

export const toObject = (r: ObjectRow): XeniurObject => ({
  id: r.id, worldId: r.world_id, parentId: r.parent_id,
  currentVersionId: r.current_version_id, currentBranchId: r.current_branch_id,
  createdAt: r.created_at, archivedAt: r.archived_at,
});

export const toRepresentation = (r: RepresentationRow): Representation => ({
  id: r.id, objectId: r.object_id,
  modality: r.modality as Representation["modality"], format: r.format,
  blobHash: r.blob_hash, producedByActionId: r.produced_by_action_id,
  provenance: r.provenance as Provenance, provider: r.provider, model: r.model,
  toolVersion: r.tool_version, generationParams: json.parse<Rec>(r.generation_params, {}),
  createdAt: r.created_at,
});

export const toVersion = (r: VersionRow): Version => ({
  id: r.id, objectId: r.object_id, seq: r.seq, parentVersionId: r.parent_version_id,
  branchId: r.branch_id,
  properties: ObjectPropertiesSchema.parse(json.parse<Rec>(r.properties, {})),
  recipeId: r.recipe_id, causeActionId: r.cause_action_id,
  label: r.label, createdAt: r.created_at,
});

export const toBranch = (r: BranchRow): Branch => ({
  id: r.id, objectId: r.object_id, name: r.name,
  headVersionId: r.head_version_id, createdAt: r.created_at,
});

export const toAction = (r: ActionRow): ActionRecord => ({
  id: r.id, taskId: r.task_id, worldId: r.world_id, intent: r.intent,
  tool: r.tool as ActionRecord["tool"], plan: json.parse(r.plan, {} as ActionRecord["plan"]),
  status: r.status as ActionRecord["status"],
  permissionLevel: r.permission_level as ActionRecord["permissionLevel"],
  provenance: r.provenance as Provenance, provider: r.provider, model: r.model,
  toolVersion: r.tool_version, generationParams: json.parse<Rec>(r.generation_params, {}),
  cost: json.parse<Cost>(r.cost, zeroCost()), error: r.error,
  receipt: r.receipt === null ? null : json.parse<Receipt | null>(r.receipt, null),
  startedAt: r.started_at, finishedAt: r.finished_at,
});

export const toRelationship = (r: RelationshipRow): Relationship => ({
  id: r.id, fromObjectId: r.from_object_id, toObjectId: r.to_object_id,
  kind: r.kind as Relationship["kind"], metadata: json.parse<Rec>(r.metadata, {}),
  createdAt: r.created_at,
});

export const toEdge = (r: EdgeRow): RepresentationEdge => ({
  fromRepresentationId: r.from_representation_id,
  toRepresentationId: r.to_representation_id,
  actionId: r.action_id, kind: r.kind as RepresentationEdge["kind"],
});

export const toTask = (r: TaskRow): Task => ({
  id: r.id, worldId: r.world_id, title: r.title,
  status: r.status as Task["status"], tool: r.tool as Task["tool"],
  payload: json.parse<Rec>(r.payload, {}), progress: r.progress, detail: r.detail,
  error: r.error, attempts: r.attempts, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const toTaskEvent = (r: TaskEventRow): TaskEvent => ({
  id: r.id, taskId: r.task_id, type: r.type as TaskEvent["type"],
  payload: json.parse<Rec>(r.payload, {}), createdAt: r.created_at,
});
