import { useEffect, useState } from "react";
import type { CandidateRecord, Scene, TrailRow } from "@xeniur/core";
import { SceneRenderer, type SceneBindings } from "@xeniur/ui";

/**
 * Ask — the Brain, visible, inside the Scene.
 *
 * 1. The person asks in their words. The request is read into one of the things XENIUR can
 *    do and the reading is shown as a chip they can correct. No intent picker.
 * 2. `prepare` compiles what the model would see and says how much of it is new: an ordinary
 *    request shows a one-line indicator and proceeds; an expanded one shows only the delta;
 *    a consequential one shows everything.
 * 3. `ask` runs exactly what was shown. While live calls are off the result is *gated* and
 *    the sheet says so with the reason — never invented output.
 * 4. Proposals arrive as candidates in the tray; nothing becomes knowledge without a click.
 */
type Resolved = Awaited<ReturnType<NonNullable<NonNullable<Window["xeniur"]>["brain"]>["resolve"]>>;
type Prepared = Awaited<ReturnType<NonNullable<NonNullable<Window["xeniur"]>["brain"]>["prepare"]>>;
type Asked = Awaited<ReturnType<NonNullable<NonNullable<Window["xeniur"]>["brain"]>["ask"]>>;

type Phase =
  | { kind: "reading"; resolved: Resolved }
  | { kind: "preparing" }
  | { kind: "review"; prepared: Prepared; intent: string }
  | { kind: "asking"; prepared: Prepared }
  | { kind: "answered"; result: Asked; prepared: Prepared }
  | { kind: "failed"; reason: string };

