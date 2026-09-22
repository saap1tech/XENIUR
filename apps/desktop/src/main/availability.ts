import type { AvailabilityReport, Feature, FeatureAvailability } from "@xeniur/core";
import type { Services } from "./services.js";

/**
 * Reads what the assembled runtime can do — from the objects that were actually constructed,
 * never from config alone. A provider named in config that does not exist in the registry is
 * `not_implemented`; a switch held closed in code is `disabled_by_policy`; a missing key or
 * endpoint is `needs_setup`. Nothing here is cached: the report is as old as the call.
 */
export interface RuntimeShape {
  brainLive: boolean;
  brainPriceVerified: boolean;
  keychainAvailable: boolean;
  cloudProviders: Array<{ id: string; keyPresent: boolean; callableModels: number }>;
  outreachConfigured: boolean;
  riskMode: "local_only" | "google_lookup";
  riskKeyPresent: boolean;
  providerIdsInConfig: string[];
  providerIdsImplemented: string[];
  handsWired: boolean;
  capabilityRegistryWired: boolean;
  browserManualWired: boolean;
  browserDelegatedWired: boolean;
  serviceRoutes: Array<{ id: string; endpoint: boolean; token: boolean }>;
}

export function availabilityFrom(r: RuntimeShape, at = Date.now()): AvailabilityReport {
  const f = (state: FeatureAvailability["state"], because: string): FeatureAvailability => ({ state, because });
  const missingProviders = r.providerIdsInConfig.filter((id) => !r.providerIdsImplemented.includes(id));
  const withKey = r.cloudProviders.filter((p) => p.keyPresent);
  const callable = withKey.filter((p) => p.callableModels > 0);

  const features: Record<Feature, FeatureAvailability> = {
    "brain.live": r.brainLive
      ? (r.brainPriceVerified ? f("available", "live calls are switched on and the price is verified")
        : f("needs_setup", "live calls are switched on but no model has a verified price"))
      : f("disabled_by_policy", "liveCallsEnabled is false in the desktop services; no request is made and no key is read"),
    "models.cloud": !r.keychainAvailable
      ? f("needs_setup", "the operating system keychain is not available, so no key can be stored")
      : withKey.length === 0 ? f("needs_setup", "no cloud key is stored; add one under Your models")
      : callable.length === 0 ? f("needs_setup", `${withKey.length} key${withKey.length === 1 ? "" : "s"} stored, but no model with a verified price is callable`)
      : f("available", `${callable.length} provider${callable.length === 1 ? "" : "s"} with a key and a verified price`),
    "browser.manual": r.browserManualWired ? f("available", "isolated tabs, HTTPS only, address policy on every frame") : f("not_implemented", "no browser shell is constructed"),
    "browser.delegated": r.browserDelegatedWired
      ? f("available", "bound to a tab you can see, with a grant you gave")
      : f("needs_setup", "add one of your accounts and open a tab; the assistant acts only where you can watch"),
    "browser.route.service_api": r.serviceRoutes.length === 0
      ? f("not_implemented", "no service route adapter is constructed")
      : r.serviceRoutes.some((s) => s.endpoint && s.token) ? f("available", `${r.serviceRoutes.filter((s) => s.endpoint && s.token).length} route${r.serviceRoutes.length === 1 ? "" : "s"} configured with a token`)
      : f("needs_setup", "a route exists but has no endpoint or no token"),
    "outreach.send": r.outreachConfigured ? f("available", "a transport is configured") : f("disabled_by_policy", "the desktop installs DisabledTransport: the mechanism is complete and nothing is reachable"),
    "web.risk_lookup": r.riskMode === "local_only"
      ? f("disabled_by_policy", "local-only mode: the address policy applies, no URL leaves the machine")
      : r.riskKeyPresent ? f("available", "Google Web Risk lookup is on; full URLs are sent to Google") : f("needs_setup", "lookup mode is on but GOOGLE_WEB_RISK_API_KEY is not set"),
    "hands.playwright": r.handsWired ? f("available", "the automation package is constructed") : f("not_implemented",
      missingProviders.length > 0 ? `config names ${missingProviders.join(", ")}, which no registry implements; @xeniur/hands is not imported by the desktop` : "@xeniur/hands is not imported by the desktop"),
    "capabilities.registry": r.capabilityRegistryWired ? f("available", "constructed") : f("not_implemented", "CapabilityRegistry is never constructed; Situations receive capabilities: []"),
  };
  return { at, features };
}

/** The shape, read from the live services. Every field comes from a constructed object. */
export function runtimeShape(services: Services, env: NodeJS.ProcessEnv = process.env): RuntimeShape {
  const providers = services.models.list();
  return {
    brainLive: services.gatedBrain.enabled,
    brainPriceVerified: providers.some((p) => p.models.some((m) => m.callable && m.priceVerifiedOn !== null)),
    keychainAvailable: providers.some((p) => p.canStore) || providers.length === 0,
    cloudProviders: providers.filter((p) => !p.local).map((p) => ({ id: p.id, keyPresent: p.keyPresent, callableModels: p.models.filter((m) => m.callable).length })),
    outreachConfigured: services.mail.configured(),
    riskMode: services.compute.preference("web.riskMode", "local_only") === "google_lookup" ? "google_lookup" : "local_only",
    riskKeyPresent: Boolean(env["GOOGLE_WEB_RISK_API_KEY"]),
    providerIdsInConfig: Object.values(services.config.capabilities ?? {}).flatMap((c) => (c as { order?: string[] }).order ?? []),
    providerIdsImplemented: services.providerIds,
    handsWired: false,
    capabilityRegistryWired: false,
    browserManualWired: Boolean(services.browser),
    // Acting in a tab needs a signed-in account and a tab to act in; without one it is setup, not a promise.
    browserDelegatedWired: services.browser.profiles().some((p) => p.kind === "signed_in") && services.browser.tabs().length > 0,
    serviceRoutes: services.routes.endpoints.map((e) => ({ id: e.id, endpoint: Boolean(e.endpoint), token: services.routes.tokens.has(e.id) })),
  };
}

export function runtimeAvailability(services: Services): AvailabilityReport {
  return availabilityFrom(runtimeShape(services));
}
