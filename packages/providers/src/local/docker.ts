import { CapabilityUnavailable } from "@xeniur/core";
import type { Provider, ProviderCall, ProviderResult, Availability } from "../types.js";
import { probeDocker } from "./probe.js";

/**
 * Python and Node workloads are meant to run in local containers. Docker is not
 * installed on this machine, so the capability reports itself unavailable with the
 * actual reason rather than failing obscurely somewhere deeper. The browser-based
 * preview runtime for HTML/CSS/JS/React is unaffected and works today.
 */
export async function dockerAvailable(): Promise<Availability> {
  // Short-TTL cached rather than remembered forever, so a Docker that gets started later
  // is actually noticed instead of being written off for the life of the process.
  return probeDocker();
}

export const dockerProvider: Provider = {
  id: "local.docker",
  kind: "deterministic",
  tools: ["code.run"],

  available: dockerAvailable,

  async execute(call: ProviderCall): Promise<ProviderResult> {
    const state = await dockerAvailable();
    if (!state.ok) throw new CapabilityUnavailable(call.tool, state.reason);
    throw new CapabilityUnavailable(call.tool, "container runners land in M2");
  },
};
