import type { ActionDescription, Attempt, AttemptCheck, LeafSceneNode } from "@xeniur/core";
import { ATTEMPT_WORDS, GRANT_KIND_WORDS } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Button, Tag } from "./primitives.jsx";
import { t } from "../i18n.js";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * The card a person approves — the exact operation, and nothing implied.
 *
 * Where it goes, as which account, what it carries (named and versioned, with digests, never
 * the values), any amount, what will happen, and what this route can establish about the
 * outcome. Approving binds to this plan by its digest: a change to the destination, the
 * account, the material or the amount makes a different plan, and the old approval refuses it.
 */
export function ActionReviewCard({ node, bindings }: { node: Node<"ActionReviewCard">; bindings: SceneBindings }) {
  const a = bindings.actionReviews?.[node.actionId];
  if (!a) return null;
  const d: ActionDescription = a.description;
  return (
    <section className="xr-action" aria-labelledby={`action-${node.actionId.slice(0, 8)}`}>
      <header className="xr-action__head">
        <small className="xr-mono">{t("action.eyebrow")}</small>
        <h2 id={`action-${node.actionId.slice(0, 8)}`}>{d.effect}</h2>
      </header>
      <dl className="xr-action__facts">
        <div><dt>{t("action.destination")}</dt><dd className="xr-mono">{d.destination}</dd></div>
        <div><dt>{t("action.account")}</dt><dd>{d.accountLabel ?? t("action.noaccount")}{a.accountVerifiedByPerson ? "" : ` · ${t("action.unverified")}`}</dd></div>
        <div><dt>{t("action.does")}</dt><dd>{GRANT_KIND_WORDS.action.label} · <span className="xr-mono">{d.actionClass}</span> · {d.route === "embedded_tab" ? t("action.route.tab") : t("action.route.api")}</dd></div>
        {d.amount !== null && <div><dt>{t("action.amount")}</dt><dd>{d.amount}{d.currency ? ` ${d.currency}` : ""}</dd></div>}
        <div><dt>{t("action.plan")}</dt><dd className="xr-mono">{a.reviewDigest.slice(0, 12)}…</dd></div>
      </dl>

      {d.items.length > 0 && (
        <>
          <h3 className="xr-action__h">{t("action.carries")}</h3>
          <ul className="xr-action__items">
            {d.items.map((i) => <li key={`${i.title}-${i.versionId ?? ""}`}>{i.title}{i.versionId ? <span className="xr-mono"> · {i.versionId.slice(0, 8)}</span> : null}{i.digest ? <span className="xr-mono"> · {i.digest.slice(0, 10)}…</span> : null}</li>)}
          </ul>
        </>
      )}
      {d.fields.length > 0 && (
        <>
          <h3 className="xr-action__h">{t("action.fields")}</h3>
          <ul className="xr-action__fields">
            {d.fields.map((f) => <li key={f.name}><span className="xr-mono">{f.name}</span> · {f.chars} {t("save.characters")}</li>)}
          </ul>
        </>
      )}

      <p className="xr-action__verification">{d.verification}</p>
      <footer className="xr-action__verbs">
        <Button variant="primary" onClick={() => bindings.onApproveAction?.(node.actionId)}>{t("action.approve")}</Button>
        <Button onClick={() => bindings.onDiscardAction?.(node.actionId)}>{t("action.discard")}</Button>
      </footer>
    </section>
  );
}

/**
 * What became of it. Four words, and the attempts that produced them — immutable, in order,
 * with every status check beside the attempt it asked about. An uncertain attempt offers
 * *Check status*; it never offers to try again.
 */
export function ActionReceiptCard({ node, bindings }: { node: Node<"ActionReceiptCard">; bindings: SceneBindings }) {
  const r = bindings.actionReceipts?.[node.actionId];
  if (!r) return null;
  return (
    <section className="xr-receipt" aria-label={t("receipt.aria", { destination: r.description.destination })}>
      <header className="xr-receipt__head">
        <small className="xr-mono">{t("receipt.eyebrow")}</small>
        <h3>{r.description.effect}</h3>
        <span className="xr-mono">{r.description.destination}</span>
      </header>
      <ol className="xr-receipt__attempts">
        {r.attempts.map((attempt: Attempt, i: number) => (
          <li key={attempt.id} className={`xr-receipt__attempt is-${attempt.state}`}>
            <span className="xr-receipt__n xr-mono">{String(i + 1).padStart(2, "0")}</span>
            <Tag variant={attempt.state === "confirmed" ? "ok" : attempt.state === "failed" ? "review" : "blocked"}>{ATTEMPT_WORDS[attempt.state].label}</Tag>
            <span className="xr-receipt__means">{ATTEMPT_WORDS[attempt.state].means}</span>
            {attempt.detail && <span className="xr-receipt__detail">{attempt.detail}</span>}
            {attempt.reference && <span className="xr-receipt__ref xr-mono">{attempt.reference}</span>}
            <ul className="xr-receipt__checks">
              {(r.checks[attempt.id] ?? []).map((c: AttemptCheck) => (
                <li key={c.id}><span className="xr-mono">{new Date(c.at).toISOString().slice(0, 16).replace("T", " ")}</span> {c.result} — {c.detail}</li>
              ))}
            </ul>
            {(attempt.state === "uncertain" || attempt.state === "attempted") && (
              <Button onClick={() => bindings.onCheckStatus?.(attempt.id)}>{t("receipt.check")}</Button>
            )}
          </li>
        ))}
      </ol>
      <p className="xr-receipt__note">{t("receipt.note")}</p>
    </section>
  );
}
