import type { LeafSceneNode } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { t } from "../i18n.js";
import { Empty, Panel, ProvenanceBadge } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * How a form actually came to be, drawn as the chain it is.
 *
 * Depth 0 is what you are looking at; every step below it is what that was made from,
 * ending at whatever a person or an outside source put in. The cost is summed across the
 * whole chain, because that is what the outcome really cost.
 */
export function LineageGraph({ node, bindings }: { node: Node<"LineageGraph">; bindings: SceneBindings }) {
  const lineage = bindings.lineage?.[node.representationId];
  if (!lineage || lineage.steps.length <= 1) return <Empty>No transformations yet.</Empty>;

  return (
    <Panel title="Where this came from">
      <ol className="xr-lineage">
        {lineage.steps.map((step) => {
          const rep = step.representation;
          return (
            <li key={step.representationId} className="xr-lineage__step">
              <span className="xr-lineage__depth">{step.depth}</span>
              <span className="xr-lineage__what">
                {rep ? `${rep.modality}/${rep.format}` : "unknown"}
              </span>
              {rep && <ProvenanceBadge provenance={rep.provenance} provider={rep.provider} />}
              {rep?.toolVersion && <span className="xr-dim">{rep.toolVersion}</span>}
            </li>
          );
        })}
        <li className="xr-lineage__total">
          {lineage.actions.length} step{lineage.actions.length === 1 ? "" : "s"} · ${lineage.totalUsd.toFixed(2)}
        </li>
      </ol>
    </Panel>
  );
}

const POLICY_LABEL: Record<string, string> = {
  deterministic: "re-runs free",
  candidate_generation: t("recipe.candidate"),
  manual: "yours to do",
};

/**
 * The recipe as the DAG it is: which step feeds which, what each one is allowed to do on
 * a rebuild, and whether it is currently up to date.
 */
export function RecipeGraph({ node, bindings }: { node: Node<"RecipeGraph">; bindings: SceneBindings }) {
  const steps = bindings.stepStates?.[node.objectId] ?? [];
  if (steps.length === 0) return <Empty>{t("recipe.empty")}</Empty>;

  return (
    <Panel title="Recipe">
      <ol className="xr-recipe">
        {steps.map((s) => (
          <li key={s.stepKey} className={`xr-step xr-step--${s.state} xr-step--${s.replayPolicy}`}>
            <span className="xr-step__key">{s.stepKey}</span>
            <span className="xr-step__tool">{s.tool}</span>
            <span className="xr-step__policy">{POLICY_LABEL[s.replayPolicy] ?? s.replayPolicy}</span>
            <span className="xr-step__state">{s.state}</span>
            <span className="xr-step__why">{s.reason}</span>
            {s.formRoles.length > 0 && (
              <span className="xr-step__roles">{s.formRoles.join(", ")}</span>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
