import { useCallback, useState } from "react";
import type { World } from "@xeniur/core";
import { t } from "@xeniur/ui";
import { BrandMark } from "./BrandMark.js";

/**
 * The first run is one question: *What would you like to work on?*
 *
 * Three answers, each a way into the work — bring something in, start something new in
 * words, continue a project already here — and every one of them works with zero keys.
 * Nobody is asked their profession, their workflow or their model. Model setup is not a
 * first-run scene: it appears the moment a task could use cloud AI (the Ask sheet says so
 * then) and stays reachable from the palette under *Your models*.
 *
 * Skip is in the same weight as the three ways in. A first run adds nothing that cannot
 * be reached later from Home.
 */
export function FirstRun({ worlds, onDone, onImport, onStart, onContinue, onImportPackage, onOpenExample }: {
  /** Worlds already on this machine — an upgrade, or a second run. Empty on a fresh machine. */
  worlds: readonly World[];
  onDone(): void;
  /** Bring something in: a new World that opens on its drop target. */
  onImport(): void;
  /** Start something new: a World named after the goal, with the goal set. */
  onStart(outcome: string): void;
  /** Continue: open a World already here. */
  onContinue(worldId: string): void;
  /** Continue: open a .xeniur package someone sent. */
  onImportPackage(): void;
  onOpenExample(): void;
}) {
  const bridge = typeof window === "undefined" ? undefined : window.xeniur;
  const [starting, setStarting] = useState(false);
  const [outcome, setOutcome] = useState("");

  const finish = useCallback(async () => {
    await bridge?.models?.finishFirstRun();
    onDone();
  }, [bridge, onDone]);
  const then = (next: () => void) => () => { void finish().then(next); };

  const existing = worlds.filter((w) => w.summary !== "__xeniur_settings__");

  return (
    <main className="xr-firstrun" aria-labelledby="firstrun-title">
      <section className="xr-firstrun__scene">
        <BrandMark />
        <h1 id="firstrun-title">{t("firstrun.title")}</h1>
        <p className="xr-firstrun__lead">{t("firstrun.lead")}</p>

        <div className="xr-firstrun__choices">
          <article className="xr-firstrun__choice">
            <strong>{t("firstrun.have.title")}</strong>
            <span>{t("firstrun.have.body")}</span>
            <button type="button" className="xr-button xr-button--primary" onClick={then(onImport)}>{t("firstrun.have.verb")}</button>
          </article>

          <article className="xr-firstrun__choice">
            <strong>{t("firstrun.new.title")}</strong>
            <span>{t("firstrun.new.body")}</span>
            {starting ? (
              <form className="xr-begin__form" onSubmit={(e) => {
                e.preventDefault();
                const text = outcome.trim();
                if (text) { void finish().then(() => onStart(text)); }
              }}>
                <label htmlFor="firstrun-outcome">{t("firstrun.new.label")}</label>
                <input id="firstrun-outcome" autoFocus value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder={t("firstrun.new.placeholder")} />
                <div className="xr-begin__actions">
                  <button type="submit" className="xr-button xr-button--primary">{t("firstrun.new.verb")}</button>
                  <button type="button" className="xr-button" onClick={() => setStarting(false)}>{t("firstrun.notnow")}</button>
                </div>
              </form>
            ) : (
              <button type="button" className="xr-button xr-button--primary" onClick={() => setStarting(true)}>{t("firstrun.new.verb")}</button>
            )}
          </article>

          <article className="xr-firstrun__choice">
            <strong>{t("firstrun.continue.title")}</strong>
            <span>{t("firstrun.continue.body")}</span>
            {existing.length > 0 ? (
              <ul className="xr-firstrun__worlds">
                {existing.slice(0, 5).map((w) => (
                  <li key={w.id}><button type="button" className="xr-text-action" onClick={then(() => onContinue(w.id))}>{w.emoji} {w.title}</button></li>
                ))}
              </ul>
            ) : <small>{t("firstrun.continue.none")}</small>}
            <button type="button" className="xr-button" onClick={then(onImportPackage)}>{t("firstrun.continue.package")}</button>
          </article>
        </div>

        <div className="xr-firstrun__actions">
          <button type="button" className="xr-button" onClick={then(() => undefined)}>{t("firstrun.skip")}</button>
          <button type="button" className="xr-text-action" onClick={then(onOpenExample)}>{t("firstrun.example")}</button>
        </div>
      </section>
    </main>
  );
}
