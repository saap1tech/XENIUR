import type { Authorization, PlanShape, Tool } from "@xeniur/core";
import { assertAuthorizes } from "@xeniur/core";
import type { RuntimeRegistry } from "./binding.js";
import { bindOutcome, normalisePlan, type BindingProblem } from "./binding.js";
import type { BrainContext } from "./context.js";
import { renderRequest } from "./context.js";
import type { LlmClient } from "./llm.js";
import { BrainOutcomeSchema, type BrainIntent, type BrainOutcome } from "./outcome.js";
import { GATED_SYSTEM_PROMPT, REPAIR_PROMPT } from "./prompt.js";

/**
 * What it costs to ask, from configuration a person can read and correct.
 *
 * `verified` is the load-bearing field. An unverified price is not zero — it is unknown,
 * and XENIUR refuses the call rather than making it and finding out. Silently treating an
 * unknown price as free is how a cap stops being a cap.
 */
export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
  verified: boolean;
  /** When somebody last checked this against the provider's published price. */
  verifiedOn: string | null;
}

/**
 * The narrow slice of the spend ledger the Brain needs.
 *
 * Declared here rather than imported from the graph so the Brain depends on the *shape* of
 * a budget and not on where one is stored. It also makes the ordering contract explicit:
 * a reserve that throws is a call that must not be made.
 */
export interface SpendReserver {
  reserve(input: {
    estimateUsd: number; provider: string; model: string | null;
    taskId?: string | null; attempt?: number;
  }): { id: string; reservedUsd: number; expiresAt: number };
  settle(holdId: string, actual: {
    usd: number; inputTokens?: number; outputTokens?: number;
    requestId?: string | null; outcome: "ok" | "invalid_output" | "refused" | "error";
  }): void;
  release(holdId: string): void;
}

/**
 * A routed choice of model for one attempt: the client to call and its own verified price.
 *
 * Supplied by the models package's policy. When present, each attempt asks the resolver with
 * the escalation count, so a repair after unusable output steps up to a stronger model —
 * cheap-first, on the person's own keys — and is billed at *that* model's price.
 */
export interface ResolvedModel {
  id: string;
  client: LlmClient;
  pricing: Pricing;
  /** Why this model, in the words shown in the receipt. */
  because: string;
  escalation: number;
}

export interface ModelResolver {
  resolve(intent: BrainIntent, ctx: { escalation: number; hasRestrictedSources: boolean }): ResolvedModel | null;
}

export interface GatedBrainOptions {
  ledger: SpendReserver;
  /** Routes each attempt to a model by policy. Without one, the fixed client and pricing are used. */
  resolver?: ModelResolver;
  pricing: Pricing;
  /**
   * The switch. False means no request is made under any circumstances — not "no key
   * configured", not "not enabled": the code path that would call a provider is not taken.
   * This milestone ships with it false and no key handling at all.
   */
  liveCallsEnabled: boolean;
  maxOutputTokens?: number;
  maxRepairs?: number;
}

export type GatedResult =
  | { status: "ok"; outcome: BrainOutcome; attempts: number; usd: number; model: string | null;
      /** Which models were tried, in order, and why. Escalation is visible here, not hidden. */
      routed: Array<{ model: string; escalation: number; because: string }> }
  | { status: "gated"; reason: string }
  | { status: "refused"; reason: string; problems: BindingProblem[] }
  | { status: "over_budget"; reason: string };

/**
 * The Brain, behind every gate that matters.
 *
 * Built, tested and shipped switched off. Nothing here needs a key to run, and with
 * `liveCallsEnabled: false` the branch that would reach a provider is never taken — which
 * is a stronger statement than "no key is configured", because it does not depend on the
 * environment being what somebody expected.
 *
 * The order of the gates is the design:
 *
 *   1. **live calls enabled?** — off, and it stops here
 *   2. **is the price verified?** — an unknown price is refused, never assumed to be zero
 *   3. **reserve the money** — before dispatch, so two tasks cannot both spend the last of it
 *   4. **dispatch, and settle whatever it cost** — including repairs and failures
 *   5. **validate the shape** — three allowed answers, nothing else parses
 *   6. **bind every reference** — an invented id is a refusal, not an action
 *   7. **recompute consequence** — the model's opinion about approval is discarded
 *
 * Only after all seven does a person see anything, and what they see is a proposal. The
 * Permission Broker still decides.
 */
export class GatedBrain {
  private readonly maxOutputTokens: number;
  private readonly maxRepairs: number;

