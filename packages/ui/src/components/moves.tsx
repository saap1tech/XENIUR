import type { LeafSceneNode } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { t } from "../i18n.js";
import { Button } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * Thinking moves — beside a selected claim, question or decision.
 *
 *   Find the basis   where this came from and what its sources actually say
 *   Challenge it     counterarguments, conflicting evidence, assumptions — as proposals
 *   Connect it       relationships with other Objects here — the graph first, a model second
 *   Test it          a way to investigate the uncertainty — a plan, never a result
 *
 * Each creates something persistent: a support row to review, a counterclaim candidate, a
 * proposed link, a hypothesis and steps. None produces "a longer answer". A cited passage is
 * not support; a proposed counterargument is not valid until read; a proposed test was not
 * performed.
 */
export function ThinkingMoves({ node, bindings }: { node: Node<"ThinkingMoves">; bindings: SceneBindings }) {
  const state = bindings.states[node.objectId];
  if (!state) return null;
  const kind = state.properties.semanticType;
  const isIdea = kind === "claim" || kind === "question" || kind === "decision" || kind === "hypothesis";
  if (!isIdea) return null;
  const brain = bindings.brainAvailable ?? false;
  const needsModel = "needs a model — none is connected, so this would only show what would be sent";
  const connections = bindings.connections?.[node.objectId] ?? [];

  return (
    <section className="xr-moves" aria-label={t("sr.moves", { title: state.properties.title, unavailable: brain ? 0 : 2 })}>
      <h3>Thinking moves</h3>
      <div className="xr-moves__grid">
        <Move label="Find the basis" means="Show where this idea came from and what its sources actually say."
          onClick={() => bindings.onThinkingMove?.("basis", node.objectId)} />
        <Move label="Challenge it" means="Surface counterarguments, conflicting evidence or assumptions — as proposals."
          disabled={!brain} why={needsModel} onClick={() => bindings.onThinkingMove?.("challenge", node.objectId)} />
        <Move label="Connect it" means="Find relationships with other Objects in this World."
          onClick={() => bindings.onThinkingMove?.("connect", node.objectId)} />
        <Move label="Test it" means="Propose a way to investigate the uncertainty. A plan, not a result."
          disabled={!brain} why={needsModel} onClick={() => bindings.onThinkingMove?.("test", node.objectId)} />
      </div>
      {connections.length > 0 && (
        <ul className="xr-moves__connections" aria-label="Connections found in the graph">
          {connections.map((c) => (
            <li key={c.objectId}>
              <button type="button" className="xr-moves__target" onClick={() => bindings.onSelect?.(c.objectId)}>{c.title}</button>
              <span className="xr-moves__because">{c.because}</span>
              <Button onClick={() => bindings.onProposeConnection?.(node.objectId, c.objectId)}>Propose link</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Move({ label, means, disabled = false, why, onClick }: { label: string; means: string; disabled?: boolean; why?: string; onClick(): void }) {
  return (
    <button type="button" className="xr-tmove" disabled={disabled} title={disabled ? why : means} onClick={onClick}
      aria-describedby={undefined}>
      <strong>{label}</strong>
      <span>{disabled ? why : means}</span>
    </button>
  );
}
