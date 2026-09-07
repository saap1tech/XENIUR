import { z } from "zod";

/** What kind of thing a representation *is*. One Object may hold many modalities. */
export const MODALITIES = ["image", "mesh", "video", "text", "code", "url", "data"] as const;
export const ModalitySchema = z.enum(MODALITIES);
export type Modality = z.infer<typeof ModalitySchema>;

/**
 * How a representation came to exist. This is a stored column, never a convention:
 * nothing produced by a mock provider may ever be mistaken for real model output,
 * including in exports and in the Inspector.
 */
export const PROVENANCE = ["generated", "deterministic", "imported", "human", "mock"] as const;
export const ProvenanceSchema = z.enum(PROVENANCE);
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Object <-> Object edges. Coarse; the fine-grained truth lives in representation lineage. */
export const RELATIONSHIP_KINDS = [
  "derived_from", "contains", "references", "variant_of", "part_of",
] as const;
export const RelationshipKindSchema = z.enum(RELATIONSHIP_KINDS);
export type RelationshipKind = z.infer<typeof RelationshipKindSchema>;

/**
 * The role a representation played as an input to an action. A composite is
 * `source` + `style` + `mask` — not three anonymous parents. This is precisely
 * what a bare edge table cannot express, and why action_inputs is canonical.
 */
export const INPUT_ROLES = ["source", "reference", "mask", "style", "audio", "control"] as const;
export const InputRoleSchema = z.enum(INPUT_ROLES);
export type InputRole = z.infer<typeof InputRoleSchema>;

export const OUTPUT_ROLES = ["primary", "preview", "thumbnail", "sidecar"] as const;
export const OutputRoleSchema = z.enum(OUTPUT_ROLES);
export type OutputRole = z.infer<typeof OutputRoleSchema>;

/** Representation -> representation edges, materialised from action inputs x outputs. */
export const EDGE_KINDS = [
  "derived_from", "converted_from", "edited_from", "composed_from",
] as const;
export const EdgeKindSchema = z.enum(EDGE_KINDS);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

export const ACTION_STATUSES = [
  "planned", "running", "needs_approval", "completed", "failed", "refused",
] as const;
export const ActionStatusSchema = z.enum(ACTION_STATUSES);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;
