import type { BrainIntent } from "./outcome.js";

/**
 * Natural language, resolved.
 *
 * A person does not pick a `BRAIN_INTENT` before asking. They ask; XENIUR reads the request
 * into one of the things it can do and shows the reading as a chip the person can correct —
 * *Compare approaches → A and B → inspect context → proceed*. Rules first, because rules are
 * inspectable and free; a model's reading only when the rules do not resolve, and even then
 * the resolved call goes through the same typed plan and permission boundaries.
 */
export interface AskSelection { id: string; title: string; semanticType: string }

export interface ResolvedAsk {
  /** Null when the rules did not resolve: the host offers the nearest intents to choose from. */
  intent: BrainIntent | null;
  objects: string[];
  /** The reading, in words the person can correct. */
  interpretation: string;
  /** How it was read: by a rule here, or not at all. A model's reading is added by the host. */
  by: "rule" | "unresolved";
  /** When unresolved: the closest intents, most likely first. */
  nearest: BrainIntent[];
}

const INTENT_WORDS: Record<BrainIntent, string> = {
  explain_check: "Explain this measurement",
  find_evidence: "Find what the sources say",
  draft_decision: "Draft a decision",
  choose_transform: "Choose a tool for this",
  describe_impact: "Describe what changed",
  prepare_delivery: "Prepare the delivery",
  research_plan: "Turn the sources into claims and steps",
  write_document: "Write it as a document",
  challenge_claim: "Challenge this",
  propose_test: "Propose a way to test this",
};

export function intentWord(intent: BrainIntent): string { return INTENT_WORDS[intent]; }

const RULES: Array<{ test: RegExp; intent: BrainIntent; needs?: number }> = [
  { test: /\b(compar\w*|disagree\w*|conflict\w*|differ\w*|versus|vs\.?|against each other|both)\b/i, intent: "find_evidence", needs: 2 },
  { test: /\b(challenge|counter[- ]?argu\w*|steelman|push back|wrong about|could be wrong|weak(est)? point)\b/i, intent: "challenge_claim" },
  { test: /\b(test (this|it)|experiment|how (would|could) (i|we) (check|verify|test)|what (would|could) (i|we) test|validate this)\b/i, intent: "propose_test" },
  { test: /\b(what should (i|we) do|plan|steps?|next moves?|roadmap|what to do)\b/i, intent: "research_plan" },
  { test: /\b(write|draft|introduction|paragraph|summar(y|ise|ize)|prose|essay|section)\b/i, intent: "write_document" },
  { test: /\b(explain|what does .* mean|why (did|does) .* (fail|pass|warn)|this (check|measurement|result))\b/i, intent: "explain_check" },
  { test: /\b(what changed|since (the )?last|what is different|impact|out of date)\b/i, intent: "describe_impact" },
  { test: /\b(decide|decision|options?|choose between|which (one|should)|trade-?offs?)\b/i, intent: "draft_decision" },
  { test: /\b(evidence|sources? (for|behind|on)|support(s|ed)? (for|this)|what do the sources say|basis)\b/i, intent: "find_evidence" },
  { test: /\b(deliver\w*|package|ship|send (it|this) (to|out)|hand ?over)\b/i, intent: "prepare_delivery" },
  { test: /\b(convert|export|resize|render|transform|turn (this|it) into)\b/i, intent: "choose_transform" },
];

export function resolveAsk(utterance: string, selection: readonly AskSelection[]): ResolvedAsk {
  const text = utterance.trim();
  const names = (ids: readonly AskSelection[]) => ids.map((s) => `"${s.title}"`).join(" and ");

  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    if (rule.needs && selection.length < rule.needs) continue;
    const objects = rule.needs ? selection.slice(0, rule.needs) : selection.slice(0, 1);
    const target = objects.length > 0 ? ` → ${names(objects)}` : "";
    return {
      intent: rule.intent, objects: objects.map((s) => s.id), by: "rule",
      interpretation: `${INTENT_WORDS[rule.intent]}${target} → inspect context → proceed`,
      nearest: [rule.intent],
    };
  }

  // Not resolved. Offer the nearest things XENIUR can do, most general first — never a guess
  // dressed as a reading.
  const nearest: BrainIntent[] = selection.length >= 2
    ? ["find_evidence", "research_plan", "draft_decision"]
    : selection.length === 1
      ? ["find_evidence", "challenge_claim", "write_document"]
      : ["research_plan", "write_document", "find_evidence"];
  return {
    intent: null, objects: selection.slice(0, 2).map((s) => s.id), by: "unresolved",
    interpretation: `I did not read "${text.length > 60 ? `${text.slice(0, 59)}…` : text}" as one thing I can do. Choose one:`,
    nearest,
  };
}
