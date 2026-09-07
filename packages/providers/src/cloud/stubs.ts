import { CapabilityUnavailable } from "@xeniur/core";
import type { Provider, ProviderCall, ProviderEnv, ProviderResult, Availability } from "../types.js";
import { keyPresent, loadProvidersConfig } from "../config.js";

/**
 * Cloud providers are declared, ordered and priced in config, but nothing here can run
 * without a key that is actually present *and* an explicit enable in config. Two locks,
 * because an accidental first call is the expensive kind of mistake.
 *
 * Their prices in config/providers.json are marked unverified: confirm them against each
 * provider's live pricing page before enabling one.
 */
function makeStub(id: string, tools: Provider["tools"]): Provider {
  return {
    id, kind: "generative", tools,

    async available(env: ProviderEnv): Promise<Availability> {
      const entry = loadProvidersConfig(env.rootDir).providers[id];
      if (!entry) return { ok: false, reason: `${id} is not declared in config/providers.json` };
      if (!entry.enabled) return { ok: false, reason: `${id} is disabled in config` };
      if (!keyPresent(entry)) return { ok: false, reason: `${entry.requiresKey} is not set` };
      if (entry.modelVerified === false) {
        return { ok: false, reason: `${id} model "${entry.model}" and its price are unverified` };
      }
      return { ok: false, reason: `${id} client is not implemented in V1` };
    },

    async execute(call: ProviderCall, env: ProviderEnv): Promise<ProviderResult> {
      const state = await this.available(env);
      throw new CapabilityUnavailable(call.tool, state.ok ? "not implemented" : state.reason);
    },
  };
}

export const openaiImageProvider = makeStub("openai.image", ["image.generate"]);
export const meshyProvider = makeStub("meshy", ["3d.generate"]);
export const runwayProvider = makeStub("runway", ["video.generate"]);
