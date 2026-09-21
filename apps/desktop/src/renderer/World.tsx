import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConstraintRecord, DecisionDetail, FrictionState, ImpactReport, Lane, ObjectState, ProcessProof,
  CandidateRecord, ChallengeRecord, EntryRecord, EnvelopeSheet, GoalStatus, JudgingSheetData, ModeEnvelopeInput, ModeRecord, PackageInspectionView, Representation, Scene, Standing, SupportMap, Task,
  ThinkingMap, TrailRow, TrustFacts, WorkGoal, WorldSnapshot,
} from "@xeniur/core";
import { SceneRenderer, presentBindings, t, type SceneBindings } from "@xeniur/ui";
import {
  NEED_WORDS, SituationSchema, compileSituation, layoutScene, proposalsFor,
  type GestureProposal,
} from "@xeniur/grammar";
import { GOAL_STATUSES, GOAL_STATUS_WORDS, planDigest } from "@xeniur/core";
import { BrandMark } from "./BrandMark.js";
import { Arrival } from "./Arrival.js";
import { Ask } from "./Ask.js";
import { KeyboardMap } from "./KeyboardMap.js";
import { reviewSupportBinding } from "./lib/reviewSupport.js";
import { Organizer } from "./Organizer.js";

/** The project's meaningful things, not XENIUR's subsystems. */
const ZONES = [
  { key: "sources", label: "Sources" },
  { key: "decisions", label: "Decisions" },
  { key: "work", label: "Work" },
  { key: "deliveries", label: "Deliveries" },
] as const;

