import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";
import { ModalitySchema } from "./enums.js";
import { FormRoleSchema } from "./object.js";

export const CHECK_STATUSES = ["pass", "warn", "fail", "skipped"] as const;
export const CheckStatusSchema = z.enum(CHECK_STATUSES);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

/**
 * Evidence about a representation, not an opinion about it. Every check names the
 * validator that produced it and what it measured, so a readiness decision can be traced
 * to a measurement rather than to a judgement nobody can inspect.
 */
/**
 * What a check measured. "unbound" exists only for rows written before evidence was
 * bound to a subject; readiness refuses them rather than guessing what they were about.
 */
export const SUBJECT_KINDS = ["representation", "object_version", "unbound"] as const;
export const SubjectKindSchema = z.enum(SUBJECT_KINDS);
export type SubjectKind = z.infer<typeof SubjectKindSchema>;

export const CheckSchema = z.object({
  id: UuidSchema,
  objectId: UuidSchema,
  representationId: UuidSchema.nullable(),
  validator: z.string().min(1),
  status: CheckStatusSchema,
  summary: z.string(),
  detail: z.record(z.unknown()).default({}),
  formRole: z.string().nullable().default(null),
  at: TimestampSchema,

  /* What was measured, so a rebuilt form cannot inherit this. */
  subjectKind: SubjectKindSchema.default("unbound"),
  subjectId: z.string().nullable().default(null),
  /** The blob sha256 at the moment of measurement. Changing bytes invalidates the check. */
  subjectHash: z.string().nullable().default(null),
  validatorVersion: z.string().default("0.0.0"),
  params: z.record(z.unknown()).default({}),
  /** Tool versions actually used, so a capability change is visible. */
  environment: z.record(z.unknown()).default({}),
  /** Groups one validation pass. */
  runId: UuidSchema.nullable().default(null),
});
export type Check = z.infer<typeof CheckSchema>;

/* ------------------------------------------------------------ requirements */

/** A form must exist, optionally of a given modality and format. */
export const FormRequirementSchema = z.object({
  form: z.object({
    role: FormRoleSchema,
    modality: ModalitySchema.optional(),
    format: z.string().optional(),
  }),
}).strict();

/** A validator must have run and reported at least this well. */
export const CheckRequirementSchema = z.object({
  check: z.object({
    validator: z.string().min(1),
    status: CheckStatusSchema.default("pass"),
    /** Optional numeric ceiling on a value the validator reported. */
    max: z.number().optional(),
    min: z.number().optional(),
    field: z.string().optional(),
    /**
     * Which form this is about. Without it the requirement is judged against every form
     * the validator ran on — so "the print must be watertight" would also fail because
     * the raw imported source is not, which is true and beside the point.
     */
    formRole: z.string().optional(),
  }),
}).strict();

/** Nothing may be stale, blocked or waiting on a candidate decision. */
export const FreshRequirementSchema = z.object({ fresh: z.literal(true) }).strict();

/** A previous release against another profile must exist. */
export const ReleaseRequirementSchema = z.object({
  release: z.object({ profileId: z.string().min(1) }),
}).strict();

export const RequirementSchema = z.union([
  FormRequirementSchema, CheckRequirementSchema, FreshRequirementSchema, ReleaseRequirementSchema,
]);
export type Requirement = z.infer<typeof RequirementSchema>;

export const ProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** What this readiness is for: a deliverable, or an action XENIUR is about to take. */
  gates: z.enum(["artifact", "action"]).default("artifact"),
  /** For action profiles: the tools this profile guards. */
  tools: z.array(z.string()).default([]),
  description: z.string().default(""),
  /** One sentence naming what this profile actually establishes. Shown beside the name. */
  verifies: z.string().default(""),
  requires: z.array(RequirementSchema).default([]),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfilesFileSchema = z.object({
  profiles: z.array(ProfileSchema),
});

/* -------------------------------------------------------------- reporting */

export interface RequirementResult {
  requirement: Requirement;
  met: boolean;
  /** Why, in the words shown to the person. Always populated, met or not. */
  detail: string;
  /** What would move this forward, when there is a single obvious next step. */
  remedy: string | null;
}

export interface ReadinessReport {
  profileId: string;
  profileName: string;
  /** What this profile actually establishes — and what it does not. Shown beside the name. */
  verifies: string;
  gates: "artifact" | "action";
  ready: boolean;
  results: RequirementResult[];
  /** The unmet requirements, in the order they should be tackled. */
  blockers: RequirementResult[];
}

export const ReleaseSchema = z.object({
  id: UuidSchema,
  objectId: UuidSchema,
  versionId: UuidSchema,
  profileId: z.string().min(1),
  /** The profile definition as it stood, so a later edit cannot rewrite what was approved. */
  profileHash: z.string().nullable().default(null),
  /** The exact checks this approval rested on. */
  checkIds: z.array(UuidSchema).default([]),
  /** The accepted decisions this delivery was made under, at the versions accepted. */
  decisionIds: z.array(UuidSchema).default([]),
  note: z.string().nullable().default(null),
  /** The readiness report exactly as it stood when approved. */
  evidence: z.record(z.unknown()).default({}),
  approvedAt: TimestampSchema,
});
export type Release = z.infer<typeof ReleaseSchema>;

/**
 * Raised when an action is gated by a readiness profile that is not satisfied.
 *
 * This is the same shape of refusal as an unaffordable purchase: the work is not wrong,
 * it is simply not ready, and the person is told exactly what is missing.
 */
export class NotReady extends Error {
  readonly code = "not_ready" as const;
  constructor(readonly profileId: string, readonly profileName: string, readonly blockers: string[]) {
    super(`${profileName} is not satisfied yet:\n  - ${blockers.join("\n  - ")}`);
    this.name = "NotReady";
  }
}
