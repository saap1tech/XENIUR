import { z } from "zod";
import { BlobHashSchema, TimestampSchema, UuidSchema } from "./ids.js";
import { ActionStatusSchema, ProvenanceSchema } from "./enums.js";
import { PermissionLevelSchema } from "./permissions.js";
import { ToolSchema } from "./tools.js";

/** What an action actually cost. Summed across a lineage to price an outcome. */
export const CostSchema = z.object({
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  credits: z.number().nonnegative().default(0),
  usd: z.number().nonnegative().default(0),
  ms: z.number().int().nonnegative().default(0),
});
export type Cost = z.infer<typeof CostSchema>;

export const zeroCost = (): Cost => ({ inputTokens: 0, outputTokens: 0, credits: 0, usd: 0, ms: 0 });

export const addCost = (a: Cost, b: Cost): Cost => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  credits: a.credits + b.credits,
  usd: a.usd + b.usd,
  ms: a.ms + b.ms,
});

/**
 * The Brain's only legal output. Never prose. Validated before anything executes;
 * on failure the Brain gets exactly one repair attempt, then the plan is refused.
 */
export const ActionPlanSchema = z.object({
  intent: z.string().min(1),
  objects: z.array(UuidSchema).default([]),
  tool: ToolSchema,
  args: z.record(z.unknown()).default({}),
  /** The Brain's guess only. The Permission Broker decides for real. */
  confirmation: z.boolean().default(false),
  rationale: z.string().max(500).optional(),
}).strict();
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

export const SentDataSchema = z.object({
  name: z.string().min(1),
  /** Verifies the exact local value without copying sensitive content into public proof. */
  valueDigest: BlobHashSchema,
  valueType: z.enum(["string", "number", "boolean", "object", "null"]),
}).strict();
export type SentData = z.infer<typeof SentDataSchema>;

/** Written after any consequential operation, so an outcome can always be audited. */
export const ReceiptSchema = z.object({
  screenshotBlobHash: z.string().nullable().default(null),
  domDigest: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  params: z.record(z.unknown()).default({}),
  sessionGrantId: UuidSchema.nullable().default(null),
  attempted: z.string().default(""),
  planDigest: BlobHashSchema.nullable().default(null),
  destination: z.string().nullable().default(null),
  dataSent: z.array(SentDataSchema).default([]),
  quotedPrice: CostSchema.nullable().default(null),
  actualPrice: CostSchema.nullable().default(null),
  providerResponse: z.object({
    status: z.string().min(1), reference: z.string().nullable().default(null),
    digest: BlobHashSchema.nullable().default(null),
  }).strict().nullable().default(null),
  outcome: z.string(),
  at: TimestampSchema,
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/**
 * One row per transformation. The Capability Router writes this — which is why no
 * capability can produce an unattributed representation.
 */
export const ActionRecordSchema = z.object({
  id: UuidSchema,
  taskId: UuidSchema.nullable().default(null),
  worldId: UuidSchema,
  intent: z.string(),
  tool: ToolSchema,
  plan: ActionPlanSchema,
  status: ActionStatusSchema,
  permissionLevel: PermissionLevelSchema,
  provenance: ProvenanceSchema,
  provider: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  toolVersion: z.string().nullable().default(null),
  generationParams: z.record(z.unknown()).default({}),
  cost: CostSchema,
  error: z.string().nullable().default(null),
  receipt: ReceiptSchema.nullable().default(null),
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema.nullable().default(null),
});
export type ActionRecord = z.infer<typeof ActionRecordSchema>;
