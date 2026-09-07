import type { IngredientKind, LeafSceneNode, Lane, MapEntry } from "@xeniur/core";
import { LANES, MAP_QUESTIONS } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Button, Empty, Panel } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

const LANE_LABEL: Record<Lane, string> = {
  keep: "Keep", question: "Question", connect: "Connect",
  test: "Test", build: "Build", ignore: "Ignore",
};

/**
 * The anti-feed.
 *
 * Six headings instead of an endless list, and every answer carries the reason it is
 * there — because a compression nobody can check is just a different kind of feed. The
 * person acts by sorting into the six lanes, which is what intake is supposed to become.
 *
 * The headings say what was computed, not what it means. "Similar wording" is a fact about
 * two sentences; "What keeps repeating?" was a claim about the world, and comparing words
 * cannot establish it. Holding that line is the difference between a thinking tool and a
 * confident one.
 */
export function ThinkingMapView({ node, bindings }: { node: Node<"ThinkingMap">; bindings: SceneBindings }) {
  const map = bindings.thinkingMap?.[node.worldId];
  if (!map) return <Empty>Nothing has been captured in this World yet.</Empty>;

  const friction = bindings.friction?.[node.worldId];

  return (
    <div className="xr-map">
      {friction?.active && (
        <div className="xr-friction" role="status">
          <p className="xr-friction__prompt">{friction.prompt}</p>
          <p className="xr-friction__why">
            {friction.intakeSinceMove} things taken in since your last move. XENIUR has
            stopped surfacing more until one of them becomes something.
          </p>
          <div className="xr-friction__actions">
            <Button onClick={() => bindings.onDismissFriction?.(node.worldId)}>
              Not now
            </Button>
          </div>
        </div>
      )}

      <p className="xr-map__counts">
        {map.counts.sources} sources · {map.counts.atoms} atoms · {map.counts.links} links
      </p>

      {MAP_QUESTIONS.map(({ key, question, explains }) => {
        const entries = map[key] as MapEntry[];
        return (
          <Panel key={key} title={question}>
            <p className="xr-map__explains">{explains}</p>
            {entries.length === 0 ? <Empty>Nothing yet.</Empty> : (
              <ul className="xr-atoms">
                {entries.slice(0, node.limit).map((e) => (
                  <li key={e.atom.objectId} className={`xr-atom xr-atom--${e.atom.atomType}`}>
                    <span className="xr-atom__type">{e.atom.atomType}</span>
                    <p className="xr-atom__text">{e.atom.text}</p>
                    <p className="xr-atom__because">{e.because}</p>
                    <div className="xr-atom__foot">
                      {e.atom.extraction === "heuristic" && (
                        <span className="xr-chip xr-chip--heuristic">suggested by pattern</span>
                      )}
                      {e.atom.confidence === null
                        ? <span className="xr-chip">unrated</span>
                        : <span className="xr-chip">{Math.round(e.atom.confidence * 100)}% sure</span>}
                      <span className="xr-lanes">
                        {LANES.map((lane) => (
                          <button
                            key={lane} type="button"
                            className={`xr-lane${e.atom.lane === lane ? " is-set" : ""}`}
                            onClick={() => bindings.onSort?.(e.atom.objectId, lane)}
                          >{LANE_LABEL[lane]}</button>
                        ))}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- ingredient panel */

const KIND_LABEL: Record<IngredientKind, string> = {
  your_observation: "Your observation",
  external_human: "External source",
  previous_object: "Previous object",
  ai_suggested: "AI-suggested",
  unattributed: "Origin unknown",
};

/**
 * What XENIUR is about to think with, before it thinks with it.
 *
 * Counts and precise statements, never a score. Each statement is decidable and carries a
 * path you can follow; "origin unknown" is shown as exactly that rather than being
 * reported as generated. Where nothing came from a person it invites one ingredient rather
 * than refusing, because the person remains responsible for novelty and direction.
 */
export function IngredientPanel({ node, bindings }: { node: Node<"IngredientPanel">; bindings: SceneBindings }) {
  const dna = bindings.dna?.[node.objectId];
  if (!dna) return <Empty>Nothing to inspect yet.</Empty>;

  const kinds = (Object.entries(dna.summary.counts) as Array<[IngredientKind, number]>)
    .filter(([, n]) => n > 0);

  return (
    <Panel title="What this is made of">
      <div className="xr-dna">
        {kinds.length === 0 ? <Empty>Nothing yet.</Empty> : (
          <ul className="xr-dna__kinds">
            {kinds.map(([kind, count]) => (
              <li key={kind} className={`xr-dna__kind xr-dna__kind--${kind}`}>
                <span className="xr-dna__count">{count}</span>
                <span className="xr-dna__label">{KIND_LABEL[kind]}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="xr-dna__composition">{dna.composition}</p>

        {dna.statements.length > 0 && (
          <ul className="xr-dna__statements">
            {dna.statements.map((s) => (
              <li key={s.kind} className={`xr-dna__statement xr-dna__statement--${s.kind}`}>
                {s.text}
              </li>
            ))}
          </ul>
        )}

        {dna.invitation && (
          <div className="xr-dna__flag xr-dna__flag--signal">
            <p>{dna.invitation}</p>
            <Button variant="primary" onClick={() => bindings.onAddObservation?.(node.objectId)}>
              Add something of yours
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------- focus view */

/**
 * One thing, and nothing else.
 *
 * No Active list, no suggestions, no navigation. It only quiets XENIUR itself, and says
 * so — claiming to silence a machine it does not control would be a lie the person only
 * discovers when a notification arrives.
 */
export function FocusView({ node, bindings }: { node: Node<"FocusView">; bindings: SceneBindings }) {
  const state = bindings.states[node.objectId];
  const forms = state?.forms ?? [];
  const rep = forms
    .map((f) => bindings.representations[f.representationId])
    .find((r) => r !== undefined);

  return (
    <div className="xr-focus">
      <header className="xr-focus__head">
        <h1>{state?.properties.title ?? "Focus"}</h1>
        {node.minutes > 0 && <span className="xr-focus__timer">{node.minutes} min</span>}
        <Button onClick={() => bindings.onExitFocus?.()}>Leave focus</Button>
      </header>

      <div className="xr-focus__material">
        {rep?.blobHash && rep.modality === "image" && (
          <img src={bindings.blobUrl(rep.blobHash)} alt="" />
        )}
        {rep?.blobHash && rep.modality === "text" && (
          <article className="xr-focus__text">{bindings.textOf?.(rep.id) ?? ""}</article>
        )}
        {!rep && <Empty>Nothing to focus on yet.</Empty>}
      </div>

      <footer className="xr-focus__foot">
        XENIUR is quiet: no suggestions, no task updates, no navigation.
        It has not touched anything outside this window.
      </footer>
    </div>
  );
}