  constructor(
    private readonly client: LlmClient,
    private readonly opts: GatedBrainOptions,
  ) {
    this.maxOutputTokens = opts.maxOutputTokens ?? 1200;
    this.maxRepairs = Math.max(0, opts.maxRepairs ?? 1);
  }

  get model(): string | null { return this.client.model; }
  get enabled(): boolean { return this.opts.liveCallsEnabled; }

  /** What one attempt would cost at a price, before it is made. */
  estimateUsd(pricing: Pricing = this.opts.pricing): number {
    // A generous ceiling on input rather than a guess at it: an estimate that turns out
    // to be low is a reservation that did not reserve enough.
    const inputMTok = 8_000 / 1_000_000;
    const outputMTok = this.maxOutputTokens / 1_000_000;
    return inputMTok * pricing.inputPerMTok + outputMTok * pricing.outputPerMTok;
  }

  /**
   * The plan a Brain call *is*, so an approval can be bound to it.
   *
   * The context digest sits in the arguments: change what the model would see and the digest
   * changes, and an authorisation granted for the previous content no longer applies. Same
   * mechanism as a changed price or destination on any other plan.
   */
  planFor(intent: BrainIntent, contextDigest: string | null, estimateUsd: number): PlanShape {
    return {
      tool: "brain.ask",
      args: { intent, contextDigest: contextDigest ?? "none" },
      destination: "model",
      estimatedUsd: Number(estimateUsd.toFixed(6)),
    };
  }

  async ask(
    intent: BrainIntent, utterance: string, context: BrainContext, registry: RuntimeRegistry,
    opts: {
      taskId?: string | null; allowGeneration?: boolean; hasRestrictedSources?: boolean;
      /** A compiled context: its rendered block is sent, its digest binds the approval. */
      compiled?: { rendered: string; contextDigest: string; includesRestricted: boolean };
      /** Consent for exactly this call — this intent, this context, this price. */
      authorization?: Authorization;
    } = {},
  ): Promise<GatedResult> {
    if (opts.compiled?.includesRestricted) opts = { ...opts, hasRestrictedSources: true };
    /* 1 — the switch. */
    if (!this.opts.liveCallsEnabled) {
      return {
        status: "gated",
        reason: "The Brain is built and tested but switched off. No request has been made, " +
                "and XENIUR is not holding a key.",
      };
    }

    /* 2 — an unknown price is not a free one. Without a resolver, the fixed price is checked
     *     here once; with one, each routed model's price is checked as it is chosen. */
    if (!this.opts.resolver && !this.opts.pricing.verified) {
      return {
        status: "gated",
        reason: "The price of this model has not been verified, so XENIUR will not call it. " +
                "Set it in config/providers.json once you have checked it.",
      };
    }

    const user = opts.compiled
      ? `${opts.compiled.rendered}\n\n${renderRequest(context, utterance)}`
      : renderRequest(context, utterance);

    let attempts = 0;
    let spent = 0;
    let lastReply = "";
    let lastErrors = "";
    const routed: Array<{ model: string; escalation: number; because: string }> = [];

    for (let attempt = 0; attempt <= this.maxRepairs; attempt += 1) {
      attempts += 1;

      // Which model, at which price. A resolver routes by policy and escalates on repair;
      // restricted material may leave no route at all, which is a refusal, not a fallback.
      let client = this.client;
      let pricing = this.opts.pricing;
      let because = "the configured model";
      if (this.opts.resolver) {
        const r = this.opts.resolver.resolve(intent, {
          escalation: attempt, hasRestrictedSources: opts.hasRestrictedSources ?? false,
        });
        if (!r) {
          return {
            status: "gated",
            reason: opts.hasRestrictedSources
              ? "A restricted source is in view and no local model is available, so nothing was sent."
              : "No model with a verified price is available for this. Add a key, or verify a price.",
          };
        }
        if (!r.pricing.verified) {
          return { status: "gated", reason: `The price of ${r.id} has not been verified, so XENIUR will not call it.` };
        }
        client = r.client; pricing = r.pricing; because = r.because;
        routed.push({ model: r.id, escalation: r.escalation, because });
      }
      const estimate = this.estimateUsd(pricing);

      // Consent, when offered, covers exactly this intent, this context and this price. A
      // different context is a different call, and the approval does not carry over.
      if (opts.authorization) {
        try {
          assertAuthorizes(opts.authorization, this.planFor(intent, opts.compiled?.contextDigest ?? null, estimate), "model");
        } catch (err) {
          return { status: "refused", reason: err instanceof Error ? err.message : String(err), problems: [] };
        }
      }

      /* 3 — reserve before dispatch, every attempt including repairs. */
      let hold: { id: string };
      try {
        hold = this.opts.ledger.reserve({
          estimateUsd: estimate, provider: client.id, model: client.model,
          taskId: opts.taskId ?? null, attempt: attempts,
        });
      } catch (err) {
        // A refusal to reserve is a refusal to call. Nothing is dispatched.
        return {
          status: "over_budget",
          reason: err instanceof Error ? err.message : String(err),
        };
      }

      /* 4 — dispatch, and settle whatever happened. */
      let text: string;
      try {
        const response = await client.complete({
          system: GATED_SYSTEM_PROMPT(intent),
          user: attempt === 0 ? user : `${user}\n\n${REPAIR_PROMPT(lastReply, lastErrors)}`,
          maxOutputTokens: this.maxOutputTokens,
        });
        const usd = this.actualUsd(response.inputTokens, response.outputTokens, pricing);
        spent += usd;
        text = response.text;
        lastReply = text;

        const parsed = this.parse(text);
        if (!parsed.ok) {
          // A reply that will not parse still cost money, and the ledger says so.
          this.opts.ledger.settle(hold.id, {
            usd, inputTokens: response.inputTokens, outputTokens: response.outputTokens,
            outcome: "invalid_output",
          });
          lastErrors = parsed.errors;
          continue;
        }

        /* 5, 6, 7 — shape, references, consequence. */
        const problems = bindOutcome(parsed.outcome, registry,
                                     { allowGeneration: opts.allowGeneration ?? false });
        if (problems.length > 0) {
          this.opts.ledger.settle(hold.id, {
            usd, inputTokens: response.inputTokens, outputTokens: response.outputTokens,
            outcome: "refused",
          });
          // Not repaired: a plan naming things that do not exist is not a formatting
          // mistake, and asking again mostly produces a different invention.
          return {
            status: "refused",
            reason: "the plan referred to things that do not exist here",
            problems,
          };
        }

        this.opts.ledger.settle(hold.id, {
          usd, inputTokens: response.inputTokens, outputTokens: response.outputTokens,
          outcome: "ok",
        });
        return {
          status: "ok",
          outcome: normalisePlan(parsed.outcome),
          attempts, usd: spent, model: response.model, routed,
        };
      } catch (err) {
        // A call that threw may still have been billed; the hold is settled at the
        // estimate rather than released, because assuming otherwise under-reports.
        this.opts.ledger.settle(hold.id, { usd: estimate, outcome: "error" });
        return {
          status: "refused",
          reason: err instanceof Error ? err.message : String(err),
          problems: [],
        };
      }
    }

    return {
      status: "refused",
      reason: `no usable answer after ${attempts} attempts: ${lastErrors}`,
      problems: [],
    };
  }

