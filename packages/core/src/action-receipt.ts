import { z } from "zod";
import { CostSchema, SentDataSchema } from "./action.js";
import { BlobHashSchema, TimestampSchema, UuidSchema } from "./ids.js";

/** A durable Living Object created after a consequential external action. */
export const ActionReceiptRecordSchema = z.object({
  objectId: UuidSchema,
  actionId: UuidSchema,
  worldId: UuidSchema,
  capability: z.string().min(1),
  attempted: z.string().min(1),
  planDigest: BlobHashSchema,
  accountSessionId: UuidSchema.nullable(),
  destination: z.string().min(1),
  dataSent: z.array(SentDataSchema),
  quotedPrice: CostSchema.nullable(),
  actualPrice: CostSchema,
  providerResponse: z.object({
    status: z.string().min(1), reference: z.string().nullable(), digest: BlobHashSchema.nullable(),
  }).strict().nullable(),
  at: TimestampSchema,
  outcome: z.enum(["succeeded", "failed", "refused", "partial", "unknown"]),
}).strict();
export type ActionReceiptRecord = z.infer<typeof ActionReceiptRecordSchema>;

