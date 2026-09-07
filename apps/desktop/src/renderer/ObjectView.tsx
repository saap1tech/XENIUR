import { useEffect, useMemo, useState } from "react";
import type { ImpactReport, ObjectDetail, Scene } from "@xeniur/core";
import { SceneRenderer, type SceneBindings } from "@xeniur/ui";

export interface ObjectViewProps {
  detail: ObjectDetail;
  busy: boolean;
  onRefresh(): void;
  onBack(): void;
}

type Tab = "forms" | "compare" | "evidence" | "history" | "how";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "forms", label: "Forms" },
  { id: "compare", label: "Compare" },
  { id: "evidence", label: "Evidence" },
  { id: "history", label: "History" },
  { id: "how", label: "Show how this happened" },
];

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
export function ObjectView({ detail, busy, onRefresh, onBack }: ObjectViewProps) {
  const [tab, setTab] = useState<Tab>("forms");
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  // Off until somebody asks. A form is a thing you made, not a file you have to manage.
  const [showFileNames, setShowFileNames] = useState(false);
  const [impact, setImpact] = useState<ImpactReport | null>(null);

  const bridge = window.xeniur;
  const objectId = detail.state.object.id;
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
  }), [detail, objectId, bridge, onRefresh, impact]);

  // The rebuild/review split is per-Object and cheap; it is refetched whenever the Object
  // changes so the headline can never describe a state that has already moved on.
  useEffect(() => {
    void bridge?.living.impact(objectId).then(setImpact);
  }, [bridge, objectId, detail]);

  const scene: Scene = useMemo(() => {
    const nodes: Array<Record<string, unknown>> = [];
    switch (tab) {
      case "forms":
        nodes.push({ id: "strip", component: "FormStrip", objectId, selectedRole, showFileNames });
        nodes.push({ id: "impact", component: "ImpactReview", objectId, compact: false });
        nodes.push({ id: "readiness", component: "ReadinessBoard", objectId, showAll: false });
        nodes.push({ id: "drawer", component: "IdeaDrawer", objectId, open: false });
        break;
      case "compare":
        nodes.push({
          id: "compare", component: "CompareForms", objectId,
          formRole: selectedRole ?? detail.state.forms[0]?.role ?? "source.primary",
          leftVersionId: null, rightVersionId: null,
        });
        break;
      case "how":
        nodes.push({ id: "recipe", component: "RecipeGraph", objectId });
        if (detail.lineage?.steps[0]) {
          nodes.push({
            id: "lineage", component: "LineageGraph",
            representationId: detail.lineage.steps[0].representationId,
          });
        }
        break;
      case "evidence":
        nodes.push({ id: "checks", component: "ChecksPanel", objectId, formRole: selectedRole });
        nodes.push({ id: "readiness", component: "ReadinessBoard", objectId, showAll: true });
        break;
      case "history":
        nodes.push({ id: "timeline", component: "VersionTimeline", objectId });
        break;
    }
    return {
      worldId: detail.state.object.worldId,
      title: detail.state.properties.title,
      reason: `${tab} · v${detail.state.seq}`,
      root: { id: "root", component: "Canvas", layout: "column", children: nodes as never },
    };
  }, [tab, objectId, selectedRole, showFileNames, detail]);

  return (
    <main className="xr-object">
      <header className="xr-object__head">
        <button type="button" className="xr-back" onClick={onBack}>← World</button>
        <h1>{detail.state.properties.title}</h1>
        <span className="xr-object__type">{detail.state.properties.semanticType}</span>
        <span className="xr-object__version">
          v{detail.state.seq}{detail.state.branchName ? ` · ${detail.state.branchName}` : ""}
        </span>
        {stale.length > 0 && (
          <span className="xr-object__stale">
            {stale.length} out of date
          </span>
        )}
        <div className="xr-object__actions">
          <button type="button" className="xr-button"
            onClick={() => setShowFileNames((on) => !on)}>
            {showFileNames ? "Hide filenames" : "Show filenames"}
          </button>
          <button type="button" className="xr-button" disabled={busy}
            onClick={() => { void bridge?.living.exportPackage(objectId); }}>
            Export .xeniur
          </button>
        </div>
      </header>

      <nav className="xr-tabs">
        {TABS.map((t) => (
          <button
            key={t.id} type="button"
            className={`xr-tab${tab === t.id ? " is-active" : ""}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </nav>

      <SceneRenderer scene={scene} bindings={bindings} />
    </main>
  );
}
