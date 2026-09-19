import type { EconomySnapshot, SystemInfo, Task, Today, TodayRow, TrustFacts, World } from "@xeniur/core";
import { SUPPORT_GLYPHS, describeTrust } from "@xeniur/core";
import { ArrowRight, Globe2, Layers3, Plus, Workflow } from "lucide-react";
import { BrandMark } from "./BrandMark.js";
import { FolderCard } from "./components/ui/folder-card.js";

const ENTRIES = [{ key: "import", label: "Bring something in" }, { key: "continue", label: "Continue work" }, { key: "review", label: "Review changes" }] as const;
export type HomeEntry = typeof ENTRIES[number]["key"];

function EconomyBand({ value }: { value: EconomySnapshot | null }) {
  const intelligence = value?.intelligence; const compute = value?.compute;
  return <section className="xr-economy" aria-label="How XENIUR uses resources">
    <div><small>01 / ON YOUR MACHINE</small><strong>Unlimited Local</strong><span>Scene compilation · graph work · Blender · FFmpeg</span></div>
    <div><small>02 / LIGHT REASONING</small><strong>Included Intelligence</strong><span>{intelligence?.configured ? `${intelligence.rollingRemaining} rolling · ${intelligence.reserveRemaining} reserve` : "Cloud capacity not configured"}</span></div>
    <div><small>03 / COSTLY CREATION</small><strong>Metered Generation</strong><span>{compute?.configured ? `${compute.balance} Compute available` : "Pricing and balance not configured"}</span></div>
  </section>;
}

