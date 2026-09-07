import type { LeafSceneNode } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { currentForms, displayForm } from "../bindings.js";
import { Empty, Panel, ProvenanceBadge } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

function Thumb({ bindings, objectId }: { bindings: SceneBindings; objectId: string }) {
  const rep = displayForm(bindings, objectId);
  if (!rep?.blobHash) return <div className="xr-thumb xr-thumb--none" />;
  if (rep.modality === "image") {
    return <img className="xr-thumb" src={bindings.blobUrl(rep.blobHash)} alt="" />;
  }
  return <div className={`xr-thumb xr-thumb--${rep.modality}`}>{rep.format.toUpperCase()}</div>;
}

export function ObjectCard({ node, bindings }: { node: Node<"ObjectCard">; bindings: SceneBindings }) {
  const state = bindings.states[node.objectId];
  if (!state) return null;
  const rep = displayForm(bindings, node.objectId);
  return (
    <article
      className={`xr-card${node.selected ? " xr-card--selected" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width }}
      onClick={() => bindings.onSelect?.(node.objectId)}
    >
      <Thumb bindings={bindings} objectId={node.objectId} />
      <h3 className="xr-card__title">{state.properties.title}</h3>
      <div className="xr-card__meta">
        <span className="xr-card__type">{state.properties.semanticType}</span>
        {rep && <ProvenanceBadge provenance={rep.provenance} provider={rep.provider} />}
      </div>
    </article>
  );
}

export function Gallery({ node, bindings }: { node: Node<"Gallery">; bindings: SceneBindings }) {
  if (node.objectIds.length === 0) return <Empty>Nothing here yet.</Empty>;
  return (
    <div className="xr-gallery" style={{ gridTemplateColumns: `repeat(${node.columns}, minmax(0, 1fr))` }}>
      {node.objectIds.map((id) => {
        const state = bindings.states[id];
        if (!state) return null;
        // The gallery is the default view of a World, so it has to carry provenance too:
        // a person should never have to click into something to find out it is a mock.
        const rep = displayForm(bindings, id);
        return (
          <button key={id} type="button" className="xr-gallery__item" onClick={() => bindings.onSelect?.(id)}>
            <Thumb bindings={bindings} objectId={id} />
            <span className="xr-gallery__label">{state.properties.title}</span>
            {rep && <ProvenanceBadge provenance={rep.provenance} provider={rep.provider} />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The Inspector is where the Object Graph becomes visible. Provenance and the full
 * lineage chain are shown to the person, not just kept queryable — "this STL came from
 * this GLB, generated from this image, which came from that circle", and what it cost.
 */
export function Inspector({ node, bindings }: { node: Node<"Inspector">; bindings: SceneBindings }) {
  const state = bindings.states[node.objectId];
  if (!state) return null;
  const forms = currentForms(bindings, node.objectId);
  const head = displayForm(bindings, node.objectId);
  const lineage = head ? bindings.lineage?.[head.id] : undefined;

  return (
    <Panel title={state.properties.title}>
      <dl className="xr-inspector__facts">
        <dt>Type</dt><dd>{state.properties.semanticType}</dd>
        <dt>Forms</dt><dd>{forms.length}</dd>
        <dt>Version</dt><dd>{state.seq}{state.branchName ? ` · ${state.branchName}` : ""}</dd>
        <dt>Object id</dt><dd className="xr-mono">{state.object.id}</dd>
      </dl>

      {node.showProvenance && head && (
        <div className="xr-inspector__provenance">
          <ProvenanceBadge provenance={head.provenance} provider={head.provider} />
          {head.model && <span className="xr-mono">{head.model}</span>}
          {head.toolVersion && <span className="xr-dim">{head.toolVersion}</span>}
        </div>
      )}

      {node.showLineage && (
        lineage && lineage.steps.length > 1 ? (
          <ol className="xr-lineage">
            {lineage.steps.map((step) => (
              <li key={step.representationId} className="xr-lineage__step">
                <span className="xr-lineage__depth">{step.depth}</span>
                <span className="xr-lineage__what">
                  {step.representation
                    ? `${step.representation.modality}/${step.representation.format}`
                    : "unknown"}
                </span>
                {step.representation && (
                  <ProvenanceBadge provenance={step.representation.provenance} provider={step.representation.provider} />
                )}
              </li>
            ))}
            <li className="xr-lineage__total">
              {lineage.actions.length} steps · ${lineage.totalUsd.toFixed(2)}
            </li>
          </ol>
        ) : <Empty>No transformations yet.</Empty>
      )}
    </Panel>
  );
}

export function Comparison({ node, bindings }: { node: Node<"Comparison">; bindings: SceneBindings }) {
  const sides = [node.leftRepresentationId, node.rightRepresentationId].map((id) => bindings.representations[id]);
  return (
    <Panel title={node.label || "Compare"}>
      <div className="xr-compare">
        {sides.map((rep, i) => (
          <figure key={rep?.id ?? i} className="xr-compare__side">
            {rep?.blobHash && rep.modality === "image"
              ? <img src={bindings.blobUrl(rep.blobHash)} alt="" />
              : <div className="xr-thumb xr-thumb--none">{rep?.format.toUpperCase() ?? "—"}</div>}
            <figcaption>
              {rep ? <ProvenanceBadge provenance={rep.provenance} provider={rep.provider} /> : "missing"}
            </figcaption>
          </figure>
        ))}
      </div>
    </Panel>
  );
}
