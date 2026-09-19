import { useEffect, useState } from "react";
import type { ProcessProof } from "@xeniur/core";
import { Check, FileCheck2, ShieldCheck, X } from "lucide-react";

export function ProcessShare({ objectId, title, proof, onClose }: { objectId: string; title: string; proof: ProcessProof; onClose(): void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [hashes, setHashes] = useState(false); const [timing, setTiming] = useState(false); const [busy, setBusy] = useState(false); const [result, setResult] = useState<{ path: string; rootHash: string } | null>(null);
  useEffect(() => { document.querySelector<HTMLButtonElement>(".xr-process-share__close")?.focus(); }, []);
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <div className="xr-modal-backdrop"><section className="xr-process-share" role="dialog" aria-modal="true" aria-labelledby="share-title"><header><div><small>MADE WITH XENIUR</small><h2 id="share-title">Choose what the page reveals.</h2></div><button className="xr-process-share__close" type="button" onClick={onClose} aria-label="Close"><X /></button></header>
    <p>The public page uses generic stage names. Prompts, private notes, source text, filenames, model names, and every unselected event stay out.</p>
    <div className="xr-process-share__events">{proof.events.length ? proof.events.map((event) => <label key={event.id}><input type="checkbox" checked={selected.has(event.id)} onChange={() => toggle(event.id)} /><span><b>{event.kind.replaceAll("_", " ")}</b><small>{event.actor} · {new Date(event.at).toLocaleDateString()}</small></span>{selected.has(event.id) && <Check size={16} />}</label>) : <p className="xr-empty">No process events have been recorded for {title} yet.</p>}</div>
    <div className="xr-process-share__options"><label><input type="checkbox" checked={hashes} onChange={(event) => setHashes(event.target.checked)} /><span><b>Disclose selected file hashes</b><small>Lets a viewer verify the exact bytes you chose.</small></span></label><label><input type="checkbox" checked={timing} onChange={(event) => setTiming(event.target.checked)} /><span><b>Disclose dates and recorded session duration</b><small>Only activity recorded inside XENIUR. Off by default.</small></span></label></div>
    {result && <div className="xr-share-success"><FileCheck2 /><span><b>Static proof page created</b><small>{result.path}<br />SHA-256 {result.rootHash}</small></span></div>}
    <footer><span><ShieldCheck size={16} /> {selected.size} of {proof.events.length} steps selected</span><button type="button" className="xr-button" onClick={onClose}>Done</button><button type="button" className="xr-button xr-button--signal" disabled={!selected.size || busy} onClick={async () => { setBusy(true); try { setResult(await window.xeniur!.process.exportPage({ objectId, eventIds: [...selected], discloseHashes: hashes, discloseTiming: timing })); } finally { setBusy(false); } }}>{busy ? "Building…" : "Create proof page"}</button></footer>
  </section></div>;
}
