import type { ChallengeRecord, Compliance, EntryRecord, LeafSceneNode } from "@xeniur/core";
import { AI_POLICY_WORDS, COMPLIANCE_GLYPHS } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Button, Tag } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * A challenge World's centre.
 *
 * Rules, dates, the deliverable, the judging criteria and the AI policy — all visible before
 * entering. Then the person's own entry with its live compliance, in the three-state glyph
 * set: complies ●, violates ◌ with the violating event named, *the record does not say* ○.
 * It is never rounded to green. Other entries appear only after close, in submission order,
 * with no ranking anywhere.
 */
export function ChallengeBoard({ node, bindings }: { node: Node<"ChallengeBoard">; bindings: SceneBindings }) {
  const c = bindings.challenges?.[node.worldId];
  if (!c) return null;
  const now = Date.now();
  const open = c.rules.startsAt <= now && now < c.rules.endsAt;
  const daysLeft = Math.max(0, Math.ceil((c.rules.endsAt - now) / 86_400_000));
  const mine = bindings.challengeEntries?.[node.worldId]?.filter((e) => e.publisher.publicKey === bindings.selfPublicKey) ?? [];
  const others = bindings.challengeEntries?.[node.worldId]?.filter((e) => e.publisher.publicKey !== bindings.selfPublicKey) ?? [];

  return (
    <section className="xr-challenge" aria-labelledby={`challenge-${node.worldId.slice(0, 8)}`}>
      <header className="xr-challenge__head">
        <h2 id={`challenge-${node.worldId.slice(0, 8)}`}>{c.rules.title}</h2>
        <span className="xr-challenge__by">by {c.publisher.displayName}</span>
        <span className="xr-challenge__dates xr-mono">
          {date(c.rules.startsAt)} – {date(c.rules.endsAt)}{open ? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : " · closed"}
        </span>
        <PolicyTag policy={c.rules.aiPolicy} />
      </header>

      <p className="xr-challenge__brief">{c.rules.brief}</p>

      <div className="xr-challenge__grid">
        <Block label="Rules">
          <ul>{c.rules.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        </Block>
        <Block label="Deliverable">
          <p>{c.rules.deliverable.description}</p>
          <p className="xr-challenge__roles xr-mono">{c.rules.deliverable.formRoles.join(" · ")}</p>
        </Block>
        <Block label={`Judged by the ${c.rules.judging.by}`}>
          <ul>{c.rules.judging.criteria.map((r) => <li key={r}>{r}</li>)}</ul>
        </Block>
        <Block label="AI policy">
          <p>{AI_POLICY_WORDS[c.rules.aiPolicy].means}</p>
        </Block>
      </div>

      <div className="xr-challenge__entries">
        <h3>Your entry</h3>
        {mine.length === 0 ? (
          <p className="xr-challenge__none">
            Nothing entered yet.{open && bindings.onEnterChallenge && bindings.focusObjectId
              ? <> <Button onClick={() => bindings.onEnterChallenge?.(node.worldId, bindings.focusObjectId!)}>Enter what is in the centre</Button></>
              : null}
          </p>
        ) : mine.map((e) => <Entry key={e.id} entry={e} bindings={bindings} />)}

        {!open && others.length > 0 && (
          <>
            <h3>Other entries <span className="xr-challenge__order">in the order they arrived</span></h3>
            {others.map((e) => <Entry key={e.id} entry={e} bindings={bindings} />)}
          </>
        )}
        {open && <p className="xr-challenge__none">Other entries appear after the challenge closes.</p>}
      </div>
    </section>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="xr-challenge__block"><h4>{label}</h4>{children}</div>;
}

function Entry({ entry, bindings }: { entry: EntryRecord; bindings: SceneBindings }) {
  const title = bindings.states[entry.objectId]?.properties.title ?? "an entry";
  return (
    <article className="xr-entry">
      <button type="button" className="xr-entry__title" onClick={() => bindings.onSelect?.(entry.objectId)}>{title}</button>
      <span className="xr-entry__who">{entry.publisher.displayName}</span>
      <ComplianceTag compliance={entry.compliance} />
      {entry.compliance.verdict !== "complies" && (
        <ul className="xr-entry__because">{entry.compliance.because.map((b) => <li key={b}>{b}</li>)}</ul>
      )}
    </article>
  );
}

/** The policy as a fully rounded tag: glyph, then the word. Colour is never alone. */
export function PolicyTag({ policy }: { policy: ChallengeRecord["rules"]["aiPolicy"] }) {
  return <Tag variant="blocked">◷ {AI_POLICY_WORDS[policy].label}</Tag>;
}

export function ComplianceTag({ compliance }: { compliance: Compliance }) {
  const g = COMPLIANCE_GLYPHS[compliance.verdict];
  return (
    <Tag role="status" variant={compliance.verdict === "complies" ? "ok" : compliance.verdict === "violates" ? "review" : "blocked"}>
      <span aria-hidden="true">{g.glyph}</span> {g.word}
    </Tag>
  );
}

const date = (t: number) => new Date(t).toISOString().slice(0, 10);
