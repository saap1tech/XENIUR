import type { PermissionLevel } from "./permissions.js";

/**
 * Thrown by the Permission Broker when an action's consequence exceeds what may run
 * unattended. It is a control-flow signal, not a failure: the task parks in
 * `needs_approval` with a preview the person can actually read, and resumes only on an
 * explicit yes.
 */
export class ApprovalRequired extends Error {
  readonly code = "approval_required" as const;
  constructor(
    /** The XENIUR-native preview line, e.g. "Book court · 5:00 PM · $18". */
    readonly preview: string,
    readonly level: PermissionLevel,
    readonly detail: string = "",
  ) {
    super(preview);
    this.name = "ApprovalRequired";
  }
}

export const isApprovalRequired = (e: unknown): e is ApprovalRequired =>
  e instanceof ApprovalRequired ||
  (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "approval_required");

/** Raised when a capability exists but its runtime is not installed on this machine. */
export class CapabilityUnavailable extends Error {
  readonly code = "capability_unavailable" as const;
  constructor(readonly capability: string, readonly reason: string) {
    super(`${capability} unavailable: ${reason}`);
    this.name = "CapabilityUnavailable";
  }
}

/** Raised when a plan would exceed a configured spend ceiling. */
export class BudgetExceeded extends Error {
  readonly code = "budget_exceeded" as const;
  constructor(readonly limit: string, readonly wouldSpendUsd: number, readonly capUsd: number) {
    super(`${limit} would spend $${wouldSpendUsd.toFixed(2)}, cap is $${capUsd.toFixed(2)}`);
    this.name = "BudgetExceeded";
  }
}


/**
 * Permission to perform one specific thing.
 *
 * A blanket `approved: true` says a person agreed to *something* — it survives the plan
 * changing, the inputs changing, the destination changing and the price changing, which
 * makes it worthless as evidence of consent. An Authorization is bound to a digest of the
 * exact plan, so if any of that moves, the permission no longer applies.
 */
export interface Authorization {
  /** sha256 over the normalised plan, its inputs and its destination. */
  planDigest: string;
  /** The most this may spend. Reserved before dispatch, never checked after. */
  spendLimitUsd: number;
  /** What it covers, e.g. a domain or an object id. */
  scope: string;
  expiresAt: number;
  grantedAt: number;
}

export class AuthorizationInvalid extends Error {
  readonly code = "authorization_invalid" as const;
  constructor(readonly reason: "digest" | "expired" | "scope" | "spend", detail: string) {
    super(detail);
    this.name = "AuthorizationInvalid";
  }
}

/**
 * Raised when work would commit onto a version the person has already moved past.
 *
 * A task that finishes after an edit must not publish into the new head as though nothing
 * happened; the result is offered as a conflict the person can see.
 */
export class StaleBaseVersion extends Error {
  readonly code = "stale_base_version" as const;
  constructor(
    readonly objectId: string,
    readonly expectedVersionId: string,
    readonly actualVersionId: string | null,
  ) {
    super(
      `this was built against a version that is no longer current — the Object moved on ` +
      `while the work was running, so the result is held rather than published`,
    );
    this.name = "StaleBaseVersion";
  }
}
