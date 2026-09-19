import type { ClaimSupport, LeafSceneNode, SupportStatus, TrustFacts } from "@xeniur/core";
import { SUPPORT_GLYPHS, describeTrust } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Empty } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/* ------------------------------------------------------------ support chip */

/**
 * One citation, as a chip. Glyph and word, never colour alone.
 *
 * `unresolved` is drawn as an outline on the hairline — deliberately empty, so that a claim
 * nobody has checked never reads as sourced. A model's proposed status is shown with the
 * word "proposed" beside it, because a model saying "supported" is a proposal, not a review.
 */
export function SupportChip({ support, label, onOpen, onReview }: {
  support: ClaimSupport;
  label: string;
  onOpen?(): void;
  onReview?(status: Exclude<SupportStatus, "unresolved">): void;
}) {
  const g = SUPPORT_GLYPHS[support.status];
  const proposed = support.checkedBy === "model";
  const unchecked = support.checkedBy === "unchecked";
  return (
    <span className={`xr-support xr-support--${support.status}${proposed ? " is-proposed" : ""}`}>
      <button type="button" className="xr-support__open" onClick={onOpen}
        aria-label={`${label}: ${g.word}${proposed ? ", proposed by a model" : unchecked ? ", not yet checked" : ""}`}>
        <span className="xr-support__glyph" aria-hidden="true">{g.glyph}</span>
        <span className="xr-support__label">{label}</span>
        <span className="xr-support__word">{g.word}{proposed ? " · proposed" : ""}</span>
      </button>
      {onReview && support.checkedBy !== "human" && (
        <span className="xr-support__review" role="group" aria-label="Review this citation">
          <button type="button" onClick={() => onReview("supported")}>supports</button>
          <button type="button" onClick={() => onReview("contradicted")}>contradicts</button>
          <button type="button" onClick={() => onReview("ambiguous")}>ambiguous</button>
        </span>
      )}
    </span>
  );
}

/* --------------------------------------------------------------- claim pair */

const RELATION_WORD: Record<string, string> = {
  supports: "supports", contradicts: "contradicts", informed_by: "informed",
  same_as: "says the same as", derived_from: "derives from",
};

/**
 * Two claims and the relation a person asserted between them, with the passage behind the
 * second.
 *
 * This is the contradiction view — "your claim ↕ their claim" — and the shape a critique
 * takes when it arrives from someone else's World. It never resolves the disagreement; it
 * places the two claims and their evidence side by side and leaves the judgement where it
 * belongs.
 */
export function ClaimPair({ node, bindings }: { node: Node<"ClaimPair">; bindings: SceneBindings }) {
  const left = bindings.states[node.leftObjectId];
  const right = bindings.states[node.rightObjectId];
  if (!left || !right) return <Empty>One of these claims is no longer here.</Empty>;

  const rightSupport = bindings.support?.[node.rightObjectId] ?? [];
  const passage = bindings.passages?.[node.rightObjectId];

  return (
    <section className={`xr-pair xr-pair--${node.relation}`}
      aria-label={`${left.properties.title} — ${RELATION_WORD[node.relation]} — ${right.properties.title}`}>
      <article className="xr-pair__claim xr-pair__claim--left">
        <span className="xr-pair__who">Your claim</span>
        <p>{left.properties.title}</p>
      </article>

      <div className="xr-pair__relation" aria-hidden="true">
        <span className="xr-pair__arrow">↕</span>
        <span className="xr-pair__word">{RELATION_WORD[node.relation]}</span>
      </div>

      <article className="xr-pair__claim xr-pair__claim--right">
        <span className="xr-pair__who">Their claim</span>
        <p>{right.properties.title}</p>
        {passage && (
          <blockquote className="xr-pair__passage">
            <span className="xr-pair__source">{passage.sourceTitle}</span>
            <span className="xr-pair__exact">{passage.text}</span>
          </blockquote>
        )}
        {rightSupport.length > 0 && (
          <div className="xr-pair__support">
            {rightSupport.map((s) => (
              <SupportChip key={s.id} support={s} label="source"
                onOpen={() => bindings.onOpenSource?.(node.rightObjectId)}
                onReview={(status) => bindings.onReviewSupport?.(s.id, status)} />
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

/* --------------------------------------------------------------- trust strip */

const CELL = ({ label, children, settled }: { label: string; children: React.ReactNode; settled?: boolean }) => (
  <div className={`xr-trust__cell${settled ? " is-settled" : ""}`}>
    <span className="xr-trust__label">{label}</span>
    <span className="xr-trust__value">{children}</span>
  </div>
);

/**
 * "Can I trust this work?" — five cells of facts, never a tick.
 *
 * Support counts by state, measurements current, provenance as three actor counts (never a
 * single "AI-made" badge), receipts with unknowns shown, cost with escalations. The strip is
 * lime in exactly one condition — everything reviewed, current, receipted, nothing awaiting
 * review — and that *settled* state is the only place in the product where trust is lime.
 * It does not animate into lime; it settles.
 */
export function TrustStrip({ node, bindings }: { node: Node<"TrustStrip">; bindings: SceneBindings }) {
  const t = bindings.trust?.[node.objectId];
  if (!t) return null;
  const s = t.support;
  const g = SUPPORT_GLYPHS;

  return (
    <div className={`xr-trust${t.settled ? " is-settled" : ""}${node.compact ? " xr-trust--compact" : ""}`}
      role="group" aria-label={describeTrust(t)}>
      <CELL label="Support" settled={t.settled}>
        <span className="xr-trust__glyphs" aria-hidden="true">
          <span className="is-supported">{g.supported.glyph} {s.supported}</span>
          <span className="is-ambiguous">{g.ambiguous.glyph} {s.ambiguous}</span>
          <span className="is-unresolved">{g.unresolved.glyph} {s.unresolved}</span>
          <span className="is-contradicted">{g.contradicted.glyph} {s.contradicted}</span>
        </span>
      </CELL>
      <CELL label="Evidence" settled={t.settled}>
        <span className="xr-mono">{t.evidence.current}/{t.evidence.total}</span> current
      </CELL>
      <CELL label="Provenance" settled={t.settled}>
        <span className="xr-trust__glyphs" aria-hidden="true">
          <span>⌂ {t.provenance.human}</span>
          <span>⚙ {t.provenance.tool}</span>
          <span>◆ {t.provenance.model}</span>
        </span>
      </CELL>
      <CELL label="Actions" settled={t.settled}>
        <span className="xr-mono">{t.actions.receipted}</span> receipted
        {t.actions.unknown > 0 && <span className="is-unknown"> · {t.actions.unknown} unknown</span>}
      </CELL>
      <CELL label="Cost" settled={t.settled}>
        <span className="xr-mono">${t.cost.usd.toFixed(2)}</span>
        {t.cost.escalations > 0 && <span> · {t.cost.escalations} ⤴</span>}
      </CELL>
      {!node.compact && t.decisionsNeedingReview > 0 && (
        <div className="xr-trust__note">{t.decisionsNeedingReview} decision{t.decisionsNeedingReview === 1 ? "" : "s"} awaiting review</div>
      )}
    </div>
  );
}
