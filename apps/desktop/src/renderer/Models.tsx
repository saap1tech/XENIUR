import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelProviderView, Scene } from "@xeniur/core";
import { SceneRenderer, emptyBindings, t, type SceneBindings } from "@xeniur/ui";
import { BrandMark } from "./BrandMark.js";

const WORLD_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

/**
 * Your models — reached when a task needs it, never before.
 *
 * The Ask sheet opens this when the resolved destination is remote and no key exists; the
 * palette opens it under the same name at any time. `reason` is the sentence that brought
 * the person here, so the screen says why it appeared. Back returns to exactly where the
 * person was.
 */
export function Models({ reason, onBack }: { reason?: string | null; onBack(): void }) {
  const bridge = typeof window === "undefined" ? undefined : window.xeniur;
  const [providers, setProviders] = useState<ModelProviderView[]>([]);
  const [verification, setVerification] = useState<Record<string, { ok: boolean; models: string[]; reason: string | null }>>({});

  const refresh = useCallback(async () => { setProviders((await bridge?.models?.list()) ?? []); }, [bridge]);
  useEffect(() => { void refresh(); }, [refresh]);

  const bindings: SceneBindings = useMemo(() => ({
    ...emptyBindings(),
    modelProviders: providers,
    modelVerification: verification,
    onAddModelKey: async (provider, key) => { setProviders((await bridge?.models.add(provider, key)) ?? []); },
    onRemoveModelKey: async (provider) => { setProviders((await bridge?.models.remove(provider)) ?? []); },
    onVerifyModel: async (provider) => {
      const r = await bridge?.models.verify(provider);
      if (r) setVerification((v) => ({ ...v, [provider]: r }));
    },
  }), [bridge, providers, verification]);

  const scene: Scene = {
    worldId: WORLD_PLACEHOLDER, title: t("models.title"), reason: "your models",
    root: { id: "root", component: "Canvas", layout: "column",
            children: [{ id: "m", component: "ModelSetup", firstRun: false } as never] },
  };

  return (
    <main className="xr-models-view">
      <header className="xr-models-view__head">
        <button type="button" className="xr-back" onClick={onBack}>← {t("models.back")}</button>
        <BrandMark compact />
      </header>
      {reason && <p className="xr-models-view__reason" role="status">{reason}</p>}
      <section className="xr-firstrun__scene">
        <SceneRenderer scene={scene} bindings={bindings} />
      </section>
    </main>
  );
}
