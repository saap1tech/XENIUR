import { useCallback, useEffect, useState } from "react";
import type { ComputeQuote, EconomySnapshot, ObjectDetail, SystemInfo, Task, World as WorldRow, WorldSnapshot } from "@xeniur/core";
import { Home, type HomeEntry } from "./Home.js";
import { World } from "./World.js";
import { ObjectView } from "./ObjectView.js";
import { CommandPalette, usePaletteShortcut, type Command } from "./CommandPalette.js";
import { FocusMode } from "./FocusMode.js";
import { BrandMark } from "./BrandMark.js";
import { ComputeReview } from "./ComputeReview.js";
import { WebLayer } from "./WebLayer.js";
import { WorkflowLibrary } from "./WorkflowLibrary.js";

/** A new World, named for the way in rather than for a subsystem. */
const NEW_WORLD: Record<HomeEntry, { title: string; emoji: string }> = {
  import: { title: "New project", emoji: "◻" },
  continue: { title: "New project", emoji: "◻" },
  review: { title: "New project", emoji: "◻" },
};

type View =
  | { kind: "home" }
  | { kind: "world"; snapshot: WorldSnapshot }
  | { kind: "object"; detail: ObjectDetail; worldSnapshot: WorldSnapshot }
  | { kind: "focus"; objectId: string; minutes: number }
  | { kind: "web" }
  | { kind: "workflows" };

