import { useEffect, useRef, useState } from "react";
import type { LeafSceneNode, PermissionLevel } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Button, Empty, Panel } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

export function Document({ node, bindings }: { node: Node<"Document">; bindings: SceneBindings }) {
  const state = bindings.states[node.objectId];
  const rep = Object.values(bindings.representations)
    .filter((r) => r.objectId === node.objectId && r.modality === "text").pop();
  if (!state) return null;
  return (
    <Panel title={state.properties.title}>
      {rep?.blobHash
        ? <article className="xr-doc" data-editable={node.editable}>{String(rep.generationParams["preview"] ?? "")}</article>
        : <Empty>Nothing written yet.</Empty>}
    </Panel>
  );
}

export function Timeline({ node, bindings }: { node: Node<"Timeline">; bindings: SceneBindings }) {
  const total = Math.max(node.durationMs, 1);
  return (
    <Panel title="Timeline">
      <div className="xr-timeline">
        {node.objectIds.map((id, i) => {
          const state = bindings.states[id];
          return (
            <div key={id} className="xr-timeline__clip" style={{ flexGrow: 1 }}>
              <span>{state?.properties.title ?? `clip ${i + 1}`}</span>
            </div>
          );
        })}
      </div>
      <p className="xr-dim">{(total / 1000).toFixed(1)}s</p>
    </Panel>
  );
}

/** The Active area: five statuses, straight from the queue's own events. */
export function TaskProgress({ node, bindings }: { node: Node<"TaskProgress">; bindings: SceneBindings }) {
  const tasks = node.taskIds.map((id) => bindings.tasks[id]).filter((t) => t !== undefined);
  if (tasks.length === 0) return <Empty>Nothing running.</Empty>;
  return (
    <ul className="xr-tasks">
      {tasks.map((task) => (
        <li key={task.id} className={`xr-task xr-task--${task.status}`}>
          <span className="xr-task__title">{task.title}</span>
          <span className="xr-task__detail">{task.detail ?? task.status}</span>
          <div className="xr-task__bar"><div style={{ width: `${Math.round(task.progress * 100)}%` }} /></div>
          {task.status === "needs_approval" && (
            <div className="xr-task__actions">
              <Button variant="primary" onClick={() => bindings.onApprove?.(task.id)}>Approve</Button>
              <Button onClick={() => bindings.onReject?.(task.id)}>Decline</Button>
            </div>
          )}
          {(task.status === "queued" || task.status === "running") && bindings.onCancel && (
            <div className="xr-task__actions">
              <Button onClick={() => bindings.onCancel?.(task.id)}>Stop</Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Nothing consequential happens without this dialog. It states the actual consequence in
 * the person's terms — "Book court · 5:00 PM · $18" — because a confirmation nobody can
 * read is not a confirmation.
 */
export function ApprovalDialog({ node, bindings }: { node: Node<"ApprovalDialog">; bindings: SceneBindings }) {
  const wording: Partial<Record<PermissionLevel, string>> = {
    COMMUNICATE: "This sends something on your behalf.",
    COMMIT: "This commits you to something.",
    PURCHASE: "This spends your money.",
    DESTRUCTIVE: "This cannot be undone.",
  };
  return (
    <div className={`xr-approval xr-approval--${node.level.toLowerCase()}`} role="alertdialog">
      <p className="xr-approval__preview">{node.preview}</p>
      {node.detail && <p className="xr-approval__detail">{node.detail}</p>}
      <p className="xr-approval__level">{wording[node.level] ?? "This needs your confirmation."}</p>
      {/* Consent binds to this plan and no other: the tool, the things it touches, the digest. */}
      {(node.tool || node.planDigest) && (
        <dl className="xr-approval__plan">
          {node.tool && <div><dt>Does</dt><dd className="xr-mono">{node.tool}</dd></div>}
          <div><dt>Touches</dt><dd>{node.objects.length === 0 ? "nothing in this project" : node.objects.map((id) => bindings.states[id]?.properties.title ?? id.slice(0, 8)).join(" · ")}</dd></div>
          {node.planDigest && <div><dt>Plan</dt><dd className="xr-mono">{node.planDigest.slice(0, 12)}…</dd></div>}
        </dl>
      )}
      <div className="xr-approval__actions">
        <Button variant="primary" onClick={() => bindings.onApprove?.(node.taskId)}>Approve this exact plan</Button>
        <Button onClick={() => bindings.onReject?.(node.taskId)}>Decline</Button>
      </div>
    </div>
  );
}

/**
 * A slot the main process fills with an isolated WebContentsView. The renderer only ever
 * reports where the view should sit — it never hosts remote content itself.
 */
export function Browser({ node }: { node: Node<"Browser">; bindings: SceneBindings }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      window.xeniur?.browser.setBounds(node.viewId, {
        x: Math.round(r.x), y: Math.round(r.y),
        width: Math.round(r.width), height: Math.round(r.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("scroll", report, true);
    return () => { observer.disconnect(); window.removeEventListener("scroll", report, true); };
  }, [node.viewId]);
  return <div ref={ref} className="xr-browser" data-view-id={node.viewId} data-url={node.url} />;
}

export function CodePreview({ node, bindings }: { node: Node<"CodePreview">; bindings: SceneBindings }) {
  const files = bindings.projectFiles?.(node.objectId) ?? {};
  const paths = Object.keys(files);
  const [open, setOpen] = useState<string | undefined>(paths[0]);
  const selected = open ?? paths[0];
  return (
    <Panel
      title={bindings.states[node.objectId]?.properties.title ?? "Project"}
      actions={node.running
        ? <Button onClick={() => bindings.onStop?.(node.objectId)}>Stop</Button>
        : <Button variant="primary" onClick={() => bindings.onRun?.(node.objectId)}>Run</Button>}
    >
      {paths.length === 0 ? <Empty>No files yet.</Empty> : (
        <div className="xr-code">
          <ul className="xr-code__files">
            {paths.map((p) => (
              <li key={p}>
                <button type="button" className={p === selected ? "is-open" : ""} onClick={() => setOpen(p)}>{p}</button>
              </li>
            ))}
          </ul>
          <pre className="xr-code__body">{selected ? files[selected] : ""}</pre>
        </div>
      )}
      <p className="xr-dim">Entry: {node.entry} · runs in an isolated preview, never in XENIUR's own process.</p>
    </Panel>
  );
}
