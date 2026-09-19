import { useEffect, useState } from "react";
import type { EnvelopeSheet, LeafSceneNode, ModeRecord } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Button } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * A mode, in its two visible phases.
 *
 * **Review.** Before anything starts, the envelope is drawn as a sheet: duration, what is
 * quiet while it runs, the exit. The confirmation is a verb — *Begin focus*, never *OK* —
 * and *Not now* sits beside it in the same weight. Starting sends the sheet's digest back,
 * which is how the store knows this envelope was read.
 *
 * **Running.** A thin rule at the top of the window with the mode's name and the remaining
 * time in mono, and an **Exit** that is always reachable by keyboard (Escape). Exit asks
 * nothing; it records the moment. When the mode is over the rule fades and the centre slot
 * the person left is restored by the host.
 *
 * A mode is never shown when it is not running. There is no badge for "you could start one".
 */
export function FocusContract({ node, bindings }: { node: Node<"FocusContract">; bindings: SceneBindings }) {
  if (node.phase === "review") {
    const sheet = node.sheetDigest ? bindings.modeSheets?.[node.sheetDigest] : undefined;
    if (!sheet) return null;
    return <EnvelopeReview sheet={sheet} bindings={bindings} />;
  }
  const mode = node.modeId ? bindings.modes?.[node.modeId] : undefined;
  if (!mode || mode.endedAt !== null) return null;
  return <RunningRule mode={mode} bindings={bindings} />;
}

function EnvelopeReview({ sheet, bindings }: { sheet: EnvelopeSheet; bindings: SceneBindings }) {
  return (
    <section className="xr-mode-sheet" aria-labelledby={`mode-${sheet.digest.slice(0, 8)}`}>
      <h2 id={`mode-${sheet.digest.slice(0, 8)}`} className="xr-mode-sheet__name">{sheet.name}</h2>
      <dl className="xr-mode-sheet__lines">
        {sheet.lines.map((line) => (
          <div key={line.label} className="xr-mode-sheet__line">
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
      <p className="xr-mode-sheet__exit">{sheet.exit}</p>
      <div className="xr-mode-sheet__actions">
        <Button onClick={() => bindings.onStartMode?.(sheet.kind, sheet.digest)}>{sheet.verb}</Button>
        <Button onClick={() => bindings.onDeclineMode?.(sheet.kind)}>Not now</Button>
      </div>
    </section>
  );
}

function RunningRule({ mode, bindings }: { mode: ModeRecord; bindings: SceneBindings }) {
  const endsAt = mode.startedAt + mode.envelope.durationMinutes * 60_000;
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.round((endsAt - Date.now()) / 1000)));

  useEffect(() => {
    const timer = setInterval(() => setRemaining(Math.max(0, Math.round((endsAt - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  // Escape is the emergency exit. It is the same exit for every mode, and it asks nothing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") bindings.onExitMode?.(mode.id, "emergency"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bindings, mode.id]);

  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");
  const name = MODE_WORD[mode.kind] ?? mode.kind;

  return (
    <div className="xr-mode-rule xr-mode-rule--running" role="status" aria-label={`${name} running, ${mm} minutes ${ss} seconds left`}>
      <span className="xr-mode-rule__name">{name}</span>
      <span className="xr-mode-rule__clock xr-mono" aria-hidden="true">{mm}:{ss}</span>
      {mode.envelope.restrictions.length > 0 && (
        <span className="xr-mode-rule__restrictions">{mode.envelope.restrictions.join(" · ")}</span>
      )}
      <button type="button" className="xr-mode-rule__exit"
        onClick={() => bindings.onExitMode?.(mode.id, "left")}
        aria-keyshortcuts="Escape">Exit</button>
    </div>
  );
}

const MODE_WORD: Record<string, string> = {
  focus_contract: "Focus Contract", serendipity: "Serendipity", recovery: "Recovery", discovery: "Discovery",
};
