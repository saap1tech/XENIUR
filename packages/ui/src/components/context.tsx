import type { LeafSceneNode } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Button } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

const KIND_WORD: Record<string, string> = {
  focus: "what you are working on", decision: "decision", constraint: "constraint",
  change: "what changed", passage: "passage",
};
const WHY_WORD: Record<string, string> = {
  restricted_rights: "marked restricted — stays on this machine",
  over_budget: "would not fit in what this call can carry",
  outside_focus: "not connected to what you are working on",
  unresolved_support: "its citation has not been reviewed",
  not_requested: "not part of what you allowed",
};

/**
 * "What the model will see."
 *
 * The included items as chips, grouped by kind — and, as important, what was left out and
 * why. Nothing is sent that the person could not have read first. The card is filed under the
 * context's digest, which is also in the plan the approval is bound to, so confirming here
 * confirms exactly this content at exactly this cost.
 */
export function ContextReview({ node, bindings }: { node: Node<"ContextReview">; bindings: SceneBindings }) {
  const ctx = bindings.contexts?.[node.contextDigest];
  if (!ctx) return null;

  const groups = new Map<string, typeof ctx.included>();
  for (const item of ctx.included) groups.set(item.kind, [...(groups.get(item.kind) ?? []), item]);

  return (
    <section className="xr-context" role="dialog" aria-label="What the model will see">
      <header className="xr-context__head">
        <h3>What the model will see</h3>
        <p className="xr-context__meta">
          <span>{ctx.included.length} item{ctx.included.length === 1 ? "" : "s"}</span>
          <span>·</span>
          <span className="xr-mono">~{ctx.tokens} tokens</span>
          <span>·</span>
          <span>{ctx.destination === "local" ? "stays on this machine" : `to ${ctx.modelLabel ?? "a remote model"}`}</span>
          {ctx.estimatedUsd > 0 && <><span>·</span><span className="xr-mono">≤ ${ctx.estimatedUsd.toFixed(3)}</span></>}
        </p>
      </header>

      <div className="xr-context__groups">
        {[...groups].map(([kind, items]) => (
          <div key={kind} className="xr-context__group">
            <span className="xr-context__kind">{KIND_WORD[kind] ?? kind}</span>
            <ul className="xr-chips">
              {items.map((i) => <li key={i.id}><span className="xr-chip">{i.label}</span></li>)}
            </ul>
          </div>
        ))}
      </div>

      {ctx.excluded.length > 0 && (
        <div className="xr-context__excluded">
          <span className="xr-context__kind">Left out</span>
          <ul>
            {ctx.excluded.map((e) => (
              <li key={`${e.kind}-${e.id}`}>
                <span className="xr-context__left">{e.label}</span>
                <span className="xr-context__why">{WHY_WORD[e.why] ?? e.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ctx.includesRestricted && (
        <p className="xr-context__restricted">
          Restricted material is included. That is allowed only because this stays on this machine.
        </p>
      )}

      <footer className="xr-context__actions">
        <Button onClick={() => bindings.onDeclineContext?.(node.contextDigest)}>Not this</Button>
        <Button variant="primary" onClick={() => bindings.onConfirmContext?.(node.contextDigest)}>
          Send exactly this
        </Button>
      </footer>
    </section>
  );
}
