import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Link2, ShieldCheck, Trophy, X } from "lucide-react";

type Report = { feeds: number; adopted: string[]; alreadyHere: number; refused: Array<{ feed: string; title: string; why: string }>; failed: Array<{ feed: string; why: string }> };

/**
 * Arena feeds, inside the Protected Web layer because that is what they are: URLs the person
 * added, fetched through the same checked path as any page, as data. Nothing is fetched until
 * *Check the feeds*; every challenge is verified against its publisher's signature and
 * quarantined by that publisher's trust here. What arrives shows up on Today as one row.
 */
export function ArenaFeeds() {
  const bridge = typeof window === "undefined" ? undefined : window.xeniur;
  const [feeds, setFeeds] = useState<Array<{ url: string; label: string }>>([]);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => { setFeeds((await bridge?.arena?.feeds()) ?? []); }, [bridge]);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <details className="xr-arena" aria-labelledby="arena-title"><summary id="arena-title">Challenges</summary>
      <header><h2>Take on a challenge</h2>
        <p>Add a challenge feed from someone you trust. New challenges appear in your work when you check the feed.</p></header>
      <div className="xr-arena__path" aria-label="How challenge feeds work"><span><Link2 aria-hidden="true" /> Add a feed</span><ArrowRight aria-hidden="true" /><span><ShieldCheck aria-hidden="true" /> Check signatures</span><ArrowRight aria-hidden="true" /><span><Trophy aria-hidden="true" /> Pick a challenge</span></div>
      <ul className="xr-arena__feeds">
        {feeds.map((f) => (
          <li key={f.url}><Link2 size={16} aria-hidden="true" /><span className="xr-mono">{f.label || f.url}</span>{f.label && <em>{f.url}</em>}
            <button type="button" className="xr-text-action" onClick={() => void bridge?.arena?.removeFeed(f.url).then(setFeeds)}>Remove</button></li>
        ))}
        {feeds.length === 0 && <li className="xr-arena__quiet">Your challenge shelf is empty.</li>}
      </ul>
      <form className="xr-arena__add" onSubmit={(e) => {
        e.preventDefault();
        const u = url.trim(); if (!u) return;
        void bridge?.arena?.addFeed(u, label.trim()).then((list) => { setFeeds(list); setUrl(""); setLabel(""); setError(null); }).catch((c: unknown) => setError(c instanceof Error ? c.message : String(c)));
      }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/arena.json" aria-label="Feed address" className="xr-mono" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A label" aria-label="Feed label" />
        <button type="submit" className="xr-button">Add feed</button>
        <button type="button" className="xr-button xr-button--primary" disabled={busy || feeds.length === 0} onClick={() => {
          setBusy(true); setError(null);
          void bridge?.arena?.refresh().then(setReport).catch((c: unknown) => setError(c instanceof Error ? c.message : String(c))).finally(() => setBusy(false));
        }}>{busy ? "Checking…" : "Check the feeds"}</button>
      </form>
      {error && <p className="xr-arena__error" role="status">{error}</p>}
      {report && (
        <div className="xr-arena__report" role="status">
          <div className="xr-arena__outcomes"><span><Check aria-hidden="true" /> <strong>{report.adopted.length}</strong> new</span><span><ShieldCheck aria-hidden="true" /> <strong>{report.alreadyHere}</strong> already here</span><span><X aria-hidden="true" /> <strong>{report.refused.length + report.failed.length}</strong> need review</span></div>
          {report.adopted.length > 0 && <ul>{report.adopted.map((t) => <li key={t}>Arrived: {t}</li>)}</ul>}
          {(report.refused.length > 0 || report.failed.length > 0) && <details><summary>Why some did not arrive</summary>
            <ul>{report.refused.map((r, i) => <li key={`refused-${i}`}>Refused “{r.title}”: {r.why}</li>)}{report.failed.map((r, i) => <li key={`failed-${i}`}>{r.feed}: {r.why}</li>)}</ul>
          </details>}
        </div>
      )}
      <details className="xr-arena__explain"><summary>How are these checked?</summary><p>Feeds are fetched as data, without site scripts. Each challenge needs a valid publisher signature. Unknown publishers are limited to three imports per day. Reports and blocks stay on this device; there is no central moderation service yet.</p></details>
    </details>
  );
}
