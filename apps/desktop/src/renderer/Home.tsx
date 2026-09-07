import type { SystemInfo, Task, World } from "@xeniur/core";

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** The three ways in. Not modes, not subsystems — what a person came here to do. */
const ENTRIES = [
  { key: "import", label: "Bring something in" },
  { key: "continue", label: "Continue work" },
  { key: "review", label: "Review changes" },
] as const;

export type HomeEntry = typeof ENTRIES[number]["key"];

/**
 * Projects, and the few things that need you.
 *
 * Not a dashboard and not a feed. Large plain cards for the Worlds a person is actually
 * working in, three ways to start, and beneath them a thin strip carrying **only what
 * needs attention** — a parked approval, a pending manual step, an unreviewed decision.
 *
 * Nothing that is merely running appears here, and nothing that is merely finished. A
 * home screen that lists everything happening is a home screen a person has to read, and
 * the whole point is that most of the time there is nothing to do.
 */
export function Home({ worlds, active, info, onOpen, onCreate, onApprove, onReject }: {
  worlds: World[];
  active: Task[];
  info: SystemInfo | null;
  onOpen(worldId: string): void;
  onCreate(entry: HomeEntry): void;
  onApprove(taskId: string): void;
  onReject(taskId: string): void;
}) {
  // Only what a person can act on. Running and completed tasks are not attention —
  // they are noise wearing attention's clothes.
  const needsYou = active.filter((t) => t.status === "needs_approval" || t.status === "failed");

  return (
    <main className="xr-home">
      <header className="xr-home__head">
        <h1>{greeting()}</h1>
      </header>

      <nav className="xr-home__entries">
        {ENTRIES.map((e) => (
          <button key={e.key} type="button" className="xr-entry" onClick={() => onCreate(e.key)}>
            {e.label}
          </button>
        ))}
      </nav>

      <section className="xr-worlds">
        {worlds.map((world) => (
          <button key={world.id} type="button" className="xr-world-card" onClick={() => onOpen(world.id)}>
            <span className="xr-world-card__emoji">{world.emoji}</span>
            <span className="xr-world-card__title xr-display">{world.title}</span>
          </button>
        ))}
        {worlds.length === 0 && <p className="xr-empty">Nothing here yet. Bring something in.</p>}
      </section>

      <section className="xr-attention">
        <h2>Needs you</h2>
        {needsYou.length === 0
          ? <p className="xr-empty">Nothing is waiting on you.</p>
          : (
            <ul>
              {needsYou.map((task) => (
                <li key={task.id} className="xr-attention__item">
                  <span className="xr-attention__what">{task.title}</span>
                  <span>{task.status === "failed" ? (task.error ?? "did not finish") : (task.detail ?? "")}</span>
                  {task.status === "needs_approval" && (
                    <span className="xr-active__actions">
                      <button type="button" className="xr-button xr-button--primary"
                        onClick={() => onApprove(task.id)}>Look at it</button>
                      <button type="button" className="xr-button" onClick={() => onReject(task.id)}>Decline</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      {info?.brainIsMock && (
        <footer className="xr-mockbar">
          Running on the deterministic mock Brain — no model is being called, and nothing
          generated here is real model output.
        </footer>
      )}
    </main>
  );
}
