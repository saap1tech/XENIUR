import { z } from "zod";

/**
 * Permission levels, ordered by consequence. The Permission Broker is deterministic:
 * it reads this ordering, never a model's opinion about how risky something is.
 */
export const PERMISSION_LEVELS = [
  "READ",         // observe only
  "CREATE",       // make a new local object/representation
  "MODIFY",       // change a local object; reversible, always writes a version
  "COMMUNICATE",  // send something to a person or service
  "COMMIT",       // submit a form, book, publish
  "PURCHASE",     // spend money
  "DESTRUCTIVE",  // irreversible loss
] as const;
export const PermissionLevelSchema = z.enum(PERMISSION_LEVELS);
export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

const RANK: Record<PermissionLevel, number> = {
  READ: 0, CREATE: 1, MODIFY: 2, COMMUNICATE: 3, COMMIT: 4, PURCHASE: 5, DESTRUCTIVE: 6,
};

export const rankOf = (level: PermissionLevel): number => RANK[level];

/** READ/CREATE/MODIFY are reversible and local, so they may execute without asking. */
export const AUTO_EXECUTE_MAX: PermissionLevel = "MODIFY";
export const isAutoExecutable = (level: PermissionLevel): boolean =>
  RANK[level] <= RANK[AUTO_EXECUTE_MAX];

/**
 * Levels a user may never pre-authorise in bulk. A "remember this choice" decision
 * is refused for these — every single one is confirmed individually, every time.
 */
export const NEVER_REMEMBERABLE: ReadonlySet<PermissionLevel> = new Set<PermissionLevel>([
  "PURCHASE", "DESTRUCTIVE",
]);

export const PERMISSION_DECISIONS = ["allow_once", "allow_session", "deny"] as const;
export const PermissionDecisionSchema = z.enum(PERMISSION_DECISIONS);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;
