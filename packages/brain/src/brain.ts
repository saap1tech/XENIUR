import type { ActionPlan } from "@xeniur/core";
import { ActionPlanSchema } from "@xeniur/core";
import type { BrainContext } from "./context.js";
import { renderRequest } from "./context.js";
import type { LlmClient } from "./llm.js";
import { REPAIR_PROMPT, SYSTEM_PROMPT } from "./prompt.js";

export interface BrainOptions {
  maxOutputTokens?: number;
  /** One repair attempt by default. Two round trips is already generous for a router. */
  maxRepairs?: number;
}

export interface PlanResult {
  plan: ActionPlan;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  repaired: boolean;
}

export class InvalidPlanError extends Error {
  readonly code = "invalid_plan" as const;
  constructor(readonly attempts: number, readonly lastReply: string, readonly errors: string) {
    super(`the Brain did not produce a valid Action Plan after ${attempts} attempts: ${errors}`);
    this.name = "InvalidPlanError";
  }
}

/** Models like to wrap JSON in prose or a fence even when told not to. Dig it out. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  return start !== -1 && end > start ? candidate.slice(start, end + 1) : candidate;
}

/**
 * Turns intent into a typed Action Plan — never prose, and never anything that executes
 * before it validates.
 *
 * On a malformed reply the model gets exactly one chance to fix it, with the validation
 * error handed back. After that the Brain fails closed: nothing runs, nothing is
 * half-applied, and the person is told the plan could not be formed.
 */
export class Brain {
  private readonly maxOutputTokens: number;
  private readonly maxRepairs: number;

  constructor(private readonly client: LlmClient, opts: BrainOptions = {}) {
    this.maxOutputTokens = opts.maxOutputTokens ?? 1200;
    this.maxRepairs = Math.max(0, opts.maxRepairs ?? 1);
  }

  get model(): string | null { return this.client.model; }
  /** True when plans are coming from the deterministic stub rather than a model. */
  get isMock(): boolean { return this.client.id === "mock"; }

  async plan(utterance: string, context: BrainContext): Promise<PlanResult> {
    const user = renderRequest(context, utterance);
    let inputTokens = 0, outputTokens = 0, attempts = 0;
    let lastReply = "", lastErrors = "";

    for (let attempt = 0; attempt <= this.maxRepairs; attempt += 1) {
      attempts += 1;
      const response = await this.client.complete({
        system: SYSTEM_PROMPT,
        user: attempt === 0 ? user : `${user}\n\n${REPAIR_PROMPT(lastReply, lastErrors)}`,
        maxOutputTokens: this.maxOutputTokens,
      });
      inputTokens += response.inputTokens;
      outputTokens += response.outputTokens;
      lastReply = response.text;

      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJson(response.text));
      } catch (err) {
        lastErrors = `reply was not JSON: ${err instanceof Error ? err.message : String(err)}`;
        continue;
      }

      const result = ActionPlanSchema.safeParse(parsed);
      if (result.success) {
        return {
          plan: result.data, model: response.model, inputTokens, outputTokens,
          attempts, repaired: attempt > 0,
        };
      }
      lastErrors = result.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
    }

    // Fail closed. A plan that will not validate never becomes an action.
    throw new InvalidPlanError(attempts, lastReply, lastErrors);
  }
}
