import type { PackageInspectionView } from "@xeniur/core";

/**
 * A package arrived. Nothing has been written.
 *
 * The sheet shows who sent it and how they are trusted here — a badge with a glyph and a
 * word, never a colour alone — what is inside, what it would disclose, and two verbs. Someone
 * else's work opens **for review** in a critique World; a critique that links to your work
 * lands **beside** it. An unsigned, altered or blocked package shows its refusal and nothing
 * else. "Not now" has the same weight as either verb.
 */
export function Arrival({ path, inspection, onOpen, onBlock, onDismiss }: {
  path: string;
  inspection: PackageInspectionView;
  onOpen(as: "work" | "critique"): void;
  onBlock(): void;
  onDismiss(): void;
}) {
  const p = inspection.publisher;
  const name = path.split("/").pop() ?? path;
  const isCritique = inspection.intent === "critique";
  const isOwn = p?.self === true;

  return (
    <section className="xr-arrival" role="dialog" aria-labelledby="arrival-title">
      <header className="xr-arrival__head">
        <h2 id="arrival-title">{inspection.contents.title || name}</h2>
        <span className="xr-arrival__file xr-mono">{name}</span>
      </header>

      {p ? (
        <div className={`xr-arrival__publisher is-${p.trust}`}>
          <span className="xr-arrival__glyph" aria-hidden="true">{TRUST_GLYPH[p.trust]}</span>
          <span className="xr-arrival__who">{isOwn ? "You" : p.displayName}</span>
          <span className="xr-arrival__trust">{isOwn ? "your own signature" : TRUST_WORD[p.trust]}</span>
          <span className="xr-arrival__key xr-mono">{p.publicKey.slice(0, 8)}…</span>
          {!isOwn && p.proofHistory > 0 && <span className="xr-arrival__proof">{p.proofHistory} verified process share{p.proofHistory === 1 ? "" : "s"}</span>}
          {!isOwn && p.dailyLimit !== null && (
            <span className="xr-arrival__rate">{p.importsToday} of {p.dailyLimit} today</span>
          )}
        </div>
      ) : (
        <div className="xr-arrival__publisher is-unsigned">
          <span className="xr-arrival__glyph" aria-hidden="true">○</span>
          <span className="xr-arrival__who">Nobody vouches for this</span>
        </div>
      )}

      {inspection.ok ? (
        <>
          <dl className="xr-arrival__contents">
            <div><dt>Inside</dt><dd>
              {inspection.contents.versions} version{inspection.contents.versions === 1 ? "" : "s"} ·{" "}
              {inspection.contents.decisions} decision{inspection.contents.decisions === 1 ? "" : "s"} ·{" "}
              {inspection.contents.sources} source{inspection.contents.sources === 1 ? "" : "s"} ·{" "}
              {inspection.contents.atoms} claim{inspection.contents.atoms === 1 ? "" : "s"}
            </dd></div>
            <div><dt>Sent as</dt><dd>{INTENT_WORD[inspection.intent ?? "archive"]}</dd></div>
            {inspection.discloses.length > 0 && (
              <div><dt>Carries</dt><dd>{inspection.discloses.join("; ")}</dd></div>
            )}
          </dl>
          <p className="xr-arrival__note">
            {isCritique
              ? "Their claims and decisions will sit beside yours and link to them. Nothing of yours changes."
              : "Their work opens read-only, in its own World, for you to review. Your claims sit beside it."}
          </p>
          <div className="xr-arrival__actions">
            {isCritique || isOwn
              ? <button type="button" className="xr-button" onClick={() => onOpen("work")}>{isOwn ? "Bring it in" : "Open beside my work"}</button>
              : <button type="button" className="xr-button" onClick={() => onOpen("critique")}>Open for review</button>}
            <button type="button" className="xr-button" onClick={onDismiss}>Not now</button>
            {p && !isOwn && p.trust !== "blocked" && (
              <button type="button" className="xr-button xr-arrival__block" onClick={onBlock}>Block {p.displayName}</button>
            )}
          </div>
        </>
      ) : (
        <>
          <ul className="xr-arrival__problems">
            {inspection.problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
          <p className="xr-arrival__note">Nothing was written.</p>
          <div className="xr-arrival__actions">
            <button type="button" className="xr-button" onClick={onDismiss}>Close</button>
          </div>
        </>
      )}
    </section>
  );
}

const TRUST_GLYPH: Record<string, string> = { unknown: "○", known: "◐", trusted: "●", blocked: "◌" };
const TRUST_WORD: Record<string, string> = {
  unknown: "unknown here — you have not judged them", known: "known to you", trusted: "trusted by you", blocked: "blocked by you",
};
const INTENT_WORD: Record<string, string> = {
  archive: "a full archive", delivery: "a delivery", share: "shared for review", critique: "a critique of your work",
};
