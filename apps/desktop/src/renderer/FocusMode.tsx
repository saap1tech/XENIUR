import { useEffect, useMemo, useState } from "react";
import type { ObjectDetail, Scene } from "@xeniur/core";
import { SceneRenderer, type SceneBindings } from "@xeniur/ui";
import { SituationSchema, compileSituation, layoutScene } from "@xeniur/grammar";

/**
 * Focus Mode.
 *
 * XENIUR goes quiet: no Active list, no suggestions, no task toasts, no navigation, one
 * thing in view. It does *not* touch anything outside this window, and it says so — a mode
 * that claimed to silence the machine would be a lie the person discovers the first time a
 * notification arrives mid-session.
 *
 * Leaving is always one obvious click. A focus mode that is hard to escape is a trap.
 */
export function FocusMode({ objectId, minutes, onExit }: {
  objectId: string;
  minutes: number;
  onExit(): void;
}) {
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [remaining, setRemaining] = useState(minutes * 60);
  const bridge = window.xeniur;

  useEffect(() => {
    void bridge?.living.detail(objectId).then(setDetail);
  }, [bridge, objectId]);

  useEffect(() => {
    if (minutes <= 0) return;
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(timer);
  }, [minutes]);

  // Escape leaves. Nothing else is bound, because nothing else should happen in here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const bindings: SceneBindings = useMemo(() => ({
    states: detail ? { [objectId]: detail.state } : {},
    representations: Object.fromEntries((detail?.representations ?? []).map((r) => [r.id, r])),
    tasks: {},
    blobUrl: (hash) => bridge?.blobs.url(hash) ?? "",
    onExitFocus: onExit,
  }), [detail, objectId, bridge, onExit]);

  const scene: Scene | null = detail ? (() => {
    const semantic = compileSituation(SituationSchema.parse({
      worldId: detail.state.object.worldId, title: detail.state.properties.title,
      goal: { kind: "understand", description: `Focus on ${detail.state.properties.title}` },
      scope: { worldId: detail.state.object.worldId, objectIds: [objectId], externalContextAllowed: false },
      meaning: "relationship", interaction: "review", taskStates: ["selected"],
      focus: { kind: "object", id: objectId, label: detail.state.properties.title },
      objects: [{ id: objectId, title: detail.state.properties.title,
        semanticType: detail.state.properties.semanticType,
        traits: detail.state.properties.traits,
        formRoles: detail.state.forms.map((form) => form.role), states: ["selected"] }],
      changes: [], capabilities: [`focus:${minutes}`], constraints: [], choices: [], layer: 1,
    }));
    return layoutScene(semantic, { layoutId: semantic.layoutId });
  })() : null;

  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="xr-focusmode">
      {minutes > 0 && (
        <div className="xr-focusmode__clock" aria-live="off">{mm}:{ss}</div>
      )}
      {scene
        ? <SceneRenderer scene={scene} bindings={bindings} />
        : <p className="xr-empty">Loading…</p>}
    </div>
  );
}
