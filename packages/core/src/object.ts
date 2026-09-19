import { z } from "zod";
import { BlobHashSchema, TimestampSchema, UuidSchema } from "./ids.js";
import {
  ModalitySchema, ProvenanceSchema, RelationshipKindSchema, EdgeKindSchema,
  InputRoleSchema, OutputRoleSchema,
} from "./enums.js";
import { SemanticTraitsSchema } from "./traits.js";

export const WorldSchema = z.object({
  id: UuidSchema,
  title: z.string().min(1),
  emoji: z.string().min(1).max(8),
  summary: z.string().default(""),
  createdAt: TimestampSchema,
  lastOpenedAt: TimestampSchema.nullable(),
});
export type World = z.infer<typeof WorldSchema>;

/**
 * A XENIUR Object row: identity and pointers, and deliberately nothing else.
 *
 * Every mutable property lives in the version snapshot instead. Anything left here would
 * be state that Undo cannot reach — renaming, retagging or changing units would silently
 * escape history. Read properties through `currentState()`, never off this row.
 */
export const XeniurObjectSchema = z.object({
  id: UuidSchema,
  worldId: UuidSchema,
  parentId: UuidSchema.nullable().default(null),
  currentVersionId: UuidSchema.nullable().default(null),
  currentBranchId: UuidSchema.nullable().default(null),
  createdAt: TimestampSchema,
  archivedAt: TimestampSchema.nullable().default(null),
});
export type XeniurObject = z.infer<typeof XeniurObjectSchema>;

/** Everything about an Object that a person can change. Snapshotted into every version. */
export const ObjectPropertiesSchema = z.object({
  title: z.string().min(1),
  semanticType: z.string().min(1),
  /** Domain-independent affordances used by the visual grammar. Versioned like any property. */
  traits: SemanticTraitsSchema.default([]),
  tags: z.array(z.string()).default([]),
  /** Physical extent, when the thing has one. Units are recorded, never assumed. */
  dimensions: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullable().default(null),
  units: z.enum(["mm", "cm", "m", "in", "px", "pt"]).nullable().default(null),
  /** Object-level settings — anything a template or recipe needs to remember. */
  settings: z.record(z.unknown()).default({}),
});
export type ObjectProperties = z.infer<typeof ObjectPropertiesSchema>;

export const defaultProperties = (title: string, semanticType: string): ObjectProperties => ({
  title, semanticType, traits: [], tags: [], dimensions: null, units: null, settings: {},
});

/**
 * A form role, e.g. "source.primary", "delivery.godot", "print.stl",
 * "preview.thumbnail". Namespaced by convention so a readiness profile can ask for
 * "the thing you would hand to Godot" rather than "some mesh somewhere".
 */
export const FormRoleSchema = z.string().regex(
  /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/,
  "a form role looks like namespace.name, e.g. delivery.godot",
);
export type FormRole = z.infer<typeof FormRoleSchema>;

export const ObjectFormSchema = z.object({
  role: FormRoleSchema,
  representationId: UuidSchema,
});
export type ObjectForm = z.infer<typeof ObjectFormSchema>;

/**
 * What an Object *is* at one version: its identity, the snapshot's properties, and every
 * form that is current simultaneously. This is what "current" means everywhere in XENIUR
 * — resolved through the head version, never "the most recently created representation".
 */
export const ObjectStateSchema = z.object({
  object: XeniurObjectSchema,
  versionId: UuidSchema,
  seq: z.number().int().nonnegative(),
  branchId: UuidSchema.nullable(),
  branchName: z.string().nullable(),
  properties: ObjectPropertiesSchema,
  forms: z.array(ObjectFormSchema),
  recipeId: UuidSchema.nullable(),
});
export type ObjectState = z.infer<typeof ObjectStateSchema>;

export const formOf = (state: ObjectState, role: string): ObjectForm | undefined =>
  state.forms.find((f) => f.role === role);

/**
 * One concrete form of an Object, self-describing about where it came from.
 * A representation must be able to answer "how would I reproduce you?" without a join,
 * which is why provider/model/tool_version/params are stored on the row.
 */
export const RepresentationSchema = z.object({
  id: UuidSchema,
  objectId: UuidSchema,
  modality: ModalitySchema,
  format: z.string().min(1),              // png, glb, stl, mp4, md, tsx
  blobHash: BlobHashSchema.nullable().default(null),
  producedByActionId: UuidSchema.nullable().default(null),  // null only for user imports
  provenance: ProvenanceSchema,
  provider: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  toolVersion: z.string().nullable().default(null),
  generationParams: z.record(z.unknown()).default({}),
  createdAt: TimestampSchema,
});
export type Representation = z.infer<typeof RepresentationSchema>;

/**
 * A complete state snapshot: properties, every simultaneous form, and the recipe revision
 * in force. Append-only. `parentVersionId` is what makes branching possible — going back
 * to an earlier state forks rather than truncates, so both heads survive.
 */
export const VersionSchema = z.object({
  id: UuidSchema,
  objectId: UuidSchema,
  seq: z.number().int().nonnegative(),
  parentVersionId: UuidSchema.nullable(),
  branchId: UuidSchema.nullable(),
  properties: ObjectPropertiesSchema,
  recipeId: UuidSchema.nullable().default(null),
  causeActionId: UuidSchema.nullable(),
  label: z.string().nullable().default(null),
  createdAt: TimestampSchema,
});
export type Version = z.infer<typeof VersionSchema>;

export const BranchSchema = z.object({
  id: UuidSchema,
  objectId: UuidSchema,
  name: z.string().min(1),
  headVersionId: UuidSchema.nullable(),
  createdAt: TimestampSchema,
});
export type Branch = z.infer<typeof BranchSchema>;

export const MAIN_BRANCH = "main";

export const RelationshipSchema = z.object({
  id: UuidSchema,
  fromObjectId: UuidSchema,
  toObjectId: UuidSchema,
  kind: RelationshipKindSchema,
  metadata: z.record(z.unknown()).default({}),
  createdAt: TimestampSchema,
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const ActionInputSchema = z.object({
  actionId: UuidSchema,
  representationId: UuidSchema,
  role: InputRoleSchema,
});
export type ActionInput = z.infer<typeof ActionInputSchema>;

export const ActionOutputSchema = z.object({
  actionId: UuidSchema,
  representationId: UuidSchema,
  role: OutputRoleSchema,
});
export type ActionOutput = z.infer<typeof ActionOutputSchema>;

/** Materialised index over action_inputs x action_outputs. Never a second source of truth. */
export const RepresentationEdgeSchema = z.object({
  fromRepresentationId: UuidSchema,
  toRepresentationId: UuidSchema,
  actionId: UuidSchema,
  kind: EdgeKindSchema,
});
export type RepresentationEdge = z.infer<typeof RepresentationEdgeSchema>;

export const BlobSchema = z.object({
  sha256: BlobHashSchema,
  bytes: z.number().int().nonnegative(),
  mime: z.string(),
  ext: z.string(),
  refcount: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
});
export type Blob = z.infer<typeof BlobSchema>;
