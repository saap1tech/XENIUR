import { useState } from "react";
import type { LeafSceneNode } from "@xeniur/core";
import { GOAL_STATUS_WORDS, KNOWLEDGE_GLYPHS, KNOWLEDGE_STATES, describeStanding } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Button } from "./primitives.jsx";
import { t } from "../i18n.js";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * Where you stand.
 *
 * The goal in the person's words; five knowledge states as labelled counts (● known · ◐
 * proposed · ◌ disputed · ○ unknown · ▲ chosen despite); what changed since they left; the
 * next actions; what is needed to finish. Every count is rows, every item a link. Nothing is
 * generated, nothing is scored, nothing is a percentage.
 */
export function Standing({ node, bindings }: { node: Node<"Standing">; bindings: SceneBindings }) {
  const s = bindings.standings?.[node.goalId];
  const [draft, setDraft] = useState("");
  if (!s) return null;
  const open = s.nextActions.filter((a) => !a.doneAt);
  const missing = s.needed.filter((n) => !n.satisfied);
  const c = s.changed;
  const nothingChanged = c.newSources.length + c.rebuild.length + c.review.length + c.critiques.length === 0;

  return (
    <section className="xr-standing" aria-label={describeStanding(s)}>
      <p className="xr-sr">{t("sr.standing", {
        goal: s.goal.outcome, status: GOAL_STATUS_WORDS[s.goal.status].label,
        known: s.knowledge.known.length, proposed: s.knowledge.proposed.length, disputed: s.knowledge.disputed.length,
        unknown: s.knowledge.unknown.length, chosen: s.knowledge.chosenDespite.length,
        changed: c.newSources.length + c.rebuild.length + c.review.length + c.critiques.length,
        next: open.length, needed: missing.length,
      })}</p>
      <header className="xr-standing__head">
        <h2>{s.goal.outcome}</h2>
        <span className="xr-standing__status" title={GOAL_STATUS_WORDS[s.goal.status].means}>{GOAL_STATUS_WORDS[s.goal.status].label}</span>
        {s.focus && <span className="xr-standing__focus">in the centre: <button type="button" onClick={() => bindings.onSelect?.(s.focus!.id)}>{s.focus.title}</button></span>}
      </header>

      <div className="xr-standing__knowledge" role="list">
        {KNOWLEDGE_STATES.map((k) => {
          const g = KNOWLEDGE_GLYPHS[k]; const items = s.knowledge[k];
          return (
            <div key={k} className={`xr-standing__state is-${k}`} role="listitem" title={g.means}>
              <span className="xr-standing__glyph" aria-hidden="true">{g.glyph}</span>
              <span className="xr-standing__n xr-mono">{items.length}</span>
              <span className="xr-standing__word">{g.word}</span>
              {items.length > 0 && (
                <ul className="xr-standing__items">
                  {items.slice(0, 5).map((it) => (
                    <li key={it.id}>{it.id.startsWith("candidate-") ? <span>{it.title}</span>
                      : <button type="button" onClick={() => bindings.onSelect?.(it.id)}>{it.title}</button>}</li>
                  ))}
                  {items.length > 5 && <li className="xr-standing__more">and {items.length - 5} more</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="xr-standing__cols">
        <section className="xr-standing__col">
          <h3>Changed since you left</h3>
          {nothingChanged ? <p className="xr-standing__quiet">Nothing.</p> : (
            <ul>
              {c.review.map((r) => <li key={`r-${r.id}`}><button type="button" onClick={() => bindings.onSelect?.(r.id)}>{r.title}</button> — a decision it rested on needs review</li>)}
              {c.rebuild.map((r) => <li key={`b-${r.id}`}><button type="button" onClick={() => bindings.onSelect?.(r.id)}>{r.title}</button> — out of date since delivery</li>)}
              {c.newSources.map((r) => <li key={`s-${r.id}`}>{r.title} — new source</li>)}
              {c.critiques.map((r) => <li key={`c-${r.id}`}><button type="button" onClick={() => bindings.onSelect?.(r.id)}>{r.title}</button> — a critique arrived</li>)}
            </ul>
          )}
        </section>

        <section className="xr-standing__col">
          <h3>Next</h3>
          {open.length === 0 && <p className="xr-standing__quiet">Nothing written down yet.</p>}
          <ul>
            {open.map((a) => (
              <li key={a.id} className="xr-standing__action">
                <button type="button" className="xr-standing__done" aria-label={`Done: ${a.text}`}
                  onClick={() => bindings.onNextActionDone?.(s.goal.id, a.id)}>○</button>
                {a.objectId ? <button type="button" onClick={() => bindings.onSelect?.(a.objectId!)}>{a.text}</button> : <span>{a.text}</span>}
                {a.origin === "accepted_proposal" && <span className="xr-standing__origin">accepted proposal</span>}
              </li>
            ))}
          </ul>
          {bindings.onAddNextAction && (
            <form className="xr-standing__add" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { bindings.onAddNextAction?.(s.goal.id, draft.trim()); setDraft(""); } }}>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What you mean to do next" aria-label="Add a next action" />
              <Button type="submit">Add</Button>
            </form>
          )}
        </section>

        <section className="xr-standing__col">
          <h3>Needed to finish</h3>
          {s.needed.length === 0 ? <p className="xr-standing__quiet">No required outputs named.</p> : (
            <ul>
              {s.needed.map((n) => (
                <li key={n.output} className={n.satisfied ? "is-satisfied" : "is-missing"}>
                  <span aria-hidden="true">{n.satisfied ? "●" : "○"}</span> {n.output}{n.satisfied ? "" : " — not yet made"}
                </li>
              ))}
            </ul>
          )}
          {missing.length === 0 && s.needed.length > 0 && <p className="xr-standing__quiet">Everything named exists.</p>}
        </section>
      </div>
    </section>
  );
}
