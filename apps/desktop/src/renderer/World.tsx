import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConstraintRecord, DecisionDetail, FrictionState, ImpactReport, Lane, ObjectState, ProcessProof,
  Representation, Scene, Task, ThinkingMap, TrustFacts, WorldSnapshot,
} from "@xeniur/core";
import { SceneRenderer, type SceneBindings } from "@xeniur/ui";
import {
  SituationSchema, compileSituation, layoutScene, proposalsFor,
  type GestureProposal,
} from "@xeniur/grammar";
import { BrandMark } from "./BrandMark.js";

/** The project's meaningful things, not XENIUR's subsystems. */
const ZONES = [
  { key: "sources", label: "Sources" },
  { key: "decisions", label: "Decisions" },
  { key: "work", label: "Work" },
  { key: "deliveries", label: "Deliveries" },
] as const;

const ZONE_INTENT = {
  sources: { meaning: "relationship", interaction: "connect", layer: 2, goal: "understand" },
  decisions: { meaning: "relationship", interaction: "review", layer: 3, goal: "decide" },
  work: { meaning: "relationship", interaction: "choose", layer: 2, goal: "transform" },
  deliveries: { meaning: "relationship", interaction: "commit", layer: 3, goal: "deliver" },
} as const;

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
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelection ?? snapshot.states[0]?.object.id ?? null,
  );
  const [utterance, setUtterance] = useState("");
  const [map, setMap] = useState<ThinkingMap | null>(null);
  const [friction, setFriction] = useState<FrictionState | null>(null);
  const [decisions, setDecisions] = useState<DecisionDetail[]>([]);
  const [impact, setImpact] = useState<Record<string, ImpactReport>>({});
  const [showHow, setShowHow] = useState<{ objectId: string; subject: string } | null>(null);
  const [constraints, setConstraints] = useState<ConstraintRecord[]>([]);
  const [proof, setProof] = useState<ProcessProof | null>(null);
  const [trust, setTrust] = useState<Record<string, TrustFacts>>({});
  const [gestureProposals, setGestureProposals] = useState<GestureProposal[]>([]);
  const [gesturePair, setGesturePair] = useState<{
    sourceId: string; targetId: string; targetKind: "claim" | "object";
  } | null>(null);
  const [languageOpen, setLanguageOpen] = useState(false);

  const bridge = window.xeniur;
  const worldId = snapshot.world.id;

  const refreshThinking = useCallback(async () => {
    setMap((await bridge?.sense.map(worldId)) ?? null);
    setFriction((await bridge?.sense.friction(worldId)) ?? null);
    setDecisions((await bridge?.decisions?.list(worldId)) ?? []);
  }, [bridge, worldId]);

  useEffect(() => { void refreshThinking(); }, [refreshThinking]);

  useEffect(() => {
    void bridge?.constraints?.list(worldId).then((items) => setConstraints(items ?? []));
  }, [bridge, worldId]);

  // Impact is per-Object and only needed for the one in the centre.
  useEffect(() => {
    if (!selectedId) return;
    void bridge?.living.impact?.(selectedId).then((report) => {
      if (report) setImpact((prev) => ({ ...prev, [selectedId]: report }));
    });
    void bridge?.process?.proof(selectedId).then((value) => setProof(value ?? null));
    // Facts the graph can show about the focused Object. Never a tick; re-read on every change.
    void bridge?.trust?.facts(selectedId).then((facts) => {
      if (facts) setTrust((prev) => ({ ...prev, [selectedId]: facts }));
    });
  }, [bridge, selectedId, snapshot, decisions, proof?.counts]);

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
    constraints: Object.fromEntries(constraints.map((constraint) => [constraint.objectId, constraint])),
    processProof: proof ? { [proof.objectId]: proof } : {},
    trust,
    gestureProposals: Object.fromEntries(gestureProposals.map((proposal) => [proposal.id, proposal])),
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
    onGestureTarget: (sourceId, targetId) => {
      const source = snapshot.states.find((state) => state.object.id === sourceId);
      const target = snapshot.states.find((state) => state.object.id === targetId);
      if (!source || !target) return;
      const targetKind = target.properties.semanticType === "claim" ? "claim" : "object";
      setGesturePair({ sourceId, targetId, targetKind });
      setGestureProposals(proposalsFor(
        { id: sourceId, title: source.properties.title, semanticType: source.properties.semanticType },
        { id: targetId, title: target.properties.title, kind: targetKind },
      ));
    },
    onChooseGesture: (proposalId) => {
      const proposal = gestureProposals.find((item) => item.id === proposalId);
      if (!proposal || !gesturePair) return;
      void bridge?.metrics?.record("gesture_used", ZONE_INTENT[zone].meaning);
      void bridge?.gestures.choose({ worldId, ...gesturePair, label: proposal.label });
      setGestureProposals([]);
      setGesturePair(null);
    },
    onConstraintChange: async (constraintId, value) => {
      const updated = await bridge?.constraints?.setValue(constraintId, value);
      if (updated) setConstraints((items) => items.map((item) => item.objectId === constraintId ? updated : item));
    },
  }), [snapshot, byId, tasks, map, friction, decisions, impact, worldId, bridge,
       onApprove, onReject, refreshThinking, constraints, proof, trust, gestureProposals, gesturePair, zone]);

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

    if (!selected) return {
      worldId, title: snapshot.world.title, reason: "Bring something in to establish focus",
      root: { id: "root", component: "Canvas", layout: "column", children: [
        { id: "drop", component: "ImportDrop", objectId: null, label: "Drop a file to begin" },
      ] as never },
    };

    const selectedImpact = impact[selected.object.id];
    const taskStates = ["selected"] as Array<"selected" | "changed" | "ready" | "blocked" | "conflict" | "missing">;
    if ((selectedImpact?.rebuild.length ?? 0) + (selectedImpact?.review.length ?? 0) > 0) taskStates.push("changed");
    const changes = [
      ...(selectedImpact?.rebuild ?? []).map((item) => ({
        objectId: selected.object.id, kind: "rebuild" as const, subject: item.stepKey, because: item.because,
      })),
      ...(selectedImpact?.review ?? []).map((item) => ({
        objectId: item.objectId, kind: "review" as const, subject: item.causeObjectId, because: item.because,
      })),
    ];
    const intent = ZONE_INTENT[zone];
    const isDecision = decisions.some((decision) => decision.objectId === selected.object.id);
    const situation = SituationSchema.parse({
      worldId, title: snapshot.world.title,
      meaning: intent.meaning, interaction: intent.interaction, layer: intent.layer, taskStates,
      goal: { kind: intent.goal, description: `${intent.goal} ${selected.properties.title}`,
        ...(zone === "deliveries" ? { deliverableId: selected.object.id } : {}) },
      scope: { worldId, objectIds: snapshot.states.map((state) => state.object.id), externalContextAllowed: false },
      focus: { kind: isDecision ? "decision" : "object", id: selected.object.id, label: selected.properties.title },
      objects: snapshot.states.map((state) => ({
        id: state.object.id, title: state.properties.title, semanticType: state.properties.semanticType,
        traits: state.properties.traits,
        formRoles: state.forms.map((form) => form.role), states: state.object.id === selected.object.id ? taskStates : [],
      })),
      changes, capabilities: [], constraints,
      choices: isDecision ? (decisions.find((decision) => decision.objectId === selected.object.id)?.options ?? []).map((option) => ({
        id: option.key, label: option.label, detail: option.note,
      })) : [],
    });
    const semantic = compileSituation(situation);
    const compiled = layoutScene(semantic, { layoutId: semantic.layoutId });
    const root = compiled.root.component === "Canvas" ? compiled.root : null;
    if (root && nodes.length > 0) root.children.unshift(...nodes as never[]);
    return compiled;
  }, [zone, worldId, snapshot, selected, selectedId, tasks, decisions, showHow, impact, constraints]);

  const inspector: Scene | null = useMemo(() => selected ? {
    worldId, title: "", reason: "",
    root: {
      id: "inspector", component: "Canvas", layout: "column",
      children: [
        // "Can I trust this work?" is answered before any question is asked of it.
        { id: "trust", component: "TrustStrip", objectId: selected.object.id, compact: true } as never,
        { id: "questions", component: "InspectorQuestions", objectId: selected.object.id, open: "what" } as never,
      ],
    },
  } : null, [selected, worldId]);

  const submit = () => {
    const text = utterance.trim();
    if (text === "") return;
    void bridge?.metrics?.record("typed_instead", ZONE_INTENT[zone].meaning);
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
        <BrandMark compact />
        <h1>{snapshot.world.title}</h1>
        <div className="xr-focusbar" aria-live="polite">
          <span>Focus</span><strong>{selected?.properties.title ?? "Nothing selected"}</strong>
        </div>
      </header>

      <nav className="xr-rail">
        {ZONES.map((z) => (
          <button key={z.key} type="button"
            className={`xr-rail__item${zone === z.key ? " is-active" : ""}`}
            onClick={() => {
              setZone(z.key); setShowHow(null); setGestureProposals([]);
              if (z.key === "decisions" && decisions[0]) setSelectedId(decisions[0].objectId);
            }}>
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

        <footer className={`xr-language-dock${languageOpen ? " is-open" : ""}`}>
          {!languageOpen ? <button type="button" className="xr-language-dock__trigger" onClick={() => setLanguageOpen(true)}>
            Use language for this <span>⌘K also works</span>
          </button> : <>
            <label htmlFor="world-language">Describe a shortcut for {selected?.properties.title ?? "this World"}</label>
            <input id="world-language" autoFocus value={utterance}
              placeholder="For example: make a delivery preview"
              onChange={(e) => setUtterance(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setLanguageOpen(false); }} />
            <button type="button" className={`xr-button ${busy ? "xr-button--running" : "xr-button--primary"}`}
              onClick={submit} disabled={busy}>{busy ? "Working…" : "Go"}</button>
            <button type="button" className="xr-button" onClick={() => setLanguageOpen(false)}>Close</button>
          </>}
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
