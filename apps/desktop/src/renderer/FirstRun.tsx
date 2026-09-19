import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelProviderView, Scene } from "@xeniur/core";
import { SceneRenderer, emptyBindings, type SceneBindings } from "@xeniur/ui";
import { BrandMark } from "./BrandMark.js";

const WORLD_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

/**
 * Three scenes, all skippable. No form wall.
 *
 * 1. The mark and one sentence.
 * 2. Your models — providers as cards, what each key unlocks, Skip for now as a first-class exit.
 * 3. Your first project — bring something in, or open the example.
 *
 * Each scene has one idea and a visible Skip in the same weight as Continue. Skipping all
 * three leaves every local capability usable, and every scene is reachable again from
 * Settings under the same name — a first run adds nothing that cannot be reached later.
 */
export function FirstRun({ onDone, onImport, onOpenExample }: {
  onDone(): void;
  onImport(): void;
  onOpenExample(): void;
}) {
  const bridge = window.xeniur;
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [providers, setProviders] = useState<ModelProviderView[]>([]);
  const [verification, setVerification] = useState<Record<string, { ok: boolean; models: string[]; reason: string | null }>>({});

  const refresh = useCallback(async () => {
    setProviders((await bridge?.models.list()) ?? []);
  }, [bridge]);
  useEffect(() => { void refresh(); }, [refresh]);

  const finish = useCallback(async () => {
    await bridge?.models.finishFirstRun();
    onDone();
  }, [bridge, onDone]);

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
    onSkipFirstRun: () => setStep(2),
    onContinueFirstRun: () => setStep(2),
  }), [bridge, providers, verification]);

  const modelsScene: Scene = {
    worldId: WORLD_PLACEHOLDER, title: "Your models", reason: "first run",
    root: { id: "root", component: "Canvas", layout: "column",
            children: [{ id: "m", component: "ModelSetup", firstRun: true } as never] },
  };

  return (
    <main className="xr-firstrun" aria-live="polite">
      <ol className="xr-firstrun__steps" aria-label="Setup">
        {["Welcome", "Your models", "Your first project"].map((label, i) => (
          <li key={label} className={i === step ? "is-current" : i < step ? "is-done" : ""}>{label}</li>
        ))}
      </ol>

      {step === 0 && (
        <section className="xr-firstrun__scene xr-firstrun__welcome">
          <BrandMark />
          <h1>XENIUR keeps your sources, decisions and deliveries connected — and shows you what it did.</h1>
          <div className="xr-firstrun__actions">
            <button type="button" className="xr-button" onClick={() => void finish()}>Skip</button>
            <button type="button" className="xr-button xr-button--primary" onClick={() => setStep(1)}>Begin</button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="xr-firstrun__scene">
          <SceneRenderer scene={modelsScene} bindings={bindings} />
        </section>
      )}

      {step === 2 && (
        <section className="xr-firstrun__scene xr-firstrun__project">
          <h1>Your first project</h1>
          <p>Bring something in — a file, a page, a note — or open the example to see the shape of the work.</p>
          <div className="xr-firstrun__choices">
            <button type="button" className="xr-firstrun__choice" onClick={() => { void finish(); onImport(); }}>
              <strong>Bring something in</strong>
              <span>A .blend, an image, a document, an article.</span>
            </button>
            <button type="button" className="xr-firstrun__choice" onClick={() => { void finish(); onOpenExample(); }}>
              <strong>Open the example</strong>
              <span>Rainwear 2027 — marked as an example, safe to change.</span>
            </button>
          </div>
          <div className="xr-firstrun__actions">
            <button type="button" className="xr-button" onClick={() => void finish()}>Skip</button>
          </div>
        </section>
      )}
    </main>
  );
}
