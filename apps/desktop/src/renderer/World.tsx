import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DecisionDetail, FrictionState, ImpactReport, Lane, ObjectState, Representation, Scene,
  Task, ThinkingMap, WorldSnapshot,
} from "@xeniur/core";
import { SceneRenderer, type SceneBindings } from "@xeniur/ui";

/** The project's meaningful things, not XENIUR's subsystems. */
const ZONES = [
  { key: "sources", label: "Sources" },
  { key: "decisions", label: "Decisions" },
  { key: "work", label: "Work" },
  { key: "deliveries", label: "Deliveries" },
] as const;

export type Zone = typeof ZONES[number]["key"];

export interface WorldProps {
  snapshot: WorldSnapshot;
  tasks: Task[];
  busy: boolean;
  initialSelection?: string | null;
  initialZone?: Zone;
  onBack(): void;
  onOpenObject(objectId: string): void;
  onSubmit(utterance: string, selection: string[]): void;
  onApprove(taskId: string): void;
  onReject(taskId: string): void;
}

/**
 * A project, in three zones that never move.
 *
 * Left: what the project is made of — sources, decisions, work, deliveries. Centre: the
 * one thing being thought about right now. Right: five questions about it, in the words a
 * person would use.
 *
 * The zones are the project's meaningful things rather than XENIUR's subsystems, which is
 * the difference between a workbench and a control panel. Nothing is reachable only by
 * typing: the palette and the intent bar are shortcuts into the same actions, never the
 * only way to them.
 */
