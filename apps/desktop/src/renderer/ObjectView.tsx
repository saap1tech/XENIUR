import { useEffect, useMemo, useState } from "react";
import type { ConstraintRecord, ImpactReport, ObjectDetail, ProcessProof, Scene } from "@xeniur/core";
import { SceneRenderer, type SceneBindings } from "@xeniur/ui";
import { SituationSchema, compileSituation, layoutScene } from "@xeniur/grammar";
import { BrandMark } from "./BrandMark.js";
import { ProcessShare } from "./ProcessShare.js";
import { reviewSupportBinding } from "./lib/reviewSupport.js";
import { t } from "@xeniur/ui";
import { ArrowLeft, BookOpen, GitCompareArrows, History, Layers3, Route, Share2 } from "lucide-react";
import { Sharpen } from "./Sharpen.js";

export interface ObjectViewProps {
  detail: ObjectDetail;
  busy: boolean;
  onRefresh(): void;
  onBack(): void;
  onOpenObject?(id: string): void;
}

type Tab = "forms" | "compare" | "evidence" | "history" | "how";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "forms", label: "Forms" },
  { id: "compare", label: "Compare" },
  { id: "evidence", label: "Evidence" },
  { id: "history", label: "History" },
  { id: "how", label: "Show how this happened" },
];
const TAB_ICONS = { forms: Layers3, compare: GitCompareArrows, evidence: BookOpen, history: History, how: Route };

const TAB_INTENT = {
  forms: { meaning: "relationship", interaction: "choose", layer: 2, goal: "transform" },
  compare: { meaning: "relationship", interaction: "compare", layer: 3, goal: "understand" },
  evidence: { meaning: "relationship", interaction: "review", layer: 3, goal: "validate" },
  history: { meaning: "sequence", interaction: "connect", layer: 3, goal: "understand" },
  how: { meaning: "relationship", interaction: "review", layer: 4, goal: "understand" },
} as const;

/**
 * Everything an Object *is*, in one place.
 *
 * Forms first, then what changed, split into rebuild and review — that split is the first
 * thing a person sees rather than something they have to be taught. Compare is a mode of
 * its own, because comparing is what a second revision *is*.
 *
 * The recipe and lineage graphs moved behind "Show how this happened". They stopped being
 * the interface and became the evidence you can ask for, which is the right relationship:
 * a person wants to know why their print is out of date, not to read a DAG.
 */
