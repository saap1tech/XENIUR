import { useCallback, useEffect, useState } from "react";
import type { Today, TrustFacts, ComputeQuote, EconomySnapshot, ObjectDetail, SystemInfo, Task, World as WorldRow, WorldSnapshot } from "@xeniur/core";
import { Home, type HomeEntry } from "./Home.js";
import { World } from "./World.js";
import { ObjectView } from "./ObjectView.js";
import { CommandPalette, usePaletteShortcut, type Command } from "./CommandPalette.js";
import { FocusMode } from "./FocusMode.js";
import { FirstRun } from "./FirstRun.js";
import { Models } from "./Models.js";
import { Availability } from "./Availability.js";
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
  | { kind: "world"; snapshot: WorldSnapshot; selection?: string | null; zone?: "sources" | "decisions" | "work" | "deliveries" }
  | { kind: "object"; detail: ObjectDetail; worldSnapshot: WorldSnapshot }
  | { kind: "focus"; objectId: string; minutes: number; worldId: string }
  | { kind: "web" }
  | { kind: "workflows" }
  | { kind: "firstrun" }
  /** Your models, with the sentence that brought the person here and the view to return to. */
  | { kind: "models"; reason: string | null; back: View }
  /** What works here — the runtime's own report, read on open. */
  | { kind: "availability"; back: View };

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

  const [today, setToday] = useState<Today | null>(null);
  const [worldTrust, setWorldTrust] = useState<Record<string, TrustFacts>>({});

  const refreshWorlds = useCallback(async () => {
    const list = (await bridge?.worlds.list()) ?? [];
    setWorlds(list);
    // Today and each World's trust are read once per visit to Home; rows never reorder while open.
    setToday((await bridge?.today?.get()) ?? null);
    const facts: Record<string, TrustFacts> = {};
    for (const w of list) {
      const t = await bridge?.trust?.world(w.id);
      if (t) facts[w.id] = t;
    }
    setWorldTrust(facts);
  }, [bridge]);

  const refreshTasks = useCallback(async () => {
    setTasks((await bridge?.tasks.active()) ?? []);
  }, [bridge]);

  const openWorld = useCallback(async (worldId: string) => {
    const snapshot = await bridge?.worlds.open(worldId);
    if (snapshot) setView({ kind: "world", snapshot });
  }, [bridge]);

  // The world preview lands in the Studio, not on Home.
  useEffect(() => {
    if (window.location.hostname === "localhost" && new URLSearchParams(window.location.search).get("visual-preview") === "world") {
      void bridge?.worlds.list().then((ws) => { if (ws[0]) void openWorld(ws[0].id); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    void bridge?.system.info().then((value) => {
      setInfo(value);
      // The first run is one question, asked once. It is never re-entered from a route.
      if (value?.firstRun) setView({ kind: "firstrun" });
    });
    void bridge?.economy.snapshot().then(setEconomy);
  }, [bridge, refreshWorlds, refreshTasks]);

  /** A new World opened on its drop target — the way in for material and for .xeniur packages alike. */
  const startFromMaterial = useCallback(async () => {
    const created = await bridge?.worlds.create(NEW_WORLD.import);
    await refreshWorlds();
    if (created) await openWorld(created.id);
  }, [bridge, refreshWorlds, openWorld]);

  /** A World named after the goal, with the goal set — no form, no category, no model. */
  const startFromGoal = useCallback(async (outcome: string) => {
    const title = outcome.length > 48 ? `${outcome.slice(0, 47)}…` : outcome;
    const created = await bridge?.worlds.create({ title, emoji: "◻" });
    if (!created) return;
    await bridge?.goals?.create(created.id, outcome);
    await refreshWorlds();
    await openWorld(created.id);
  }, [bridge, refreshWorlds, openWorld]);

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
    { id: "models", group: "Settings", label: "Your models", hint: "keys stay in your keychain",
      run: () => setView((current) => ({ kind: "models", reason: null, back: current })) },
    { id: "availability", group: "Settings", label: "What works here", hint: "available · needs setup · disabled · not implemented",
      run: () => setView((current) => ({ kind: "availability", back: current })) },
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
      { id: "audit", group: "This object", label: "Export audit trail",
        hint: "report · agent trail · ledger · process record, signed",
        run: async () => {
          const result = await bridge?.trust?.auditExport(id);
          if (result) setNotice(`Audit trail written to ${result.path}`);
        } },
      { id: "focus", group: "This object", label: "Enter Focus Mode",
        hint: "quiets XENIUR only",
        run: () => setView({ kind: "focus", objectId: id, minutes: 25, worldId: view.detail.state.object.worldId }) },
    );
  }

  if (!bridge) {
    const preview = window.location.hostname === "localhost" ? new URLSearchParams(window.location.search).get("visual-preview") : null;
    if (preview !== null) {
      const now = Date.now();
      const sampleWorlds: WorldRow[] = [
        { id: "11111111-1111-4111-8111-111111111111", title: "Rainwear 2027", emoji: "◒", summary: "Interview → decision → jacket → delivery", createdAt: now, lastOpenedAt: now, kind: "work", publisherId: null },
        { id: "22222222-2222-4222-8222-222222222222", title: "Tokyo / April", emoji: "⌁", summary: "People · places · priorities · cost", createdAt: now, lastOpenedAt: now, kind: "work", publisherId: null },
        { id: "33333333-3333-4333-8333-333333333333", title: "XR Identity", emoji: "XR", summary: "Logo · typography · voice · process", createdAt: now, lastOpenedAt: now, kind: "work", publisherId: null },
      ];
      return <Home worlds={sampleWorlds} active={[]} info={{ version: "0.1", brainIsMock: true, brainModel: null, capabilities: [], firstRun: false }}
        economy={{ local: { metered: false, label: "Unlimited Local" }, intelligence: { configured: true, rollingRemaining: 938, rollingLimit: 1000, reserveRemaining: 4800, reserveLimit: 5000, resetsAt: now }, compute: { configured: true, balance: 524, usdPerCompute: .02, held: 0 } }}
        today={{ date: "2026-09-16", quiet: false, more: 0, resume: {
          worldId: "11111111-1111-4111-8111-111111111111", worldTitle: "Rainwear 2027", goalId: null, focusObjectId: null, lastActiveAt: now,
          fragments: [{ text: "You were weighing ", objectId: null }, { text: "\"two jacket finishes\"", objectId: "11111111-1111-4111-8111-111111111111" }, { text: " before preparing the next client delivery.", objectId: null }, { text: " One decision needs review after something it rested on changed.", objectId: null }],
        }, rows: [
          { id: "task:1", kind: "parked_approval", glyph: "▲", text: "Delivery 02 parked — $0.12 quote awaiting you", worldId: "22222222-2222-4222-8222-222222222222", worldTitle: "Launch prop", objectId: null, zone: "work", verb: "Look at it" },
          { id: "decision:1", kind: "decision_review", glyph: "◌", text: "Decision \"orange finish\" — brief changed", worldId: "11111111-1111-4111-8111-111111111111", worldTitle: "Rainwear 2027", objectId: null, zone: "decisions", verb: "Review" },
          { id: "streak", kind: "streak", glyph: "·", text: "Streak 6 — a decision or a claim keeps it.", worldId: null, worldTitle: null, objectId: null, zone: null, verb: "" },
        ] }}
        trust={{}}
        onOpen={() => undefined} onOpenSituation={() => undefined} onContinue={() => undefined} onStart={() => undefined} onCreate={() => undefined} onReject={() => undefined} onDismissArrival={() => undefined} onExplore={() => undefined} onWorkflows={() => undefined} />;
    }
    return <main className="xr-home"><BrandMark />
      <p className="xr-empty">The bridge is unavailable. This window is not XENIUR's own renderer.</p>
    </main>;
  }

  if (view.kind === "firstrun") {
    return (
      <FirstRun
        worlds={worlds}
        onDone={() => { setView({ kind: "home" }); void bridge.system.info().then(setInfo); }}
        onImport={() => { void startFromMaterial(); }}
        onImportPackage={() => { void startFromMaterial(); }}
        onStart={(outcome) => { void startFromGoal(outcome); }}
        onContinue={(worldId) => { void openWorld(worldId); }}
        onOpenExample={async () => {
          const created = await bridge.worlds.create({ title: "Rainwear 2027 (example)", emoji: "◒" });
          await refreshWorlds();
          await openWorld(created.id);
        }}
      />
    );
  }

  if (view.kind === "models") {
    return <Models reason={view.reason} onBack={() => setView(view.back)} />;
  }
  if (view.kind === "availability") {
    return <Availability onBack={() => setView(view.back)} onModels={() => setView({ kind: "models", reason: null, back: view.back })} />;
  }

  // Focus Mode replaces everything, deliberately: chrome that is merely hidden is chrome
  // that comes back the moment something happens.
  if (view.kind === "focus") {
    return (
      <FocusMode
        objectId={view.objectId} minutes={view.minutes} worldId={view.worldId}
        onExit={(resumeObjectId) => {
          // The focus invariant: the mode ends where it began. The centre slot is restored to
          // the exact Object, not to Home and not to the first World.
          void bridge?.worlds.open(view.worldId).then((snapshot) => {
            if (snapshot) setView({ kind: "world", snapshot, selection: resumeObjectId });
            else setView({ kind: "home" });
          });
        }}
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
          snapshot={view.snapshot} tasks={tasks} busy={busy} initialSelection={view.selection ?? null} initialZone={view.zone ?? "work"}
          onBack={() => setView({ kind: "home" })}
          onOpenObject={(id) => { void openObject(id, view.snapshot); }}
          onSubmit={submit} onApprove={approve} onReject={reject}
          onNeedsKey={(reason) => setView((current) => ({ kind: "models", reason, back: current }))}
          onImported={(result) => {
            // Re-read whichever World it landed in — the same one, or a new critique World.
            void bridge?.worlds.list().then(setWorlds);
            void openWorld(result.worldId);
          }}
        />
      ) : (
        <Home
          worlds={worlds} active={tasks} info={info}
          economy={economy} today={today} trust={worldTrust}
          onOpen={(id) => { void openWorld(id); }}
          onContinue={(card, objectId) => {
            void bridge?.worlds.open(card.worldId).then((snapshot) => {
              if (snapshot) setView({ kind: "world", snapshot, selection: objectId ?? card.focusObjectId ?? null });
            });
          }}
          onStart={(outcome) => { void startFromGoal(outcome); }}
          onOpenSituation={(row) => {
            if (row.kind === "rhythm") return;
            if (!row.worldId) return;
            // The row is a compiled Situation: the World opens with focus on the Object and the zone selected.
            void bridge?.worlds.open(row.worldId).then((snapshot) => {
              if (snapshot) setView({ kind: "world", snapshot, selection: row.objectId, zone: row.zone ?? undefined });
            });
          }}
          onDismissArrival={(challengeWorldId) => {
            void bridge?.challenges?.dismiss(challengeWorldId).then(() => refreshWorlds());
          }}
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
          onReject={reject}
          onExplore={() => setView({ kind: "web" })}
          onWorkflows={() => setView({ kind: "workflows" })}
        />
      )}
    </>
  );
}
