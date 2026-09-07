import type { Authorization } from "./errors.js";
import { sha256Hex } from "./sha256.js";
import { AuthorizationInvalid } from "./errors.js";

export interface PlanShape {
  tool: string;
  args: Record<string, unknown>;
  objectId?: string | null;
  inputs?: ReadonlyArray<{ representationId: string; role: string }>;
  destination?: string | null;
  estimatedUsd?: number;
}

/** Stable JSON so key order cannot change a digest. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/**
 * What a person is actually agreeing to.
 *
 * The preview card a person reads and the thing the Broker permits are rendered from the
 * same digest, so they cannot drift apart — changing the plan, its inputs, its destination
 * or its price produces a different digest and invalidates the permission.
 */
export function planDigest(plan: PlanShape): string {
  return sha256Hex(canonical({
    tool: plan.tool,
    args: plan.args,
    objectId: plan.objectId ?? null,
    inputs: [...(plan.inputs ?? [])]
      .map((i) => `${i.role}:${i.representationId}`)
      .sort(),
    destination: plan.destination ?? null,
    estimatedUsd: plan.estimatedUsd ?? 0,
  }));
}

export function authorizeFor(
  plan: PlanShape, opts: { scope: string; spendLimitUsd?: number; ttlMs?: number } = { scope: "" },
): Authorization {
  const now = Date.now();
  return {
    planDigest: planDigest(plan),
    spendLimitUsd: opts.spendLimitUsd ?? plan.estimatedUsd ?? 0,
    scope: opts.scope,
    grantedAt: now,
    // Short by default: consent to a specific thing goes stale quickly.
    expiresAt: now + (opts.ttlMs ?? 10 * 60 * 1000),
  };
}

/** Throws unless this authorization is for exactly this plan, right now. */
export function assertAuthorizes(
  auth: Authorization, plan: PlanShape, scope: string,
): void {
  const expected = planDigest(plan);
  if (auth.planDigest !== expected) {
    throw new AuthorizationInvalid("digest",
      "what was approved is not what is about to run — approve the change");
  }
  if (auth.expiresAt <= Date.now()) {
    throw new AuthorizationInvalid("expired", "that approval has expired — approve it again");
  }
  if (auth.scope !== scope) {
    throw new AuthorizationInvalid("scope",
      `that approval was for ${auth.scope || "something else"}, not ${scope}`);
  }
  if ((plan.estimatedUsd ?? 0) > auth.spendLimitUsd) {
    throw new AuthorizationInvalid("spend",
      `this would spend $${(plan.estimatedUsd ?? 0).toFixed(2)}, above the approved $${auth.spendLimitUsd.toFixed(2)}`);
  }
}