export function App() {
  const [worlds, setWorlds] = useState<WorldRow[]>([]);
  const [view, setView] = useState<View>({ kind: "home" });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [economy, setEconomy] = useState<EconomySnapshot | null>(null);
  const [quote, setQuote] = useState<ComputeQuote | null>(null);

  const bridge = window.xeniur;
  usePaletteShortcut(setPaletteOpen);

  const refreshWorlds = useCallback(async () => {
    setWorlds((await bridge?.worlds.list()) ?? []);
  }, [bridge]);

  const refreshTasks = useCallback(async () => {
    setTasks((await bridge?.tasks.active()) ?? []);
  }, [bridge]);

  const openWorld = useCallback(async (worldId: string) => {
    const snapshot = await bridge?.worlds.open(worldId);
    if (snapshot) setView({ kind: "world", snapshot });
  }, [bridge]);

  const openObject = useCallback(async (objectId: string, snapshot?: WorldSnapshot) => {
    const detail = await bridge?.living.detail(objectId);
    const world = snapshot ?? (view.kind === "world" ? view.snapshot
      : view.kind === "object" ? view.worldSnapshot : null);
    if (detail && world) setView({ kind: "object", detail, worldSnapshot: world });
  }, [bridge, view]);

  const refreshObject = useCallback(async () => {
    if (view.kind !== "object") return;
    const detail = await bridge?.living.detail(view.detail.state.object.id);
    if (detail) setView({ ...view, detail });
  }, [bridge, view]);

  useEffect(() => {
    void refreshWorlds();
    void refreshTasks();
    void bridge?.system.info().then(setInfo);
    void bridge?.economy.snapshot().then(setEconomy);
  }, [bridge, refreshWorlds, refreshTasks]);

  // Task events are pushed by the queue. Focus Mode deliberately ignores them.
  useEffect(() => {
    return bridge?.tasks.onEvent((_event, task) => {
      if (view.kind === "focus") return;
      void refreshTasks();
      const t = task as Task;
      if (view.kind === "world" && t.worldId === view.snapshot.world.id &&
          (t.status === "completed" || t.status === "failed")) {
        void openWorld(view.snapshot.world.id);
        if (t.status === "failed") setNotice(t.error ?? "That step failed.");
      }
      if (view.kind === "object" && (t.status === "completed" || t.status === "failed")) {
        void refreshObject();
      }
    });
  }, [bridge, view, refreshTasks, openWorld, refreshObject]);

  const submit = useCallback(async (utterance: string, selection: string[]) => {
    if (view.kind !== "world" || !bridge) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await bridge.intent.submit({
        worldId: view.snapshot.world.id, utterance, selection,
      });
      if (!result.accepted) setNotice(result.error ?? "I could not plan that.");
      if (result.quote) setQuote(result.quote);
      await refreshTasks();
    } finally { setBusy(false); }
  }, [bridge, view, refreshTasks]);

  const approve = useCallback(async (taskId: string) => {
    await bridge?.tasks.approve(taskId); await refreshTasks();
  }, [bridge, refreshTasks]);

  const reject = useCallback(async (taskId: string) => {
    await bridge?.tasks.reject(taskId); await refreshTasks();
  }, [bridge, refreshTasks]);

  /** Commands follow what is on screen, so nothing is offered that would fail. */
  const commands: Command[] = [
    ...worlds.map((w): Command => ({
      id: `open-${w.id}`, group: "Worlds", label: `Open ${w.title}`, hint: w.emoji,
      run: () => openWorld(w.id),
    })),
    { id: "home", group: "Go", label: "Back to Worlds", run: () => setView({ kind: "home" }) },
  ];

  if (view.kind === "object") {
    const id = view.detail.state.object.id;
    commands.unshift(
      { id: "rebuild", group: "This object", label: "Rebuild what is out of date",
        hint: `${view.detail.steps.filter((s) => s.state !== "fresh").length} stale`,
        run: async () => { await bridge?.living.rebuild(id, false); await refreshObject(); } },
      { id: "validate", group: "This object", label: "Re-run the checks",
        run: async () => { await bridge?.living.validate(id); await refreshObject(); } },
      { id: "undo", group: "This object", label: "Undo",
        run: async () => { await bridge?.objects.undo(id); await refreshObject(); } },
      { id: "redo", group: "This object", label: "Redo",
        run: async () => { await bridge?.objects.redo(id); await refreshObject(); } },
      { id: "export", group: "This object", label: "Export .xeniur",
        run: async () => {
          const result = await bridge?.living.exportPackage(id);
          if (result) setNotice(`Exported to ${result.path}`);
        } },
      { id: "focus", group: "This object", label: "Enter Focus Mode",
        hint: "quiets XENIUR only",
        run: () => setView({ kind: "focus", objectId: id, minutes: 25 }) },
    );
  }

  if (!bridge) {
    if (window.location.hostname === "localhost" && new URLSearchParams(window.location.search).has("visual-preview")) {
      const now = Date.now();
      const sampleWorlds: WorldRow[] = [
        { id: "11111111-1111-4111-8111-111111111111", title: "Rainwear 2027", emoji: "◒", summary: "Interview → decision → jacket → delivery", createdAt: now, lastOpenedAt: now },
        { id: "22222222-2222-4222-8222-222222222222", title: "Tokyo / April", emoji: "⌁", summary: "People · places · priorities · cost", createdAt: now, lastOpenedAt: now },
        { id: "33333333-3333-4333-8333-333333333333", title: "XR Identity", emoji: "XR", summary: "Logo · typography · voice · process", createdAt: now, lastOpenedAt: now },
      ];
      return <Home worlds={sampleWorlds} active={[]} info={{ version: "0.1", brainIsMock: true, brainModel: null, capabilities: [] }}
        economy={{ local: { metered: false, label: "Unlimited Local" }, intelligence: { configured: true, rollingRemaining: 938, rollingLimit: 1000, reserveRemaining: 4800, reserveLimit: 5000, resetsAt: now }, compute: { configured: true, balance: 524, usdPerCompute: .02, held: 0 } }}
        onOpen={() => undefined} onCreate={() => undefined} onApprove={() => undefined} onReject={() => undefined} onExplore={() => undefined} onWorkflows={() => undefined} />;
    }
    return <main className="xr-home"><BrandMark />
      <p className="xr-empty">The bridge is unavailable. This window is not XENIUR's own renderer.</p>
    </main>;
  }

  // Focus Mode replaces everything, deliberately: chrome that is merely hidden is chrome
  // that comes back the moment something happens.
  if (view.kind === "focus") {
    return (
      <FocusMode
        objectId={view.objectId} minutes={view.minutes}
        onExit={() => { void openWorld(worlds[0]?.id ?? ""); setView({ kind: "home" }); }}
      />
    );
  }

  return (
    <>
      {notice && (
        <div className="xr-notice" role="status">
          {notice}<button type="button" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <CommandPalette commands={commands} open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {quote && <ComputeReview quote={quote} busy={busy} onCancel={() => {
        void bridge.economy.cancel(quote.id); setQuote(null);
      }} onConfirm={async () => {
        setBusy(true); setNotice(null);
        try { const result = await bridge.economy.confirm(quote.id); setQuote(null); if (!result.accepted) setNotice(result.error ?? "This generation was not queued."); await refreshTasks(); await bridge.economy.snapshot().then(setEconomy); }
        catch (cause) { setNotice(cause instanceof Error ? cause.message : "This estimate could not be confirmed."); }
        finally { setBusy(false); }
      }} />}

      {view.kind === "web" ? <WebLayer worlds={worlds} onBack={() => setView({ kind: "home" })} />
      : view.kind === "workflows" ? <WorkflowLibrary onBack={() => setView({ kind: "home" })} onApplied={(worldId) => { void refreshWorlds(); void openWorld(worldId); }} />
      : view.kind === "object" ? (
        <ObjectView
          detail={view.detail} busy={busy}
          onRefresh={() => { void refreshObject(); }}
          onBack={() => setView({ kind: "world", snapshot: view.worldSnapshot })}
        />
      ) : view.kind === "world" ? (
        <World
          snapshot={view.snapshot} tasks={tasks} busy={busy}
          onBack={() => setView({ kind: "home" })}
          onOpenObject={(id) => { void openObject(id, view.snapshot); }}
          onSubmit={submit} onApprove={approve} onReject={reject}
        />
      ) : (
        <Home
          worlds={worlds} active={tasks} info={info}
          economy={economy}
          onOpen={(id) => { void openWorld(id); }}
          onCreate={async (entry) => {
            // "Review changes" is not a new project: it opens the one that has changes.
            if (entry === "review" || entry === "continue") {
              const first = worlds[0];
              if (first) { void openWorld(first.id); return; }
            }
            const created = await bridge.worlds.create(NEW_WORLD[entry]);
            await refreshWorlds();
            await openWorld(created.id);
          }}
          onApprove={approve} onReject={reject}
          onExplore={() => setView({ kind: "web" })}
          onWorkflows={() => setView({ kind: "workflows" })}
        />
      )}
    </>
  );
}
