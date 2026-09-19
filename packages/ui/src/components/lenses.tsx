import { useState } from "react";
import type { LeafSceneNode, SupportLane, TrailRow } from "@xeniur/core";
import { SUPPORT_GLYPHS, SUPPORT_LANES, SUPPORT_LANE_WORDS, describeTrailRow } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * The Support Map — a report as its claims, in four lanes by support state, and a quiet
 * fifth for the author's own statements. Each claim is a 4 px card with its stance, its
 * chips and who checked. Lane headers are toggles, not a form. Counts only: the map never
 * shows a percentage, because a percentage is a claim about the whole that nobody checked.
 */
export function SupportMap({ node, bindings }: { node: Node<"SupportMap">; bindings: SceneBindings }) {
  const map = bindings.supportMaps?.[node.objectId];
  const [hidden, setHidden] = useState<Set<SupportLane>>(new Set());
  if (!map) return null;
  const g = SUPPORT_GLYPHS;
  const toggle = (lane: SupportLane) => setHidden((h) => {
    const next = new Set(h); if (next.has(lane)) next.delete(lane); else next.add(lane); return next;
  });
  const lanes = node.lanes.length > 0 ? node.lanes : [...SUPPORT_LANES];

  return (
    <section className="xr-supportmap" aria-label={map.summary}>
      <header className="xr-supportmap__head">
        <h2>{map.title}</h2>
        <span className="xr-supportmap__count">{map.claims.length} claim{map.claims.length === 1 ? "" : "s"}</span>
      </header>
      <div className="xr-supportmap__lanes" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(0, 1fr))` }}>
        {lanes.map((lane) => (
          <div key={lane} className={`xr-lane xr-lane--${lane}${hidden.has(lane) ? " is-hidden" : ""}`}>
            <button type="button" className="xr-lane__head" aria-pressed={!hidden.has(lane)} onClick={() => toggle(lane)}>
              <span aria-hidden="true">{lane === "own" ? "·" : g[lane].glyph}</span> {SUPPORT_LANE_WORDS[lane]}
              <span className="xr-lane__n xr-mono">{map.lanes[lane]}</span>
            </button>
            {!hidden.has(lane) && map.claims.filter((c) => c.lane === lane).map((c) => (
              <article key={c.objectId} className="xr-claimcard" draggable
                onDragStart={(e) => e.dataTransfer.setData("application/x-xeniur-object", c.objectId)}>
                <button type="button" className="xr-claimcard__text" onClick={() => bindings.onSelect?.(c.objectId)}>{c.text}</button>
                <div className="xr-claimcard__meta">
                  <span className="xr-claimcard__stance">{c.stance}</span>
                  {c.lane !== "own" && (
                    <span className="xr-claimcard__by">{c.checkedBy === "human" ? "checked by you" : c.checkedBy === "model" ? "proposed by a model" : "unchecked"}</span>
                  )}
                </div>
                {node.disclosure >= 3 && c.sources.length > 0 && (
                  <ul className="xr-claimcard__sources">{c.sources.map((s) => <li key={s}>{s}</li>)}</ul>
                )}
              </article>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The Agent Trail — saw · decided · authorised · executed, one row per model call or
 * consequential action. A row that stopped early stops visibly: the later cells are hairline
 * outlines, and nothing is inferred to fill them. Every filled cell shows its digest.
 */
export function AgentTrail({ node, bindings }: { node: Node<"AgentTrail">; bindings: SceneBindings }) {
  const rows = bindings.agentTrail?.[node.objectId] ?? [];
  return (
    <section className="xr-trail" aria-label={`Agent trail, ${rows.length} row${rows.length === 1 ? "" : "s"}`}>
      <div className="xr-trail__row xr-trail__row--head" aria-hidden="true">
        <span>Saw</span><span>Decided</span><span>Authorized</span><span>Executed</span>
      </div>
      {rows.length === 0 && <p className="xr-trail__none">No model has been asked anything about this yet.</p>}
      {rows.map((r) => <TrailLine key={r.id} row={r} />)}
    </section>
  );
}

function TrailLine({ row }: { row: TrailRow }) {
  return (
    <div className="xr-trail__row" role="row" aria-label={describeTrailRow(row)}>
      <Cell filled={!!row.saw}>
        {row.saw && <>
          <span className="xr-trail__digest xr-mono">{row.saw.digest.slice(0, 12)}</span>
          <span className="xr-trail__word">{row.saw.included} item{row.saw.included === 1 ? "" : "s"} · {row.saw.excluded} excl.</span>
        </>}
      </Cell>
      <Cell filled={!!row.decided}>
        {row.decided && <>
          <span className="xr-trail__word">{row.decided.kind.replaceAll("_", " ")}</span>
          {row.decided.model && <span className="xr-trail__sub">{row.decided.model}</span>}
        </>}
      </Cell>
      <Cell filled={!!row.authorized}>
        {row.authorized && <>
          <span className="xr-trail__digest xr-mono">{row.authorized.planDigest.slice(0, 12)}</span>
          <span className="xr-trail__word">{row.authorized.level}</span>
        </>}
      </Cell>
      <Cell filled={!!row.executed}>
        {row.executed && <>
          <span className="xr-trail__word">{row.executed.outcome}</span>
          <span className="xr-trail__digest xr-mono">{row.executed.actionId.slice(0, 8)}</span>
        </>}
      </Cell>
    </div>
  );
}

function Cell({ filled, children }: { filled: boolean; children: React.ReactNode }) {
  return <div className={`xr-trail__cell${filled ? " is-filled" : " is-empty"}`}>{filled ? children : <span className="xr-trail__empty" aria-label="nothing recorded" />}</div>;
}
