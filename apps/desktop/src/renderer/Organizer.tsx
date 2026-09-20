import { useCallback, useEffect, useState } from "react";
import type { Assessment, ChallengeRecord, EntryRecord, Placing, PublisherRef, Results, SignedDocument } from "@xeniur/core";
import { RECORD_LIMITS } from "@xeniur/core";

/**
 * The organizer console — for the challenge's publisher, beside the board.
 *
 * Invite judges (publishers this machine then trusts); open judging after close; read the
 * assessments as each judge recorded them; write the placings — a word, an entry, a reason —
 * in your order; publish, which signs. Nothing here sums a mark or sorts an entry: what the
 * console shows is what the judges wrote, and what it publishes is what you wrote.
 */
export function Organizer({ challenge, entries, titles, onChanged }: {
  challenge: ChallengeRecord;
  entries: EntryRecord[];
  /** Entry titles by Object id, from the World the console sits in. */
  titles: Readonly<Record<string, string>>;
  /** The board should re-read: judging opened, or results were published. */
  onChanged(): void;
}) {
  const bridge = typeof window === "undefined" ? undefined : window.xeniur;
  const worldId = challenge.worldId;
  const [status, setStatus] = useState<{ judgingOpenedAt: number | null; resultsPublishedAt: number | null }>({ judgingOpenedAt: null, resultsPublishedAt: null });
  const [judges, setJudges] = useState<Array<PublisherRef & { invitedAt: number }>>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [results, setResults] = useState<SignedDocument<Results> | null>(null);
  const [judgeKey, setJudgeKey] = useState("");
  const [judgeName, setJudgeName] = useState("");
  const [ticketKey, setTicketKey] = useState("");
  const [ticketName, setTicketName] = useState("");
  const [placings, setPlacings] = useState<Array<{ place: string; entryId: string; reason: string }>>([{ place: "", entryId: "", reason: "" }]);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus((await bridge?.judging?.status(worldId)) ?? { judgingOpenedAt: null, resultsPublishedAt: null });
    setJudges((await bridge?.judging?.judges(worldId)) ?? []);
    setAssessments((await bridge?.judging?.assessments(worldId)) ?? []);
    setResults((await bridge?.judging?.results(worldId)) ?? null);
  }, [bridge, worldId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const closed = Date.now() >= challenge.rules.endsAt;
  const titleOf = (entryId: string) => entries.find((e) => e.id === entryId);
  const act = async (work: () => Promise<unknown>) => {
    try { await work(); setNotice(null); await refresh(); onChanged(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); }
  };

  return (
    <section className="xr-organizer" aria-labelledby="organizer-title">
      <header className="xr-organizer__head">
        <small className="xr-mono">ORGANIZER</small>
        <h2 id="organizer-title">{challenge.rules.title}</h2>
        <span className="xr-organizer__state">
          {results ? "results published" : status.judgingOpenedAt ? "judging open" : closed ? "closed — judging not yet open" : "open for entries"}
        </span>
      </header>
      {notice && <p className="xr-organizer__notice" role="status">{notice}</p>}

      <h3>Distribution <small>the challenge as a signed file, and tickets</small></h3>
      <p className="xr-organizer__quiet">
        <button type="button" className="xr-button" onClick={() => void act(async () => { const r = await bridge?.arena?.exportChallenge(worldId); if (r) setNotice(`Challenge document written to ${r.path}. Send it, or list it in a feed.`); })}>Export challenge document</button>
      </p>
      {challenge.rules.entry === "ticket" && (
        <form className="xr-organizer__invite" onSubmit={(e) => {
          e.preventDefault();
          if (!ticketKey.trim() || !ticketName.trim()) return;
          void act(async () => {
            const r = await bridge?.arena?.issueTicket(worldId, { publicKey: ticketKey.trim(), displayName: ticketName.trim() }, challenge.rules.endsAt);
            if (r) setNotice(`Ticket for ${ticketName.trim()} written to ${r.path}. Send it on your own channel; XENIUR records no fee.`);
            setTicketKey(""); setTicketName("");
          });
        }}>
          <input value={ticketName} onChange={(e) => setTicketName(e.target.value)} placeholder="Participant's name" aria-label="Participant's name" />
          <input value={ticketKey} onChange={(e) => setTicketKey(e.target.value)} placeholder="Their public key" aria-label="Participant's public key" className="xr-mono" />
          <button type="submit" className="xr-button">Issue a ticket</button>
        </form>
      )}

      <h3>Judges <small>{judges.length} invited · trusted on this machine</small></h3>
      <ul className="xr-organizer__judges">
        {judges.map((j) => <li key={j.publicKey}><strong>{j.displayName}</strong> <span className="xr-mono">{j.publicKey.slice(0, 12)}…</span></li>)}
        {judges.length === 0 && <li className="xr-organizer__quiet">No judges yet. {challenge.rules.judging.by === "publisher" ? "You judge this one yourself." : "Invite the panel by public key."}</li>}
      </ul>
      <form className="xr-organizer__invite" onSubmit={(e) => {
        e.preventDefault();
        if (!judgeKey.trim() || !judgeName.trim()) return;
        void act(async () => { await bridge?.judging?.invite(worldId, { publicKey: judgeKey.trim(), displayName: judgeName.trim() }); setJudgeKey(""); setJudgeName(""); });
      }}>
        <input value={judgeName} onChange={(e) => setJudgeName(e.target.value)} placeholder="Judge's name" aria-label="Judge's name" />
        <input value={judgeKey} onChange={(e) => setJudgeKey(e.target.value)} placeholder="Their public key" aria-label="Judge's public key" className="xr-mono" />
        <button type="submit" className="xr-button">Invite</button>
      </form>

      <h3>Judging</h3>
      {status.judgingOpenedAt ? (
        <p className="xr-organizer__quiet">Opened {new Date(status.judgingOpenedAt).toISOString().slice(0, 10)}. Judges see every entry in arrival order.</p>
      ) : (
        <p className="xr-organizer__quiet">
          {closed ? "The challenge has closed." : `Opens after ${new Date(challenge.rules.endsAt).toISOString().slice(0, 10)}.`}{" "}
          <button type="button" className="xr-button" disabled={!closed} onClick={() => void act(async () => { await bridge?.judging?.open(worldId); })}>Open judging</button>
        </p>
      )}

      <h3>Assessments <small>{assessments.length} received · as each judge wrote them</small></h3>
      <ul className="xr-organizer__assessments">
        {assessments.map((a) => (
          <li key={a.id}>
            <strong>{titles[a.entryObjectId] ?? "an entry"}</strong> — {a.judge.displayName}
            <ul>{a.criteria.map((c) => <li key={c.criterion}>{c.criterion}: <b className="xr-mono">{c.mark === null ? "not marked" : c.mark === "yes" ? "✓" : c.mark === "no" ? "–" : c.mark}</b>{c.note ? ` — ${c.note}` : ""}</li>)}</ul>
            {a.note && <p>{a.note}</p>}
            <small>saw: {a.inspected.verdict}{a.inspected.density ? ` · ${a.inspected.density}` : ""} · {a.inspected.modelEvents} model events</small>
          </li>
        ))}
        {assessments.length === 0 && <li className="xr-organizer__quiet">None yet. A judge's file dropped on this World is verified and added here.</li>}
      </ul>

      <h3>Results <small>placings as you write them, in your order</small></h3>
      {results ? (
        <div className="xr-organizer__results">
          <ol>{results.body.placings.map((p) => <li key={`${p.place}-${p.entryId}`}><strong>{p.place}</strong> — {results.body.finalists.find((f) => f.entryId === p.entryId)?.title ?? "an entry"}: {p.reason}</li>)}</ol>
          <p className="xr-organizer__quiet">Signed {new Date(results.body.publishedAt).toISOString().slice(0, 10)} · {results.body.assessmentsRead} assessments read · every finalist carries its process record and verdict.</p>
          <button type="button" className="xr-button" onClick={() => void act(async () => { const r = await bridge?.judging?.exportResults(worldId); if (r) setNotice(`Results written to ${r.path}`); })}>Export results file</button>
        </div>
      ) : (
        <form className="xr-organizer__placings" onSubmit={(e) => {
          e.preventDefault();
          const rows: Placing[] = placings.filter((p) => p.place.trim() && p.entryId && p.reason.trim())
            .map((p) => ({ place: p.place.trim(), entryId: p.entryId, objectId: titleOf(p.entryId)?.objectId ?? "", reason: p.reason.trim() }));
          void act(async () => { await bridge?.judging?.publishResults(worldId, rows, note.trim()); });
        }}>
          {placings.map((p, i) => (
            <div key={i} className="xr-organizer__placing">
              <input value={p.place} onChange={(e) => setPlacings((rows) => rows.map((r, j) => j === i ? { ...r, place: e.target.value } : r))} placeholder="First · Special mention · …" aria-label="Placing" />
              <select value={p.entryId} onChange={(e) => setPlacings((rows) => rows.map((r, j) => j === i ? { ...r, entryId: e.target.value } : r))} aria-label="Entry">
                <option value="">— entry —</option>
                {entries.map((en) => <option key={en.id} value={en.id}>{titles[en.objectId] ?? en.objectId.slice(0, 8)} · {en.publisher.displayName}</option>)}
              </select>
              <input value={p.reason} onChange={(e) => setPlacings((rows) => rows.map((r, j) => j === i ? { ...r, reason: e.target.value } : r))} placeholder="Why, in a sentence" aria-label="Reason" />
            </div>
          ))}
          <div className="xr-organizer__placing-actions">
            <button type="button" className="xr-button" onClick={() => setPlacings((rows) => [...rows, { place: "", entryId: "", reason: "" }])}>Add a placing</button>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note with the results, if you want one." aria-label="Results note" rows={2} />
            <button type="submit" className="xr-button xr-button--primary" disabled={!status.judgingOpenedAt}>Publish results</button>
          </div>
        </form>
      )}

      <table className="xr-judging__limits" aria-label="What the record can and cannot establish">
        <tbody>{RECORD_LIMITS.map((r) => <tr key={r.what}><th scope="row">{r.what}</th><td>{r.is}</td><td>{r.goesAsFar}</td></tr>)}</tbody>
      </table>
    </section>
  );
}
