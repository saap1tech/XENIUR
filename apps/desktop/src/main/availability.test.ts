import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_PROVIDERS } from "@xeniur/providers";
import { AVAILABILITY, FEATURES, describeAvailability } from "@xeniur/core";
import { availabilityFrom, type RuntimeShape } from "./availability.js";

/** Gate 0: what a screen says a build can do comes from the assembled runtime, in four words. */
const base: RuntimeShape = {
  brainLive: false, brainPriceVerified: false, keychainAvailable: true,
  cloudProviders: [], outreachConfigured: false, riskMode: "local_only", riskKeyPresent: false,
  providerIdsInConfig: ["local.import", "local.sharp"], providerIdsImplemented: ["local.import", "local.sharp"],
  handsWired: false, capabilityRegistryWired: false, browserManualWired: true, browserDelegatedWired: false, serviceRoutes: [],
};

describe("availability is read, not assumed", () => {
  it("this build, as shipped: brain disabled by policy, no cloud key, hands and registry not implemented, browsing available", () => {
    const r = availabilityFrom(base).features;
    expect(r["brain.live"].state).toBe("disabled_by_policy");
    expect(r["models.cloud"].state).toBe("needs_setup");
    expect(r["browser.manual"].state).toBe("available");
    // The driver exists now; what is missing is an account and a tab to act in.
    expect(r["browser.delegated"].state).toBe("needs_setup");
    expect(r["browser.delegated"].because).toMatch(/only where you can watch/);
    expect(r["browser.route.service_api"].state).toBe("not_implemented");
    expect(r["outreach.send"].state).toBe("disabled_by_policy");
    expect(r["web.risk_lookup"].state).toBe("disabled_by_policy");
    expect(r["hands.playwright"].state).toBe("not_implemented");
    expect(r["capabilities.registry"].state).toBe("not_implemented");
  });

  it("acting in a tab is available once an account and a tab exist", () => {
    expect(availabilityFrom({ ...base, browserDelegatedWired: true }).features["browser.delegated"].state).toBe("available");
  });

  it("a configured route with a token is available; one without is setup; none at all is not implemented", () => {
    expect(availabilityFrom({ ...base, serviceRoutes: [{ id: "r", endpoint: true, token: true }] }).features["browser.route.service_api"].state).toBe("available");
    expect(availabilityFrom({ ...base, serviceRoutes: [{ id: "r", endpoint: true, token: false }] }).features["browser.route.service_api"].state).toBe("needs_setup");
    expect(availabilityFrom(base).features["browser.route.service_api"].state).toBe("not_implemented");
  });

  it("every one of the four states is reachable, and each carries a reason", () => {
    const states = new Set<string>();
    const shapes: RuntimeShape[] = [
      base,
      { ...base, cloudProviders: [{ id: "openai", keyPresent: true, callableModels: 2 }], brainLive: true, brainPriceVerified: true },
      { ...base, keychainAvailable: false },
      { ...base, riskMode: "google_lookup", riskKeyPresent: false },
    ];
    for (const s of shapes) for (const f of Object.values(availabilityFrom(s).features)) { states.add(f.state); expect(f.because.length).toBeGreaterThan(8); }
    for (const st of AVAILABILITY) expect(states.has(st), `${st} never produced`).toBe(true);
  });

  it("a provider named in config but implemented nowhere is reported as not implemented, by name", () => {
    const r = availabilityFrom({ ...base, providerIdsInConfig: ["local.playwright"] }).features["hands.playwright"];
    expect(r.state).toBe("not_implemented");
    expect(r.because).toContain("local.playwright");
  });

  it("the shipped config names only providers the registry implements", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "config/providers.json"), "utf8")) as { capabilities: Record<string, { order: string[] }> };
    const implemented = new Set(ALL_PROVIDERS.map((p) => p.id));
    for (const [cap, c] of Object.entries(config.capabilities)) {
      for (const id of c.order) expect(implemented.has(id), `${cap} names ${id}, which no provider implements`).toBe(true);
    }
  });

  it("describes every feature in one sentence, with the state word", () => {
    const lines = describeAvailability(availabilityFrom(base));
    expect(lines).toHaveLength(FEATURES.length);
    expect(lines.join("\n")).toMatch(/disabled by policy/);
    expect(lines.join("\n")).toMatch(/not implemented/);
  });
});
