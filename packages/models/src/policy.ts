import type { Constraint } from "@xeniur/core";
import type { ModelEntry, ModelProvider, ModelRegistry } from "./registry.js";
import { isPriceVerified } from "./registry.js";

/**
 * The things the Brain may be asked, as routing dimensions.
 *
 * Kept here as a string list rather than imported from the Brain, so the models package
 * depends only on core — and so the policy can name an intent before the Brain implements it.
 */
export const ROUTED_INTENTS = [
  "explain_check", "find_evidence", "draft_decision", "choose_transform",
  "describe_impact", "prepare_delivery", "research_plan", "write_document",
  "challenge_claim", "propose_test",
] as const;
export type RoutedIntent = (typeof ROUTED_INTENTS)[number];

/**
 * "Which model should I use?" — answered once, as a policy the person can see, not per task.
 *
 * `strength` is a priority Constraint Object: one slider per intent, 0 = cheapest, 1 =
 * strongest. `localOnlyForRestricted` is a boolean Constraint Object. Both are versioned,
 * undoable, and rendered by the same primitives as any other constraint. XENIUR never adjusts
 * them on the person's behalf; it shows what happened and lets the person move the slider.
 */
export interface RoutingPolicy {
  strength: Partial<Record<RoutedIntent, number>>;
  localOnlyForRestricted: boolean;
  /** How many times a failed or refused attempt may step up to a stronger model. */
  maxEscalations: number;
}

export const DEFAULT_POLICY: RoutingPolicy = {
  strength: {
    explain_check: 0.2, find_evidence: 0.2, choose_transform: 0.2, describe_impact: 0.3,
    prepare_delivery: 0.4, draft_decision: 0.8, research_plan: 0.8, write_document: 0.6,
    challenge_claim: 0.7, propose_test: 0.6,
  },
  localOnlyForRestricted: true,
  maxEscalations: 1,
};

/** The two Constraint Object definitions the policy is stored as. */
export const STRENGTH_CONSTRAINT: Constraint = { kind: "priority", dimensions: [...ROUTED_INTENTS] };
export const RESTRICTED_CONSTRAINT: Constraint = { kind: "boolean" };

/** Reads a policy back out of its two constraint values. Missing pieces fall to the default. */
export function policyFrom(strength: unknown, localOnly: unknown): RoutingPolicy {
  const s = typeof strength === "object" && strength !== null
    ? strength as Record<string, number>
    : {};
  return {
    strength: { ...DEFAULT_POLICY.strength, ...Object.fromEntries(
      Object.entries(s).filter(([k, v]) => (ROUTED_INTENTS as readonly string[]).includes(k) && typeof v === "number"),
    ) },
    localOnlyForRestricted: typeof localOnly === "boolean" ? localOnly : DEFAULT_POLICY.localOnlyForRestricted,
    maxEscalations: DEFAULT_POLICY.maxEscalations,
  };
}

/** A model's strength on the same 0–1 axis as the policy slider, from its tags. */
export function strengthOf(m: ModelEntry): number {
  if (m.tags.includes("strong")) return 1;
  if (m.tags.includes("fast") || m.tags.includes("cheap")) return 0;
  return 0.5;
}

/** What one call is likely to cost, for ordering. Input-heavy, so input weighs more. */
export const priceOf = (m: ModelEntry): number =>
  m.price.inputPerMTok * 8 + m.price.outputPerMTok * 1.2;

export interface RouteContext {
  /** True when anything the model would receive is marked `restricted`. */
  hasRestrictedSources: boolean;
  /** 0 for the first attempt; each repair or refusal steps up by one. */
  escalation: number;
  /** A Sealed Session with `remoteModels: false` is running: local models or nothing. */
  localOnly?: boolean;
}

export interface Route {
  model: ModelEntry;
  /** Why this one, in the words shown in the receipt. */
  because: string;
  escalation: number;
}

/**
 * Picks a model for an intent, deterministically.
 *
 * Cheap-first: among callable models, the one whose strength is nearest the policy's slider
 * for this intent, with price breaking ties. Each escalation moves one step up the strength
 * order — the RouteLLM shape, on the person's own keys. Restricted material forces the local
 * route when the policy says so, and yields null rather than a remote model when there is no
 * local one: refusing is the honest answer, not "probably fine".
 *
 * Same intent, same policy, same callable set, same context → same model. Tested.
 */
export function routeModel(
  intent: RoutedIntent, policy: RoutingPolicy, registry: ModelRegistry,
  keyPresent: (p: ModelProvider) => boolean, ctx: RouteContext,
): Route | null {
  let candidates = registry.callable(keyPresent).filter(isPriceVerified);
  if ((ctx.hasRestrictedSources && policy.localOnlyForRestricted) || ctx.localOnly) {
    candidates = candidates.filter((m) => m.tags.includes("local"));
  }
  if (candidates.length === 0) return null;

  const target = policy.strength[intent] ?? 0.5;
  // Stable order: distance from the slider, then price, then id — so the result is a function
  // of its inputs and nothing else.
  const ranked = [...candidates].sort((a, b) =>
    Math.abs(strengthOf(a) - target) - Math.abs(strengthOf(b) - target) ||
    priceOf(a) - priceOf(b) ||
    a.id.localeCompare(b.id));

  // Escalation steps up the strength order from the chosen one, bounded by the policy.
  const step = Math.min(ctx.escalation, policy.maxEscalations);
  const stronger = [...candidates]
    .filter((m) => strengthOf(m) >= strengthOf(ranked[0]!))
    .sort((a, b) => strengthOf(a) - strengthOf(b) || priceOf(a) - priceOf(b) || a.id.localeCompare(b.id));
  const chosen = step === 0 ? ranked[0]! : (stronger[Math.min(step, stronger.length - 1)] ?? ranked[0]!);

  const because = step === 0
    ? `${chosen.label}: nearest the ${Math.round(target * 100)}% strength you set for ${intent.replace(/_/g, " ")}` +
      (ctx.hasRestrictedSources && policy.localOnlyForRestricted ? ", local because a restricted source is in view" : "")
    : `${chosen.label}: escalated ${step} step${step === 1 ? "" : "s"} after the cheaper model did not produce a usable answer`;

  return { model: chosen, because, escalation: step };
}

/**
 * What the person has accepted, per intent and model, read from local metrics.
 *
 * Shown beside the policy so the slider is moved on evidence: "strong accepted 8/9 for
 * drafting; cheap 3/7." XENIUR never moves the slider itself.
 */
export interface AcceptanceRow { intent: string; modelId: string; accepted: boolean; }

export function acceptanceByModel(rows: readonly AcceptanceRow[]): Array<{
  intent: string; modelId: string; accepted: number; total: number;
}> {
  const map = new Map<string, { accepted: number; total: number }>();
  for (const r of rows) {
    const k = `${r.intent} :: ${r.modelId}`;
    const cur = map.get(k) ?? { accepted: 0, total: 0 };
    cur.total += 1; if (r.accepted) cur.accepted += 1;
    map.set(k, cur);
  }
  return [...map].map(([k, v]) => {
    const [intent, modelId] = k.split(" :: ") as [string, string];
    return { intent, modelId, ...v };
  }).sort((a, b) => a.intent.localeCompare(b.intent) || a.modelId.localeCompare(b.modelId));
}
