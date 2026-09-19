import type { ComputeQuote } from "@xeniur/core";
import { Cpu, HardDrive, Sparkles, X } from "lucide-react";

export function ComputeReview({ quote, busy, onCancel, onConfirm }: {
  quote: ComputeQuote; busy: boolean; onCancel(): void; onConfirm(): void;
}) {
  const enough = quote.balance >= quote.compute;
  return <div className="xr-modal-backdrop"><section className="xr-compute-review" role="dialog" aria-modal="true" aria-labelledby="compute-title">
    <header><span><Sparkles size={18} /> EXPENSIVE EXECUTION</span><button type="button" onClick={onCancel} aria-label="Cancel"><X /></button></header>
    <div className="xr-compute-review__body"><small>BEFORE XENIUR ACTS</small><h2 id="compute-title">{quote.title}</h2>
      <div className="xr-compute-number"><strong>{quote.compute}</strong><span>Compute</span></div>
      <dl><div><dt>Cloud provider</dt><dd>{quote.provider}</dd></div><div><dt>Estimated cost</dt><dd>${quote.estimatedUsd.toFixed(2)} from your allowance</dd></div><div><dt>Current balance</dt><dd>{quote.balance} Compute</dd></div><div><dt>Process record</dt><dd>{quote.provenance}</dd></div></dl>
      {quote.localAlternative && <button className="xr-local-alternative" type="button" onClick={onCancel}><HardDrive size={18} /><span><b>Local alternative</b>{quote.localAlternative}</span><strong>0 Compute</strong></button>}
      {!enough && <p className="xr-inline-warning">This estimate is visible, but the current balance cannot cover it.</p>}
    </div>
    <footer><button type="button" className="xr-button" onClick={onCancel}>Cancel</button><button type="button" className="xr-button xr-button--signal" disabled={!enough || busy} onClick={onConfirm}><Cpu size={17} /> {busy ? "Queuing…" : `Generate · ${quote.compute} Compute`}</button></footer>
  </section></div>;
}
