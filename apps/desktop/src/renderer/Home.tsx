import type { EconomySnapshot, SystemInfo, Task, World } from "@xeniur/core";
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

export function Home({ worlds, active, info, economy, onOpen, onCreate, onApprove, onReject, onExplore, onWorkflows }: {
  worlds: World[]; active: Task[]; info: SystemInfo | null; economy: EconomySnapshot | null;
  onOpen(worldId: string): void; onCreate(entry: HomeEntry): void; onApprove(taskId: string): void; onReject(taskId: string): void; onExplore(): void; onWorkflows(): void;
}) {
  const needsYou = active.filter((task) => task.status === "needs_approval" || task.status === "failed");
  const situations = active.filter((task) => !["completed", "cancelled"].includes(task.status));
  const worldName = (worldId: string) => worlds.find((world) => world.id === worldId)?.title ?? "Unknown World";
  return <main className="xr-home xr-home--next">
    <nav className="xr-site-nav"><BrandMark /><p>The visual interface between humans<br />and digital capability.</p><div><button type="button" onClick={onExplore}><Globe2 size={15} /> Protected Web</button><button type="button" onClick={onWorkflows}><Layers3 size={15} /> Workflows</button></div></nav>
    <section className="xr-home-workbench" aria-labelledby="workbench-title">
      <header className="xr-home-workbench__head"><div><small>Your visual workspace</small><h1 id="workbench-title">Work in view.</h1><p>Open a World and continue from its current situation.</p></div><div className="xr-home-workbench__actions"><button type="button" className="xr-button xr-button--primary" onClick={() => onCreate("import")}><Plus size={17} /> New World</button><button type="button" className="xr-text-action" onClick={onExplore}>Bring in a source <ArrowRight size={15} /></button></div></header>
      <div className="xr-home-workbench__grid">
        <section className="xr-project-section"><header><div><small>Living work</small><h2>Your Worlds</h2></div><span>{worlds.length} on this machine</span></header>
          <div className="xr-folder-grid">{worlds.map((world, index) => <FolderCard key={world.id} index={index} title={world.title} subtitle={world.summary || "Research, decisions, outcomes"} count={world.emoji} countLabel="" onClick={() => onOpen(world.id)} />)}
            {worlds.length === 0 && <button type="button" className="xr-empty-world" onClick={() => onCreate("import")}><b>+</b><span>Begin with a source, a thought, or a thing.</span></button>}</div></section>
        <aside className="xr-situation-board" aria-labelledby="situations-title"><header><Workflow size={19} /><div><small>Now happening</small><h2 id="situations-title">Active situations</h2></div></header>
          {situations.length === 0 ? <div className="xr-situation-board__empty"><strong>No work is running.</strong><p>Open a World to continue with its Objects, choices, and next visible action.</p></div> : <ul>{situations.map((task) => <li key={task.id} className={`is-${task.status}`}><button type="button" onClick={() => onOpen(task.worldId)}><small>{worldName(task.worldId)}</small><strong>{task.title}</strong><span>{task.status.replaceAll("_", " ")}{task.detail ? ` / ${task.detail}` : ""}</span></button>{task.status === "needs_approval" && <div><button type="button" className="xr-button xr-button--primary" onClick={() => onApprove(task.id)}>Review</button><button type="button" className="xr-button" onClick={() => onReject(task.id)}>Decline</button></div>}</li>)}</ul>}
          <footer><span>Language is available inside each World as a shortcut.</span><kbd>⌘ K</kbd></footer>
        </aside>
      </div>
    </section>
    <EconomyBand value={economy} />
    {needsYou.length > 0 && <p className="xr-home-attention-note" role="status">{needsYou.length} situation{needsYou.length === 1 ? "" : "s"} need human judgment. They are shown in Active situations.</p>}
    <footer className="xr-home-footer"><span>MADE WITH JUDGMENT</span><h2>Shape meaning.<br />Keep the history.</h2><p>XENIUR records research, choices, manual work, revisions, and model-touched steps. It does not estimate unrecorded effort or claim originality.</p>{info?.brainIsMock && <small>Deterministic Brain / no model requests are being made</small>}</footer>
  </main>;
}
