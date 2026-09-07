import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";
import { ToolSchema } from "./tools.js";

/** These five statuses drive the Active area on the Home screen, verbatim. */
export const TASK_STATUSES = [
  "queued", "running", "needs_approval", "completed", "failed", "cancelled",
] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "completed", "failed", "cancelled",
]);

export const TaskSchema = z.object({
  id: UuidSchema,
  worldId: UuidSchema,
  title: z.string().min(1),
  status: TaskStatusSchema,
  tool: ToolSchema,
  payload: z.record(z.unknown()).default({}),
  progress: z.number().min(0).max(1).default(0),
  detail: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskEventSchema = z.object({
  id: UuidSchema,
  taskId: UuidSchema,
  type: TaskStatusSchema.or(z.enum(["progress", "log"])),
  payload: z.record(z.unknown()).default({}),
  createdAt: TimestampSchema,
});
export type TaskEvent = z.infer<typeof TaskEventSchema>;