export function ObjectView({ detail, busy, onRefresh, onBack, onOpenObject }: ObjectViewProps) {
  const [tab, setTab] = useState<Tab>("forms");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [impact, setImpact] = useState<ImpactReport | null>(null);
  const [constraints, setConstraints] = useState<ConstraintRecord[]>([]);
  const [proof, setProof] = useState<ProcessProof | null>(null);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Paper: opt-in, for reading at length. Remembered for this viewer only.
  const [paper, setPaper] = useState<boolean>(() => { try { return window.localStorage?.getItem("xeniur.paper") === "1"; } catch { return false; } });

  const bridge = window.xeniur;
  const objectId = detail.state.object.id;
  const [goalId, setGoalId] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setGoalId(null);
    void bridge?.goals?.current(detail.state.object.worldId).then((goal) => { if (current) setGoalId(goal?.id ?? null); });
    return () => { current = false; };
  }, [bridge, detail.state.object.worldId]);
  const stale = detail.steps.filter((s) => s.state !== "fresh");

  const bindings: SceneBindings = useMemo(() => ({
    states: { [objectId]: detail.state },
    representations: Object.fromEntries(detail.representations.map((r) => [r.id, r])),
    tasks: {},
    stepStates: { [objectId]: detail.steps },
    rebuildPlan: detail.rebuildPlan ? { [objectId]: detail.rebuildPlan } : {},
    checks: { [objectId]: detail.checks },
    readiness: { [objectId]: detail.readiness },
    history: { [objectId]: detail.history },
    dna: { [objectId]: detail.dna },
    ...(impact ? { impact: { [objectId]: impact } } : {}),
    constraints: Object.fromEntries(constraints.map((constraint) => [constraint.objectId, constraint])),
    processProof: proof ? { [objectId]: proof } : {},
    lineage: detail.lineage
      ? { [detail.lineage.steps[0]?.representationId ?? ""]: detail.lineage as never }
      : {},
    blobUrl: (hash) => bridge?.blobs.url(hash) ?? "",
    onSelectForm: (_id, role) => setSelectedRole(role),
    onUndo: async (id) => { await bridge?.objects.undo(id); onRefresh(); },
    onRedo: async (id) => { await bridge?.objects.redo(id); onRefresh(); },
    onSwitchBranch: async (id, branchId) => { await bridge?.living.switchBranch(id, branchId); onRefresh(); },
    onRebuild: async (id, includeGeneration) => { await bridge?.living.rebuild(id, includeGeneration); onRefresh(); },
    onValidate: async (id) => { await bridge?.living.validate(id); onRefresh(); },
    onRelease: async (id, profileId) => { await bridge?.living.release(id, profileId); onRefresh(); },
    onAddObservation: () => setTab("forms"),
    onShowHow: () => setTab("how"),
    onConstraintChange: async (constraintId, value) => {
      const updated = await bridge?.constraints?.setValue(constraintId, value);
      if (updated) setConstraints((items) => items.map((item) => item.objectId === constraintId ? updated : item));
      onRefresh();
    },
    onReviewApprove: async (id) => { await bridge?.living.release(id, "artifact"); onRefresh(); },
    onReviewSupport: reviewSupportBinding({
      save: (id, status) => bridge?.sense?.reviewSupport?.(id, status) ?? Promise.reject(new Error("the bridge is unavailable")),
      refresh: () => onRefresh(),
      notify: setNotice,
    }),
  }), [detail, objectId, bridge, onRefresh, impact, constraints, proof]);

  // The rebuild/review split is per-Object and cheap; it is refetched whenever the Object
  // changes so the headline can never describe a state that has already moved on.
  useEffect(() => {
    void bridge?.living.impact(objectId).then(setImpact);
    void bridge?.constraints?.list(detail.state.object.worldId).then((items) => setConstraints(items ?? []));
    void bridge?.process?.proof(objectId).then((value) => setProof(value ?? null));
  }, [bridge, objectId, detail]);

  const scene: Scene = useMemo(() => {
    const intent = TAB_INTENT[tab];
    const changes = [
      ...(impact?.rebuild ?? []).map((item) => ({
        objectId, kind: "rebuild" as const, subject: item.stepKey, because: item.because,
      })),
      ...(impact?.review ?? []).map((item) => ({
        objectId: item.objectId, kind: "review" as const, subject: item.causeObjectId, because: item.because,
      })),
    ];
    const taskStates: Array<"selected" | "changed" | "ready"> = ["selected"];
    if (changes.length > 0) taskStates.push("changed");
    if (tab === "evidence") taskStates.push("ready");
    const semantic = compileSituation(SituationSchema.parse({
      worldId: detail.state.object.worldId, title: detail.state.properties.title,
      meaning: intent.meaning, interaction: intent.interaction, layer: intent.layer, taskStates,
      goal: { kind: intent.goal, description: `${intent.goal} ${detail.state.properties.title}` },
      scope: { worldId: detail.state.object.worldId, objectIds: [objectId], externalContextAllowed: false },
      focus: { kind: detail.state.properties.semanticType === "decision" ? "decision" : "object",
        id: objectId, label: detail.state.properties.title },
      objects: [{ id: objectId, title: detail.state.properties.title,
        semanticType: detail.state.properties.semanticType,
        traits: detail.state.properties.traits,
        formRoles: [selectedRole ?? detail.state.forms[0]?.role ?? "source.primary"], states: taskStates }],
      changes, capabilities: [], constraints: constraints.filter((item) => item.objectId === objectId), choices: [],
    }));
    return layoutScene(semantic, { layoutId: semantic.layoutId });
  }, [tab, objectId, selectedRole, detail, impact, constraints]);

  const hasText = detail.representations.some((r) => r.modality === "text");
  return (
    <main className="xr-object" data-paper={paper && hasText ? "" : undefined}>
      <header className="xr-object__head">
        <button type="button" className="xr-back" onClick={onBack}><ArrowLeft size={15} />{t("object.back")}</button>
        <BrandMark compact />
        <h1>{detail.state.properties.title}</h1>
        <span className="xr-object__type xr-technical">{detail.state.properties.semanticType}</span>
        <span className="xr-object__version">
          v{detail.state.seq}{detail.state.branchName ? ` · ${detail.state.branchName}` : ""}
        </span>
        {stale.length > 0 && (
          <span className="xr-object__stale">
            {stale.length} out of date
          </span>
        )}
        <div className="xr-object__actions">
          {hasText && (
            <button type="button" className="xr-button" aria-pressed={paper} title="Off-white for long reading. Same identity, inverted surfaces."
              onClick={() => { const next = !paper; setPaper(next); try { window.localStorage?.setItem("xeniur.paper", next ? "1" : "0"); } catch { /* per-viewer */ } }}>
              {paper ? "Graphite" : "Paper"}
            </button>
          )}
          <button type="button" className="xr-button" disabled={!proof} onClick={() => setSharing(true)}>
            <Share2 size={15} /> View / share process
          </button>
          <button type="button" className="xr-button" disabled={busy}
            onClick={() => { void bridge?.living.exportPackage(objectId); }}>
            Export .xeniur
          </button>
        </div>
      </header>

      <nav className="xr-tabs">
        {TABS.map((t) => { const Icon = TAB_ICONS[t.id]; return (
          <button
            key={t.id} type="button"
            className={`xr-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          ><Icon size={16} aria-hidden="true" />{t.label}</button>
        ); })}
      </nav>

      {notice && <p className="xr-centre__notice" role="status">{notice}<button type="button" className="xr-button" onClick={() => setNotice(null)}>Close</button></p>}
      {goalId && onOpenObject && !detail.state.properties.tags.includes("sharpen") && <div className="xr-object__strength"><Sharpen goalId={goalId} objectId={objectId} revision={detail} onOpen={onOpenObject} onSaved={onRefresh} /></div>}
      <SceneRenderer scene={scene} bindings={bindings} />
      {sharing && proof && <ProcessShare objectId={objectId} title={detail.state.properties.title} proof={proof} onClose={() => setSharing(false)} />}
    </main>
  );
}
