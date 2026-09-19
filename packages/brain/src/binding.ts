import type { Tool } from "@xeniur/core";
import { KnowledgeProposalSchema, TOOL_SPECS, isGenerativeTool } from "@xeniur/core";
import type { BrainOutcome } from "./outcome.js";

/**
 * Everything that actually exists right now, assembled by the runtime.
 *
 * The Brain never invents an identifier. Anything it names has to be in here, which is why
 * this is passed in rather than described in a prompt: a prompt is a request, and a
 * registry is a fact. A model that hallucinates a plausible uuid produces a plan that is
 * rejected here, not an action against something that does not exist.
 */
export interface RuntimeRegistry {
  worldId: string;
  objectIds: ReadonlySet<string>;
  representationIds: ReadonlySet<string>;
  versionIds: ReadonlySet<string>;
  /** Which form roles each Object actually has right now. */
  formRoles: ReadonlyMap<string, ReadonlySet<string>>;
  /** Tools whose provider is present and usable. Not "tools that exist". */
  availableTools: ReadonlySet<Tool>;
  /**
   * Stored source copies the model was shown, by id, with their text. A citation is checked
   * against these: the quoted words must actually be in the copy, or the citation is dropped.
   */
  sourceTexts?: ReadonlyMap<string, string>;
}

export interface BindingProblem {
  path: string;
  detail: string;
}

/**
 * Checks a proposed outcome against what exists, before anything is offered to a person.
 *
 * Four separate failures, all of which a fluent model makes:
 *
 *   - naming an Object, form or version that does not exist
 *   - naming a tool whose provider is not actually available on this machine
 *   - reaching for generation when the request was for a local transform
 *   - asserting anything about permission, approval or reversibility
 *
 * The last is the one worth being strict about. A model that can write
 * `"confirmation": false` into a plan for a purchase is a model that can approve its own
 * spending, so that field is stripped and recomputed from the tool table rather than read.
 */
export function bindOutcome(
  outcome: BrainOutcome, registry: RuntimeRegistry,
  opts: { allowGeneration?: boolean } = {},
): BindingProblem[] {
  const problems: BindingProblem[] = [];
  const say = (path: string, detail: string) => problems.push({ path, detail });

  if (outcome.kind === "clarification") {
    outcome.options.forEach((option, i) => {
      if (option.objectId && !registry.objectIds.has(option.objectId)) {
        say(`options[${i}].objectId`, "offers a choice that does not exist");
      }
    });
    return problems;
  }

  if (outcome.kind === "unsupported") {
    if (outcome.nearest && !registry.availableTools.has(outcome.nearest)) {
      say("nearest", `suggests ${outcome.nearest}, which is not available here`);
    }
    return problems;
  }

  const { plan } = outcome;

  if (!registry.availableTools.has(plan.tool)) {
    say("plan.tool", `${plan.tool} is not available on this machine`);
  }
  // Deterministic first is a structural rule, not a preference. A request that a local
  // tool can serve must not be routed to a model that charges for it.
  if (!opts.allowGeneration && isGenerativeTool(plan.tool)) {
    say("plan.tool", `${plan.tool} generates new material, which was not what was asked for`);
  }

  plan.objects.forEach((id, i) => {
    if (!registry.objectIds.has(id)) say(`plan.objects[${i}]`, "names an Object that does not exist");
  });

  // Arguments that look like references are checked as references. A model that writes a
  // convincing uuid into `representationId` is exactly the case this exists for.
  for (const [key, value] of Object.entries(plan.args)) {
    if (typeof value !== "string") continue;
    if (/representationId$/i.test(key) && !registry.representationIds.has(value)) {
      say(`plan.args.${key}`, "names a form that does not exist");
    }
    if (/versionId$/i.test(key) && !registry.versionIds.has(value)) {
      say(`plan.args.${key}`, "names a version that does not exist");
    }
    if (/objectId$/i.test(key) && !registry.objectIds.has(value)) {
      say(`plan.args.${key}`, "names an Object that does not exist");
    }
    if (/^(formRole|role)$/i.test(key)) {
      const target = plan.objects[0];
      const roles = target ? registry.formRoles.get(target) : undefined;
      if (roles && !roles.has(value)) {
        say(`plan.args.${key}`, `"${value}" is not a form this Object has`);
      }
    }
  }

  // A research proposal is bound word by word. Every citation must name a copy the model was
  // shown and quote words that are actually in it; a claim whose citations all fail is not
  // rejected — it is kept and shown as "not supported by the sources given", which is the
  // honest state and the one the person needs to see.
  if (plan.tool === "knowledge.propose") {
    const parsed = KnowledgeProposalSchema.safeParse(plan.args);
    if (!parsed.success) {
      say("plan.args", `is not a well-formed proposal: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).slice(0, 3).join("; ")}`);
    } else {
      parsed.data.claims.forEach((claim, ci) => {
        claim.citations.forEach((cite, k) => {
          if (!registry.sourceTexts?.has(cite.sourceVersionId)) {
            say(`plan.args.claims[${ci}].citations[${k}]`, "cites a source copy the model was not shown");
          }
        });
      });
      parsed.data.steps.forEach((step, si) => {
        for (const idx of step.restsOn) {
          if (idx >= parsed.data.claims.length) say(`plan.args.steps[${si}].restsOn`, "rests on a claim that is not in the proposal");
        }
      });
    }
  }

  // The model does not get an opinion about consequence.
  const spec = TOOL_SPECS[plan.tool];
  if (spec && plan.confirmation === false &&
      (spec.permission === "PURCHASE" || spec.permission === "COMMIT" ||
       spec.permission === "DESTRUCTIVE")) {
    say("plan.confirmation",
      `proposed skipping confirmation for a ${spec.permission} action, which it may not do`);
  }
  for (const forbidden of ["approved", "authorization", "permissionLevel", "skipApproval", "force"]) {
    if (forbidden in plan.args) {
      say(`plan.args.${forbidden}`, "tried to set its own permission, which it may not do");
    }
  }
  return problems;
}

