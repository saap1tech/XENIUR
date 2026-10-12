import type { ModelEntry } from "./registry.js";

/**
 * How well a model fits XENIUR's work. Shown to people as Recommended, Strong, Basic or
 * Experimental; a model with nothing known about it carries no mark at all.
 *
 *  best      passed every step it was run through, including an exact-quote draft   → Recommended
 *  good      dependable for most steps                                              → Strong
 *  limited   run through the steps, with a known weak spot                          → Basic
 *  care      not run, but something about it is known to cause trouble (it reasons
 *            first, it is small, or its context is short)                           → Experimental
 *  untested  nothing is known yet                                                    → no mark
 *
 * The evidence (date and per-step results) stays here, as the basis for the label; the interface
 * speaks only of what a model is good at.
 */
export type ModelFit = "best" | "good" | "limited" | "care" | "untested";
export type RatedStep = "search" | "overview" | "outline" | "draft" | "image";
export interface ModelRating {
  fit: ModelFit;
  /** One sentence, in the person's words. */
  note: string;
  /** When the model was last run through XENIUR's steps, if ever. */
  testedOn?: string;
  /** What each step did in that run. */
  steps?: Partial<Record<RatedStep, "pass" | "fail">>;
}

/**
 * Results from live runs of the guided research path against OpenRouter. Each entry records the
 * date and what each step actually did. Change an entry only after a new run, never by guessing.
 */
export const TESTED_MODELS: Readonly<Record<string, ModelRating>> = {
  "qwen/qwen3-235b-a22b-2507": { fit: "best", testedOn: "2026-10-12",
    steps: { overview: "pass", outline: "pass", draft: "pass" },
    note: "Accurate, well-sourced writing. Quotes stay faithful to your sources." },
  "openai/gpt-4o-mini": { fit: "limited", testedOn: "2026-10-12",
    steps: { search: "pass", overview: "fail", draft: "fail" },
    note: "Fast at finding sources; less precise when quoting them." },
  "meta-llama/llama-4-maverick": { fit: "limited", testedOn: "2026-10-12",
    steps: { overview: "pass", outline: "fail" },
    note: "Clear summaries; less dependable with detailed structure." },
  "deepseek/deepseek-v4-flash": { fit: "limited", testedOn: "2026-10-12",
    steps: { overview: "fail" },
    note: "Reasons at length before answering; long steps may not finish." },
  "bytedance-seed/seedream-5-0-flash": { fit: "best", testedOn: "2026-10-11", steps: { image: "pass" },
    note: "Clean, consistent illustrations at a fixed price." },
};

const SMALL = /(?:^|[^\d.])(?:0?\.\d+|[1-9]|1[0-4])b\b|nano|tiny|micro|\bmini-?\d/i;

/** The rating a model is shown with: the tested result when there is one, otherwise what is known. */
export function rateModel(m: Pick<ModelEntry, "model" | "output" | "contextWindow" | "reasoning">): ModelRating {
  const tested = TESTED_MODELS[m.model];
  if (tested) return tested;
  if (m.output === "image") return { fit: "untested", note: "" };
  if (m.reasoning) return { fit: "care", note: "Reasons before answering; slower on long steps." };
  if (SMALL.test(m.model)) return { fit: "care", note: "Lightweight; may not follow detailed structure." };
  if (m.contextWindow < 100_000) return { fit: "care", note: "Short context; long sources may not fit in one step." };
  return { fit: "untested", note: "" };
}

const ORDER: Record<ModelFit, number> = { best: 0, good: 1, limited: 2, untested: 3, care: 4 };
/** Better fits first; within a fit, cheaper first. */
export function byFit<T extends { fit: ModelFit; price: number }>(a: T, b: T): number {
  return ORDER[a.fit] - ORDER[b.fit] || a.price - b.price;
}
