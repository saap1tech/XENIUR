import { useCallback, useEffect, useMemo, useState } from "react";
import type { EnvelopeSheet, ExitReason, ModeEnvelopeInput, ModeRecord, ObjectDetail, Scene } from "@xeniur/core";
import { SceneRenderer, type SceneBindings } from "@xeniur/ui";
import { SituationSchema, compileSituation, layoutScene } from "@xeniur/grammar";

/**
 * Focus Mode — the host for a Focus Contract.
 *
 * XENIUR goes quiet: no Active list, no suggestions, no task toasts, no navigation, one
 * thing in view. It does *not* touch anything outside this window, and it says so — a mode
 * that claimed to silence the machine would be a lie the person discovers the first time a
 * notification arrives mid-session.
 *
 * Nothing starts until the envelope has been read. The sheet comes first — duration, what is
 * quiet, the exit — and its digest is what `start` requires. While running, a thin rule at
 * the top carries the name, the remaining time and Exit; Escape is the emergency exit and
 * asks nothing. When the mode ends, for any reason, the host hands back the Object that had
 * the centre slot so it can be restored exactly.
 */
export function FocusMode({ objectId, minutes, worldId, onExit }: {
  objectId: string;
  minutes: number;
  worldId: string;
  /** Called once when the mode is over, with the Object to restore to the centre. */
  onExit(resumeObjectId: string): void;
}) {
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [sheet, setSheet] = useState<EnvelopeSheet | null>(null);
  const [mode, setMode] = useState<ModeRecord | null>(null);
  const bridge = window.xeniur;

  const envelope: ModeEnvelopeInput = useMemo(() => ({
    durationMinutes: Math.max(1, minutes),
    restrictions: ["no task toasts", "no suggestions", "no navigation"],
    exitPolicy: "always",
    resumeObjectId: objectId,
  }), [minutes, objectId]);

  useEffect(() => {
    void bridge?.living.detail(objectId).then(setDetail);
    void bridge?.modes?.describe("focus_contract", envelope).then(setSheet);
  }, [bridge, objectId, envelope]);

  const leave = useCallback((reason: ExitReason) => {
    if (mode) void bridge?.modes?.exit(mode.id, reason);
    onExit(objectId);
  }, [bridge, mode, objectId, onExit]);

  // Escape before the mode starts is simply "Not now". Once running, the rule owns Escape.
  useEffect(() => {
    if (mode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onExit(objectId); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, objectId, onExit]);

  // The mode completes itself by duration; poll the record so the rule can end on time.
  useEffect(() => {
    if (!mode) return;
    const timer = setInterval(() => {
      void bridge?.modes?.active().then((running) => {
        if (!running.some((m) => m.id === mode.id)) { clearInterval(timer); onExit(objectId); }
      });
    }, 5_000);
    return () => clearInterval(timer);
  }, [bridge, mode, objectId, onExit]);

  const bindings: SceneBindings = useMemo(() => ({
    states: detail ? { [objectId]: detail.state } : {},
    representations: Object.fromEntries((detail?.representations ?? []).map((r) => [r.id, r])),
    tasks: {},
    modeSheets: sheet ? { [sheet.digest]: sheet } : {},
    modes: mode ? { [mode.id]: mode } : {},
    blobUrl: (hash) => bridge?.blobs.url(hash) ?? "",
    onExitFocus: () => leave("left"),
    onStartMode: async (kind, sheetDigest) => {
      const started = await bridge?.modes?.start(kind, envelope, sheetDigest, worldId);
      if (started) setMode(started);
    },
    onDeclineMode: () => onExit(objectId),
    onExitMode: (_modeId, reason) => leave(reason),
  }), [detail, objectId, sheet, mode, bridge, envelope, worldId, leave, onExit]);

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

  // Review first. The work is not shown until the contract has been read and begun.
  if (!mode) {
    const review: Scene | null = sheet ? {
      worldId, title: "", reason: "",
      root: { id: "mode", component: "Canvas", layout: "column",
        children: [{ id: "sheet", component: "FocusContract", phase: "review", sheetDigest: sheet.digest, modeId: null } as never] },
    } : null;
    return (
      <div className="xr-focusmode xr-focusmode--review">
        {review ? <SceneRenderer scene={review} bindings={bindings} /> : <p className="xr-empty">Loading…</p>}
      </div>
    );
  }

  const rule: Scene = {
    worldId, title: "", reason: "",
    root: { id: "rule", component: "Canvas", layout: "column",
      children: [{ id: "running", component: "FocusContract", phase: "running", sheetDigest: null, modeId: mode.id } as never] },
  };

  return (
    <div className="xr-focusmode">
      <SceneRenderer scene={rule} bindings={bindings} />
      {scene
        ? <SceneRenderer scene={scene} bindings={bindings} />
        : <p className="xr-empty">Loading…</p>}
    </div>
  );
}
