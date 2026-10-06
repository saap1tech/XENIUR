import { useEffect, useRef, useState } from "react";
import type { EconomySnapshot, ResumeCard, SystemInfo, Task, Today, TodayRow, TrustFacts, World } from "@xeniur/core";
import { ArrowRight, ArrowUpRight, Check, FolderOpen, Globe2, Layers3, Plus, Search, Settings2, Sparkles } from "lucide-react";
import { BrandMark } from "./BrandMark.js";
import { ProjectIllustration } from "./ProjectIllustration.js";

export type HomeEntry = "import" | "continue" | "review";

/** How long ago, in the words a person would use; exact dates only once it is more than a week. */
export function sinceWords(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Three honest ways to put a goal into words, so an empty field is never the first obstacle. */
const GOAL_EXAMPLES = ["Plan a week in Lisbon", "Compare two laptops", "Write up my experiment"];
const PROJECTS_SHOWN = 6;

export function Home({ worlds, active, info, economy, today, trust, onOpen, onOpenSituation, onContinue, onStart, onCreate, onReject, onDismissArrival, onExplore, onWorkflows, onModels, onCommand }: {
  worlds: World[]; active: Task[]; info: SystemInfo | null; economy: EconomySnapshot | null; today: Today | null;
  trust: Readonly<Record<string, TrustFacts>>;
  onOpen(worldId: string): void; onOpenSituation(row: TodayRow): void;
  onContinue(card: ResumeCard, objectId?: string | null): void;
  onStart(outcome: string): void; onCreate(entry: HomeEntry): void;
  onReject(taskId: string): void; onDismissArrival(challengeWorldId: string): void;
  onExplore(): void; onWorkflows(): void; onModels?(): void;
  /** Opens the command palette: every project and action, by name. */
  onCommand?(): void;
}) {
  void active; void economy;
  const [starting, setStarting] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [allProjects, setAllProjects] = useState(false);
  const goalInput = useRef<HTMLInputElement>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const projects = [...worlds.filter((w) => w.summary !== "__xeniur_settings__")]
    .sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt));
  useEffect(() => {
    let current = true;
    const ids = projects.map((project) => project.id);
    void window.xeniur?.worlds.covers?.(ids).then((found) => { if (current) setCovers(found); }).catch(() => { if (current) setCovers({}); });
    return () => { current = false; };
    // The cover list follows changes to the project list, not changes to local UI controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worlds]);
  const situations = today?.rows ?? [];
  const visibleSituations = showAll ? situations : situations.slice(0, 3);
  const resume = today?.resume;
  const shownProjects = allProjects ? projects : projects.slice(0, PROJECTS_SHOWN);
  const closeStart = () => { setStarting(false); setOutcome(""); };
  useEffect(() => {
    if (!starting) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") closeStart(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [starting]);
  const pending = situations.length + (today?.more ?? 0);
  return <main className="xr-haven">
    <header className="xr-haven__nav"><BrandMark />
      <nav aria-label="Workspace">{onCommand && <button type="button" className="xr-haven__find" title="Find a project or action" onClick={onCommand}><Search size={17} /><span>Find anything</span><kbd>⌘K</kbd></button>}<button type="button" title="Explore the web" onClick={onExplore}><Globe2 size={18} /><span>Explore</span></button>
        <button type="button" title="Workflows" onClick={onWorkflows}><Layers3 size={18} /><span>Workflows</span></button>
        <button type="button" title="AI connections" onClick={onModels}><Settings2 size={18} /><span>Settings</span></button></nav>
    </header>
    <div className="xr-haven__body">
      <section className="xr-haven__hero" aria-label="Continue your work">
        <div className="xr-haven__copy"><small>Your workspace</small>
          <h1>{resume ? <>Your next<br /><em>move.</em></> : <>Make room<br /><em>for your work.</em></>}</h1>
          {resume ? <><p className="xr-haven__resume-name">{resume.worldTitle}<small>{sinceWords(resume.lastActiveAt)}</small></p><p className="xr-haven__resume-detail">{resume.fragments.map((fragment, index) => fragment.objectId
            ? <button key={index} type="button" className="xr-haven__resume-link" onClick={() => onContinue(resume, fragment.objectId)}>{fragment.text}</button>
            : <span key={index}>{fragment.text}</span>)}</p>
            <button type="button" className="xr-haven__primary" onClick={() => onContinue(resume)}>Continue project <ArrowRight size={18} /></button></>
            : <><p className="xr-haven__resume-detail">Start with a goal. Build at your pace.</p>
              <button type="button" className="xr-haven__primary" onClick={() => setStarting(true)}>Start a project <ArrowRight size={18} /></button></>}
        </div>
        <div className="xr-haven__landscape"><ProjectIllustration /></div>
        <span className="xr-haven__hero-index">Think · Make · Grow</span>
      </section>

      <section className="xr-haven__now" aria-labelledby="haven-now"><div className="xr-haven__section-head"><div><small>Today</small><h2 id="haven-now">Your next steps</h2></div>{pending > 0 && <span>{pending} waiting on you</span>}</div>
        {today === null ? <p className="xr-haven__quiet">Reading your projects…</p>
          : situations.length === 0 ? <div className="xr-haven__allclear"><span><Check size={23} /></span><div><strong>No pending requests</strong><small>Continue your project when you’re ready.</small></div></div>
          : <div className="xr-haven__situations">{visibleSituations.map((row) => {
            const taskId = row.id.startsWith("task:") ? row.id.slice(5) : null;
            return <article key={row.id} className="xr-haven__situation"><span className="xr-haven__situation-glyph" aria-hidden="true">{row.glyph}</span>
              <button type="button" className="xr-haven__situation-main" onClick={() => onOpenSituation(row)} disabled={row.worldId === null && row.objectId === null && row.kind !== "rhythm"}><strong>{row.text}</strong>{row.worldTitle && <small>{row.worldTitle}</small>}</button>
              {row.verb && <button type="button" className="xr-haven__situation-action" onClick={() => onOpenSituation(row)}>{taskId ? "Review" : row.verb}<ArrowRight size={15} /></button>}
              {taskId && <button type="button" className="xr-haven__situation-secondary" onClick={() => onReject(taskId)}>Decline</button>}
              {row.kind === "challenge_arrival" && row.worldId && <button type="button" className="xr-haven__situation-secondary" onClick={() => onDismissArrival(row.worldId!)}>Not for me</button>}
            </article>;
          })}</div>}
        {situations.length > 3 && <button type="button" className="xr-haven__more" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show less" : `See ${situations.length - 3} more`}</button>}
        {!!today?.more && <p className="xr-haven__quiet">{today.more} more in your projects</p>}
      </section>

      <section className="xr-haven__projects" aria-labelledby="haven-projects"><div className="xr-haven__section-head"><div><small>Your work</small><h2 id="haven-projects">Projects</h2></div>{projects.length > 0 && <span>{projects.length} {projects.length === 1 ? "project" : "projects"}</span>}</div>
        <div className="xr-haven__project-grid">
          <button type="button" className="xr-haven__new" onClick={() => setStarting(true)}><span className="xr-haven__new-icon"><Plus size={29} /></span><strong>Start something</strong><small>An idea or goal</small></button>
          <button type="button" className="xr-haven__new xr-haven__new--import" onClick={() => onCreate("import")}><span className="xr-haven__new-icon"><FolderOpen size={27} /></span><strong>Add material</strong><small>Files, notes, or links</small></button>
          {shownProjects.map((project, index) => <button type="button" key={project.id} className={`xr-haven__project xr-haven__project--${index % 4}`} onClick={() => onOpen(project.id)} aria-label={`Open ${project.title}`}>
            <span className="xr-haven__project-art" aria-hidden="true"><i /><i /><i />{covers[project.id] &&
              <img src={window.xeniur?.blobs.url(covers[project.id]!) ?? ""} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</span>
            <span className="xr-haven__project-meta"><small>{project.lastOpenedAt ? `Opened ${sinceWords(project.lastOpenedAt).toLowerCase()}` : "Not opened yet"}</small><ArrowUpRight size={17} /></span>
            <strong>{project.title}</strong><span className="xr-haven__project-bottom"><span>{project.summary || "Make the next move"}</span>{trust[project.id]?.settled && <Check size={17} />}</span>
          </button>)}
        </div>
        {projects.length > PROJECTS_SHOWN && <button type="button" className="xr-haven__more" onClick={() => setAllProjects((value) => !value)}>{allProjects ? "Show fewer projects" : `Show all ${projects.length} projects`}</button>}
      </section>
      <footer className="xr-haven__foot"><span><Sparkles size={15} /> Your judgment stays in the loop.</span>{info?.brainModel ? <span>AI thinking is ready</span>
        : <button type="button" className="xr-haven__foot-action" onClick={onModels}>Working locally · Connect AI<ArrowRight size={14} /></button>}</footer>
    </div>
    {starting && <div className="xr-haven__modal" role="dialog" aria-modal="true" aria-labelledby="haven-new-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeStart(); }}><form onSubmit={(event) => { event.preventDefault(); if (outcome.trim()) { onStart(outcome.trim()); closeStart(); } }}><button type="button" className="xr-haven__modal-close" onClick={closeStart} aria-label="Close">×</button><small>NEW PROJECT</small><h2 id="haven-new-title">What are you working toward?</h2><input ref={goalInput} autoFocus aria-label="Your goal" value={outcome} onChange={(event) => setOutcome(event.target.value)} placeholder="In your own words…" maxLength={300} />
      <ul className="xr-haven__examples" aria-label="Examples">{GOAL_EXAMPLES.map((example) => <li key={example}><button type="button" onClick={() => { setOutcome(example); goalInput.current?.focus(); }}>{example}</button></li>)}</ul>
      <p className="xr-haven__modal-hint">One sentence is enough. You can change it later; the project is named after it.</p>
      <div><button type="button" onClick={closeStart}>Not now</button><button type="submit" disabled={!outcome.trim()}>Begin <ArrowRight size={16} /></button></div></form></div>}
  </main>;
}
