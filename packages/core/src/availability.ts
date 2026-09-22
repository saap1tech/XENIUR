import { z } from "zod";

/**
 * Availability — what this build, as assembled and configured on this machine, can actually do.
 *
 * Four words, kept apart on purpose: a thing may be **available**; it may **need setup** (a key,
 * an endpoint, a profile — the person can supply it); it may be **disabled by policy** (built,
 * tested, and switched off by a deliberate edit in the code or config, which the person cannot
 * undo from the screen); or it may be **not implemented** (named somewhere, built nowhere). A
 * screen that shows one of these where another is true is lying, and the report is read from
 * the runtime, never remembered.
 */
export const AVAILABILITY = ["available", "needs_setup", "disabled_by_policy", "not_implemented"] as const;
export const AvailabilitySchema = z.enum(AVAILABILITY);
export type Availability = z.infer<typeof AvailabilitySchema>;

export const AVAILABILITY_WORDS: Record<Availability, { label: string; means: string }> = {
  available: { label: "available", means: "Works here, now." },
  needs_setup: { label: "needs setup", means: "Built and switched on; missing something only you can supply." },
  disabled_by_policy: { label: "disabled by policy", means: "Built and tested; held off by a deliberate switch this screen cannot flip." },
  not_implemented: { label: "not implemented", means: "Named, but there is nothing behind the name yet." },
};

export const FEATURES = [
  "brain.live", "models.cloud", "browser.manual", "browser.delegated", "browser.route.service_api",
  "outreach.send", "web.risk_lookup", "hands.playwright", "capabilities.registry",
] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_WORDS: Record<Feature, string> = {
  "brain.live": "Live model calls from the assistant",
  "models.cloud": "Cloud models on your own keys",
  "browser.manual": "Browsing inside XENIUR",
  "browser.delegated": "The assistant acting in a tab you can see",
  "browser.route.service_api": "Sending to a service endpoint you configured",
  "outreach.send": "Sending messages to people",
  "web.risk_lookup": "Address reputation lookup (discloses the URL to Google)",
  "hands.playwright": "A separate automated browser",
  "capabilities.registry": "The capability manifest registry",
};

export interface FeatureAvailability { state: Availability; because: string }
export interface AvailabilityReport {
  at: number;
  features: Record<Feature, FeatureAvailability>;
}

/** One sentence per feature, for a screen reader or a log. */
export function describeAvailability(report: AvailabilityReport): string[] {
  return FEATURES.map((f) => `${FEATURE_WORDS[f]}: ${AVAILABILITY_WORDS[report.features[f].state].label} — ${report.features[f].because}`);
}
