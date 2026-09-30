import { z } from "zod";
import { UuidSchema } from "./ids.js";

export type WorkSignalKind = "disagreement" | "unreviewed_basis" | "changed_basis" | "assumption" | "requirement" | "recall";
export type SharpenKind = "recall" | "distinguish" | "challenge" | "apply" | "decide";
export const SharpenEffectSchema = z.enum(["reflect", "needs_review", "test", "source", "checked", "keep"]);
export type SharpenEffect = z.infer<typeof SharpenEffectSchema>;
export interface WorkSignal {
  id: string;
  kind: WorkSignalKind;
  objectId: string;
  title: string;
  fact: string;
  subjectKey: string;
  priority: number;
  lastCheckedAt: number | null;
}
/** Observations about recorded work, never a measurement of a person's mind. */
export interface WorkState {
  goalId: string;
  worldId: string;
  outcome: string;
  signals: WorkSignal[];
  assessedAt: number;
  latestSession: SharpenSession | null;
}
export interface SharpenMove {
  id: string;
  kind: SharpenKind;
  prompt: string;
  recorded: string;
  changes: string[];
  effects: SharpenEffect[];
  answer: string | null;
  effect: SharpenEffect | null;
  reflectionObjectId: string | null;
  answeredAt: number | null;
}
export interface SharpenSession {
  id: string;
  goalId: string;
  worldId: string;
  objectId: string;
  objectVersionId: string;
  title: string;
  subjectKey: string;
  basisDigest: string;
  fact: string;
  moves: SharpenMove[];
  createdAt: number;
}
export const SharpenAnswerSchema = z.object({
  sessionId: UuidSchema, moveId: UuidSchema,
  answer: z.string().trim().min(8).max(2000), effect: SharpenEffectSchema,
}).strict();
export type SharpenAnswer = z.infer<typeof SharpenAnswerSchema>;
