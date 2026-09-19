import type { ConstraintRecord, LeafSceneNode, ObjectState } from "@xeniur/core";
import { formRoleName } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { displayForm } from "../bindings.js";
import { Empty, ProvenanceBadge } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

const stateOf = (bindings: SceneBindings, id: string): ObjectState | undefined => bindings.states[id];
const titleOf = (bindings: SceneBindings, id: string): string => stateOf(bindings, id)?.properties.title ?? "Unknown object";

/** Pointer and keyboard gestures deliberately enter the same proposal-only path. */
export function requestGesture(
  bindings: SceneBindings, sourceId: string, targetId: string,
  _input: "pointer" | "keyboard",
): void {
  bindings.onGestureTarget?.(sourceId, targetId);
}

function dropHandlers(bindings: SceneBindings, targetId: string, keyboardSourceId: string) {
  return {
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      const sourceId = event.dataTransfer.getData("application/x-xeniur-object");
      if (sourceId) requestGesture(bindings, sourceId, targetId, "pointer");
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        requestGesture(bindings, keyboardSourceId, targetId, "keyboard");
      }
    },
  };
}

export function ObjectOrbit({ node, bindings }: { node: Node<"ObjectOrbit">; bindings: SceneBindings }) {
  const focus = stateOf(bindings, node.focusId);
  if (!focus) return <Empty>The focused object is not available.</Empty>;
  const impact = bindings.impact?.[node.focusId];
  // The core carries the provenance of what it shows. Nobody should have to click into an
  // Object to find out that the thing they are looking at is a mock — that principle held
  // from M1's Gallery and the orbit must hold it too.
  const shown = displayForm(bindings, node.focusId);
  return (
    <section className={`xr-orbit xr-state--${node.state}`} aria-label={`${focus.properties.title} and related forms`}>
      <div className="xr-orbit__core is-selected" data-focus="true">
        <span className="xr-orbit__type">{focus.properties.semanticType}</span>
        <h2>{focus.properties.title}</h2>
        <span className="xr-orbit__version">Version {focus.seq}</span>
        {shown && <ProvenanceBadge provenance={shown.provenance} provider={shown.provider} />}
      </div>
      <div className="xr-orbit__forms" aria-label="Current forms">
        {focus.forms.slice(0, 5).map((form, index) => {
          const rebuild = impact?.rebuild.some((item) => item.formRoles.includes(form.role));
          const rep = bindings.representations[form.representationId];
          return (
            <button key={form.role} type="button" className={`xr-orbit__satellite${rebuild ? " is-rebuild" : ""}`}
              style={{ "--orbit-index": index } as React.CSSProperties}
              onClick={() => bindings.onSelectForm?.(node.focusId, form.role)}>
              <span>{formRoleName(form.role)}</span>
              {rep && <ProvenanceBadge provenance={rep.provenance} provider={rep.provider} />}
              {rebuild && <small>Rebuild</small>}
            </button>
          );
        })}
      </div>
      {impact?.review.map((item) => (
        <button key={`${item.objectId}-${item.causeObjectId}`} type="button" className="xr-orbit__review"
          onClick={() => bindings.onShowHow?.(item.objectId, item.causeObjectId)}>
          <strong>Review</strong><span>{item.title}</span><small>{item.because}</small>
        </button>
      ))}
      <div className="xr-orbit__relations" aria-label="Related objects">
        {node.relatedIds.slice(0, 6).map((id) => (
          <button key={id} type="button" draggable className="xr-orbit__relation"
            onDragStart={(event) => event.dataTransfer.setData("application/x-xeniur-object", id)}
            {...dropHandlers(bindings, id, node.focusId)}
            aria-label={`${titleOf(bindings, id)}. Press Enter to connect ${focus.properties.title}.`}>
            {titleOf(bindings, id)}
          </button>
        ))}
      </div>
    </section>
  );
}

