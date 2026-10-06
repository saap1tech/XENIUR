import { useCallback, useEffect, useRef, useState } from "react";
import type { SharpenEffect, SharpenKind, SharpenSession, WorkSignal, WorkSignalKind, WorkState } from "@xeniur/core";
import { ArrowRight, BookOpen, Check, ChevronDown, Compass, FlaskConical, GitBranch, Lightbulb, RefreshCw, ScanEye, ShieldQuestion, Split, X } from "lucide-react";
import { ProjectIllustration } from "./ProjectIllustration.js";

const moveMeta = {
  recall: { icon: Lightbulb, label: "Recall" }, distinguish: { icon: Split, label: "Distinguish" },
  challenge: { icon: ShieldQuestion, label: "Challenge" }, apply: { icon: FlaskConical, label: "Apply" }, decide: { icon: GitBranch, label: "Decide" },
} satisfies Record<SharpenKind, { icon: typeof Lightbulb; label: string }>;
const signalMeta = {
  disagreement: { icon: Split, label: "Compare evidence" }, unreviewed_basis: { icon: BookOpen, label: "Check the basis" },
  changed_basis: { icon: RefreshCw, label: "Review a change" }, assumption: { icon: FlaskConical, label: "Test an assumption" },
  requirement: { icon: ScanEye, label: "Check requirements" }, recall: { icon: Lightbulb, label: "Remember the reason" },
} satisfies Record<WorkSignalKind, { icon: typeof Lightbulb; label: string }>;
const actions: Record<SharpenEffect, { label: string; detail: string }> = {
  reflect: { label: "Save reflection", detail: "A note linked to this work" },
  needs_review: { label: "Request review", detail: "Flag the choice and add a review step" },
  test: { label: "Add a test step", detail: "Save this test to the project's next actions" },
  source: { label: "Find another source", detail: "Save a source-finding step to the project's next actions" },
  checked: { label: "I checked this assumption", detail: "Record your check of this basis; citations stay as they are" },
  keep: { label: "Keep my choice", detail: "Record why; existing evidence alerts remain" },
};

