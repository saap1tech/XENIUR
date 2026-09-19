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
