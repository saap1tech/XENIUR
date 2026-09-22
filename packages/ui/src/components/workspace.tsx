import type {
  LeafSceneNode, RebuildItem, ReviewItem,
} from "@xeniur/core";
import { formRoleName, semanticTypeName, withArticle } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { t } from "../i18n.js";
import { Tag, Button, Empty, Panel } from "./primitives.jsx";
import { SupportChip } from "./trust.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/* ------------------------------------------------------------ impact review */

const ACTION_LABEL: Record<RebuildItem["actionable"], string> = {
  rebuild: "XENIUR can rebuild this",
  regenerate: "would need generating again",
  waiting_on_you: "waiting on you",
  blocked: "an earlier step goes first",
};

/**
 * What changed, split into what XENIUR can fix and what only you can judge.
 *
 * This split is the first thing a person sees about a changed Object, rather than
 * something they have to be taught. The two lists are visually distinct and behave
 * differently: **Rebuild** offers to act, because the work is mechanical and the correct
 * output is computable. **Review** offers only to show you why, because a changed article
 * cannot make a decision wrong — it can only make it worth looking at again, and a button
 * that claimed otherwise would be the whole product lying.
 */
export function ImpactReview({ node, bindings }: { node: Node<"ImpactReview">; bindings: SceneBindings }) {
  const impact = bindings.impact?.[node.objectId];
  if (!impact) return <Empty>Nothing has been built here yet.</Empty>;

  const nothing = impact.rebuild.length === 0 && impact.review.length === 0;

  if (node.compact) {
    return (
      <p className={`xr-impact__line${nothing ? " is-settled" : ""}`}>
        <span className="xr-impact__headline">{impact.headline}</span>
        {impact.rebuild.length > 0 && (
          <Tag variant="rebuild">{impact.rebuild.length} to rebuild</Tag>
        )}
        {impact.review.length > 0 && (
          <Tag variant="review">{impact.review.length} to review</Tag>
        )}
      </p>
    );
  }

  return (
    <div className="xr-impact">
      <p className="xr-impact__headline">{impact.headline}</p>
      {nothing && <Empty>Everything is current, and nothing is waiting on you.</Empty>}

      {impact.rebuild.length > 0 && (
        <Panel title="Rebuild" actions={
          <Button onClick={() => bindings.onRebuild?.(node.objectId, false)}>
            Rebuild what is out of date
          </Button>
        }>
          <p className="xr-impact__what">
            Out of date against what produced it. XENIUR can make these correct.
          </p>
          <ul className="xr-impact__list xr-impact__list--rebuild">
            {impact.rebuild.map((r) => (
              <li key={r.stepKey} className={`xr-impact__item xr-impact__item--${r.actionable}`}>
                <span className="xr-impact__subject">
                  {r.formRoles.map(formRoleName).join(" · ") || r.stepKey}
                </span>
                <span className="xr-impact__state">{ACTION_LABEL[r.actionable]}</span>
                {/* The first hop is this item itself — the header just said its name, so
                    only its reason is worth repeating. The rest is the path back. */}
                <p className="xr-impact__because">{r.path[0]?.happened ?? r.because}</p>
                {r.path.length > 1 && <Path steps={r.path.slice(1)} />}
                <button type="button" className="xr-showhow"
                  onClick={() => bindings.onShowHow?.(node.objectId, r.stepKey)}>
                  Show how this happened
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {impact.review.length > 0 && (
        <Panel title="Review">
          <p className="xr-impact__what">
            Something you cited has changed. Nothing here is wrong, and nothing here can be
            rebuilt; only you can say whether it still holds.
          </p>
          <ul className="xr-impact__list xr-impact__list--review">
            {impact.review.map((r) => <ReviewRow key={`${r.causeObjectId}-${r.objectId}`}
                                                 item={r} bindings={bindings} />)}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function ReviewRow({ item, bindings }: { item: ReviewItem; bindings: SceneBindings }) {
  return (
    <li className="xr-impact__item xr-impact__item--review">
      <span className="xr-impact__subject">{item.title}</span>
      <span className="xr-impact__state">review recommended</span>
      <p className="xr-impact__because">{item.because}</p>
      <div className="xr-impact__actions">
        <button type="button" className="xr-showhow"
          onClick={() => bindings.onShowHow?.(item.objectId, item.causeObjectId)}>
          Show how this happened
        </button>
        <Button onClick={() => bindings.onReviewed?.(item.objectId)}>I have looked</Button>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------- causal path */

const Path = ({ steps }: { steps: Array<{ subject: string; happened: string }> }) => (
  <ol className="xr-path">
    {steps.map((s, i) => (
      <li key={`${s.subject}-${i}`} className="xr-path__hop">
        <span className="xr-path__subject">{s.subject}</span>
        <span className="xr-path__happened">{s.happened}</span>
      </li>
    ))}
  </ol>
);

/**
 * Why one thing is the way it is, in plain language.
 *
 * Every sentence is generated from the edge that caused it — the recipe input whose hash
 * no longer matches, the semantic link whose subject moved on. None of it is a written
 * string chosen by shape of situation, because a hand-written explanation stops being true
 * the first time the graph changes and nobody notices.
 */
export function CausalPath({ node, bindings }: { node: Node<"CausalPath">; bindings: SceneBindings }) {
  const impact = bindings.impact?.[node.objectId];
  if (!impact) return <Empty>Nothing to explain here yet.</Empty>;

  if (node.kind === "rebuild") {
    const item = impact.rebuild.find((r) => r.stepKey === node.subject);
    if (!item) return <Empty>That is already up to date.</Empty>;
    return (
      <div className="xr-causal xr-causal--rebuild">
        <p className="xr-causal__head">
          {item.formRoles.map(formRoleName).join(" · ") || item.stepKey} is out of date
        </p>
        <Path steps={item.path} />
      </div>
    );
  }

  const item = impact.review.find((r) => r.causeObjectId === node.subject || r.objectId === node.subject);
  if (!item) return <Empty>Nothing here is waiting on your judgement.</Empty>;
  return (
    <div className="xr-causal xr-causal--review">
      <p className="xr-causal__head">{item.title} is worth reviewing</p>
      <ol className="xr-path">
        <li className="xr-path__hop">
          <span className="xr-path__subject">{item.causeTitle}</span>
          <span className="xr-path__happened">changed after it was cited</span>
        </li>
        <li className="xr-path__hop">
          <span className="xr-path__subject">{item.title}</span>
          <span className="xr-path__happened">{item.because}</span>
        </li>
      </ol>
      <p className="xr-causal__limit">
        This is a recommendation to look, not a finding that anything is wrong.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------- decision card */

const STATE_LABEL: Record<string, string> = {
  draft: "still deciding", accepted: "accepted",
  needs_review: "worth another look", superseded: "replaced by a later decision",
};

/**
 * One decision, as a person would tell it: the question, what was chosen, why, and the
 * passages it was decided with.
 *
 * The source chips are the point. Each one jumps to the exact stored paragraph or timecode
 * that was cited, which is only possible because capture keeps the copy it read — a chip
 * that opened a URL would be a link to whatever that page says today.
 */
export function DecisionCard({ node, bindings }: { node: Node<"DecisionCard">; bindings: SceneBindings }) {
  const decision = bindings.decisions?.[node.objectId];
  if (!decision) return <Empty>No decision recorded here.</Empty>;

  const chosen = decision.options.find((o) => o.key === decision.chosenOption);

  return (
    <article className={`xr-decision xr-decision--${decision.state}`}>
      <header className="xr-decision__head">
        <h3 className="xr-display">{decision.question}</h3>
        <Tag variant={decision.state === "needs_review" ? "review" : decision.state === "superseded" ? "faint" : "neutral"}>{STATE_LABEL[decision.state]}</Tag>
      </header>

      <p className="xr-decision__chosen">
        <span className="xr-decision__label">Chosen</span>
        <span className="xr-decision__value">{chosen?.label ?? decision.chosenOption ?? "None"}</span>
      </p>

      {decision.rationale && <p className="xr-decision__why">{decision.rationale}</p>}

      {node.showEvidence && decision.evidence.length > 0 && (
        <div className="xr-decision__evidence">
          <span className="xr-decision__label">Decided with</span>
          <ul className="xr-chips">
            {decision.evidence.map((e, i) => {
              const atom = e.atomObjectId ? bindings.states[e.atomObjectId] : undefined;
              const passage = e.atomObjectId ? bindings.passages?.[e.atomObjectId] : undefined;
              const label = passage?.sourceTitle ?? atom?.properties.title ?? "a source";
              // The support row for this citation, if a passage was cited. A chip with no
              // support row is a relation somebody asserted, not a passage anybody checked.
              const support = e.sourceVersionId
                ? (bindings.support?.[decision.objectId] ?? []).find((s) => s.sourceVersionId === e.sourceVersionId)
                : undefined;
              return (
                <li key={i}>
                  {support ? (
                    <SupportChip support={support} label={label}
                      onOpen={() => e.atomObjectId && bindings.onOpenSource?.(e.atomObjectId)}
                      onReview={(status) => bindings.onReviewSupport?.(support.id, status)} />
                  ) : (
                    <button type="button" className={`xr-chip xr-chip--${e.relation}`}
                      disabled={!e.atomObjectId}
                      onClick={() => e.atomObjectId && bindings.onOpenSource?.(e.atomObjectId)}>
                      {label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {decision.assumptions.length > 0 && (
        <div className="xr-decision__assumptions">
          <span className="xr-decision__label">Assuming</span>
          <ul>
            {decision.assumptions.map((a, i) => (
              <li key={i}>
                {a.text}
                {a.reviewTrigger && <em> / revisit if {a.reviewTrigger}</em>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {decision.state === "needs_review" && (
        <div className="xr-decision__actions">
          <Button onClick={() => bindings.onReviewed?.(node.objectId)}>
            I have looked, this still holds
          </Button>
        </div>
      )}
    </article>
  );
}

/* ----------------------------------------------------------- source viewer */

/**
 * The exact words a claim came from, in the copy that was read.
 *
 * `moved` is shown rather than hidden: a source re-extracted with a different parser
 * shifts every offset, and XENIUR found the passage by its quotation instead. Saying so is
 * the difference between a citation and a guess that happens to look right.
 */
export function SourceViewer({ node, bindings }: { node: Node<"SourceViewer">; bindings: SceneBindings }) {
  const passage = bindings.passages?.[node.atomObjectId];
  if (!passage) {
    return (
      <Panel title="Source">
        <p className="xr-source__gone">
          The words this came from are no longer in the stored copy. The source changed
          after it was captured, and XENIUR will not highlight whatever took their place.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={passage.sourceTitle}>
      <blockquote className="xr-source">
        <span className="xr-source__context">…{passage.context.before}</span>
        <mark className="xr-source__exact">{passage.text}</mark>
        <span className="xr-source__context">{passage.context.after}…</span>
      </blockquote>
      {passage.moved && (
        <p className="xr-source__moved">
          This source was re-read since the claim was captured, and the text moved.
          XENIUR found the passage by its words rather than its position.
        </p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------ preview card */

/**
 * What is about to happen, before it happens.
 *
 * Rendered from the very authorisation that gates the action: the digest is the key, so
 * the sentence a person reads and the plan the Broker will check are the same object and
 * cannot drift. Approving here approves *this* plan — a changed price or a changed
 * destination produces a different digest, and the approval simply does not apply to it.
 */
export function PreviewCard({ node, bindings }: { node: Node<"PreviewCard">; bindings: SceneBindings }) {
  const pending = bindings.pendingPlans?.[node.planDigest];
  if (!pending) return null;

  const { plan } = pending;
  const args = Object.entries(plan.args ?? {})
    .filter(([k]) => !k.startsWith("__"))
    .slice(0, 8);

  return (
    <section className="xr-preview" role="alertdialog" aria-label="About to happen">
      <header className="xr-preview__head">
        <span className="xr-preview__level">{pending.level}</span>
        <h3 className="xr-display">{pending.summary}</h3>
      </header>

      <dl className="xr-preview__facts">
        <div><dt>Action</dt><dd className="xr-mono">{plan.tool}</dd></div>
        {plan.destination && <div><dt>Where it goes</dt><dd>{plan.destination}</dd></div>}
        {typeof plan.estimatedUsd === "number" && plan.estimatedUsd > 0 && (
          <div><dt>Cost</dt><dd>${plan.estimatedUsd.toFixed(2)}</dd></div>
        )}
        {args.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
        ))}
      </dl>

      <p className="xr-preview__scope">
        {pending.reversible
          ? "This can be undone."
          : "This cannot be undone from inside XENIUR."}
        {" "}Approving covers exactly this; if anything above changes, it will ask again.
      </p>

      <div className="xr-preview__actions">
        <Button variant="primary" onClick={() => bindings.onAcceptPlan?.(node.planDigest)}>
          Do this
        </Button>
        <Button onClick={() => bindings.onDeclinePlan?.(node.planDigest)}>Not now</Button>
      </div>
    </section>
  );
}

/* ------------------------------------------------- the inspector questions */

const QUESTIONS = [
  { key: "what", label: "What is this?" },
  { key: "why", label: "Why is it this way?" },
  { key: "changed", label: "What changed?" },
  { key: "ready", label: "Is it ready?" },
  { key: "next", label: "What can I safely do next?" },
] as const;

/**
 * Five human questions, never database concepts.
 *
 * Everything here is a rendering of data the rest of XENIUR already produces — properties
 * and forms, accepted decisions, the rebuild/review split, readiness as measurements, and
 * the actions whose authorisation currently applies. The value is entirely in the framing:
 * "Why is it this way?" is a question a person actually has, and "lineage graph" is not.
 */
export function InspectorQuestions({ node, bindings }: {
  node: Node<"InspectorQuestions">; bindings: SceneBindings;
}) {
  const state = bindings.states[node.objectId];
  if (!state) return <Empty>Nothing selected.</Empty>;

  const impact = bindings.impact?.[node.objectId];
  const readiness = bindings.readiness?.[node.objectId] ?? [];
  const decisions = Object.values(bindings.decisions ?? {});

  const answer = (key: typeof QUESTIONS[number]["key"]) => {
    switch (key) {
      case "what": {
        const p = state.properties;
        return (
          <>
            <p className="xr-answer__lead">
              {withArticle(semanticTypeName(p.semanticType))} called <strong>{p.title}</strong>,
              {" "}in {state.forms.length} {state.forms.length === 1 ? "form" : "forms"} at once.
            </p>
            <ul className="xr-answer__list">
              {state.forms.map((f) => <li key={f.role}>{formRoleName(f.role)}</li>)}
            </ul>
            {p.dimensions && (
              <p className="xr-answer__aside">
                {p.dimensions.x} × {p.dimensions.y} × {p.dimensions.z} {p.units ?? ""}
              </p>
            )}
          </>
        );
      }
      case "why": {
        const relevant = decisions.filter((d) => d.state === "accepted" || d.state === "needs_review");
        if (relevant.length === 0) {
          return <p className="xr-answer__lead">
            No decisions have been recorded for this yet. What it is, it is because somebody
            made it that way. Writing that down is what makes the next revision easier.
          </p>;
        }
        return (
          <ul className="xr-answer__decisions">
            {relevant.map((d) => (
              <li key={d.objectId}>
                <button type="button" className="xr-linkish"
                  onClick={() => bindings.onSelect?.(d.objectId)}>{d.question}</button>
                <span className="xr-answer__aside"> / {d.chosenOption}</span>
              </li>
            ))}
          </ul>
        );
      }
      case "changed":
        return impact
          ? (
            <>
              <p className="xr-answer__lead">{impact.headline}</p>
              <p className="xr-answer__aside">
                {impact.rebuild.length} to rebuild · {impact.review.length} to review
              </p>
            </>
          )
          : <p className="xr-answer__lead">Nothing has been built here yet.</p>;
      case "ready": {
        if (readiness.length === 0) return <p className="xr-answer__lead">No profiles apply here.</p>;
        return (
          <ul className="xr-answer__list">
            {readiness.map((r) => {
              const met = r.results.length - r.blockers.length;
              return (
                <li key={r.profileId}>
                  <span>{r.profileName}</span>
                  <span className="xr-answer__aside"> / {met}/{r.results.length} current measurements</span>
                </li>
              );
            })}
          </ul>
        );
      }
      case "next": {
        const safe: string[] = ["Rename it", "Undo the last change", "Compare two versions"];
        if ((impact?.rebuild.length ?? 0) > 0) safe.unshift("Rebuild what is out of date. Free and reversible");
        if ((impact?.review.length ?? 0) > 0) safe.push("Look at what changed underneath a decision");
        return (
          <>
            <ul className="xr-answer__list">{safe.map((s) => <li key={s}>{s}</li>)}</ul>
            <p className="xr-answer__aside">
              Anything that spends money or leaves this machine asks first, and shows you
              exactly what it is about to do.
            </p>
          </>
        );
      }
    }
  };

  return (
    <div className="xr-inspector">
      {QUESTIONS.map((q) => (
        <details key={q.key} className="xr-question" open={q.key === node.open}>
          <summary className="xr-question__ask">{q.label}</summary>
          <div className="xr-answer">{answer(q.key)}</div>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ compare forms */

/**
 * Old and new, side by side. A mode rather than a panel.
 *
 * Comparing is what a second revision *is*, so it gets the whole centre of the workspace
 * rather than a corner of an inspector.
 */
export function CompareForms({ node, bindings }: { node: Node<"CompareForms">; bindings: SceneBindings }) {
  const pair = bindings.comparisons?.[`${node.objectId}:${node.formRole}`];
  if (!pair) return <Empty>Pick two versions to compare.</Empty>;

  const side = (which: "left" | "right") => {
    const s = pair[which];
    const rep = s.representation;
    return (
      <figure className={`xr-compare__side xr-compare__side--${which}`}>
        <figcaption>{s.label}</figcaption>
        {rep?.blobHash && rep.modality === "image" && (
          <img src={bindings.blobUrl(rep.blobHash)} alt="" />
        )}
        {rep?.blobHash && rep.modality === "text" && (
          <pre className="xr-compare__text">{bindings.textOf?.(rep.id) ?? ""}</pre>
        )}
        {rep && rep.modality !== "image" && rep.modality !== "text" && (
          <p className="xr-compare__meta xr-mono">{rep.modality}/{rep.format}</p>
        )}
        {!rep && <Empty>Nothing at this version.</Empty>}
      </figure>
    );
  };

  return (
    <section className="xr-compare">
      <h3 className="xr-display">{formRoleName(node.formRole)}</h3>
      <div className="xr-compare__pair">{side("left")}{side("right")}</div>
    </section>
  );
}

/* ----------------------------------------------------------- thinking table */

const TABLE_COLUMNS = [
  { key: "known", label: "Assessed" },
  { key: "conflicts", label: "Disagreeing" },
  { key: "unverified", label: "Unsupported" },
  { key: "actionable", label: "Open" },
] as const;

/**
 * Sensemaking as a table you push things around on, not a list you scroll.
 *
 * Claims, questions and observations cluster quietly by what the graph can say about
 * them, and the person's moves are the interactions: connect two, challenge one, or
 * **turn one into a decision** — which is the single path that crosses from thinking to
 * making, and the moment the rest of XENIUR starts caring.
 */
export function ThinkingTable({ node, bindings }: { node: Node<"ThinkingTable">; bindings: SceneBindings }) {
  const map = bindings.thinkingMap?.[node.worldId];
  if (!map) return <Empty>{t("thinking.empty")}</Empty>;

  const friction = bindings.friction?.[node.worldId];

  return (
    <div className="xr-table">
      {friction?.active && (
        <div className="xr-friction" role="status">
          <p className="xr-friction__prompt">{friction.prompt}</p>
          <p className="xr-friction__why">
            {friction.intakeSinceMove} things taken in since your last move.
          </p>
          <Button onClick={() => bindings.onDismissFriction?.(node.worldId)}>Not now</Button>
        </div>
      )}

      <div className="xr-table__grid">
        {TABLE_COLUMNS.map(({ key, label }) => (
          <section key={key} className={`xr-table__col xr-table__col--${key}`}>
            <h3 className="xr-table__head">{label}<span>{map[key].length}</span></h3>
            <ul className="xr-table__cards">
              {map[key].map((entry) => {
                const selected = node.selectedId === entry.atom.objectId;
                return (
                  <li key={entry.atom.objectId}
                      className={`xr-card${selected ? " is-selected" : ""} xr-card--${entry.atom.atomType}`}>
                    <button type="button" className="xr-card__body"
                      onClick={() => bindings.onSelect?.(entry.atom.objectId)}>
                      <span className="xr-card__type">{entry.atom.atomType}</span>
                      <span className="xr-card__text">{entry.atom.text}</span>
                      <span className="xr-card__because">{entry.because}</span>
                    </button>
                    <div className="xr-card__moves">
                      {node.selectedId && !selected && (
                        <button type="button" className="xr-move"
                          onClick={() => bindings.onLink?.(node.selectedId!, entry.atom.objectId)}>
                          Connect
                        </button>
                      )}
                      <button type="button" className="xr-move"
                        onClick={() => bindings.onSort?.(entry.atom.objectId, "question")}>
                        Challenge
                      </button>
                      <button type="button" className="xr-move xr-move--cross"
                        onClick={() => bindings.onConvertToDecision?.(entry.atom.objectId)}>
                        Make this a decision
                      </button>
                    </div>
                  </li>
                );
              })}
              {map[key].length === 0 && <li className="xr-table__empty">None</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- idea drawer */

/**
 * What XENIUR is about to think with, at the moment it matters.
 *
 * A small drawer at the point of creation, not a permanent panel: counts, paths you can
 * follow, and no score. Nothing here grades anybody's originality — it says what is in the
 * pot, and the person decides whether that is enough.
 */
export function IdeaDrawer({ node, bindings }: { node: Node<"IdeaDrawer">; bindings: SceneBindings }) {
  const dna = bindings.dna?.[node.objectId];
  if (!dna) return null;

  const counts = [
    ["your observations", "of your own", dna.summary.counts.your_observation],
    ["external sources", "external", dna.summary.counts.external_human],
    ["model-touched steps", "model-touched steps", dna.summary.modelTouchedSteps],
    ["unknown origins", "of unknown origin", dna.summary.counts.unattributed],
  ] as const;

  return (
    <details className="xr-drawer" open={node.open}>
      <summary className="xr-drawer__pull">
        What this would be made of
        <span className="xr-drawer__mini">
          {counts.filter(([, , n]) => n > 0).map(([, phrase, n]) => `${n} ${phrase}`).join(" · ")
            || "nothing yet"}
        </span>
      </summary>
      <div className="xr-drawer__body">
        <ul className="xr-drawer__counts">
          {counts.map(([label, , n]) => (
            <li key={label} className={n > 0 ? "" : "is-zero"}>
              <span className="xr-drawer__n">{n}</span>
              <span className="xr-drawer__label">{label}</span>
            </li>
          ))}
        </ul>
        {dna.statements.length > 0 && (
          <ul className="xr-drawer__statements">
            {dna.statements.map((s) => (
              <li key={s.kind}>
                {s.text}
                <button type="button" className="xr-linkish"
                  onClick={() => bindings.onShowHow?.(node.objectId, s.kind)}>
                  show which
                </button>
              </li>
            ))}
          </ul>
        )}
        {dna.invitation && (
          <div className="xr-drawer__invite">
            <p>{dna.invitation}</p>
            <Button onClick={() => bindings.onAddObservation?.(node.objectId)}>
              Add something of yours
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
