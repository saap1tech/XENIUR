import { useState } from "react";
import type { LeafSceneNode, ModelProviderView } from "@xeniur/core";
import type { SceneBindings } from "../bindings.js";
import { Button, Empty } from "./primitives.jsx";

type Node<T extends LeafSceneNode["component"]> = Extract<LeafSceneNode, { component: T }>;

/**
 * Your models.
 *
 * The providers as cards on hairlines. Beneath each, what a key unlocks in the economy's
 * three tiers: Unlimited Local is already lit, because it never depended on a key; Included
 * Intelligence lights when a key verifies. The key is typed into a field that is sent once
 * and never shown again — the card afterwards says *key stored in your keychain* and offers
 * Remove.
 *
 * Skip for now is a first-class exit in the same weight as Continue. The person leaves with
 * everything local working, and the scene is reachable again from Settings under the same
 * name. A first run adds nothing that cannot be reached again.
 */
export function ModelSetup({ node, bindings }: { node: Node<"ModelSetup">; bindings: SceneBindings }) {
  const providers = bindings.modelProviders ?? [];
  // No providers is a state the scene has to survive: the exits are the same, and the person
  // is never held on a screen that has nothing to offer them.
  if (providers.length === 0) {
    return (
      <section className="xr-models" aria-labelledby="xr-models-title">
        <header className="xr-models__head"><h2 id="xr-models-title">Your models</h2></header>
        <Empty>No model providers are configured. Everything local works with no key at all.</Empty>
        {node.firstRun && (
          <footer className="xr-models__foot">
            <Button onClick={() => bindings.onSkipFirstRun?.()}>Skip for now</Button>
            <Button variant="primary" onClick={() => bindings.onContinueFirstRun?.()}>Continue</Button>
          </footer>
        )}
      </section>
    );
  }

  return (
    <section className="xr-models" aria-labelledby="xr-models-title">
      <header className="xr-models__head">
        <h2 id="xr-models-title">Your models</h2>
        <p>
          XENIUR routes across the models you already pay for. Add a key and it unlocks
          Included Intelligence for that provider — there is no second bill. Everything local
          works with no key at all.
        </p>
      </header>

      <ul className="xr-models__grid">
        {providers.map((p) => <ProviderCard key={p.id} provider={p} bindings={bindings} />)}
      </ul>

      <footer className="xr-models__foot">
        {node.firstRun ? (
          <>
            <Button onClick={() => bindings.onSkipFirstRun?.()}>Skip for now</Button>
            <Button variant="primary" onClick={() => bindings.onContinueFirstRun?.()}>Continue</Button>
          </>
        ) : (
          <span className="xr-models__note">Keys are encrypted by your operating system and never written into a project, a package or a report.</span>
        )}
      </footer>
    </section>
  );
}

function ProviderCard({ provider: p, bindings }: { provider: ModelProviderView; bindings: SceneBindings }) {
  const [draft, setDraft] = useState("");
  const verification = bindings.modelVerification?.[p.id];
  const anyVerified = p.models.some((m) => m.priceVerifiedOn !== null);

  return (
    <li className={`xr-model${p.keyPresent ? " has-key" : ""}${p.local ? " is-local" : ""}`}>
      <header className="xr-model__head">
        <h3>{p.label}</h3>
        {p.local && <span className="xr-tag">on this machine</span>}
        {!p.local && p.keyPresent && <span className="xr-tag xr-tag--ok">key stored in your keychain</span>}
      </header>

      {/* What a key unlocks, in the three tiers. Local is lit already. */}
      <ol className="xr-model__tiers" aria-label="What this unlocks">
        <li className="is-lit"><span>Unlimited Local</span><small>always — the machine is yours</small></li>
        <li className={p.keyPresent ? "is-lit" : ""}>
          <span>Included Intelligence</span>
          <small>{p.unlocks.intelligence.length} model{p.unlocks.intelligence.length === 1 ? "" : "s"}</small>
        </li>
        <li className={p.unlocks.generation.length > 0 && p.keyPresent ? "is-lit" : ""}>
          <span>Metered Generation</span>
          <small>{p.unlocks.generation.length === 0 ? "not from this key" : `${p.unlocks.generation.length} tools`}</small>
        </li>
      </ol>

      <ul className="xr-model__models">
        {p.models.map((m) => (
          <li key={m.id}>
            <span>{m.label}</span>
            {p.local
              ? <span className="xr-tag xr-tag--ok">local · no cost</span>
              : m.priceVerifiedOn
                ? <span className="xr-tag xr-tag--ok">price checked {m.priceVerifiedOn}</span>
                : <span className="xr-tag xr-tag--review">price not verified — XENIUR will not call this</span>}
          </li>
        ))}
      </ul>

      {!p.local && !p.keyPresent && (
        <form className="xr-model__add" onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim().length >= 8) { bindings.onAddModelKey?.(p.id, draft.trim()); setDraft(""); }
        }}>
          <label>
            <span>API key</span>
            <input type="password" autoComplete="off" spellCheck={false} value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!p.canStore}
              placeholder={p.canStore ? "paste once — it is not shown again" : "this machine's keychain is unavailable"} />
          </label>
          <Button type="submit" variant="primary" disabled={!p.canStore || draft.trim().length < 8}>Store key</Button>
        </form>
      )}

      {(p.keyPresent || p.local) && (
        <div className="xr-model__actions">
          <Button onClick={() => bindings.onVerifyModel?.(p.id)}>
            Verify{p.local ? "" : " (free — lists models, never a completion)"}
          </Button>
          {!p.local && <Button onClick={() => bindings.onRemoveModelKey?.(p.id)}>Remove key</Button>}
        </div>
      )}

      {verification && (
        <p className={`xr-model__verify ${verification.ok ? "is-ok" : "is-bad"}`} role="status">
          {verification.ok
            ? `verified · ${verification.models.length} model${verification.models.length === 1 ? "" : "s"} listed${anyVerified ? "" : " · prices still unverified"}`
            : verification.reason}
        </p>
      )}
    </li>
  );
}
