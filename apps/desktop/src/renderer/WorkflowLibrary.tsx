import { useEffect, useState } from "react";
import type { WorkflowListing } from "@xeniur/core";
import { ArrowLeft, ArrowRight, Boxes, FolderOpen, LoaderCircle, PackageCheck, X } from "lucide-react";
import { BrandMark } from "./BrandMark.js";
import { ProjectIllustration } from "./ProjectIllustration.js";

/**
 * Ready-made setups. A card answers the three questions a person has before choosing one:
 * what do I bring, what do I get, and what happens when I press the button (a new project).
 */
export function WorkflowLibrary({ onBack, onApplied }: { onBack(): void; onApplied(worldId: string): void }) {
  const [items, setItems] = useState<WorkflowListing[] | null>(null); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void window.xeniur?.workflows.list().then(setItems).catch(() => { setItems([]); setError("The workflows could not be read."); }); }, []);
  const start = async (item: WorkflowListing) => {
    setBusy(item.id); setError(null);
    try { onApplied(await window.xeniur!.workflows.apply(item.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "This workflow could not be started."); setBusy(null); }
  };
  return <main className="xr-library"><nav><button type="button" className="xr-back" onClick={onBack}><ArrowLeft size={15} /> Home</button><BrandMark /><span>{items ? `${items.length} available` : ""}</span></nav>
    <header className="xr-library__intro"><div><small>Workflows</small><h1>Start from a<br /><em>proven setup.</em></h1><p>Each workflow opens a new project with its steps already in place. Bring your file and it handles the repetitive parts.</p></div><ProjectIllustration kind="finish" /></header>
    {error && <p className="xr-inline-warning" role="alert">{error}<button type="button" className="xr-inline-warning__close" aria-label="Dismiss" onClick={() => setError(null)}><X size={15} /></button></p>}
    {items === null ? <p className="xr-empty" role="status">Reading workflows…</p>
      : !items.length ? <p className="xr-empty">No workflows are installed yet.</p>
      : <section className="xr-workflow-grid" aria-label="Available workflows">{items.map((item) => <article key={item.id} className="xr-workflow-card">
        <header className="xr-workflow-card__top"><span className="xr-workflow-card__mark" aria-hidden="true">{item.emoji ?? <Boxes size={22} />}</span>
          <span className="xr-workflow-card__source">{item.source === "bundled" ? "Built in" : `Shared by ${item.author}`}</span></header>
        <h2>{item.name}</h2><p>{item.summary}</p>
        <dl className="xr-workflow-card__facts">
          {item.expects && <div><dt><FolderOpen size={15} aria-hidden="true" />You bring</dt><dd>{item.expects}</dd></div>}
          {!!item.delivers?.length && <div><dt><PackageCheck size={15} aria-hidden="true" />You get</dt><dd><ul>{item.delivers.map((name) => <li key={name}>{name}</li>)}</ul></dd></div>}
        </dl>
        <footer><span>{item.steps} {item.steps === 1 ? "step" : "steps"} set up for you</span>
          <button type="button" disabled={busy !== null} aria-label={`Start a project with ${item.name}`} onClick={() => void start(item)}>{busy === item.id ? <><LoaderCircle size={16} aria-hidden="true" />Setting up…</> : <>Start a project<ArrowRight size={16} aria-hidden="true" /></>}</button></footer>
      </article>)}</section>}
    <aside className="xr-library-note"><details><summary>What is inside a shared workflow?</summary><p>Its steps, the checks a result has to pass, the choices it will ask you to make, and an example structure. It never carries anyone's private files, and it cannot bring code that runs on your computer.</p></details></aside>
  </main>;
}