/**
 * The plan as it will actually be offered: consequence recomputed from the tool table.
 *
 * Even a plan that passed binding has its `confirmation` overwritten rather than trusted.
 * There is no path by which a model's opinion about whether something needs approving
 * reaches the Broker.
 */
export function normalisePlan(outcome: BrainOutcome): BrainOutcome {
  if (outcome.kind !== "executable") return outcome;
  const spec = TOOL_SPECS[outcome.plan.tool];
  const needsConfirmation = spec
    ? spec.permission !== "READ" && spec.permission !== "CREATE" && spec.permission !== "MODIFY"
    : true;
  return {
    ...outcome,
    plan: { ...outcome.plan, confirmation: needsConfirmation },
  };
}

/* --------------------------------------------------------- research binding */

export interface BoundCitation {
  sourceVersionId: string;
  exact: string;
  /** Where the words were found in the stored copy, or null when they were not. */
  start: number | null;
  proposedStatus: "supported" | "contradicted" | "ambiguous" | "unresolved";
  resolved: boolean;
}

export interface BoundClaim {
  text: string;
  stance: "assertion" | "opinion" | "hypothesis" | "observation" | "synthesis" | "direction";
  citations: BoundCitation[];
  /** True when no citation resolved: shown as "not supported by the sources given". */
  unsupported: boolean;
}

export interface BoundProposal {
  headline: string;
  claims: BoundClaim[];
  steps: Array<{ order: number; text: string; restsOn: number[] }>;
  uncertain: string[];
  /** Citations the model offered whose words are not in the copy. Counted, never hidden. */
  droppedCitations: number;
}

/**
 * Binds a proposal's citations to stored text — word by word.
 *
 * The model was shown passages. It may quote them. It may not invent a quotation, and it may
 * not claim a passage bears on something without the words being there. A quotation found in
 * the copy becomes a proposed support row (`checked_by: model`); one not found is dropped and
 * counted. An assertion left with no resolved citation is *kept* and marked unsupported, because
 * the person needs to see that the model made a claim its sources do not carry.
 */
export function bindProposal(args: unknown, sourceTexts: ReadonlyMap<string, string>): BoundProposal {
  const p = KnowledgeProposalSchema.parse(args);
  let dropped = 0;
  const claims: BoundClaim[] = p.claims.map((c) => {
    const citations: BoundCitation[] = c.citations.map((cite) => {
      const text = sourceTexts.get(cite.sourceVersionId);
      const start = text ? text.indexOf(cite.exact) : -1;
      const resolved = start >= 0;
      if (!resolved) dropped += 1;
      return {
        sourceVersionId: cite.sourceVersionId, exact: cite.exact,
        start: resolved ? start : null, proposedStatus: cite.bears, resolved,
      };
    }).filter((x) => x.resolved);
    return {
      text: c.text, stance: c.stance, citations,
      unsupported: c.stance === "assertion" && citations.length === 0,
    };
  });
  return {
    headline: p.headline, claims,
    steps: [...p.steps].sort((a, b) => a.order - b.order).map((s) => ({ order: s.order, text: s.text, restsOn: s.restsOn })),
    uncertain: p.uncertain, droppedCitations: dropped,
  };
}
