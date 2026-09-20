import { useState } from "react";
import type { CriterionMark, JudgingSheetData, LeafSceneNode } from "@xeniur/core";
import { CANNOT_ESTABLISH, COMPLIANCE_GLYPHS, JUDGING_SCALE_WORDS, RECORD_LIMITS } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Button, Tag } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * Judging as a Scene.
 *
 * *ARENA · ENTRY 07 · Process review.* The deliverable's forms at the top; **How this came
 * together** as four slots — Research · Decisions · Build · Delivery; **Recorded AI
 * activity** as rows; **Observation status** as the verdict and the record density; and,
 * always, **What the record cannot establish** — three rows, the same on every surface.
 *
 * The judge marks each criterion on the publisher's scale, writes a note, records, moves
 * on. Nothing here sums; the entry number is its place in the arrival order, not a rank.
 */
export function JudgingSheet({ node, bindings }: { node: Node<"JudgingSheet">; bindings: SceneBindings }) {
  const s = bindings.judgingSheets?.[node.entryId];
  if (!s) return null;
  return <Sheet s={s} bindings={bindings} />;
}

function Sheet({ s, bindings }: { s: JudgingSheetData; bindings: SceneBindings }) {
  const scale = JUDGING_SCALE_WORDS[s.scale];
  const [marks, setMarks] = useState<Record<string, CriterionMark["mark"]>>(() =>
    Object.fromEntries(s.criteria.map((c) => [c, s.own?.criteria.find((m) => m.criterion === c)?.mark ?? null])));
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(s.criteria.map((c) => [c, s.own?.criteria.find((m) => m.criterion === c)?.note ?? ""])));
  const [note, setNote] = useState(s.own?.note ?? "");
  const g = COMPLIANCE_GLYPHS[s.observation.verdict];
  const n = String(s.entryNumber).padStart(2, "0");

  return (
    <section className="xr-judging" aria-labelledby={`judging-${s.entryId.slice(0, 8)}`}>
      <header className="xr-judging__head">
        <small className="xr-judging__eyebrow xr-mono">ARENA · ENTRY {n} of {s.entryCount} · Process review</small>
        <h2 id={`judging-${s.entryId.slice(0, 8)}`}>{s.title}</h2>
        <span className="xr-judging__who">by {s.participant.displayName}</span>
      </header>

      <div className="xr-judging__forms" aria-label="The deliverable">
        {s.forms.length === 0 ? <p className="xr-judging__quiet">No forms are recorded for this entry.</p>
          : s.forms.map((f) => (
            <button key={f.role} type="button" className="xr-judging__form" onClick={() => bindings.onSelect?.(s.entryObjectId)}>
              <strong>{f.role}</strong><span>{f.modality} · {f.provenance}</span>
            </button>
          ))}
      </div>

      <h3 className="xr-judging__h">How this came together</h3>
      <div className="xr-judging__slots">
        <Slot label="Research">
          <Fact n={s.research.sources} word="source" /><Fact n={s.research.claims} word="claim" />
          <Fact n={s.research.supported} word="supported" plural="supported" /><Fact n={s.research.contradicted} word="contradicted" plural="contradicted" />
          <Fact n={s.research.unresolved} word="unresolved" plural="unresolved" />
        </Slot>
        <Slot label="Decisions">
          <Fact n={s.decisions.accepted} word="accepted decision" />
          <Fact n={s.decisions.withSteelman} word="with a steelman" plural="with a steelman" />
          <Fact n={s.decisions.chosenDespite} word="chosen despite uncertainty" plural="chosen despite uncertainty" />
        </Slot>
        <Slot label="Build">
          <Fact n={s.build.versions} word="version" />
          <Fact n={s.build.human} word="human step" /><Fact n={s.build.tool} word="tool step" /><Fact n={s.build.model} word="model step" />
        </Slot>
        <Slot label="Delivery">
          <span className="xr-judging__fact">{s.delivery.released ? "released" : "not released"}</span>
          <Tag role="status" variant={s.delivery.verdict === "complies" ? "ok" : s.delivery.verdict === "violates" ? "review" : "blocked"}>
            <span aria-hidden="true">{g.glyph}</span> {g.word}
          </Tag>
        </Slot>
      </div>

      <h3 className="xr-judging__h">Recorded AI activity</h3>
      {s.aiActivity.length === 0 ? <p className="xr-judging__quiet">No model step is in the record.</p> : (
        <ol className="xr-judging__ai">
          {s.aiActivity.map((e, i) => (
            <li key={`${e.at}-${i}`}><span className="xr-mono">{new Date(e.at).toISOString().slice(11, 16)}</span> {e.kind.replaceAll("_", " ")}{e.tool ? ` · ${e.tool}` : ""}{e.model ? ` · ${e.model}` : ""} — {e.label}</li>
          ))}
        </ol>
      )}

      <h3 className="xr-judging__h">Observation status</h3>
      <div className="xr-judging__status">
        <Tag role="status" variant={s.observation.verdict === "complies" ? "ok" : s.observation.verdict === "violates" ? "review" : "blocked"}>
          <span aria-hidden="true">{g.glyph}</span> {g.word}
        </Tag>
        {s.observation.density ? <span>{s.observation.density}</span> : <span className="xr-judging__quiet">No Sealed Session covered this entry.</span>}
        {s.delivery.because.length > 0 && s.observation.verdict !== "complies" && (
          <ul className="xr-judging__because">{s.delivery.because.map((b) => <li key={b}>{b}</li>)}</ul>
        )}
        {s.proofRoot && <span className="xr-judging__root xr-mono">process record {s.proofRoot.slice(0, 12)}…</span>}
      </div>

      <h3 className="xr-judging__h">What the record cannot establish</h3>
      <table className="xr-judging__limits">
        <tbody>
          {RECORD_LIMITS.map((r) => <tr key={r.what}><th scope="row">{r.what}</th><td>{r.is}</td><td>{r.goesAsFar}</td></tr>)}
        </tbody>
      </table>
      <p className="xr-judging__cannot">{CANNOT_ESTABLISH}</p>

      <h3 className="xr-judging__h">Your assessment <small>{scale.label}</small></h3>
      <div className="xr-judging__criteria">
        {s.criteria.map((c) => (
          <div key={c} className="xr-judging__criterion">
            <span className="xr-judging__criterion-name">{c}</span>
            <div className="xr-judging__marks" role="radiogroup" aria-label={`${c}: ${scale.label}`}>
              {scale.marks.map((m) => (
                <button key={String(m)} type="button" role="radio" aria-checked={marks[c] === m}
                  className={`xr-judging__mark${marks[c] === m ? " is-on" : ""}`}
                  onClick={() => setMarks((prev) => ({ ...prev, [c]: prev[c] === m ? null : (m as CriterionMark["mark"]) }))}>
                  {m === "yes" ? "✓" : m === "no" ? "–" : m}
                </button>
              ))}
            </div>
            <input className="xr-judging__note" value={notes[c] ?? ""} placeholder="A note, in your words" aria-label={`Note on ${c}`}
              onChange={(e) => setNotes((prev) => ({ ...prev, [c]: e.target.value }))} />
          </div>
        ))}
        <textarea className="xr-judging__overall" value={note} placeholder="Overall, what you saw and what you did not." aria-label="Overall note"
          onChange={(e) => setNote(e.target.value)} rows={3} />
      </div>

      <footer className="xr-judging__verbs">
        <Button onClick={() => bindings.onSelect?.(s.entryObjectId)}>Inspect evidence</Button>
        <Button variant="primary" onClick={() => bindings.onRecordAssessment?.(s.challengeWorldId, s.entryId,
          s.criteria.map((c) => ({ criterion: c, mark: marks[c] ?? null, note: notes[c] ?? "" })), note)}>
          {s.own ? "Record again" : "Record assessment"}
        </Button>
        <Button onClick={() => bindings.onNextEntry?.(s.challengeWorldId, s.entryId)} disabled={s.entryNumber >= s.entryCount}>Next entry</Button>
        {s.own && <span className="xr-judging__recorded">recorded {new Date(s.own.recordedAt).toISOString().slice(0, 16).replace("T", " ")}, signed by you</span>}
      </footer>
    </section>
  );
}

function Slot({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="xr-judging__slot"><h4>{label}</h4><div className="xr-judging__facts">{children}</div></div>;
}

function Fact({ n, word, plural }: { n: number; word: string; plural?: string }) {
  return <span className="xr-judging__fact"><b className="xr-mono">{n}</b> {n === 1 ? word : plural ?? `${word}s`}</span>;
}
