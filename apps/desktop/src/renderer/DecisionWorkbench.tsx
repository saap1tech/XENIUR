import { useState } from "react";
import type { XeniurBridge } from "@xeniur/core";
import { ArrowRight, Check, Plus, X } from "lucide-react";

export function DecisionWorkbench({ bridge, worldId, onClose, onSaved }: {
  bridge: XeniurBridge; worldId: string; onClose(): void; onSaved(objectId: string, accepted: boolean): void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [tradeoffs, setTradeoffs] = useState(["", ""]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [counter, setCounter] = useState("");
  const [trigger, setTrigger] = useState("");
  const [skipCounter, setSkipCounter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !!question.trim() && options.every((option) => !!option.trim()) && chosen !== null && !!reason.trim() && (!!counter.trim() || skipCounter);
  const save = async (accept: boolean) => {
    if (!question.trim() || options.some((option) => !option.trim())) return;
    if (accept && !ready) return;
    setBusy(true); setError(null);
    try {
      const detail = await bridge.decisions.create({ worldId, question: question.trim(),
        options: options.map((label, index) => ({ key: String(index + 1), label: label.trim(), note: tradeoffs[index]?.trim() ?? "" })),
        chosenOption: chosen === null ? null : String(chosen + 1), rationale: reason.trim(),
      });
      if (!detail) throw new Error("This choice could not be saved.");
      if (accept) {
        const accepted = await bridge.decisions.accept(detail.objectId, {
          ...(skipCounter ? { skipSteelman: true } : { steelman: counter.trim() }),
          ...(trigger.trim() ? { reviewTrigger: trigger.trim() } : {}),
        });
        if (!accepted) throw new Error("The choice was saved as a draft. Check its reasoning before accepting it.");
      }
      onSaved(detail.objectId, accept);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This choice could not be saved."); }
    finally { setBusy(false); }
  };
  return <section className="xr-fork" aria-labelledby="fork-title">
    <header><span>CHOICE / {options.length} PATHS</span><button type="button" onClick={onClose} aria-label="Close choice"><X size={17} /></button></header>
    <h2 id="fork-title">What are you deciding?</h2>
    <input className="xr-fork__question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Name the choice" maxLength={300} aria-label="Decision question" autoFocus />
    <div className="xr-fork__branches" role="radiogroup" aria-label="Options">
      {options.map((option, index) => <div key={index} className={`xr-fork__branch${chosen === index ? " is-chosen" : ""}`}>
        <button type="button" className="xr-fork__choose" role="radio" aria-checked={chosen === index} onClick={() => setChosen(index)}><span>{chosen === index ? <Check size={17} /> : String(index + 1)}</span>{chosen === index ? "Chosen path" : "Choose this path"}</button>
        <input value={option} onChange={(event) => setOptions((all) => all.map((value, i) => i === index ? event.target.value : value))} placeholder={`Option ${index + 1}`} maxLength={180} aria-label={`Option ${index + 1}`} />
        <input value={tradeoffs[index] ?? ""} onChange={(event) => setTradeoffs((all) => all.map((value, i) => i === index ? event.target.value : value))} placeholder="What helps or costs?" maxLength={300} aria-label={`Tradeoffs for option ${index + 1}`} />
      </div>)}
      {options.length < 3 && <button type="button" className="xr-fork__add" onClick={() => { setOptions((all) => [...all, ""]); setTradeoffs((all) => [...all, ""]); }}><Plus size={17} /> Third path</button>}
    </div>
    <div className="xr-fork__reflection"><label>Your reason <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="What makes this path right for this project?" maxLength={1000} /></label>
      <label>What could make this wrong? <input value={counter} onChange={(event) => setCounter(event.target.value)} placeholder="One honest reason" maxLength={1000} disabled={skipCounter} /></label>
      <label>Revisit if… <input value={trigger} onChange={(event) => setTrigger(event.target.value)} placeholder="A condition changes (optional)" maxLength={500} /></label>
      <label className="xr-fork__skip"><input type="checkbox" checked={skipCounter} onChange={(event) => setSkipCounter(event.target.checked)} /> I choose to leave the counterargument open</label>
    </div>
    {error && <p className="xr-fork__error" role="alert">{error}</p>}
    <footer><button type="button" onClick={() => void save(false)} disabled={busy || !question.trim() || options.some((option) => !option.trim())}>Save draft</button><button type="button" className="xr-fork__commit" onClick={() => void save(true)} disabled={busy || !ready}>Record choice <ArrowRight size={16} /></button></footer>
  </section>;
}