export function Ask({ worldId, utterance, selection, intent, bindings, onCandidates, onClose, onTrail, onNeedsKey }: {
  worldId: string;
  utterance: string;
  selection: string[];
  /** A thinking move names its intent; the reading step is then skipped. */
  intent?: string;
  bindings: SceneBindings;
  /** Candidates arrived; the host re-reads the tray. */
  onCandidates(): void;
  onClose(): void;
  onTrail(row: TrailRow | null): void;
  /** The destination is remote and no key exists: the host offers model setup. */
  onNeedsKey(): void;
}) {
  const bridge = window.xeniur;
  const [phase, setPhase] = useState<Phase | null>(null);
  const [contexts, setContexts] = useState<NonNullable<SceneBindings["contexts"]>>({});

  useEffect(() => {
    if (intent) { void prepare(intent, selection); return; }
    void bridge?.brain?.resolve(utterance, selection).then((resolved) => setPhase({ kind: "reading", resolved }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, utterance, selection, intent]);

  const prepare = async (intent: string, objects: string[]) => {
    const objectId = objects[0] ?? selection[0];
    if (!objectId) { setPhase({ kind: "failed", reason: "Select something to ask about first." }); return; }
    setPhase({ kind: "preparing" });
    try {
      const prepared = await bridge!.brain!.prepare({ worldId, objectId, intent, question: utterance });
      setContexts({ [prepared.context.contextDigest]: prepared.context });
      if (prepared.needsKey) onNeedsKey();
      // Ordinary: inside the envelope. It proceeds; the indicator says what went.
      if (prepared.level === "ordinary") { await run(prepared); return; }
      setPhase({ kind: "review", prepared, intent });
    } catch (err) {
      setPhase({ kind: "failed", reason: err instanceof Error ? err.message : String(err) });
    }
  };

  const run = async (prepared: Prepared) => {
    setPhase({ kind: "asking", prepared });
    try {
      const result = await bridge!.brain!.ask({ trailId: prepared.trailId, contextDigest: prepared.context.contextDigest, planDigest: prepared.planDigest });
      onTrail(result.trail);
      if (result.proposed) onCandidates();
      setPhase({ kind: "answered", result, prepared });
    } catch (err) {
      setPhase({ kind: "failed", reason: err instanceof Error ? err.message : String(err) });
    }
  };

  if (!phase) return <section className="xr-ask"><p className="xr-ask__quiet">Reading…</p></section>;

  if (phase.kind === "reading") {
    const r = phase.resolved;
    return (
      <section className="xr-ask" aria-label="How XENIUR read your request">
        <p className="xr-ask__utterance">“{utterance}”</p>
        <div className="xr-ask__chip">
          <span className="xr-ask__reading">{r.interpretation}</span>
          {r.intent ? (
            <>
              <button type="button" className="xr-button xr-button--primary" onClick={() => void prepare(r.intent!, r.objects)}>Proceed</button>
              <button type="button" className="xr-button" onClick={onClose}>Not this</button>
            </>
          ) : (
            <span className="xr-ask__nearest">
              {r.nearest.map((n) => <button key={n} type="button" className="xr-button" onClick={() => void prepare(n, r.objects)}>{word(n)}</button>)}
              <button type="button" className="xr-button" onClick={onClose}>Not now</button>
            </span>
          )}
        </div>
      </section>
    );
  }

  if (phase.kind === "preparing") return <section className="xr-ask"><p className="xr-ask__quiet">Compiling what the model would see…</p></section>;

  if (phase.kind === "review") {
    const { prepared } = phase;
    const digest = prepared.context.contextDigest;
    const scene: Scene = { worldId, title: "", reason: "", root: { id: "ctx", component: "Canvas", layout: "column",
      children: [{ id: "review", component: "ContextReview", contextDigest: digest } as never] } };
    const local = { ...bindings, contexts, onConfirmContext: () => void run(prepared), onDeclineContext: onClose };
    return (
      <section className="xr-ask" aria-label={phase.prepared.level === "consequential" ? "This acts outward — inspect everything" : "New material would be shared"}>
        <header className="xr-ask__level">
          {prepared.level === "expanded"
            ? <><strong>New material would be shared.</strong> {prepared.delta.length} item{prepared.delta.length === 1 ? "" : "s"} the model has not seen for this kind of request before.</>
            : <><strong>This request acts outward.</strong> Inspect the context and the plan before anything leaves.</>}
        </header>
        {prepared.level === "expanded" && (
          <ul className="xr-ask__delta">
            {prepared.context.included.filter((i) => prepared.delta.includes(i.id)).map((i) => (
              <li key={i.id}><span className="xr-ask__kind">{i.kind}</span> {i.label} <span className="xr-mono">{i.tokens} tok</span></li>
            ))}
          </ul>
        )}
        <SceneRenderer scene={scene} bindings={local} />
      </section>
    );
  }

  if (phase.kind === "asking") {
    const digest = phase.prepared.context.contextDigest;
    const scene: Scene = { worldId, title: "", reason: "", root: { id: "ind", component: "Canvas", layout: "column",
      children: [{ id: "i", component: "ContextIndicator", contextDigest: digest } as never] } };
    return <section className="xr-ask"><SceneRenderer scene={scene} bindings={{ ...bindings, contexts }} /><p className="xr-ask__quiet">Asking…</p></section>;
  }

  if (phase.kind === "answered") {
    const { result, prepared } = phase;
    const digest = prepared.context.contextDigest;
    const scene: Scene = { worldId, title: "", reason: "", root: { id: "ind", component: "Canvas", layout: "column",
      children: [{ id: "i", component: "ContextIndicator", contextDigest: digest } as never] } };
    return (
      <section className="xr-ask" aria-live="polite">
        <SceneRenderer scene={scene} bindings={{ ...bindings, contexts }} />
        <AskResult result={result} />
        <button type="button" className="xr-button" onClick={onClose}>Close</button>
      </section>
    );
  }

  return (
    <section className="xr-ask" role="alert">
      <p className="xr-ask__result is-failed"><strong>Could not ask.</strong> {phase.reason}</p>
      <button type="button" className="xr-button" onClick={onClose}>Close</button>
    </section>
  );
}

const WORDS: Record<string, string> = {
  explain_check: "Explain this measurement", find_evidence: "Find what the sources say", draft_decision: "Draft a decision",
  choose_transform: "Choose a tool for this", describe_impact: "Describe what changed", prepare_delivery: "Prepare the delivery",
  research_plan: "Turn the sources into claims and steps", write_document: "Write it as a document",
  challenge_claim: "Challenge this", propose_test: "Propose a way to test this",
};
const word = (intent: string) => WORDS[intent] ?? intent;

export type { CandidateRecord };

/** The outcome, in words. A gated or refused call shows its reason and no output — nothing is invented. */
export function AskResult({ result }: { result: Asked }) {
  if (result.status === "ok") {
    return result.proposed
      ? <p className="xr-ask__result">{result.proposed.claims} claim{result.proposed.claims === 1 ? "" : "s"} and {result.proposed.steps} step{result.proposed.steps === 1 ? "" : "s"} proposed
          {result.proposed.unsupported > 0 ? `; ${result.proposed.unsupported} unsupported by the sources given` : ""}. They are in the tray below — none is knowledge yet.</p>
      : <p className="xr-ask__result">Answered. Nothing was proposed as a claim or a step.</p>;
  }
  return (
    <p className={`xr-ask__result is-${result.status}`}>
      <strong>{result.status === "gated" ? "Not sent." : result.status === "refused" ? "Refused." : "Over budget."}</strong> {result.reason}
    </p>
  );
}