export function AffordanceRing({ node, bindings }: { node: Node<"AffordanceRing">; bindings: SceneBindings }) {
  const ids = [...new Set([...node.proposalIds, ...Object.keys(bindings.gestureProposals ?? {})])];
  const proposals = ids.map((id) => bindings.gestureProposals?.[id]).filter(Boolean);
  if (proposals.length === 0) return null;
  return (
    <nav className="xr-affordance-ring" aria-label={`Actions for ${titleOf(bindings, node.objectId)}`}>
      {proposals.map((proposal) => proposal && (
        <button key={proposal.id} type="button" title={proposal.because}
          onClick={() => bindings.onChooseGesture?.(proposal.id)}>{proposal.label}</button>
      ))}
    </nav>
  );
}

export function SpatialCanvas({ node, bindings }: { node: Node<"SpatialCanvas">; bindings: SceneBindings }) {
  return (
    <section className="xr-spatial" aria-label={`Spatial view focused on ${titleOf(bindings, node.focusId)}`}>
      <div className="xr-spatial__edges" aria-hidden="true">
        {node.edges.map((edge) => <span key={edge.id} className={`xr-spatial__edge xr-state--${edge.state ?? "selected"}`} />)}
      </div>
      {node.objectIds.map((id, index) => {
        const state = stateOf(bindings, id);
        if (!state) return null;
        const focused = id === node.focusId;
        return (
          <button key={id} type="button" draggable
            className={`xr-spatial__object${focused ? " is-focus is-selected" : ""}`}
            style={{ "--spatial-index": index } as React.CSSProperties}
            onClick={() => bindings.onSelect?.(id)}
            onDragStart={(event) => event.dataTransfer.setData("application/x-xeniur-object", id)}
            {...dropHandlers(bindings, id, node.focusId)}>
            <small>{state.properties.semanticType}</small><strong>{state.properties.title}</strong>
          </button>
        );
      })}
    </section>
  );
}

const formatted = (constraint: ConstraintRecord): string => {
  const definition = constraint.definition;
  if (definition.kind === "range") return `${definition.unit} ${Number(constraint.value).toLocaleString()}`;
  if (definition.kind === "quantity") return `${constraint.value} ${definition.unit}`;
  if (definition.kind === "date_range" && typeof constraint.value === "object") {
    const value = constraint.value as { start: number; end: number };
    return `${new Date(value.start).toLocaleDateString()} - ${new Date(value.end).toLocaleDateString()}`;
  }
  if (definition.kind === "priority" && typeof constraint.value === "object") {
    return Object.entries(constraint.value as Record<string, number>).map(([key, value]) => `${key} ${Math.round(value * 100)}%`).join(", ");
  }
  if (definition.kind === "location") return definition.places.find((place) => place.id === constraint.value)?.label ?? String(constraint.value);
  if (definition.kind === "enum") {
    const values = Array.isArray(constraint.value) ? constraint.value : [constraint.value];
    return values.map((id) => definition.options.find((option) => option.id === id)?.label ?? id).join(", ");
  }
  return constraint.value === true ? "Yes" : constraint.value === false ? "No" : String(constraint.value);
};

export function ConstraintStrip({ node, bindings }: { node: Node<"ConstraintStrip">; bindings: SceneBindings }) {
  const constraints = node.constraintIds.map((id) => bindings.constraints?.[id]).filter(Boolean) as ConstraintRecord[];
  if (constraints.length === 0) return <Empty>No constraints are attached yet.</Empty>;
  return (
    <section className="xr-constraints" aria-label="Current constraints">
      {constraints.map((constraint) => (
        <button key={constraint.objectId} type="button" className={`xr-constraint xr-constraint--${constraint.definition.kind}`}>
          <span>{constraint.appliesTo}</span><strong>{formatted(constraint)}</strong>
        </button>
      ))}
    </section>
  );
}