export function Home({ worlds, active, info, economy, today, trust, onOpen, onOpenSituation, onCreate, onApprove, onReject, onDismissArrival, onExplore, onWorkflows }: {
  worlds: World[]; active: Task[]; info: SystemInfo | null; economy: EconomySnapshot | null;
  /** At most seven situations that need a person. Null while loading; quiet when nothing does. */
  today: Today | null;
  /** Each World's Trust Strip, summed over its Objects. */
  trust: Readonly<Record<string, TrustFacts>>;
  onOpen(worldId: string): void;
  /** A Today row opens its World with focus already on the Object and the zone selected. */
  onOpenSituation(row: TodayRow): void;
  onCreate(entry: HomeEntry): void; onApprove(taskId: string): void; onReject(taskId: string): void;
  onDismissArrival(challengeWorldId: string): void;
  onExplore(): void; onWorkflows(): void;
}) {
  const parkedTaskId = (row: TodayRow) => row.id.startsWith("task:") ? row.id.slice(5) : null;
  void active;
  return <main className="xr-home xr-home--next">
    <nav className="xr-site-nav"><BrandMark /><p>The visual interface between humans<br />and digital capability.</p><div><button type="button" onClick={onExplore}><Globe2 size={15} /> Protected Web</button><button type="button" onClick={onWorkflows}><Layers3 size={15} /> Workflows</button></div></nav>
    <section className="xr-home-workbench" aria-labelledby="workbench-title">
      <header className="xr-home-workbench__head"><div><small>Your visual workspace</small><h1 id="workbench-title">Work in view.</h1><p>Open a World and continue from its current situation.</p></div><div className="xr-home-workbench__actions"><button type="button" className="xr-button xr-button--primary" onClick={() => onCreate("import")}><Plus size={17} /> New World</button><button type="button" className="xr-text-action" onClick={onExplore}>Bring in a source <ArrowRight size={15} /></button></div></header>
      <div className="xr-home-workbench__grid">
        <section className="xr-project-section"><header><div><small>Living work</small><h2>Your Worlds</h2></div><span>{worlds.length} on this machine</span></header>
          <div className="xr-folder-grid">{worlds.filter((w) => w.summary !== "__xeniur_settings__").map((world, index) => <FolderCard key={world.id} index={index} title={world.title} subtitle={world.summary || "Research, decisions, outcomes"} count={world.emoji} countLabel="" trust={trust[world.id] ? <FolderTrust facts={trust[world.id]!} /> : null} onClick={() => onOpen(world.id)} />)}
            {worlds.length === 0 && <button type="button" className="xr-empty-world" onClick={() => onCreate("import")}><b>+</b><span>Begin with a source, a thought, or a thing.</span></button>}</div></section>
        <aside className="xr-today" aria-labelledby="today-title"><header><Workflow size={19} /><div><small>What should I do with my time?</small><h2 id="today-title">Today</h2></div><span className="xr-today__date xr-mono">{today?.date ?? ""}</span></header>
          {today === null ? <div className="xr-today__quiet"><p>Reading your Worlds…</p></div>
            : today.quiet ? <div className="xr-today__quiet"><strong>Nothing needs you.</strong><p>Open a World when you want to; nothing here is waiting.</p></div>
            : <ol className="xr-today__rows">{today.rows.map((row) => {
              const taskId = parkedTaskId(row);
              return <li key={row.id} className={`xr-today__row is-${row.kind}`}>
                <span className="xr-today__glyph" aria-hidden="true">{row.glyph}</span>
                <button type="button" className="xr-today__text" onClick={() => onOpenSituation(row)} disabled={row.worldId === null && row.objectId === null && row.kind !== "rhythm"}>
                  <strong>{row.text}</strong>{row.worldTitle && <small>{row.worldTitle}</small>}
                </button>
                <span className="xr-today__verb">
                  {taskId ? <><button type="button" className="xr-button xr-button--primary" onClick={() => onApprove(taskId)}>Review</button><button type="button" className="xr-button" onClick={() => onReject(taskId)}>Decline</button></>
                    : row.kind === "challenge_arrival" ? <><button type="button" className="xr-button" onClick={() => onOpenSituation(row)}>{row.verb}</button><button type="button" className="xr-button" onClick={() => onDismissArrival(row.worldId!)}>Not for me</button></>
                    : row.verb ? <button type="button" className="xr-button" onClick={() => onOpenSituation(row)}>{row.verb}</button> : null}
                </span>
              </li>;
            })}</ol>}
          {today && !today.quiet && <p className="xr-today__rest">{today.more > 0 ? `${today.more} more behind these, in the Worlds they belong to.` : "Nothing else needs you."}</p>}
          <footer><span>Language is available inside each World as a shortcut.</span><kbd>⌘ K</kbd></footer>
        </aside>
      </div>
    </section>
    <EconomyBand value={economy} />
    <footer className="xr-home-footer"><span>MADE WITH JUDGMENT</span><h2>Shape meaning.<br />Keep the history.</h2><p>XENIUR records research, choices, manual work, revisions, and model-touched steps. It does not estimate unrecorded effort or claim originality.</p>{info?.brainIsMock && <small>Deterministic Brain / no model requests are being made</small>}</footer>
  </main>;
}

/**
 * A World's Trust Strip at Layer 1: five numerals in one line, glyph and count for every
 * state, lime only when every fact is settled. It does not animate into lime; it settles.
 */
function FolderTrust({ facts }: { facts: TrustFacts }) {
  const s = facts.support; const g = SUPPORT_GLYPHS;
  return <span className={`xr-folder__trust${facts.settled ? " is-settled" : ""}`} role="img" aria-label={describeTrust(facts)}>
    <span>{g.supported.glyph} {s.supported}</span><span>{g.ambiguous.glyph} {s.ambiguous}</span>
    <span>{g.unresolved.glyph} {s.unresolved}</span><span>{g.contradicted.glyph} {s.contradicted}</span>
    <span className="xr-folder__trust-sep">·</span><span>{facts.evidence.current}/{facts.evidence.total} current</span>
    <span className="xr-folder__trust-sep">·</span><span>${facts.cost.usd.toFixed(2)}</span>
    {facts.settled && <span className="xr-folder__trust-word">settled</span>}
  </span>;
}
