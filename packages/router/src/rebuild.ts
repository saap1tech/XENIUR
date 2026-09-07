import type {
  ObjectState, RebuildPlan, Recipe, RecipeStep, Representation, StepStatus, Tool,
} from "@xeniur/core";
import type { Authorization } from "@xeniur/core";
import { capabilityVersionFor } from "@xeniur/core";
import type { ObjectGraph } from "@xeniur/graph";
import { fingerprintStep, parseRef, topoOrder } from "@xeniur/graph";
import type { CapabilityRouter } from "./router.js";

export interface RebuildOptions {
  worldId: string;
  taskId?: string | null;
  /** Run candidate_generation steps too. They still produce candidates, never overwrites. */
  includeGeneration?: boolean;
  /** Permission for exactly this rebuild, when one is needed. */
  authorization?: Authorization;
}

export interface StepOutcome {
  stepKey: string;
  tool: Tool;
  status: "rebuilt" | "candidate" | "skipped" | "failed" | "held";
  reason: string;
  representationId: string | null;
  formRoles: string[];
}

export interface RebuildResult {
  objectId: string;
  outcomes: StepOutcome[];
  state: ObjectState | null;
  rebuilt: number;
  candidates: number;
  skipped: number;
  failed: number;
  /** Built successfully, but the Object moved on while they ran, so nothing was published. */
  held: number;
}

/**
 * Runs a rebuild plan.
 *
 * Only what the plan actually offered runs, and each policy keeps its meaning all the way
 * through execution: deterministic steps re-run and replace their form, generation parks a
 * candidate for a person, and a manual step is never attempted — XENIUR cannot do it, and
 * pretending otherwise would quietly produce a deliverable nobody made.
 */
export class RebuildRunner {
  constructor(
    private readonly graph: ObjectGraph,
    private readonly router: CapabilityRouter,
  ) {}

  plan(objectId: string, costOf?: (tool: Tool) => number): RebuildPlan {
    return this.graph.recipes.planRebuild(objectId, costOf);
  }

  async run(objectId: string, opts: RebuildOptions): Promise<RebuildResult> {
    const recipe = this.graph.recipes.recipeAtCurrentVersion(objectId);
    const plan = this.graph.recipes.planRebuild(objectId);
    const outcomes: StepOutcome[] = [];

    if (!recipe) {
      return { objectId, outcomes, state: this.graph.currentState(objectId),
               rebuilt: 0, candidates: 0, skipped: 0, failed: 0, held: 0 };
    }

    const wanted = new Map<string, StepStatus>();
    for (const s of plan.willRebuild) wanted.set(s.stepKey, s);
    if (opts.includeGeneration) for (const s of plan.canRegenerate) wanted.set(s.stepKey, s);

    // Anything that will not run is reported, with the plan's own words for why.
    for (const s of [...plan.waitingOnYou, ...plan.blocked]) {
      outcomes.push({
        stepKey: s.stepKey, tool: s.tool, status: "skipped", reason: s.reason,
        representationId: null, formRoles: s.formRoles,
      });
    }
    if (!opts.includeGeneration) {
      for (const s of plan.canRegenerate) {
        outcomes.push({
          stepKey: s.stepKey, tool: s.tool, status: "skipped",
          reason: "generation costs money and produces something different, so it was not run",
          representationId: null, formRoles: s.formRoles,
        });
      }
    }

    /** What each step produced in this run, so downstream steps can consume it. */
    const produced = new Map<string, string>();

    for (const step of topoOrder(recipe.steps)) {
      const status = wanted.get(step.key);
      if (!status) continue;

      try {
        const inputs = this.#resolveInputs(step, objectId, produced);
        const isCandidate = step.replayPolicy === "candidate_generation";
        const formRole = step.outputs[0]?.formRole ?? null;

        const result = await this.router.execute(
          {
            intent: `rebuild ${step.key}`, objects: [objectId], tool: step.tool,
            args: step.args, confirmation: false,
          },
          {
            worldId: opts.worldId, objectId, taskId: opts.taskId ?? null,
            ...(opts.authorization ? { authorization: opts.authorization } : {}), inputs,
            // A candidate must not become the current form, so it publishes to no role.
            formRoles: isCandidate ? [null] : [formRole],
            label: `rebuild ${step.key}`,
          },
        );

        const rep = result.representations[0];
        if (!rep) {
          outcomes.push({
            stepKey: step.key, tool: step.tool, status: "failed",
            reason: "the step produced no output", representationId: null,
            formRoles: status.formRoles,
          });
          continue;
        }

        this.#recordDerivation(recipe, step, rep, inputs);
        for (const out of step.outputs) produced.set(`${step.key}.${out.slot}`, rep.id);

        if (result.conflict) {
          // Someone changed this Object while the step ran. The output is stored and
          // inspectable; taking over the newer work would be the one unrecoverable move.
          outcomes.push({
            stepKey: step.key, tool: step.tool, status: "held",
            reason: "you changed this while it was building, so the result is waiting rather than published",
            representationId: rep.id, formRoles: status.formRoles,
          });
        } else if (isCandidate && formRole) {
          this.graph.recipes.addCandidate({
            objectId, representationId: rep.id, formRole,
            recipeId: recipe.id, stepKey: step.key,
          });
          outcomes.push({
            stepKey: step.key, tool: step.tool, status: "candidate",
            reason: "generated beside the current form, waiting for you to accept or reject it",
            representationId: rep.id, formRoles: status.formRoles,
          });
        } else {
          outcomes.push({
            stepKey: step.key, tool: step.tool, status: "rebuilt",
            reason: status.reason, representationId: rep.id, formRoles: status.formRoles,
          });
        }
      } catch (err) {
        outcomes.push({
          stepKey: step.key, tool: step.tool, status: "failed",
          reason: err instanceof Error ? err.message : String(err),
          representationId: null, formRoles: status.formRoles,
        });
      }
    }

    const count = (s: StepOutcome["status"]) => outcomes.filter((o) => o.status === s).length;
    return {
      objectId, outcomes, state: this.graph.currentState(objectId),
      rebuilt: count("rebuilt"), candidates: count("candidate"),
      skipped: count("skipped"), failed: count("failed"), held: count("held"),
    };
  }