function constraint(bindings: SceneBindings, id: string): ConstraintRecord | null {
  return bindings.constraints?.[id] ?? null;
}

export function RangeMeter({ node, bindings }: { node: Node<"RangeMeter">; bindings: SceneBindings }) {
  const item = constraint(bindings, node.constraintId);
  if (!item || item.definition.kind !== "range" || typeof item.value !== "number") return <Empty>No cost range is available.</Empty>;
  const d = item.definition;
  return (
    <label className="xr-meter">
      <span>{item.appliesTo}</span><output>{d.unit} {item.value.toLocaleString()}</output>
      <input type="range" min={d.min} max={d.max} step={d.step} value={item.value}
        onChange={(event) => bindings.onConstraintChange?.(item.objectId, Number(event.target.value))} />
      <small>{d.unit} {d.min.toLocaleString()} to {d.unit} {d.max.toLocaleString()}</small>
    </label>
  );
}

export function Stepper({ node, bindings }: { node: Node<"Stepper">; bindings: SceneBindings }) {
  const item = constraint(bindings, node.constraintId);
  if (!item || item.definition.kind !== "quantity" || typeof item.value !== "number") return <Empty>No quantity is available.</Empty>;
  const definition = item.definition;
  const value = item.value;
  const change = (by: number) => bindings.onConstraintChange?.(item.objectId,
    Math.max(definition.min, Math.min(definition.max, value + by)));
  return (
    <div className="xr-stepper" aria-label={`${item.appliesTo}: ${item.value} ${item.definition.unit}`}>
      <span>{item.appliesTo}</span>
      <button type="button" onClick={() => change(-1)} aria-label="Decrease">-</button>
      <strong>{item.value}</strong><small>{item.definition.unit}</small>
      <button type="button" onClick={() => change(1)} aria-label="Increase">+</button>
    </div>
  );
}

export function PeopleChips({ node, bindings }: { node: Node<"PeopleChips">; bindings: SceneBindings }) {
  const item = constraint(bindings, node.constraintId);
  if (!item || item.definition.kind !== "quantity" || typeof item.value !== "number") return <Empty>No people count is available.</Empty>;
  return (
    <div className="xr-people" aria-label={`${item.value} ${item.definition.unit}`}>
      {Array.from({ length: item.value }, (_, index) => <span key={index} aria-hidden="true">{index + 1}</span>)}
      <strong>{item.value} {item.definition.unit}</strong>
    </div>
  );
}

