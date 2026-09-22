import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";

/**
 * Where the person was — exactly. The project, the goal and plan revision, the step, the
 * item in the centre and its form, the browser tabs that were open, a review that was pending.
 *
 * Deliberately absent: anything that grants authority. Restoring a position puts the same
 * things in front of the person; it never restores permission to act. Tabs come back paused;
 * a pending review comes back as a review, not as an approval. `.strict()` so that a grant
 * field cannot be added without a test noticing.
 */
export const WorkPositionSchema = z.object({
  worldId: UuidSchema,
  goalId: UuidSchema.nullable().default(null),
  planRevision: z.number().int().positive().nullable().default(null),
  stepId: z.string().nullable().default(null),
  objectId: UuidSchema.nullable().default(null),
  formRole: z.string().nullable().default(null),
  zone: z.enum(["sources", "decisions", "work", "deliveries"]).nullable().default(null),
  tabIds: z.array(z.string().min(1)).max(32).default([]),
  pendingReviewId: z.string().nullable().default(null),
  savedAt: TimestampSchema,
}).strict();
export type WorkPosition = z.infer<typeof WorkPositionSchema>;
export type WorkPositionInput = z.input<typeof WorkPositionSchema>;
