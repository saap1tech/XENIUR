import { useState } from "react";
import type { CandidateRecord, LeafSceneNode } from "@xeniur/core";
import { SUPPORT_GLYPHS, compressForScene } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { t } from "../i18n.js";
import { Button, Tag } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * The Proposals tray — what a model proposed, before any of it is knowledge.
 *
 * Claims and steps arrive as candidates: each card carries its stance, its proposed support
 * state as a chip (a model's opinion, never final), and *unsupported by the sources given*
 * where binding found no passage. Seven are primary; the rest sit behind *Show supporting
 * detail*. Nothing becomes an atom without a click; an assertion whose citations nobody has
 * reviewed needs *Accept anyway*. Reject is one click and records a rejection.
 */
export function ProposalsTray({ node, bindings }: { node: Node<"ProposalsTray">; bindings: SceneBindings }) {
  const all = bindings.candidates?.[node.worldId] ?? [];
  const [showAll, setShowAll] = useState(false);
  if (all.length === 0) return null;
  const claims = all.filter((c) => c.atomType !== "moment");
  const steps = all.filter((c) => c.atomType === "moment");
  const { primary, supporting } = compressForScene(steps);

  return (
    <section className="xr-proposals" aria-label={`${all.length} proposal${all.length === 1 ? "" : "s"} awaiting review`}>
      <p className="xr-sr">{all.length === 0 ? t("sr.proposals.none") : t("sr.proposals", { count: all.length })}</p>
      <header className="xr-proposals__head">
        <h2>Proposed</h2>
        <span className="xr-proposals__count xr-mono">{all.length}</span>
        <span className="xr-proposals__note">A model's proposals. None of this is knowledge until you accept it.</span>
      </header>

      {claims.length > 0 && (
        <div className="xr-proposals__group">
          <h3>Claims</h3>
          {claims.map((c) => <CandidateCard key={c.id} candidate={c} bindings={bindings} />)}
        </div>
      )}

      {steps.length > 0 && (
        <div className="xr-proposals__group">
          <h3>Steps</h3>
          <ol className="xr-proposals__steps">
            {primary.map((c) => <li key={c.id}><CandidateCard candidate={c} bindings={bindings} step /></li>)}
            {showAll && supporting.map((c) => <li key={c.id}><CandidateCard candidate={c} bindings={bindings} step /></li>)}
          </ol>
          {supporting.length > 0 && (
            <Button onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show supporting detail · ${supporting.length} more`}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function CandidateCard({ candidate, bindings, step = false }: { candidate: CandidateRecord; bindings: SceneBindings; step?: boolean }) {
  const unsupported = candidate.stance === "assertion" && candidate.citations.length === 0;
  const unreviewedAssertion = candidate.stance === "assertion" && candidate.citations.length > 0;
  return (
    <article className={`xr-candidate${step ? " xr-candidate--step" : ""}`} aria-label={`${candidate.stance}: ${candidate.text}`}>
      <p className="xr-candidate__text">{candidate.text}</p>
      <div className="xr-candidate__meta">
        <span className="xr-candidate__stance">{candidate.stance}</span>
        {candidate.citations.map((c, i) => {
          const g = SUPPORT_GLYPHS[c.proposedStatus];
          return (
            <span key={i} className={`xr-candidate__chip is-${c.proposedStatus}`} title="a model's proposed reading; not reviewed">
              <span aria-hidden="true">{g.glyph}</span> {g.word} · proposed
            </span>
          );
        })}
        {unsupported && <Tag variant="review">unsupported by the sources given</Tag>}
      </div>
      <div className="xr-candidate__actions">
        {unreviewedAssertion
          ? <Button onClick={() => bindings.onAcceptCandidate?.(candidate.id, { acceptUnreviewed: true })}>Accept anyway</Button>
          : <Button onClick={() => bindings.onAcceptCandidate?.(candidate.id, {})}>Accept</Button>}
        <Button onClick={() => bindings.onRejectCandidate?.(candidate.id)}>Reject</Button>
        {unreviewedAssertion && <span className="xr-candidate__why">its citations have not been reviewed</span>}
      </div>
    </article>
  );
}

/**
 * The compact indicator for an ordinary request: which World, how much, where it goes. No
 * interruption when the request stays inside what was approved before.
 */
export function ContextIndicator({ node, bindings }: { node: Node<"ContextIndicator">; bindings: SceneBindings }) {
  const ctx = bindings.contexts?.[node.contextDigest];
  if (!ctx) return null;
  return (
    <div className="xr-ctxind" role="status" aria-label={t("sr.context", {
      included: ctx.included.length, excluded: ctx.excluded.length,
      destination: ctx.destination === "local" ? t("sr.context.local") : t("sr.context.remote", { model: ctx.modelLabel ?? "a remote model" }),
    })}>
      <span className="xr-ctxind__scope">{ctx.included.length} item{ctx.included.length === 1 ? "" : "s"}</span>
      {ctx.excluded.length > 0 && <span className="xr-ctxind__excluded">· {ctx.excluded.length} left out</span>}
      <span className="xr-ctxind__dest">· {ctx.destination === "local" ? "stays on this machine" : `→ ${ctx.modelLabel ?? "remote model"}`}</span>
      <button type="button" className="xr-ctxind__open" onClick={() => bindings.onOpenContext?.(node.contextDigest)}>what it sees</button>
    </div>
  );
}