  #resolveInputs(
    step: RecipeStep, objectId: string, produced: Map<string, string>,
  ): Array<{ representationId: string; role: "source" | "reference" | "mask" | "style" | "audio" | "control" }> {
    const state = this.graph.currentState(objectId);
    const out: Array<{ representationId: string; role: "source" | "style" | "mask" | "reference" | "audio" | "control" }> = [];

    for (const input of step.inputs) {
      let representationId: string | undefined;
      if (input.sourceKind === "form") {
        representationId = state?.forms.find((f) => f.role === input.sourceRef)?.representationId;
      } else if (input.sourceKind === "decision") {
        // The brief as accepted. A decision still in draft resolves to nothing, and the
        // step reports itself unresolvable rather than building against an unmade choice.
        const decision = this.graph.decisions.get(input.sourceRef);
        representationId = decision?.acceptedVersionId
          ? this.graph.formsAt(decision.acceptedVersionId)
              .find((f) => f.role === "decision.brief")?.representationId
          : undefined;
      } else {
        const ref = parseRef(input.sourceRef);
        // Prefer what this run just produced; fall back to what is currently published.
        representationId = ref ? produced.get(input.sourceRef) : undefined;
        if (!representationId && ref) {
          const upstreamRole = this.#roleProducedBy(objectId, ref.key, ref.slot);
          representationId = upstreamRole
            ? state?.forms.find((f) => f.role === upstreamRole)?.representationId
            : undefined;
        }
      }

      if (!representationId) {
        if (input.required) {
          throw new Error(`step "${step.key}" needs "${input.sourceRef}", which does not exist`);
        }
        continue;
      }
      const role = (["source", "style", "mask", "reference", "audio", "control"] as const)
        .find((r) => r === input.slot) ?? "source";
      out.push({ representationId, role });
    }
    return out;
  }

  #roleProducedBy(objectId: string, stepKey: string, slot: string): string | null {
    const recipe = this.graph.recipes.recipeAtCurrentVersion(objectId);
    const step = recipe?.steps.find((s) => s.key === stepKey);
    return step?.outputs.find((o) => o.slot === slot)?.formRole ?? null;
  }

  #recordDerivation(
    recipe: Recipe, step: RecipeStep, rep: Representation,
    inputs: ReadonlyArray<{ representationId: string }>,
  ): void {
    // Fingerprinted from what the step *actually consumed*, not from the plan computed
    // before the run. Earlier in a rebuild an upstream output may not exist yet, so the
    // plan-time fingerprint is taken over an empty input set — recording that would make
    // a step look stale the instant its upstream appeared, forever.
    const inputHashes = inputs
      .map((i) => this.graph.getRepresentation(i.representationId)?.blobHash)
      .filter((h): h is string => typeof h === "string");

    this.graph.recipes.recordDerivation({
      representationId: rep.id, recipeId: recipe.id, stepKey: step.key,
      fingerprint: fingerprintStep({
        tool: step.tool,
        capabilityVersion: step.capabilityVersion || capabilityVersionFor(step.tool),
        args: step.args, inputHashes,
      }),
      capabilityVersion: step.capabilityVersion || capabilityVersionFor(step.tool),
    });
  }
}
