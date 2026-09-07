import type { Tool } from "@xeniur/core";
import { TOOL_SPECS, isGenerativeTool } from "@xeniur/core";
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
