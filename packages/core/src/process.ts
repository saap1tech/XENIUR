import { z } from "zod";
import { BlobHashSchema, TimestampSchema, UuidSchema } from "./ids.js";

export const PROCESS_EVENT_KINDS = [
  "source_collected", "note_written", "sketch_made", "decision_accepted",
  "experiment_rejected", "manual_edit", "tool_used", "model_step", "revision", "xeniur_session",
] as const;
export const ProcessEventKindSchema = z.enum(PROCESS_EVENT_KINDS);
export type ProcessEventKind = z.infer<typeof ProcessEventKindSchema>;

export const ProcessActorSchema = z.enum(["human", "tool", "model"]);
export type ProcessActor = z.infer<typeof ProcessActorSchema>;

/**
 * Where an edit's material came from. Recorded by the surface that saw it happen; null when
 * the surface did not say. A paste is a fact about origin, not about a model — the record
 * can name it as unexplained, never as generated.
 */
export const EVENT_ORIGINS = ["typed", "pasted", "imported", "generated"] as const;
export const EventOriginSchema = z.enum(EVENT_ORIGINS);
export type EventOrigin = z.infer<typeof EventOriginSchema>;

export const ProcessEventSchema = z.object({
  id: UuidSchema,
  objectId: UuidSchema,
  versionId: UuidSchema.nullable().default(null),
  kind: ProcessEventKindSchema,
  actor: ProcessActorSchema,
  label: z.string().min(1),
  tool: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  inputHashes: z.array(BlobHashSchema).default([]),
  outputHashes: z.array(BlobHashSchema).default([]),
  durationMs: z.number().int().nonnegative().default(0),
  at: TimestampSchema,
  origin: EventOriginSchema.nullable().default(null),
  /** For a paste or an import: how much material, in characters, and the Source Object behind it if any. */
  originSize: z.number().int().nonnegative().nullable().default(null),
  originSourceId: UuidSchema.nullable().default(null),
}).strict();
export type ProcessEvent = z.infer<typeof ProcessEventSchema>;

export interface ProcessCounts {
  userCreatedSketches: number;
  researchedSources: number;
  acceptedHumanDecisions: number;
  manualRevisions: number;
  rejectedExperiments: number;
  modelTouchedSteps: number;
  toolSteps: number;
  recordedXeniurSessions: number;
  recordedSessionMs: number;
}

/** Factual authorship context. It deliberately makes no legal ownership claim. */
export interface ProcessProof {
  objectId: string;
  summary: string;
  counts: ProcessCounts;
  events: ProcessEvent[];
  disclosedHashes: string[];
  rootHash: string;
  privacy: "private" | "filtered" | "public";
  generatedAt: number;
}

export const zeroProcessCounts = (): ProcessCounts => ({
  userCreatedSketches: 0, researchedSources: 0, acceptedHumanDecisions: 0,
  manualRevisions: 0, rejectedExperiments: 0, modelTouchedSteps: 0,
  toolSteps: 0, recordedXeniurSessions: 0, recordedSessionMs: 0,
});

export interface DerivationNotice {
  sourceObjectId: string;
  derivedObjectId: string;
  overlap: number;
  invitation: "attribute" | "license" | "disclose_transformation";
  /** Similarity is a prompt for context, never a finding of theft or ownership. */
  statement: string;
}
