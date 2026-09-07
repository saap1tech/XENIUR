import type {
  CausalStep, ImpactReport, RebuildItem, RecipeStep, StepStatus,
} from "@xeniur/core";
import { formRoleName } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";
import { parseRef, upstreamOf } from "./recipes.js";

/**
 * What changed since the last delivery, split into what XENIUR can fix and what only a
 * person can judge.
 *
 * Every sentence here is built from the edge that produced it — the recipe input that no
 * longer matches, the semantic link whose subject moved on — rather than written out by
 * hand. A hand-written explanation drifts from the graph the first time either changes,
 * and an explanation that has quietly stopped being true is worse than none.
 */
export function impactOf(
  graph: ObjectGraph, objectId: string,
  opts: {
    sinceReleaseId?: string;
    /** What a generative step would cost, supplied by whoever knows the price list. */
    costOf?: (tool: string) => number;
  } = {},
): ImpactReport {
  const state = graph.currentState(objectId);
  const plan = graph.recipes.planRebuild(objectId, (tool) => opts.costOf?.(tool) ?? 0);
  const recipe = graph.recipes.recipeAtCurrentVersion(objectId);
  const byKey = new Map((recipe?.steps ?? []).map((s) => [s.key, s]));

  const rebuild: RebuildItem[] = [
    ...plan.willRebuild.map((s) => item(s, "rebuild")),
    ...plan.canRegenerate.map((s) => item(s, "regenerate")),
    ...plan.waitingOnYou.map((s) => item(s, "waiting_on_you")),
    ...plan.blocked.map((s) => item(s, "blocked")),
  ];

  function item(status: StepStatus, actionable: RebuildItem["actionable"]): RebuildItem {
    const step = byKey.get(status.stepKey);
    return {
      stepKey: status.stepKey,
      formRoles: status.formRoles,
      state: status.state,
      actionable,
      estimatedUsd: actionable === "regenerate" ? opts.costOf?.(status.tool) ?? 0 : 0,
      path: pathFor(status, step),
      because: pathFor(status, step).map((p) => `${p.subject} ${p.happened}`).join(" → "),
    };
  }

  /**
   * The chain of hops that explains one out-of-date step.
   *
   * Walks back through the recipe's own inputs: a step is behind because something it
   * consumes changed, and that thing is either a form of this Object or another step.
   * Depth is bounded because a recipe is a DAG that a person has to be able to read.
   */
  function pathFor(status: StepStatus, step: RecipeStep | undefined): CausalStep[] {
    const hops: CausalStep[] = [];
    const seen = new Set<string>();
    let cursor = step;

    for (let depth = 0; depth < 6 && cursor; depth += 1) {
      if (seen.has(cursor.key)) break;
      seen.add(cursor.key);

      const upstreamKeys = upstreamOf(cursor);
      const forms = cursor.inputs
        .filter((i) => i.sourceKind === "form")
        .map((i) => formRoleName(i.sourceRef));
      const decisions = cursor.inputs
        .filter((i) => i.sourceKind === "decision")
        .map((i) => graph.currentState(i.sourceRef)?.properties.title ?? "a decision");

      const produces = cursor.outputs
        .map((o) => (o.formRole ? formRoleName(o.formRole) : null))
        .filter((n): n is string => n !== null);

      if (depth === 0) {
        hops.push({
          subject: produces[0] ?? cursor.key,
          happened: status.reason,
        });
      } else {
        hops.push({
          subject: produces[0] ?? cursor.key,
          happened: "was built from what came before it, so it follows",
        });
      }

      // Name the source that actually feeds this step, then follow it back one hop.
      if (upstreamKeys.length === 0) {
        for (const name of forms) {
          hops.push({ subject: name, happened: "is what this was built from" });
        }
        for (const name of decisions) {
          hops.push({ subject: name, happened: "is the accepted decision this was built under" });
        }
        break;
      }
      cursor = byKey.get(upstreamKeys[0]!);
    }
    return hops;
  }

  const review = graph.decisions.reviewQueue(state?.object.worldId ?? "");

  const releases = graph.db.prepare(
    opts.sinceReleaseId
      ? `SELECT * FROM releases WHERE id = ?`
      : `SELECT * FROM releases WHERE object_id = ? ORDER BY approved_at DESC LIMIT 1`,
  ).get(opts.sinceReleaseId ?? objectId) as Record<string, unknown> | undefined;

  const total = rebuild.length + review.length;
  const since = releases
    ? labelForRelease(graph, releases["object_id"] as string, releases["id"] as string)
    : null;

  return {
    objectId,
    rebuild,
    // Only the reviews that touch this Object's world are relevant, and a decision this
    // Object was never linked to is somebody else's business.
    review,
    sinceReleaseId: (releases?.["id"] as string | null) ?? null,
    sinceLabel: since,
    headline: total === 0
      ? since ? `Nothing has changed since ${since}` : "Nothing is out of date"
      : `${total} thing${total === 1 ? "" : "s"} changed${since ? ` since ${since}` : ""}`,
  };
}

/** "Delivery 01", counted per Object so the number means something to the person. */
function labelForRelease(graph: ObjectGraph, objectId: string, releaseId: string): string {
  const all = graph.db.prepare(
    `SELECT id FROM releases WHERE object_id = ? ORDER BY approved_at, rowid`,
  ).all(objectId) as Array<{ id: string }>;
  const index = all.findIndex((r) => r.id === releaseId);
  return `Delivery ${String(index + 1).padStart(2, "0")}`;
}
