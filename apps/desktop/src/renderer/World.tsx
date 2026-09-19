import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ConstraintRecord, DecisionDetail, FrictionState, ImpactReport, Lane, ObjectState, ProcessProof,
  ChallengeRecord, EntryRecord, GoalStatus, PackageInspectionView, Representation, Scene, SupportMap, Task, ThinkingMap, TrailRow, TrustFacts,
  WorkGoal, WorldSnapshot,
} from "@xeniur/core";
import { SceneRenderer, type SceneBindings } from "@xeniur/ui";
import {
  SituationSchema, compileSituation, layoutScene, proposalsFor,
  type GestureProposal,
} from "@xeniur/grammar";
import { GOAL_STATUSES, GOAL_STATUS_WORDS } from "@xeniur/core";
import { BrandMark } from "./BrandMark.js";
import { Arrival } from "./Arrival.js";

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
  /** Something arrived and was opened; the World should be re-read (and maybe another World shown). */
  onImported?(result: { objectId: string; worldId: string }): void;
  /** The goal as already known (a host or a test); undefined means read it from the bridge. */
  initialGoal?: WorkGoal | null;
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
  onBack, onOpenObject, onSubmit, onApprove, onReject, onImported, initialGoal,
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
  const [arrival, setArrival] = useState<{ path: string; inspection: PackageInspectionView } | null>(null);
  const [challenge, setChallenge] = useState<ChallengeRecord | null>(null);
  const [entries, setEntries] = useState<EntryRecord[]>([]);
  const [selfKey, setSelfKey] = useState<string | null>(null);
  const [supportMap, setSupportMap] = useState<SupportMap | null>(null);
  const [goal, setGoal] = useState<WorkGoal | null | undefined>(initialGoal);   // undefined: not read yet
  const [relevant, setRelevant] = useState<string[] | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [trailRows, setTrailRows] = useState<TrailRow[]>([]);

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

  // The goal — what the person is trying to accomplish — and the Objects it is about.
  const refreshGoal = useCallback(async () => {
    if (!bridge?.goals) return;                       // a static render keeps what it was given
    const g = (await bridge.goals.current(worldId)) ?? null;
    setGoal(g);
    setRelevant(g ? (await bridge.goals.relevant(g.id)) ?? [] : null);
  }, [bridge, worldId]);
  useEffect(() => { void refreshGoal(); }, [refreshGoal]);

  // The centre follows the goal's focus on open; afterwards the goal follows the centre.
  useEffect(() => {
    if (goal?.focusObjectId && !initialSelection && selectedId === (snapshot.states[0]?.object.id ?? null)) {
      setSelectedId(goal.focusObjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal?.id]);
  useEffect(() => {
    if (goal && selectedId && goal.focusObjectId !== selectedId) {
      void bridge?.goals?.setFocus(goal.id, selectedId).then((g) => { if (g) setGoal(g); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // A challenge World's centre is its board. Read once, and again when an entry changes.
  const refreshChallenge = useCallback(async () => {
    if (snapshot.world.kind !== "challenge") return;
    setChallenge((await bridge?.challenges?.get(worldId)) ?? null);
    setEntries((await bridge?.challenges?.entries(worldId)) ?? []);
    setSelfKey((await bridge?.publishers?.self())?.publicKey ?? null);
  }, [bridge, worldId, snapshot.world.kind]);
  useEffect(() => { void refreshChallenge(); }, [refreshChallenge]);

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
    // The lenses: the claims behind it, and what any agent saw, decided, was allowed and did.
    void bridge?.trust?.supportMap(selectedId).then((m) => setSupportMap(m ?? null));
    void bridge?.brain?.trail(selectedId).then((rows) => setTrailRows(rows ?? []));
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
    supportMaps: supportMap ? { [supportMap.objectId]: supportMap } : {},
    agentTrail: selectedId ? { [selectedId]: trailRows } : {},
    challenges: challenge ? { [challenge.worldId]: challenge } : {},
    challengeEntries: challenge ? { [challenge.worldId]: entries } : {},
    selfPublicKey: selfKey,
    focusObjectId: selectedId,
    onEnterChallenge: async (challengeWorldId, objectId) => {
      await bridge?.challenges?.enter(challengeWorldId, objectId);
      await refreshChallenge();
    },
    gestureProposals: Object.fromEntries(gestureProposals.map((proposal) => [proposal.id, proposal])),
    blobUrl: (hash) => bridge?.blobs.url(hash) ?? "",
    onSelect: (objectId) => setSelectedId(objectId),
    onApprove, onReject,
    onImport: async (paths, objectId) => {
      // A .xeniur is inspected and shown, never opened on drop. Anything else is a file.
      const packages = paths.filter((p) => p.endsWith(".xeniur"));
      const files = paths.filter((p) => !p.endsWith(".xeniur"));
      if (files.length > 0) {
        await bridge?.living.importFiles(files, { worldId, objectId });
        onImported?.({ objectId: objectId ?? "", worldId });
      }
      if (packages[0]) {
        const inspection = await bridge?.packages?.inspect(packages[0]);
        if (inspection) setArrival({ path: packages[0], inspection });
      }
    },
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
       onApprove, onReject, onImported, refreshThinking, refreshChallenge, constraints, proof, trust, supportMap, trailRows,
       challenge, entries, selfKey, selectedId, gestureProposals, gesturePair, zone]);

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

    // A challenge World: the board is the centre, whatever is selected. Rules before entry.
    if (snapshot.world.kind === "challenge" && challenge) return {
      worldId, title: snapshot.world.title, reason: "The rules, the dates, the deliverable, the policy — then your entry",
      root: { id: "root", component: "Canvas", layout: "column", children: [
        ...nodes,
        { id: "board", component: "ChallengeBoard", worldId },
      ] as never },
    };

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
    // With a goal, the centre shows what the goal is about; without one, the whole World.
    const goalScope = goal && relevant
      ? [...new Set([selected.object.id, ...relevant, ...(zone === "deliveries" ? [selected.object.id] : [])])]
      : snapshot.states.map((state) => state.object.id);
    const situation = SituationSchema.parse({
      worldId, title: snapshot.world.title,
      meaning: intent.meaning, interaction: intent.interaction, layer: intent.layer, taskStates,
      goal: goal
        ? { id: goal.id, outcome: goal.outcome, status: goal.status, requiredOutputs: goal.requiredOutputs,
            openQuestions: goal.openQuestionIds,
            nextActions: goal.nextActions.filter((a) => !a.doneAt).map((a) => ({ id: a.id, text: a.text, objectId: a.objectId })),
            description: goal.outcome, ...(zone === "deliveries" ? { deliverableId: selected.object.id } : {}) }
        : { kind: intent.goal, description: `${intent.goal} ${selected.properties.title}`,
            ...(zone === "deliveries" ? { deliverableId: selected.object.id } : {}) },
      scope: { worldId, objectIds: goalScope, externalContextAllowed: false },
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
    // The Sources zone asks "which claims are actually supported?" — the Support Map is that
    // question as a Scene, laid under the compiled centre when the focus has claims behind it.
    if (root && zone === "sources" && supportMap && supportMap.claims.length > 0) {
      root.children.push({ id: "support-map", component: "SupportMap", objectId: selected.object.id, lanes: [], disclosure: intent.layer } as never);
    }
    return compiled;
  }, [zone, worldId, snapshot, selected, selectedId, tasks, decisions, showHow, impact, constraints, challenge, supportMap, goal, relevant]);

  const inspector: Scene | null = useMemo(() => selected ? {
    worldId, title: "", reason: "",
    root: {
      id: "inspector", component: "Canvas", layout: "column",
      children: [
        // "Can I trust this work?" is answered before any question is asked of it.
        { id: "trust", component: "TrustStrip", objectId: selected.object.id, compact: true } as never,
        { id: "questions", component: "InspectorQuestions", objectId: selected.object.id, open: "what" } as never,
        // What did the agent see, decide, authorise and execute — the enterprise question, always answerable.
        ...(trailRows.length > 0 ? [{ id: "trail", component: "AgentTrail", objectId: selected.object.id } as never] : []),
      ],
    },
  } : null, [selected, worldId, trailRows]);

  // Until a World has a goal, the first thing the dock asks is what the person is trying to
  // accomplish. The answer is stored verbatim; nothing about a profession or a model is asked.
  const askingForGoal = goal === null && snapshot.world.kind === "work";
  const submit = () => {
    const text = utterance.trim();
    if (text === "") return;
    if (askingForGoal) {
      void bridge?.goals?.create(worldId, text, selectedId).then(() => refreshGoal());
      setUtterance(""); setLanguageOpen(false);
      return;
    }
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
        {goal && snapshot.world.kind === "work" && (
          <div className="xr-goalbar">
            {editingGoal ? (
              <input className="xr-goalbar__edit" autoFocus value={goalDraft} aria-label="What you are trying to accomplish"
                onChange={(e) => setGoalDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && goalDraft.trim()) { void bridge?.goals?.setOutcome(goal.id, goalDraft).then((g) => { if (g) setGoal(g); }); setEditingGoal(false); }
                  if (e.key === "Escape") setEditingGoal(false);
                }} onBlur={() => setEditingGoal(false)} />
            ) : (
              <button type="button" className="xr-goalbar__outcome" title="Edit what you are trying to accomplish"
                onClick={() => { setGoalDraft(goal.outcome); setEditingGoal(true); }}>{goal.outcome}</button>
            )}
            <select className="xr-goalbar__status" value={goal.status} aria-label="How you are working on it"
              title={GOAL_STATUS_WORDS[goal.status].means}
              onChange={(e) => { void bridge?.goals?.setStatus(goal.id, e.target.value as GoalStatus).then((g) => { if (g) setGoal(g); }); }}>
              {GOAL_STATUSES.map((st) => <option key={st} value={st}>{GOAL_STATUS_WORDS[st].label}</option>)}
            </select>
          </div>
        )}
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
        {arrival && (
          <Arrival path={arrival.path} inspection={arrival.inspection}
            onOpen={async (as) => {
              const result = await bridge?.packages?.import(arrival.path, { as, worldId: as === "work" ? worldId : null });
              setArrival(null);
              if (result) onImported?.(result);
            }}
            onBlock={async () => {
              const p = arrival.inspection.publisher;
              if (p) await bridge?.publishers?.setTrust(p.publicKey, p.displayName, "blocked");
              setArrival(null);
            }}
            onDismiss={() => setArrival(null)} />
        )}
        <div className="xr-centre__solo">
          <SceneRenderer scene={scene} bindings={bindings} />
        </div>

        <footer className={`xr-language-dock${languageOpen || askingForGoal ? " is-open" : ""}`}>
          {!languageOpen && !askingForGoal ? <button type="button" className="xr-language-dock__trigger" onClick={() => setLanguageOpen(true)}>
            Use language for this <span>⌘K also works</span>
          </button> : <>
            <label htmlFor="world-language">{askingForGoal
              ? "What are you trying to accomplish?"
              : `Describe a shortcut for ${selected?.properties.title ?? "this World"}`}</label>
            <input id="world-language" autoFocus value={utterance}
              placeholder={askingForGoal ? "One sentence, in your words" : "For example: make a delivery preview"}
              onChange={(e) => setUtterance(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setLanguageOpen(false); }} />
            <button type="button" className={`xr-button ${busy ? "xr-button--running" : "xr-button--primary"}`}
              onClick={submit} disabled={busy}>{busy ? "Working…" : askingForGoal ? "Set it" : "Go"}</button>
            {!askingForGoal && <button type="button" className="xr-button" onClick={() => setLanguageOpen(false)}>Close</button>}
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
