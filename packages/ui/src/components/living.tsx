import type { LeafSceneNode, ReadinessReport, StepState } from "@xeniur/core";
import { formRoleName } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { currentForms } from "../bindings.js";
import { Button, Empty, Panel, ProvenanceBadge } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/* ------------------------------------------------------------- form strip */

/**
 * Every simultaneous form of an Object, side by side.
 *
 * This is the clearest statement the interface makes: these are not five files, they are
 * one thing wearing five forms. So they carry human names — Source, Model, Print,
 * Thumbnail, Turntable — and no filenames at all unless a person asks for them. A tile
 * labelled `print.stl` is a row in a table; a tile labelled Print is a thing you made.
 *
 * A form that is out of date says so on its own tile, because staleness only visible after
 * clicking is staleness nobody notices.
 */
export function FormStrip({ node, bindings }: { node: Node<"FormStrip">; bindings: SceneBindings }) {
  const forms = currentForms(bindings, node.objectId);
  if (forms.length === 0) return <Empty>Nothing here yet.</Empty>;

  const stateOf = (role: string): StepState | null =>
    bindings.stepStates?.[node.objectId]?.find((s) => s.formRoles.includes(role))?.state ?? null;

  return (
    <div className="xr-forms">
      {forms.map(({ role, representation }) => {
        const state = stateOf(role);
        const stale = state !== null && state !== "fresh";
        return (
          <button
            key={role} type="button"
            className={`xr-form${role === node.selectedRole ? " is-selected" : ""}${stale ? " is-stale" : ""}`}
            onClick={() => bindings.onSelectForm?.(node.objectId, role)}
          >
            <span className="xr-form__role">{formRoleName(role)}</span>
            {representation.modality === "image" && representation.blobHash ? (
              <img className="xr-form__thumb" src={bindings.blobUrl(representation.blobHash)} alt="" />
            ) : (
              <span className={`xr-form__thumb xr-form__thumb--${representation.modality}`}>
                {representation.format.toUpperCase()}
              </span>
            )}
            <span className="xr-form__meta">
              <ProvenanceBadge provenance={representation.provenance} provider={representation.provider} />
              {stale && <span className="xr-chip xr-chip--stale">{state}</span>}
            </span>
            {node.showFileNames && (
              <span className="xr-form__file xr-mono">
                {representation.format}
                {representation.blobHash ? ` · ${representation.blobHash.slice(0, 8)}` : ""}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- readiness board */

/**
 * Readiness as a count of current measurements rather than a tick.
 *
 * "Current" is the load-bearing word: a check only counts while it names the exact
 * representation and bytes occupying that role right now, so this number falls the moment
 * a form is rebuilt. A bare green tick could not say that, which is why there isn't one.
 */
function measurementLine(report: ReadinessReport): string {
  const met = report.results.length - report.blockers.length;
  return `${met}/${report.results.length} current measurements`;
}

/**
 * Every profile as a row, met or blocked with the exact requirement that is stopping it.
 * A red light nobody can act on is worse than no light at all, so each blocker shows what
 * it measured and, where there is one, what would move it forward.
 */
export function ReadinessBoard({ node, bindings }: { node: Node<"ReadinessBoard">; bindings: SceneBindings }) {
  const reports = bindings.readiness?.[node.objectId] ?? [];
  if (reports.length === 0) return <Empty>No readiness profiles apply here yet.</Empty>;

  const shown = node.showAll ? reports : reports.filter((r) => r.gates === "artifact");
  return (
    <Panel title="Ready for">
      <ul className="xr-readiness">
        {shown.map((report) => (
          <li key={report.profileId} className={`xr-ready xr-ready--${report.ready ? "yes" : "no"}`}>
            <div className="xr-ready__head">
              <span className="xr-ready__name">{report.profileName}</span>
              <span className="xr-ready__state">{measurementLine(report)}</span>
              {report.ready && (
                <Button variant="primary" onClick={() => bindings.onRelease?.(node.objectId, report.profileId)}>
                  Approve release
                </Button>
              )}
            </div>
            {report.verifies && <p className="xr-ready__verifies">{report.verifies}</p>}
            {!report.ready && (
              <ul className="xr-ready__blockers">
                {report.blockers.map((b, i) => (
                  <li key={i}>
                    {b.detail}
                    {b.remedy && <span className="xr-ready__remedy"> / {b.remedy}</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------ checks panel */

export function ChecksPanel({ node, bindings }: { node: Node<"ChecksPanel">; bindings: SceneBindings }) {
  const checks = (bindings.checks?.[node.objectId] ?? [])
    .filter((c) => !node.formRole || c.formRole === node.formRole);
  if (checks.length === 0) return <Empty>Nothing has been checked yet.</Empty>;

  return (
    <Panel title="Evidence" actions={
      <Button onClick={() => bindings.onValidate?.(node.objectId)}>Re-check</Button>
    }>
      <ul className="xr-checks">
        {checks.map((c) => (
          <li key={c.id} className={`xr-check xr-check--${c.status}`}>
            <span className="xr-check__status">{c.status}</span>
            <span className="xr-check__validator">{c.validator}</span>
            <span className="xr-check__summary">{c.summary}</span>
            {c.formRole && <span className="xr-check__role">{c.formRole}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------------------------------------------------- rebuild preview */

const BUCKETS = [
  { key: "willRebuild", title: "Will rebuild", note: "free, and produces the same bytes" },
  { key: "canRegenerate", title: "Can regenerate", note: "costs money, and produces something different" },
  { key: "waitingOnYou", title: "Waiting on you", note: "XENIUR cannot do this one" },
  { key: "blocked", title: "Blocked", note: "waiting on something earlier" },
] as const;

/**
 * Three honest columns rather than a progress bar.
 *
 * The distinction is the whole point: a deterministic step can be re-run for nothing, a
 * generative one produces something *different* and so must never overwrite a decision,
 * and a manual step is simply not XENIUR's to perform.
 */
export function RebuildPreview({ node, bindings }: { node: Node<"RebuildPreview">; bindings: SceneBindings }) {
  const plan = bindings.rebuildPlan?.[node.objectId];
  if (!plan) return <Empty>Nothing to rebuild.</Empty>;

  const pending = plan.willRebuild.length + plan.canRegenerate.length +
                  plan.waitingOnYou.length + plan.blocked.length;
  if (pending === 0) {
    return <Panel title="Rebuild"><Empty>Everything is up to date.</Empty></Panel>;
  }

  return (
    <Panel
      title="Rebuild"
      actions={plan.willRebuild.length > 0 ? (
        <Button variant="primary" onClick={() => bindings.onRebuild?.(node.objectId, false)}>
          Rebuild {plan.willRebuild.length} · free
        </Button>
      ) : undefined}
    >
      <div className="xr-rebuild">
        {BUCKETS.map(({ key, title, note }) => {
          const steps = plan[key];
          if (steps.length === 0) return null;
          return (
            <div key={key} className={`xr-rebuild__bucket xr-rebuild__bucket--${key}`}>
              <h3>{title}<span> {note}</span></h3>
              <ul>
                {steps.map((s) => (
                  <li key={s.stepKey}>
                    <span className="xr-rebuild__step">{s.stepKey}</span>
                    <span className="xr-rebuild__why">{s.reason}</span>
                  </li>
                ))}
              </ul>
              {key === "canRegenerate" && (
                <Button onClick={() => bindings.onRebuild?.(node.objectId, true)}>
                  Regenerate · ${plan.estimatedUsd.toFixed(2)}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------- version timeline */

export function VersionTimeline({ node, bindings }: { node: Node<"VersionTimeline">; bindings: SceneBindings }) {
  const history = bindings.history?.[node.objectId];
  const state = bindings.states[node.objectId];
  if (!history || !state) return <Empty>No history yet.</Empty>;

  return (
    <Panel title="History" actions={
      <>
        <Button onClick={() => bindings.onUndo?.(node.objectId)}>Undo</Button>
        <Button onClick={() => bindings.onRedo?.(node.objectId)}>Redo</Button>
      </>
    }>
      <div className="xr-branches">
        {history.branches.map((b) => (
          <button
            key={b.id} type="button"
            className={`xr-branch${b.id === state.branchId ? " is-current" : ""}`}
            onClick={() => bindings.onSwitchBranch?.(node.objectId, b.id)}
          >{b.name}</button>
        ))}
      </div>
      <ol className="xr-versions">
        {history.versions.map((v) => (
          <li
            key={v.id}
            className={`xr-version${v.id === state.versionId ? " is-current" : ""}`}
          >
            <span className="xr-version__seq">v{v.seq}</span>
            <span className="xr-version__label">{v.label ?? "(no label)"}</span>
            <span className="xr-version__forms">{v.formCount} form{v.formCount === 1 ? "" : "s"}</span>
            {v.id === state.versionId && <span className="xr-version__here">showing</span>}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/* -------------------------------------------------------------- import drop */

export function ImportDrop({ node, bindings }: { node: Node<"ImportDrop">; bindings: SceneBindings }) {
  return (
    <div
      className="xr-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const paths = [...e.dataTransfer.files].map((f) => (f as File & { path?: string }).path)
          .filter((p): p is string => typeof p === "string");
        if (paths.length > 0) bindings.onImport?.(paths, node.objectId ?? null);
      }}
    >
      <p>{node.label}</p>
      <p className="xr-dim">
        A .blend, .glb, .stl, an image, a video, a PDF or a note. The original is kept.
      </p>
    </div>
  );
}