  /** What a call actually cost, from measured usage rather than the estimate. */
  actualUsd(inputTokens: number, outputTokens: number, pricing: Pricing = this.opts.pricing): number {
    return (inputTokens / 1_000_000) * pricing.inputPerMTok +
           (outputTokens / 1_000_000) * pricing.outputPerMTok;
  }

  /**
   * Parses a reply into one of the three allowed answers.
   *
   * Strict schemas throughout: an unknown field is a rejection rather than something
   * silently carried into a plan. Models wrap JSON in prose and fences even when told not
   * to, so the object is dug out first — that is formatting, not permission.
   */
  private parse(text: string):
    | { ok: true; outcome: BrainOutcome }
    | { ok: false; errors: string } {
    let json: unknown;
    try {
      json = JSON.parse(extractJson(text));
    } catch (err) {
      return { ok: false, errors: `reply was not JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
    const result = BrainOutcomeSchema.safeParse(json);
    if (result.success) return { ok: true, outcome: result.data };
    return {
      ok: false,
      errors: result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    };
  }
}

/** Models wrap JSON in prose or a fence even when told not to. Dig it out. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start !== -1 && end > start ? candidate.slice(start, end + 1) : candidate;
}

/** The tools a bounded intent is even allowed to reach for. */
export const INTENT_TOOLS: Record<BrainIntent, readonly Tool[]> = {
  explain_check: [],
  find_evidence: [],
  draft_decision: [],
  choose_transform: ["image.transform", "3d.process", "3d.export", "3d.solidify",
                     "3d.render", "3d.turntable", "video.edit", "video.export",
                     "object.update", "object.move"],
  describe_impact: [],
  prepare_delivery: ["export.package", "export.file"],
};
