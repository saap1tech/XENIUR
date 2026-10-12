import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelChoiceView, ModelFitView, ProjectModelsView } from "@xeniur/core";
import { BrainCircuit, Check, ChevronDown, CircleCheck, CircleMinus, FlaskConical, Image, Search, Star, X } from "lucide-react";

/** A model's standing as a mark and a word, never colour alone. A model with no standing carries no mark. */
export const FIT: Record<Exclude<ModelFitView, "untested">, { label: string; icon: typeof Star; meaning: string }> = {
  best: { label: "Recommended", icon: Star, meaning: "The most reliable results across every step." },
  good: { label: "Strong", icon: CircleCheck, meaning: "Dependable for most work." },
  limited: { label: "Basic", icon: CircleMinus, meaning: "Useful, with a weaker spot noted beside it." },
  care: { label: "Experimental", icon: FlaskConical, meaning: "May be slow or uneven on longer steps." },
};

export function FitBadge({ fit }: { fit: ModelFitView }) {
  if (fit === "untested") return null;
  const { label, icon: Icon } = FIT[fit];
  return <span className={`xr-fit xr-fit--${fit}`}><Icon size={13} aria-hidden="true" />{label}</span>;
}
const price = (m: ModelChoiceView) => m.output === "image"
  ? `$${(m.imagePriceUsd ?? 0).toFixed(3)} per picture`
  : `$${(m.inputPerMTok ?? 0).toFixed(2)} in · $${(m.outputPerMTok ?? 0).toFixed(2)} out per million tokens`;
/** The shortest name a person recognises: no provider prefix, no release suffix. */
export const shortName = (m: Pick<ModelChoiceView, "label">) => m.label.replace(/^[^:]+:\s*/, "").replace(/\s+(Instruct|Preview)\b.*$/i, "");

/** The header chip: which model this project writes with, and how it fits. */
export function ProjectModelsChip({ view, onOpen }: { view: ProjectModelsView | null; onOpen(): void }) {
  const current = view?.text.find((m) => m.id === view.current.text);
  const standing = current && current.fit !== "untested" ? FIT[current.fit] : null;
  const Icon = standing?.icon ?? BrainCircuit;
  return <button type="button" className={`xr-models-chip${current ? ` xr-models-chip--${current.fit}` : ""}`} onClick={onOpen}
    aria-label={current ? `AI models for this project: ${shortName(current)}${standing ? `, ${standing.label}` : ""}` : "Choose AI models for this project"} title="AI models for this project">
    <Icon size={15} aria-hidden="true" /><span>{current ? shortName(current) : "Choose models"}</span><ChevronDown size={14} aria-hidden="true" />
  </button>;
}

function Option({ m, name, checked, onPick }: { m: ModelChoiceView; name: string; checked: boolean; onPick(): void }) {
  return <label className={`xr-model-option${checked ? " is-chosen" : ""}`}>
    <input type="radio" name={name} checked={checked} onChange={onPick} />
    <span className="xr-model-option__body">
      <span className="xr-model-option__head"><strong>{shortName(m)}</strong><FitBadge fit={m.fit} /></span>
      {m.note && <span className="xr-model-option__note">{m.note}</span>}
      <span className="xr-model-option__price">{price(m)}</span>
    </span>
  </label>;
}

/** Choose this project's models. Rated ones first; the rest of the catalogue is a search away. */
export function ProjectModelsDialog({ view, busy, error, onSave, onClose }: {
  view: ProjectModelsView; busy: boolean; error: string; onSave(text: string | null, image: string | null): void; onClose(): void;
}) {
  const [text, setText] = useState<string | null>(view.chosen.text);
  const [image, setImage] = useState<string | null>(view.chosen.image);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  // Focus moves in once and returns once; typing in the search never moves it.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("input:checked, input, button")?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close.current(); };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  const rated = view.text.filter((m) => m.fit !== "untested" && m.fit !== "care");
  const shownText = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return view.text.filter((m) => `${m.label} ${m.model}`.toLowerCase().includes(q)).slice(0, 40);
    if (all) return view.text;
    const pinned = view.text.filter((m) => m.id === text);
    return [...rated, ...view.text.filter((m) => !rated.includes(m)).slice(0, 4), ...pinned].filter((m, i, list) => list.indexOf(m) === i);
  }, [view.text, query, all, rated, text]);
  const fallback = (kind: "text" | "image") => view[kind].find((m) => m.id === view.current[kind] && view.chosen[kind] === null);
  return <div className="xr-project__cost-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="xr-models-dialog" role="dialog" aria-modal="true" aria-labelledby="models-title">
      <header><div><h2 id="models-title">AI models for this project</h2><p>Recommended models give the most reliable results. Every step shows its price before it runs.</p></div>
        <button type="button" className="xr-models-dialog__close" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
      <div className="xr-models-dialog__body">
        <fieldset><legend><BrainCircuit size={16} aria-hidden="true" />Writing and research</legend>
          <label className={`xr-model-option xr-model-option--default${text === null ? " is-chosen" : ""}`}><input type="radio" name="text-model" checked={text === null} onChange={() => setText(null)} />
            <span className="xr-model-option__body"><span className="xr-model-option__head"><strong>Use the app setting</strong></span>
              <span className="xr-model-option__note">{fallback("text") ? `Currently ${shortName(fallback("text")!)}.` : "The model chosen in Settings."}</span></span></label>
          {shownText.map((m) => <Option key={m.id} m={m} name="text-model" checked={text === m.id} onPick={() => setText(m.id)} />)}
          <div className="xr-models-dialog__more">
            <label><Search size={15} aria-hidden="true" /><input type="search" aria-label="Find a model" placeholder={`Find among ${view.text.length} models`} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            {!query && view.text.length > shownText.length && <button type="button" onClick={() => setAll(true)}>Show all {view.text.length}</button>}
          </div>
        </fieldset>
        {view.image.length > 0 && <fieldset><legend><Image size={16} aria-hidden="true" />Pictures</legend>
          <label className={`xr-model-option xr-model-option--default${image === null ? " is-chosen" : ""}`}><input type="radio" name="image-model" checked={image === null} onChange={() => setImage(null)} />
            <span className="xr-model-option__body"><span className="xr-model-option__head"><strong>Use the app setting</strong></span>
              <span className="xr-model-option__note">{fallback("image") ? `Currently ${shortName(fallback("image")!)}.` : "The model chosen in Settings."}</span></span></label>
          {view.image.map((m) => <Option key={m.id} m={m} name="image-model" checked={image === m.id} onPick={() => setImage(m.id)} />)}
        </fieldset>}
        <ul className="xr-models-dialog__legend" aria-label="What the marks mean">
          {(Object.keys(FIT) as Array<keyof typeof FIT>).map((fit) => <li key={fit}><FitBadge fit={fit} /><span>{FIT[fit].meaning}</span></li>)}
        </ul>
      </div>
      {error && <p className="xr-inline-warning" role="alert">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="xr-button--primary" disabled={busy} onClick={() => onSave(text, image)}>{busy ? "Saving…" : "Use these models"}<Check size={17} aria-hidden="true" /></button></footer>
    </section>
  </div>;
}