export function Calendar({ node, bindings }: { node: Node<"Calendar">; bindings: SceneBindings }) {
  const item = constraint(bindings, node.constraintId);
  if (!item || item.definition.kind !== "date_range" || typeof item.value !== "object") return <Empty>No dates are available.</Empty>;
  const value = item.value as { start: number; end: number };
  return (
    <section className="xr-calendar" aria-label={`${item.appliesTo}: ${formatted(item)}`}>
      <time dateTime={new Date(value.start).toISOString()}>{new Date(value.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
      <span aria-hidden="true" />
      <time dateTime={new Date(value.end).toISOString()}>{new Date(value.end).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
    </section>
  );
}

export function PriorityBalance({ node, bindings }: { node: Node<"PriorityBalance">; bindings: SceneBindings }) {
  const item = constraint(bindings, node.constraintId);
  if (!item || item.definition.kind !== "priority" || typeof item.value !== "object") return <Empty>No priorities are available.</Empty>;
  const values = item.value as Record<string, number>;
  return (
    <section className="xr-priorities" aria-label={formatted(item)}>
      {item.definition.dimensions.map((dimension) => (
        <label key={dimension}><span>{dimension}</span><input type="range" min="0" max="1" step="0.05"
          value={values[dimension] ?? 0}
          onChange={(event) => bindings.onConstraintChange?.(item.objectId, {
            ...values, [dimension]: Number(event.target.value),
          })} /></label>
      ))}
    </section>
  );
}

export function SchematicMap({ node, bindings }: { node: Node<"SchematicMap">; bindings: SceneBindings }) {
  const item = node.constraintId ? constraint(bindings, node.constraintId) : null;
  const places = item?.definition.kind === "location" ? item.definition.places.filter((place) => node.placeIds.includes(place.id)) : [];
  return (
    <section className="xr-schematic-map" aria-label="Places on a schematic map">
      <svg viewBox="0 0 640 360" role="img" aria-label={places.map((place) => place.label).join(", ")}>
        <path d="M62 256 C168 88 292 282 392 128 C458 28 544 92 588 58" />
        {places.map((place) => (
          <g key={place.id} transform={`translate(${place.x} ${place.y})`}
            className={node.selectedPlaceId === place.id ? "is-selected" : ""}>
            <circle r="10" /><text x="16" y="5">{place.label}</text>
          </g>
        ))}
      </svg>
      <div className="xr-map__places">
        {places.map((place) => <button key={place.id} type="button"
          onClick={() => item && bindings.onConstraintChange?.(item.objectId, place.id)}>{place.label}</button>)}
      </div>
    </section>
  );
}

export function ChoiceCards({ node, bindings }: { node: Node<"ChoiceCards">; bindings: SceneBindings }) {
  const visible = node.choices.filter((choice) => !choice.excluded);
  return (
    <section className="xr-choices" aria-label={`Choose by ${node.meaning}`}>
      {visible.map((choice) => (
        <button key={choice.id} type="button" className={choice.selected ? "is-selected" : ""}
          onClick={() => bindings.onChoose?.(choice.id)}>
          <strong>{choice.label}</strong>{choice.detail && <span>{choice.detail}</span>}
          {choice.cost !== null && <small>€{choice.cost.toLocaleString()}</small>}
        </button>
      ))}
      {visible.length === 0 && <Empty>No options fit the current constraints.</Empty>}
    </section>
  );
}

export function EvidenceMeter({ node, bindings }: { node: Node<"EvidenceMeter">; bindings: SceneBindings }) {
  const reports = bindings.readiness?.[node.objectId] ?? [];
  const met = reports.flatMap((report) => report.results).filter((result) => result.met).length;
  const total = reports.flatMap((report) => report.results).length;
  const proof = bindings.processProof?.[node.objectId];
  return (
    <section className="xr-evidence-meter" aria-label={`${met} of ${total} current measurements`}>
      <div><strong>{met}<span>/{total}</span></strong><p>current measurements</p></div>
      {proof && <div className="xr-proof-summary"><p>Proof of process</p><strong>{proof.summary}</strong>
        <small>Hash {proof.rootHash.slice(0, 12)}</small></div>}
    </section>
  );
}

export function EmptySlot({ node }: { node: Node<"EmptySlot">; bindings: SceneBindings }) {
  return <section className="xr-empty-slot"><span>{node.meaning}</span><strong>{node.label}</strong></section>;
}

export function ReviewSheet({ node, bindings }: { node: Node<"ReviewSheet">; bindings: SceneBindings }) {
  const state = stateOf(bindings, node.objectId);
  const proof = bindings.processProof?.[node.objectId];
  return (
    <article className="xr-review-sheet" aria-label={node.title}>
      <header><span>Ready for your decision</span><h2>{node.title}</h2></header>
      <dl>
        <div><dt>Object</dt><dd>{state?.properties.title ?? "Unknown"}</dd></div>
        <div><dt>Current forms</dt><dd>{state?.forms.map((form) => formRoleName(form.role)).join(", ") || "None"}</dd></div>
        <div><dt>Process</dt><dd>{proof?.summary ?? "No process proof published"}</dd></div>
      </dl>
      <footer><button type="button" className="xr-button xr-button--primary"
        onClick={() => bindings.onReviewApprove?.(node.objectId)}>Approve delivery</button></footer>
    </article>
  );
}
