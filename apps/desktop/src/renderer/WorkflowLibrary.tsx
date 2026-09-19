import { useEffect, useState } from "react";
import type { WorkflowListing } from "@xeniur/core";
import { ArrowLeft, ArrowUpRight, Boxes, LockKeyhole } from "lucide-react";
import { BrandMark } from "./BrandMark.js";

export function WorkflowLibrary({ onBack, onApplied }: { onBack(): void; onApplied(worldId: string): void }) {
  const [items, setItems] = useState<WorkflowListing[]>([]); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void window.xeniur?.workflows.list().then(setItems); }, []);
  return <main className="xr-library"><nav><button type="button" className="xr-back" onClick={onBack}><ArrowLeft size={15} /> Home</button><BrandMark /><span className="xr-badge"><LockKeyhole size={12} /> DATA-ONLY</span></nav>
    <header><small>THE CAPABILITY EXCHANGE / 001</small><h1>Borrow the structure.<br /><em>Keep your work yours.</em></h1><p>Install a visual workflow—not executable plugin code. Each one can compose only capabilities XENIUR already trusts.</p></header>
    {error && <p className="xr-inline-warning">{error}</p>}
    <section className="xr-workflow-grid">{items.map((item, index) => <article key={item.id} className="xr-workflow-card"><div className="xr-workflow-card__top"><span>{String(index + 1).padStart(2, "0")}</span><Boxes /></div><small>{item.source} / {item.steps} steps</small><h2>{item.name}</h2><p>{item.summary}</p><footer><span>By {item.author}</span><button type="button" disabled={busy !== null} onClick={async () => { setBusy(item.id); setError(null); try { onApplied(await window.xeniur!.workflows.apply(item.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : "This workflow could not be applied."); setBusy(null); } }}>{busy === item.id ? "Preparing…" : "Use workflow"}<ArrowUpRight size={16} /></button></footer></article>)}</section>
    <aside className="xr-library-note"><strong>No arbitrary code.</strong><p>A shared workflow may contain scene structure, constraints, a trusted recipe, readiness profiles, a decision template, delivery roles, sample Objects, and instructions. Private object IDs and generative steps are refused.</p></aside>
  </main>;
}