export function Sharpen({ goalId, objectId, revision, onOpen, onSaved, initialState }: {
  goalId: string; objectId: string | null; revision: unknown; onOpen(id: string): void; onSaved(): void;
  initialState?: WorkState | null;
}) {
  const bridge = typeof window !== "undefined" ? window.xeniur?.workState : undefined;
  const [state, setState] = useState<WorkState | null>(initialState ?? null);
  const [expanded, setExpanded] = useState(false);
  const [session, setSession] = useState<SharpenSession | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try { const next = await bridge?.assess(goalId); if (request === generation.current) setState(next ?? null); }
    catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message : "Could not read the work state."); }
  }, [bridge, goalId]);
  useEffect(() => { if (bridge) void refresh(); return () => { generation.current++; }; }, [refresh, revision, bridge]);
  useEffect(() => { setSession(null); setExpanded(false); setError(null); }, [goalId]);
  const start = async (signal?: WorkSignal, targetId = objectId,depth:"focused"|"full"="focused") => {
    if (!bridge) return;
    setBusy(true); setError(null);
    try { setSession(await bridge.start(goalId, signal?.objectId ?? targetId, signal?.id,depth)); setExpanded(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not begin this check."); }
    finally { setBusy(false); }
  };
  const pending = state?.latestSession && state.latestSession.moves.some((m) => !m.answeredAt) ? state.latestSession : null;
  if (!bridge && !initialState) return null;
  return <section className="xr-strength" aria-label="Strengthen this work">
    <div className="xr-strength__bar"><Compass size={19} aria-hidden="true" /><button type="button" className="xr-strength__toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <strong>Strengthen the work</strong><span>{state ? state.signals.length ? `${state.signals.length} recorded ${state.signals.length === 1 ? "condition" : "conditions"} to consider` : "Check your reasons at a stopping point" : "Reading the work…"}</span><ChevronDown size={15} aria-hidden="true" /></button>
      <button type="button" className="xr-strength__start" disabled={busy || (!objectId && !state?.signals.length)} onClick={() => void start()}>Quick check <ArrowRight size={15} /></button>
    </div>
    {expanded && <div className="xr-strength__body"><button type="button" className="xr-text-action" disabled={busy} onClick={()=>void start(undefined,objectId,"full")}>Full thinking path</button><div className="xr-strength__intro"><ProjectIllustration kind="sharpen" /><div><h3>A stronger basis.<br />A clearer next move.</h3><p>Use a short thinking move to improve this project. Each answer becomes a linked note, review request, or test.</p></div></div>
      {pending && <button type="button" className="xr-strength__resume" onClick={() => { setSession(pending); setError(null); setExpanded(false); }}><BookOpen size={17} /> Resume your check of “{pending.title}” <ArrowRight size={15} /></button>}
      <div className="xr-strength__signals">{state?.signals.map((signal) => { const { icon: Icon, label } = signalMeta[signal.kind]; return <article key={signal.id}>
        <Icon size={20} aria-hidden="true" /><div><small>{label}</small><button type="button" className="xr-strength__subject" onClick={() => onOpen(signal.objectId)}>{signal.title}</button><p>{signal.fact}</p>
          {signal.lastCheckedAt && <span>Last check: {new Date(signal.lastCheckedAt).toLocaleDateString()}</span>}</div>
        <button type="button" className="xr-strength__check" disabled={busy} aria-label={`${label}: ${signal.title}`} onClick={() => void start(signal)}><ArrowRight size={18} /></button>
      </article>; })}</div>
      {state?.signals.length === 0 && <p className="xr-strength__quiet">No recorded fragility was detected. You can still challenge the selected work.</p>}
    </div>}
    {error && <p className="xr-strength__error" role="alert">{error}</p>}
    {session && <SharpenSessionView key={session.id} session={session} busy={busy} onPause={() => { setSession(null); void refresh(); }} onOpen={onOpen}
      onRestart={() => void start(state?.signals.find((s) => s.objectId === session.objectId && s.subjectKey === session.subjectKey), session.objectId)}
      onAnswer={async (moveId, answer, effect) => { if (!bridge) return; setBusy(true); setError(null); try { const next = await bridge.answer({ sessionId: session.id, moveId, answer, effect }); setSession(next); await refresh(); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The reflection could not be saved."); await refresh(); } finally { setBusy(false); } }} />}
  </section>;
}

/** The record stays hidden during recall unless the person deliberately opens it. */
export function SharpenSessionView({ session, busy, onPause, onOpen, onRestart, onAnswer }: {
  session: SharpenSession; busy: boolean; onPause(): void; onOpen(id: string): void; onRestart(): void;
  onAnswer(moveId: string, answer: string, effect: SharpenEffect): Promise<void>;
}) {
  const [index, setIndex] = useState(() => { const i = session.moves.findIndex((m) => !m.answeredAt); return i < 0 ? session.moves.length - 1 : i; });
  const [answer, setAnswer] = useState(""), [effect, setEffect] = useState<SharpenEffect>(session.moves[index]!.effects[0]!);
  const [reveal, setReveal] = useState(false);
  const move = session.moves[index]!, { icon: Icon, label } = moveMeta[move.kind];
  const completed = session.moves.every((m) => m.answeredAt !== null);
  const choose = (i: number) => { setIndex(i); setAnswer(""); setReveal(false); setEffect(session.moves[i]!.effects[0]!); };
  const promptId = `sharpen-prompt-${move.id}`;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, [move.id]);
  return <div className="xr-sharpen" aria-label={`Sharpen ${session.title}`}>
    <header className="xr-sharpen__head"><div><small>SHARPEN THIS</small><h2>{session.title}</h2></div><button type="button" disabled={busy} onClick={onPause} className="xr-sharpen__pause"><X size={16} /> {completed ? "Return to work" : "Pause"}</button></header>
    <nav className="xr-sharpen__route" aria-label="Thinking moves">{session.moves.map((m, i) => { const Glyph = moveMeta[m.kind].icon; return <button type="button" key={m.id} disabled={busy || (i > 0 && !session.moves[i - 1]?.answeredAt)} aria-current={i === index ? "step" : undefined} className={m.answeredAt ? "is-saved" : ""} onClick={() => choose(i)}>
      <span>{m.answeredAt ? <Check size={16} aria-hidden="true" /> : <Glyph size={16} aria-hidden="true" />}</span>{moveMeta[m.kind].label}</button>; })}</nav>
    <div className="xr-sharpen__question"><Icon size={25} aria-hidden="true" /><div><small>{index + 1} / {session.moves.length} · {label}</small><h3 id={promptId}>{move.prompt}</h3></div></div>
    {!move.answeredAt ? <form className="xr-sharpen__form" onSubmit={(event) => { event.preventDefault(); if (answer.trim().length >= 8 && !busy) void onAnswer(move.id, answer.trim(), effect); }}>
      <textarea ref={inputRef} aria-labelledby={promptId} placeholder="In your own words…" value={answer} maxLength={2000} minLength={8} required onChange={(event) => setAnswer(event.target.value)} rows={4} disabled={busy} />
      {move.effects.length > 1 && <fieldset className="xr-sharpen__effects"><legend>How should this change the work?</legend>{move.effects.map((action) => <label key={action}><input type="radio" name={`effect-${move.id}`} value={action} checked={effect === action} disabled={busy} onChange={() => setEffect(action)} /><span><strong>{actions[action].label}</strong><small>{actions[action].detail}</small></span></label>)}</fieldset>}
      <footer><button type="button" className="xr-sharpen__reveal" onClick={() => setReveal(!reveal)}><BookOpen size={15} /> {reveal ? "Hide the record" : "Show the recorded basis"}</button><button type="submit" className="xr-button xr-button--primary" disabled={busy || answer.trim().length < 8}>{busy ? "Saving…" : actions[effect].label}<ArrowRight size={15} /></button></footer>
    </form> : <div className="xr-sharpen__remembered"><small>{move.kind === "recall" ? "YOU REMEMBERED" : "YOUR REFLECTION"}</small><p>{move.answer}</p><span><Check size={14} /> {actions[move.effect!].label} · saved to the project</span></div>}
    {(reveal || move.answeredAt) && <div className="xr-sharpen__record"><div><small>RECORDED BASIS</small><p>{move.recorded}</p><button type="button" className="xr-text-action" onClick={() => onOpen(session.objectId)}>Open the work <ArrowRight size={14} /></button></div><div><small>WHAT CHANGED</small>{move.changes.length ? move.changes.map((c, i) => <p key={i}>{c}</p>) : <p>No changes were detected in the recorded basis at the start of this check.</p>}<small>Snapshots from {new Date(session.createdAt).toLocaleDateString()}</small></div></div>}
    {move.answeredAt && <footer className="xr-sharpen__next">{move.reflectionObjectId && <button type="button" className="xr-text-action" onClick={() => onOpen(move.reflectionObjectId!)}>Open saved note <ArrowRight size={14} /></button>}
      {index < session.moves.length - 1 ? <button type="button" className="xr-button xr-button--primary" onClick={() => choose(index + 1)}>Next move <ArrowRight size={15} /></button> : <button type="button" className="xr-button xr-button--primary" onClick={onPause}>Return to work <ArrowRight size={15} /></button>}</footer>}
    <details className="xr-sharpen__limits"><summary>About this check</summary><p>Prompts come from the project's records. Your answers are saved as your reflections. They never grade your understanding, resolve a disputed citation, or approve a delivery.</p><button type="button" className="xr-text-action" disabled={busy} onClick={onRestart}>Start a fresh check <RefreshCw size={14} /></button></details>
  </div>;
}
