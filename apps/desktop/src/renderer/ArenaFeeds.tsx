import { useCallback, useEffect, useState } from "react";

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
    <section className="xr-arena" aria-labelledby="arena-title">
      <header><small>ARENA</small><h2 id="arena-title">Challenge feeds</h2>
        <p>A feed is a signed list of challenges at an address you add. Checking it fetches the list the way Explore fetches a page — HTTPS, address policy, no scripts — and verifies every challenge against its publisher before anything is shown. Unknown publishers: three a day.</p></header>
      <ul className="xr-arena__feeds">
        {feeds.map((f) => (
          <li key={f.url}><span className="xr-mono">{f.url}</span>{f.label && <em>{f.label}</em>}
            <button type="button" className="xr-text-action" onClick={() => void bridge?.arena?.removeFeed(f.url).then(setFeeds)}>Remove</button></li>
        ))}
        {feeds.length === 0 && <li className="xr-arena__quiet">No feeds yet.</li>}
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
          <p>{report.feeds} feed{report.feeds === 1 ? "" : "s"} checked · {report.adopted.length} new · {report.alreadyHere} already here · {report.refused.length} refused · {report.failed.length} unreachable</p>
          {report.adopted.length > 0 && <ul>{report.adopted.map((t) => <li key={t}>Arrived: {t}</li>)}</ul>}
          {report.refused.length > 0 && <ul>{report.refused.map((r, i) => <li key={i}>Refused “{r.title}”: {r.why}</li>)}</ul>}
          {report.failed.length > 0 && <ul>{report.failed.map((r, i) => <li key={i}>{r.feed}: {r.why}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