export function World({
  snapshot, tasks, busy, initialSelection = null, initialZone = "work",
  onBack, onOpenObject, onSubmit, onApprove, onReject,
}: WorldProps) {
  const [zone, setZone] = useState<Zone>(initialZone);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection);
  const [utterance, setUtterance] = useState("");
  const [map, setMap] = useState<ThinkingMap | null>(null);
  const [friction, setFriction] = useState<FrictionState | null>(null);
  const [decisions, setDecisions] = useState<DecisionDetail[]>([]);
  const [impact, setImpact] = useState<Record<string, ImpactReport>>({});
  const [showHow, setShowHow] = useState<{ objectId: string; subject: string } | null>(null);

  const bridge = window.xeniur;
  const worldId = snapshot.world.id;

  const refreshThinking = useCallback(async () => {
    setMap((await bridge?.sense.map(worldId)) ?? null);
    setFriction((await bridge?.sense.friction(worldId)) ?? null);
    setDecisions((await bridge?.decisions?.list(worldId)) ?? []);
  }, [bridge, worldId]);

  useEffect(() => { void refreshThinking(); }, [refreshThinking]);

  // Impact is per-Object and only needed for the one in the centre.
  useEffect(() => {
    if (!selectedId) return;
    void bridge?.living.impact?.(selectedId).then((report) => {
      if (report) setImpact((prev) => ({ ...prev, [selectedId]: report }));
    });
  }, [bridge, selectedId, snapshot]);

  const byId = useMemo(
    () => new Map(snapshot.representations.map((r: Representation) => [r.id, r])),
    [snapshot.representations],
  );

  const selected: ObjectState | undefined = selectedId
    ? snapshot.states.find((s) => s.object.id === selectedId)
    : undefined;

  const bindings: SceneBindings = useMemo(() => ({
    states: Object.fromEntries(snapshot.states.map((s) => [s.object.id, s])),
    representations: Object.fromEntries(byId),
    tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    thinkingMap: map ? { [worldId]: map } : {},
    friction: friction ? { [worldId]: friction } : {},
    decisions: Object.fromEntries(decisions.map((d) => [d.objectId, d])),
    impact,
    blobUrl: (hash) => bridge?.blobs.url(hash) ?? "",
    onSelect: (objectId) => setSelectedId(objectId),
    onApprove, onReject,
    onSort: async (objectId, lane: Lane) => {
      await bridge?.sense.sort(objectId, lane);
      await refreshThinking();
    },
    onDismissFriction: async (id) => {
      await bridge?.sense.dismissFriction(id, "not now");
      await refreshThinking();
    },
    onShowHow: (objectId, subject) => setShowHow({ objectId, subject }),
    onReviewed: async (objectId) => {
      await bridge?.decisions?.reaffirm(objectId);
      await refreshThinking();
    },
    onRebuild: async (objectId, includeGeneration) => {
      await bridge?.living.rebuild(objectId, includeGeneration);
    },
    onRun: (objectId) => { void bridge?.code.run(objectId); },
    onStop: (objectId) => { void bridge?.code.stop(objectId); },
  }), [snapshot, byId, tasks, map, friction, decisions, impact, worldId, bridge,
       onApprove, onReject, refreshThinking]);

  /** One thing at a time in the centre, chosen by the zone and what is selected. */
  const scene: Scene = useMemo(() => {
    const nodes: Array<Record<string, unknown>> = [];
    const parked = tasks.find((t) => t.status === "needs_approval");

    if (parked) {
      nodes.push({
        id: `approval-${parked.id}`, component: "ApprovalDialog", taskId: parked.id,
        level: (parked.payload["__level"] as string) ?? "COMMIT",
        preview: (parked.payload["__preview"] as string) ?? parked.title,
        detail: (parked.payload["__detail"] as string) ?? "",
      });
    }

    if (showHow) {
      nodes.push({
        id: "how", component: "CausalPath", objectId: showHow.objectId,
        subject: showHow.subject,
        kind: impact[showHow.objectId]?.rebuild.some((r) => r.stepKey === showHow.subject)
          ? "rebuild" : "review",
      });
    }

    switch (zone) {
      case "sources":
        nodes.push({ id: "table", component: "ThinkingTable", worldId, selectedId });
        break;

      case "decisions":
        for (const d of decisions) {
          nodes.push({ id: `d-${d.objectId}`, component: "DecisionCard",
                       objectId: d.objectId, showEvidence: true });
        }
        if (decisions.length === 0) {
          nodes.push({ id: "table", component: "ThinkingTable", worldId, selectedId });
        }
        break;

      case "deliveries":
        if (selected) {
          nodes.push({ id: "ready", component: "ReadinessBoard",
                       objectId: selected.object.id, showAll: true });
        }
        break;

      default:
        if (selected) {
          nodes.push({ id: "strip", component: "FormStrip",
                       objectId: selected.object.id, selectedRole: null });
          nodes.push({ id: "impact", component: "ImpactReview",
                       objectId: selected.object.id, compact: false });
        } else {
          nodes.push({
            id: "gallery", component: "Gallery",
            objectIds: snapshot.states.map((s) => s.object.id), columns: 3,
          });
          if (snapshot.states.length === 0) {
            nodes.push({ id: "drop", component: "ImportDrop", objectId: null,
                         label: "Drop a file to begin" });
          }
        }
    }

    return {
      worldId, title: snapshot.world.title,
      reason: selected ? selected.properties.title : ZONES.find((z) => z.key === zone)!.label,
      root: { id: "root", component: "Canvas", layout: "column", children: nodes as never },
    };
  }, [zone, worldId, snapshot, selected, selectedId, tasks, decisions, showHow, impact]);

  const inspector: Scene | null = useMemo(() => selected ? {
    worldId, title: "", reason: "",
    root: {
      id: "inspector", component: "Canvas", layout: "column",
      children: [{
        id: "questions", component: "InspectorQuestions",
        objectId: selected.object.id, open: "what",
      } as never],
    },
  } : null, [selected, worldId]);

  const submit = () => {
    const text = utterance.trim();
    if (text === "") return;
    onSubmit(text, selectedId ? [selectedId] : []);
    setUtterance("");
  };

  const counts: Record<Zone, number> = {
    sources: map?.counts.sources ?? 0,
    decisions: decisions.length,
    work: snapshot.states.length,
    deliveries: 0,
  };

  return (
    <div className={`xr-shell${inspector ? "" : " xr-shell--no-inspector"}`}>
      <header className="xr-shell__head">
        <button type="button" className="xr-back" onClick={onBack}>←</button>
        <h1>{snapshot.world.title}</h1>
        <span className="xr-shell__reason">{scene.reason}</span>
      </header>

      <nav className="xr-rail">
        {ZONES.map((z) => (
          <button key={z.key} type="button"
            className={`xr-rail__item${zone === z.key ? " is-active" : ""}`}
            onClick={() => { setZone(z.key); setShowHow(null); }}>
            {z.label}
            <span className="xr-rail__count">{counts[z.key] || ""}</span>
          </button>
        ))}

        <div className="xr-rail__foot">
          {selected && (
            <button type="button" className="xr-rail__item"
              onClick={() => onOpenObject(selected.object.id)}>
              Open {selected.properties.title}
            </button>
          )}
        </div>
      </nav>

      <main className="xr-centre">
        <div className="xr-centre__solo">
          <SceneRenderer scene={scene} bindings={bindings} />
        </div>

        <footer className="xr-say">
          <input
            value={utterance}
            placeholder={selected ? "Say what to do with it…" : "Say what you want…"}
            onChange={(e) => setUtterance(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
          <button type="button" className={`xr-button ${busy ? "xr-button--running" : "xr-button--primary"}`}
            onClick={submit} disabled={busy}>
            {busy ? "Working…" : "Go"}
          </button>
        </footer>
      </main>

      {inspector && (
        <aside className="xr-inspector-zone">
          <SceneRenderer scene={inspector} bindings={bindings} />
        </aside>
      )}
    </div>
  );
}