/** The four zones are four of the six needs: what the rail names is the question the centre answers. */
const ZONE_NEED = { sources: "know_more", decisions: "decide", work: "make", deliveries: "finish" } as const;

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
  /** A request resolved to a remote model and no key exists: the host offers Your models. */
  onNeedsKey?(reason: string): void;
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
  onBack, onOpenObject, onSubmit, onApprove, onReject, onImported, initialGoal, onNeedsKey,
}: WorldProps) {
  const [zone, setZone] = useState<Zone>(initialZone);
  const [showKeys, setShowKeys] = useState(false);
  // The Sealed Session: the sheet being read, and the mode once it runs. Read from the store, never remembered.
  const [sealSheet, setSealSheet] = useState<{ sheet: EnvelopeSheet; envelope: ModeEnvelopeInput } | null>(null);
  const [sealMode, setSealMode] = useState<ModeRecord | null>(null);
  // Judging: whether this machine judges here, and the sheet for the entry in front of it.
  const [judging, setJudging] = useState<{ isJudge: boolean; openedAt: number | null }>({ isJudge: false, openedAt: null });
  const [judgeEntry, setJudgeEntry] = useState<string | null>(null);      // entry id; null = the board
  const [judgingSheet, setJudgingSheet] = useState<JudgingSheetData | null>(null);
  const [finishRefusals, setFinishRefusals] = useState<Record<string, string[]>>({});
  const [ticket, setTicket] = useState<{ valid: boolean; usedAt: number | null; expiresAt: number } | null>(null);
  // Until the person clicks a zone, the goal's next question chooses the representation.
  const [zoneChosen, setZoneChosen] = useState<boolean>(initialZone !== "work");
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
  const [worldTrust, setWorldTrust] = useState<TrustFacts | null>(null);
  const [gestureProposals, setGestureProposals] = useState<GestureProposal[]>([]);
  const [gesturePair, setGesturePair] = useState<{
    sourceId: string; targetId: string; targetKind: "claim" | "object" | "decision" | "work";
  } | null>(null);
  const [arrival, setArrival] = useState<{ path: string; inspection: PackageInspectionView } | null>(null);
  const [challenge, setChallenge] = useState<ChallengeRecord | null>(null);
  const [entries, setEntries] = useState<EntryRecord[]>([]);
  const [selfKey, setSelfKey] = useState<string | null>(null);
  const [supportMap, setSupportMap] = useState<SupportMap | null>(null);
  const [goal, setGoal] = useState<WorkGoal | null | undefined>(initialGoal);   // undefined: not read yet
  const [relevant, setRelevant] = useState<string[] | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [standing, setStanding] = useState<Standing | null>(null);
  const [ask, setAsk] = useState<{ utterance: string; selection: string[]; intent?: string } | null>(null);
  const [connections, setConnections] = useState<Record<string, Array<{ objectId: string; title: string; because: string; by: string }>>>({});
  const [brainAvailable, setBrainAvailable] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Density: Compact / Comfortable / Detailed = disclosure 1 / 2 / 3, the person's, remembered per World.
  const [density, setDensity] = useState<1 | 2 | 3 | null>(() => {
    try { const v = window.localStorage?.getItem(`xeniur.density.${snapshot.world.id}`); return v ? (Number(v) as 1 | 2 | 3) : null; } catch { return null; }
  });
  const chooseDensity = useCallback((d: 1 | 2 | 3) => {
    setDensity(d);
    try { window.localStorage?.setItem(`xeniur.density.${snapshot.world.id}`, String(d)); } catch { /* per-viewer convenience only */ }
  }, [snapshot.world.id]);
  // Present: the same Scene, full-window, read-only. P toggles; Esc leaves.
  const [present, setPresent] = useState(false);
  const [presentSlot, setPresentSlot] = useState(0);
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [showStanding, setShowStanding] = useState(false);
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
  const refreshCandidates = useCallback(async () => {
    setCandidates((await bridge?.sense?.pendingCandidates?.(worldId)) ?? []);
  }, [bridge, worldId]);
  useEffect(() => { void refreshCandidates(); }, [refreshCandidates]);
  useEffect(() => { void bridge?.system?.info().then((info) => setBrainAvailable(!!info && !info.brainIsMock)); }, [bridge]);

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
  const refreshStanding = useCallback(async () => {
    if (!goal || !bridge?.goals) return;
    setStanding((await bridge.goals.standing(goal.id)) ?? null);
  }, [bridge, goal]);
  // The standing feeds the compiler's knowledge counts, so it is read whenever the goal is.
  useEffect(() => { void refreshStanding(); }, [refreshStanding, showStanding, decisions, map]);
  // Keys, as the map (`?`) lists them: ⌘K palette · ⌘1/2/3 density · 1–4 zones · ↑↓ Enter ·
  // P present · W where do I stand · Esc leaves any mode. Never while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && ["1", "2", "3"].includes(e.key)) { e.preventDefault(); chooseDensity(Number(e.key) as 1 | 2 | 3); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") { setShowKeys((v) => !v); return; }
      if (["1", "2", "3", "4"].includes(e.key)) { const z = ZONES[Number(e.key) - 1]!; setZone(z.key); setZoneChosen(true); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (present) return;
        e.preventDefault();
        const ids = snapshot.states.map((st) => st.object.id);
        if (ids.length === 0) return;
        const at = ids.indexOf(selectedId ?? "");
        const step = e.key === "ArrowDown" ? 1 : -1;
        setSelectedId(ids[at < 0 ? 0 : (at + step + ids.length) % ids.length]!);
        return;
      }
      if (e.key === "Enter" && selectedId && !present) { onOpenObject(selectedId); return; }
      if (e.key === "w" || e.key === "W") { if (goal) setShowStanding((v) => !v); }
      if (e.key === "p" || e.key === "P") { setPresent((v) => !v); setPresentSlot(0); }
      if (present && e.key === "ArrowRight") setPresentSlot((i) => i + 1);
      if (present && e.key === "ArrowLeft") setPresentSlot((i) => Math.max(0, i - 1));
      if (e.key === "Escape") { setShowStanding(false); setPresent(false); setShowKeys(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goal, present, chooseDensity, snapshot.states, selectedId, onOpenObject]);

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
    setSealMode((await bridge?.seal?.active()) ?? null);
    const status = await bridge?.judging?.status(worldId);
    setJudging({ isJudge: (await bridge?.judging?.isJudge(worldId)) ?? false, openedAt: status?.judgingOpenedAt ?? null });
    const held = await bridge?.arena?.ticketHeld(worldId);
    setTicket(held ? { valid: held.valid, usedAt: held.usedAt, expiresAt: held.ticket.expiresAt } : null);
  }, [bridge, worldId, snapshot.world.kind]);
  useEffect(() => { void refreshChallenge(); }, [refreshChallenge]);

  // The judge's sheet for the entry in front of them, re-read whenever it changes.
  useEffect(() => {
    if (!judgeEntry) { setJudgingSheet(null); return; }
    void bridge?.judging?.sheet(worldId, judgeEntry).then((sheet) => setJudgingSheet(sheet ?? null));
  }, [bridge, worldId, judgeEntry, entries]);

  // While a Sealed Session runs: one heartbeat per interval with what is in the centre and its
  // version, and the size of every paste — the size only; the text itself is never stored.
  useEffect(() => {
    if (!sealMode || sealMode.endedAt !== null) return;
    const entryId = sealMode.envelope.entryObjectId;
    const beat = () => {
      const focus = snapshot.states.find((st) => st.object.id === selectedId);
      void bridge?.seal?.beat(sealMode.id, selectedId, focus?.versionId ?? null);
    };
    beat();
    const timer = window.setInterval(beat, sealMode.envelope.heartbeatSeconds * 1000);
    const onPaste = (e: ClipboardEvent) => {
      if (!entryId) return;
      const chars = e.clipboardData?.getData("text")?.length ?? 0;
      if (chars === 0) return;
      const entry = snapshot.states.find((st) => st.object.id === entryId);
      void bridge?.seal?.paste(entryId, entry?.versionId ?? null, chars);
    };
    window.addEventListener("paste", onPaste);
    return () => { window.clearInterval(timer); window.removeEventListener("paste", onPaste); };
  }, [bridge, sealMode, selectedId, snapshot.states]);

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
    void bridge?.trust?.world?.(worldId).then((facts) => setWorldTrust(facts ?? null));
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

  const bindingsRef = useRef<SceneBindings | null>(null);
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
    standings: standing ? { [standing.goal.id]: standing } : {},
    candidates: { [worldId]: candidates },
    connections, brainAvailable,
    onThinkingMove: async (move, objectId) => {
      const title = snapshot.states.find((st) => st.object.id === objectId)?.properties.title ?? "this";
      if (move === "basis") {
        const r = await bridge?.sense?.basis?.(objectId);
        if (r?.passage) bindingsRef.current?.onOpenSource?.(objectId);
        await refreshThinking();
      } else if (move === "connect") {
        setConnections((prev) => ({ ...prev, [objectId]: [] }));
        const found = (await bridge?.sense?.connections?.(objectId)) ?? [];
        setConnections((prev) => ({ ...prev, [objectId]: found }));
      } else {
        setAsk({ utterance: move === "challenge" ? `Challenge "${title}"` : `How could we test "${title}"?`, selection: [objectId],
          intent: move === "challenge" ? "challenge_claim" : "propose_test" });
      }
    },
    onProposeConnection: (fromObjectId, toObjectId) => {
      const source = snapshot.states.find((st) => st.object.id === fromObjectId);
      const target = snapshot.states.find((st) => st.object.id === toObjectId);
      if (!source || !target) return;
      const targetKind = decisions.some((d) => d.objectId === toObjectId) ? "decision" : target.properties.semanticType === "claim" ? "claim" : "object";
      setGesturePair({ sourceId: fromObjectId, targetId: toObjectId, targetKind });
      setGestureProposals(proposalsFor(
        { id: fromObjectId, title: source.properties.title, semanticType: source.properties.semanticType },
        { id: toObjectId, title: target.properties.title, kind: targetKind },
      ));
    },
    onAcceptCandidate: async (id, edit) => {
      const atom = await bridge?.sense?.acceptCandidate?.(id, edit);
      if (atom === null) return;                       // the tray already offers Accept anyway
      await refreshCandidates(); await refreshThinking(); await refreshStanding();
    },
    onRejectCandidate: async (id) => { await bridge?.sense?.rejectCandidate?.(id); await refreshCandidates(); },
    // A citation's review saves, refreshes the knowledge it touches, and fails in words.
    onReviewSupport: reviewSupportBinding({
      save: (id, status) => bridge?.sense?.reviewSupport?.(id, status) ?? Promise.reject(new Error("the bridge is unavailable")),
      refresh: async () => { await refreshThinking(); await refreshStanding(); },
      notify: setNotice,
    }),
    onCancel: async (taskId) => { await bridge?.tasks?.cancel(taskId); },
    finishRefusals,
    onFinish: async (goalId, anyway) => {
      // The check decides. Refusals are shown in words; finishing anyway records a Decision.
      const result = await bridge?.goals?.finish(goalId, anyway);
      if (!result) return;
      if (result.finished) { setFinishRefusals((r) => ({ ...r, [goalId]: [] })); setGoal(result.goal); }
      else setFinishRefusals((r) => ({ ...r, [goalId]: result.missing }));
      await refreshStanding();
    },
    onNextActionDone: async (goalId, actionId) => { await bridge?.goals?.doneNextAction(goalId, actionId); await refreshStanding(); await refreshGoal(); },
    onAddNextAction: async (goalId, text) => { await bridge?.goals?.addNextAction(goalId, text, selectedId); await refreshStanding(); await refreshGoal(); },
    agentTrail: selectedId ? { [selectedId]: trailRows } : {},
    challenges: challenge ? { [challenge.worldId]: challenge } : {},
    challengeEntries: challenge ? { [challenge.worldId]: entries } : {},
    selfPublicKey: selfKey,
    focusObjectId: selectedId,
    onEnterChallenge: async (challengeWorldId, objectId) => {
      await bridge?.challenges?.enter(challengeWorldId, objectId);
      await refreshChallenge();
    },
    judgingSheets: judgingSheet ? { [judgingSheet.entryId]: judgingSheet } : {},
    onRecordAssessment: async (challengeWorldId, entryId, criteria, note) => {
      try { await bridge?.judging?.assess(challengeWorldId, entryId, criteria, note); setNotice(null); }
      catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); }
      const sheet = await bridge?.judging?.sheet(challengeWorldId, entryId);
      setJudgingSheet(sheet ?? null);
    },
    onNextEntry: (_challengeWorldId, entryId) => {
      const at = entries.findIndex((e) => e.id === entryId);
      const next = entries[at + 1];
      if (next) setJudgeEntry(next.id);
    },
    ticketHeld: ticket,
    sealRunning: sealMode,
    onSealSession: async (_challengeWorldId, entryObjectId) => {
      // The envelope: until the challenge closes (capped at a day), remote models off, a
      // heartbeat a minute. The sheet is shown first; nothing starts until it is read.
      const minutesLeft = challenge ? Math.floor((challenge.rules.endsAt - Date.now()) / 60_000) : 120;
      const envelope: ModeEnvelopeInput = {
        durationMinutes: Math.max(1, Math.min(24 * 60, minutesLeft)), restrictions: ["remote models off"],
        exitPolicy: "always", remoteModels: false, entryObjectId, heartbeatSeconds: 60, resumeObjectId: entryObjectId,
      };
      const sheet = await bridge?.modes?.describe("sealed_session", envelope);
      if (sheet) setSealSheet({ sheet, envelope });
    },
    modeSheets: sealSheet ? { [sealSheet.sheet.digest]: sealSheet.sheet } : {},
    modes: sealMode ? { [sealMode.id]: sealMode } : {},
    onStartMode: async (kind, sheetDigest) => {
      if (kind !== "sealed_session" || !sealSheet) return;
      const started = await bridge?.modes?.start(kind, sealSheet.envelope, sheetDigest, worldId);
      setSealSheet(null);
      setSealMode(started ?? null);
    },
    onDeclineMode: () => setSealSheet(null),
    onExitMode: async (modeId, reason) => {
      await bridge?.modes?.exit(modeId, reason);
      setSealMode(null);
      await refreshChallenge();
    },
    gestureProposals: Object.fromEntries(gestureProposals.map((proposal) => [proposal.id, proposal])),
    blobUrl: (hash) => bridge?.blobs.url(hash) ?? "",
    onSelect: (objectId) => setSelectedId(objectId),
    onApprove, onReject,
    onImport: async (paths, objectId) => {
      // A .xeniur is inspected and shown, never opened on drop. Anything else is a file.
      const packages = paths.filter((p) => p.endsWith(".xeniur"));
      const signed = paths.filter((p) => /\.xeniur-(judging|results|challenge|ticket)\.json$/.test(p));
      const files = paths.filter((p) => !p.endsWith(".xeniur") && !signed.includes(p));
      for (const doc of signed) {
        // A signed document — a judge's assessment, a publisher's results, a challenge, a ticket:
        // verified against its signer before anything is written; refused in words otherwise.
        try {
          if (doc.endsWith(".xeniur-challenge.json")) {
            const r = await bridge?.arena?.adoptChallengeFile(doc);
            setNotice(r?.alreadyHere ? "That challenge is already here." : `“${r?.title}” arrived and verified. It is a World now.`);
            if (r?.worldId) onImported?.({ objectId: "", worldId: r.worldId });
          } else if (doc.endsWith(".xeniur-ticket.json")) {
            const t = await bridge?.arena?.adoptTicketFile(doc);
            if (t) setNotice(`Your entry ticket verified. It is good until ${new Date(t.expiresAt).toISOString().slice(0, 10)}.`);
          } else {
            const r = await bridge?.judging?.adoptFile(doc);
            if (r) setNotice(`${r.kind === "xeniur.judging/1" ? "An assessment" : "Results"} arrived and verified.`);
          }
        } catch (cause) { setNotice(cause instanceof Error ? cause.message : String(cause)); }
        await refreshChallenge();
      }
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
      const targetKind = decisions.some((d) => d.objectId === targetId) ? "decision"
        : target.properties.semanticType === "claim" ? "claim" : "object";
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
       onApprove, onReject, onImported, refreshThinking, refreshChallenge, refreshStanding, refreshGoal, constraints, proof, trust, supportMap, trailRows,
       standing, candidates, refreshCandidates, connections, brainAvailable, challenge, entries, selfKey, selectedId,
       gestureProposals, gesturePair, zone, sealSheet, sealMode, judgingSheet, entries, ticket, finishRefusals]);
  bindingsRef.current = bindings;

  /** One thing at a time in the centre, chosen by the zone and what is selected. */
  const scene: Scene = useMemo(() => {
    const nodes: Array<Record<string, unknown>> = [];
    const parked = tasks.find((t) => t.status === "needs_approval");

    if (parked) {
      // The plan the person is asked to approve — shown as itself, digest included, so the
      // consent is to this plan and cannot quietly cover a different one.
      const plan = parked.payload["plan"] as { tool?: string; objects?: string[]; args?: Record<string, unknown> } | undefined;
      nodes.push({
        id: `approval-${parked.id}`, component: "ApprovalDialog", taskId: parked.id,
        level: (parked.payload["__level"] as string) ?? "COMMIT",
        preview: (parked.payload["__preview"] as string) ?? parked.title,
        detail: (parked.payload["__detail"] as string) ?? "",
        tool: plan?.tool ?? parked.tool, objects: plan?.objects ?? [],
        planDigest: plan?.tool ? planDigest({ tool: plan.tool, args: plan.args ?? {} }) : undefined,
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

    // Where do I stand: the goal's state as the centre, until Esc.
    if (showStanding && goal) return {
      worldId, title: snapshot.world.title, reason: "Where you stand on this goal",
      root: { id: "root", component: "Canvas", layout: "column", children: [
        { id: "standing", component: "Standing", goalId: goal.id },
      ] as never },
    };

    // A challenge World: the board is the centre, whatever is selected. Rules before entry.
    // A Sealed Session's sheet replaces the board until it is read; its rule sits above it while it runs.
    if (snapshot.world.kind === "challenge" && challenge) return {
      worldId, title: snapshot.world.title, reason: sealSheet ? "Read what a Sealed Session records before it starts"
        : judgeEntry ? "One entry: what was made, how, what the record says, and what it cannot" : "The rules, the dates, the deliverable, the policy — then your entry",
      root: { id: "root", component: "Canvas", layout: "column", children: sealSheet
        ? [{ id: "seal-sheet", component: "FocusContract", phase: "review", sheetDigest: sealSheet.sheet.digest, modeId: null }]
        : judgeEntry && judgingSheet
        ? [{ id: "judging", component: "JudgingSheet", challengeWorldId: worldId, entryId: judgeEntry }]
        : [
          ...(sealMode && sealMode.endedAt === null ? [{ id: "seal-rule", component: "FocusContract", phase: "running", sheetDigest: null, modeId: sealMode.id }] : []),
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
      // A clicked zone names the question; otherwise the goal's status chooses it. The zone's
      // meaning and interaction still shape the centre when the person chose the zone.
      ...(zoneChosen || !goal ? { meaning: intent.meaning, interaction: intent.interaction, need: ZONE_NEED[zone] } : {}),
      ...(standing ? { knowledge: {
        known: standing.knowledge.known.length, proposed: standing.knowledge.proposed.length,
        disputed: standing.knowledge.disputed.length, unknown: standing.knowledge.unknown.length,
        chosenDespite: standing.knowledge.chosenDespite.length,
      } } : {}),
      layer: density ?? intent.layer, taskStates,
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
    compiled.reason = NEED_WORDS[semantic.need];
    const root = compiled.root.component === "Canvas" ? compiled.root : null;
    if (root && nodes.length > 0) root.children.unshift(...nodes as never[]);
    // The Sources zone asks "which claims are actually supported?" — the Support Map is that
    // question as a Scene, laid under the compiled centre when the focus has claims behind it.
    if (root && zone === "sources" && supportMap && supportMap.claims.length > 0) {
      root.children.push({ id: "support-map", component: "SupportMap", objectId: selected.object.id, lanes: [], disclosure: intent.layer } as never);
    }
    return compiled;
  }, [zone, zoneChosen, worldId, snapshot, selected, selectedId, tasks, decisions, showHow, impact, constraints, challenge, supportMap, goal, relevant, showStanding, standing, density, sealSheet, sealMode, judgeEntry, judgingSheet]);

  const inspector: Scene | null = useMemo(() => selected ? {
    worldId, title: "", reason: "",
    root: {
      id: "inspector", component: "Canvas", layout: "column",
      children: [
        // "Can I trust this work?" is answered before any question is asked of it.
        { id: "trust", component: "TrustStrip", objectId: selected.object.id, compact: true } as never,
        { id: "moves", component: "ThinkingMoves", objectId: selected.object.id } as never,
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
      setUtterance("");
      return;
    }
    const selection = selectedId ? [selectedId] : [];
    // A question to the Brain opens Ask, inside the Scene. A command goes to the planner as before.
    void (async () => {
      const read = await bridge?.brain?.resolve(text, selection);
      if (read && (read.by === "rule" || text.endsWith("?"))) {
        setAsk({ utterance: text, selection });
      } else {
        void bridge?.metrics?.record("typed_instead", ZONE_INTENT[zone].meaning);
        onSubmit(text, selection);
      }
    })();
    setUtterance("");
  };

  const counts: Record<Zone, number> = {
    sources: map?.counts.sources ?? 0,
    decisions: decisions.length,
    work: snapshot.states.filter((st) => !["claim", "question", "decision", "atom"].includes(st.properties.semanticType)).length,
    deliveries: worldTrust?.actions.receipted ?? 0,
  };
  // One line of state under each zone: words, never an unread badge.
  const zoneState: Record<Zone, string> = {
    sources: worldTrust && worldTrust.support.unresolved + worldTrust.support.contradicted > 0
      ? [worldTrust.support.unresolved ? `${worldTrust.support.unresolved} unresolved` : "", worldTrust.support.contradicted ? `${worldTrust.support.contradicted} contradicted` : ""].filter(Boolean).join(" · ")
      : "",
    decisions: decisions.some((d) => d.state === "needs_review") ? `${decisions.filter((d) => d.state === "needs_review").length} to review` : "",
    work: worldTrust && worldTrust.evidence.total > 0 && worldTrust.evidence.current < worldTrust.evidence.total
      ? `${worldTrust.evidence.total - worldTrust.evidence.current} measurement${worldTrust.evidence.total - worldTrust.evidence.current === 1 ? "" : "s"} stale` : "",
    deliveries: worldTrust && worldTrust.actions.unknown > 0 ? `${worldTrust.actions.unknown} unknown` : "",
  };

  if (present) {
    // The centre's slot order is the walk; ←/→ move the focus; nothing here can change the graph.
    const slots = scene.root.component === "Canvas" ? scene.root.children : [];
    const idx = Math.min(presentSlot, Math.max(0, slots.length - 1));
    const focusNode = slots[idx];
    const shown: Scene = focusNode
      ? { ...scene, root: { id: "present", component: "Canvas", layout: "column", children: [focusNode] as never } }
      : scene;
    return (
      <div className="xr-present" role="region" aria-label={`Presenting ${snapshot.world.title} — ${idx + 1} of ${slots.length}. Escape leaves.`}>
        <SceneRenderer scene={shown} bindings={presentBindings(bindings)} />
        <footer className="xr-present__foot">
          <span className="xr-mono">{idx + 1} / {slots.length}</span>
          {selected && trust[selected.object.id] && (
            <SceneRenderer scene={{ worldId, title: "", reason: "", root: { id: "t", component: "Canvas", layout: "column",
              children: [{ id: "trust", component: "TrustStrip", objectId: selected.object.id, compact: true } as never] } }} bindings={presentBindings(bindings)} />
          )}
          <span className="xr-present__hint">← → walk · Esc leaves</span>
        </footer>
      </div>
    );
  }

  return (
    <div className={`xr-shell${inspector ? "" : " xr-shell--no-inspector"}`}>
      {showKeys && <KeyboardMap onClose={() => setShowKeys(false)} />}
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
            <button type="button" className={`xr-goalbar__where${showStanding ? " is-on" : ""}`} title="Where do I stand? (W)"
              onClick={() => setShowStanding((v) => !v)}>Where I stand</button>
            <select className="xr-goalbar__status" value={goal.status} aria-label="How you are working on it"
              title={GOAL_STATUS_WORDS[goal.status].means}
              onChange={(e) => { void bridge?.goals?.setStatus(goal.id, e.target.value as Exclude<GoalStatus, "finished">).then((g) => { if (g) setGoal(g); }); }}>
              {/* Finished is not chosen here: it is the outcome of Finish, under Where I stand. */}
              {GOAL_STATUSES.filter((st) => st !== "finished" || goal.status === "finished").map((st) => <option key={st} value={st} disabled={st === "finished"}>{GOAL_STATUS_WORDS[st].label}</option>)}
            </select>
          </div>
        )}
        <div className="xr-focusbar" aria-live="polite">
          <span>Focus</span><strong>{selected?.properties.title ?? "Nothing selected"}</strong>
        </div>
        <div className="xr-density" role="radiogroup" aria-label="How much to show">
          {([1, 2, 3] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={(density ?? ZONE_INTENT[zone].layer) === d}
              className={`xr-density__dot${(density ?? ZONE_INTENT[zone].layer) === d ? " is-on" : ""}`}
              title={`${["Compact", "Comfortable", "Detailed"][d - 1]} (⌘${d})`} onClick={() => chooseDensity(d)}>
              <span aria-hidden="true">{"·".repeat(d)}</span><span className="xr-density__word">{["Compact", "Comfortable", "Detailed"][d - 1]}</span>
            </button>
          ))}
        </div>
      </header>

      <nav className="xr-rail">
        {ZONES.map((z) => (
          <button key={z.key} type="button"
            className={`xr-rail__item${zone === z.key ? " is-active" : ""}`}
            onDragOver={z.key === "work" ? (e) => e.preventDefault() : undefined}
            onDrop={z.key === "work" ? (e) => {
              // A question dropped on Work proposes a next action on the goal. Proposes; the person confirms.
              const sourceId = e.dataTransfer.getData("application/x-xeniur-object");
              const source = snapshot.states.find((state) => state.object.id === sourceId);
              if (!source || source.properties.semanticType !== "question") return;
              e.preventDefault();
              setGesturePair({ sourceId, targetId: worldId, targetKind: "work" });
              setGestureProposals(proposalsFor(
                { id: sourceId, title: source.properties.title, semanticType: "question" },
                { id: worldId, title: "Work", kind: "work" },
              ));
            } : undefined}
            onClick={() => {
              setZone(z.key); setZoneChosen(true); setShowHow(null); setGestureProposals([]);
              if (z.key === "decisions" && decisions[0]) setSelectedId(decisions[0].objectId);
            }}>
            <span className="xr-rail__label">{z.label}<span className="xr-rail__count">{counts[z.key] || ""}</span></span>
            {zoneState[z.key] && <span className={`xr-rail__state is-${z.key}`}>{zoneState[z.key]}</span>}
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
        {ask && (
          <Ask worldId={worldId} utterance={ask.utterance} selection={ask.selection} intent={ask.intent} bindings={bindings}
            onCandidates={() => { void refreshCandidates(); }}
            onTrail={(row) => { if (row && selectedId) setTrailRows((rows) => [row, ...rows.filter((r) => r.id !== row.id)]); }}
            onNeedsKey={() => { const why = t("models.needed"); if (onNeedsKey) onNeedsKey(why); else setNotice(why); }}
            onClose={() => setAsk(null)} />
        )}
        {notice && <p className="xr-centre__notice" role="status">{notice}<button type="button" className="xr-button" onClick={() => setNotice(null)}>Close</button></p>}
        <div className="xr-centre__solo">
          {scene.reason && snapshot.world.kind === "work" && !showStanding && (
            <p className="xr-stage__need"><span>{scene.reason}</span>{selected && <em> · {selected.properties.title}</em>}</p>
          )}
          <SceneRenderer scene={scene} bindings={bindings} />
        </div>
        {candidates.length > 0 && snapshot.world.kind === "work" && (
          <div className="xr-centre__tray">
            <SceneRenderer scene={{ worldId, title: "", reason: "", root: { id: "tray", component: "Canvas", layout: "column",
              children: [{ id: "proposals", component: "ProposalsTray", worldId } as never] } }} bindings={bindings} />
          </div>
        )}

        <footer className="xr-language-dock">
          <label htmlFor="world-language">{askingForGoal ? "What are you trying to accomplish?" : "Use language for this"}</label>
          <input id="world-language" value={utterance}
            placeholder={askingForGoal ? "One sentence, in your words" : `Ask about ${selected?.properties.title ?? "this World"}, or say what to do — “compare these two”, “make a delivery preview”`}
            onChange={(e) => setUtterance(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setUtterance(""); }} />
          <button type="button" className={`xr-button ${busy ? "xr-button--running" : "xr-button--primary"}`}
            onClick={submit} disabled={busy || utterance.trim() === ""}>{busy ? "Working…" : askingForGoal ? "Set it" : "Go"}</button>
          <span className="xr-language-dock__hint">⌘K palette</span>
        </footer>
      </main>

      {snapshot.world.kind === "challenge" && challenge && (judging.isJudge || selfKey === challenge.publisher.publicKey) && (
        <aside className="xr-inspector-zone">
          {judging.isJudge && judging.openedAt && entries.length > 0 && (
            <div className="xr-judge-nav">
              <small className="xr-mono">JUDGE</small>
              <div className="xr-judge-nav__entries">
                <button type="button" className={`xr-rail__item${judgeEntry === null ? " is-active" : ""}`} onClick={() => setJudgeEntry(null)}>The board</button>
                {entries.map((e, i) => (
                  <button key={e.id} type="button" className={`xr-rail__item${judgeEntry === e.id ? " is-active" : ""}`} onClick={() => setJudgeEntry(e.id)}>
                    {String(i + 1).padStart(2, "0")} · {snapshot.states.find((st) => st.object.id === e.objectId)?.properties.title ?? "an entry"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {selfKey === challenge.publisher.publicKey && (
            <Organizer challenge={challenge} entries={entries}
              titles={Object.fromEntries(snapshot.states.map((st) => [st.object.id, st.properties.title]))}
              onChanged={() => { void refreshChallenge(); }} />
          )}
        </aside>
      )}
      {inspector && selected && snapshot.world.kind !== "challenge" && (
        <aside className="xr-inspector-zone">
          <SceneRenderer scene={inspector} bindings={bindings} />
          {/* A processing permission, versioned on the Object. Never a rights change, never a deletion. */}
          <div className="xr-aiperm">
            {selected.properties.settings["aiProcessing"] === "never" ? (
              <>
                <span className="xr-aiperm__state">Not sent to AI</span>
                <button type="button" className="xr-button" onClick={() => { void bridge?.objects?.setAiProcessing(selected.object.id, "allowed").then(() => onImported?.({ objectId: selected.object.id, worldId })); }}>Use this for the current task</button>
              </>
            ) : (
              <button type="button" className="xr-button" onClick={() => { void bridge?.objects?.setAiProcessing(selected.object.id, "never").then(() => onImported?.({ objectId: selected.object.id, worldId })); }}>Don’t send this to AI</button>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
