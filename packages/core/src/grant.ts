import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";

/**
 * A grant — what the person allowed, exactly.
 *
 * Four kinds, kept apart because they are four different permissions: signing in is not
 * reading, reading is not sending, a draft is not an action. A grant names the route, the
 * exact visible tab (profile, tab id and the webContents that tab *is*), the origins, the
 * project and goal, the versions of the material approved, the destinations allowed, the
 * classes of action allowed, an expiry and limits. A consequential action additionally binds
 * the digest of the reviewed plan, so consent cannot cover a different one.
 *
 * Nothing observed through a tool can create, widen or renew a grant. Only the person can,
 * through XENIUR's own interface, and only in the trusted process.
 */
export const GRANT_KINDS = ["website_access", "observation", "model_disclosure", "action"] as const;
export const GrantKindSchema = z.enum(GRANT_KINDS);
export type GrantKind = z.infer<typeof GrantKindSchema>;

export const GRANT_KIND_WORDS: Record<GrantKind, { label: string; means: string }> = {
  website_access: { label: "website access", means: "You are signed in to this site, in a profile you chose." },
  observation: { label: "assistant observation", means: "The assistant may read this tab for this task." },
  model_disclosure: { label: "model disclosure", means: "Approved material may go to the named model, for the stated purpose." },
  action: { label: "assistant action", means: "The assistant may perform the operation you reviewed, here." },
};

export const ROUTES = ["embedded_tab", "service_api"] as const;
export const RouteSchema = z.enum(ROUTES);
export type Route = z.infer<typeof RouteSchema>;

export const ACTION_CLASSES = ["read", "fill", "click", "submit", "api_post"] as const;
export const ActionClassSchema = z.enum(ACTION_CLASSES);
export type ActionClass = z.infer<typeof ActionClassSchema>;

export const GRANT_STATES = ["active", "paused", "revoked", "expired", "consumed"] as const;
export const GrantStateSchema = z.enum(GRANT_STATES);
export type GrantState = z.infer<typeof GrantStateSchema>;

export const GrantSchema = z.object({
  id: UuidSchema,
  revision: z.number().int().positive(),
  kind: GrantKindSchema,
  route: RouteSchema.nullable().default(null),
  worldId: UuidSchema,
  goalId: UuidSchema.nullable().default(null),
  /* The exact visible view. A tab id alone is not enough: the webContents is what the tab *is*. */
  profileId: z.string().nullable().default(null),
  tabId: z.string().nullable().default(null),
  webContentsId: z.number().int().nullable().default(null),
  origins: z.array(z.string().min(1)).max(32).default([]),
  /** Text a person read and confirmed. A matching display name is not proof of identity. */
  accountLabel: z.string().max(200).nullable().default(null),
  accountVerifiedBy: z.literal("person").nullable().default(null),
  /** Versions, not objects: an edit puts the material outside the grant. */
  dataVersionIds: z.array(z.string().min(1)).max(256).default([]),
  modelDestinations: z.array(z.string().min(1)).max(8).default([]),
  actionClasses: z.array(ActionClassSchema).max(5).default([]),
  /** For a consequential action: the digest of the plan the person reviewed. */
  reviewDigest: z.string().nullable().default(null),
  payloadVersionIds: z.array(z.string().min(1)).max(64).default([]),
  oneUse: z.boolean().default(false),
  uses: z.number().int().nonnegative().default(0),
  limits: z.object({
    maxActions: z.number().int().positive().nullable().default(null),
    maxAmount: z.number().nonnegative().nullable().default(null),
    currency: z.string().max(8).nullable().default(null),
  }).strict().default({ maxActions: null, maxAmount: null, currency: null }),
  expiresAt: TimestampSchema,
  state: GrantStateSchema.default("active"),
  because: z.string().max(300).default(""),
  createdAt: TimestampSchema,
  supersededBy: UuidSchema.nullable().default(null),
}).strict();
export type Grant = z.infer<typeof GrantSchema>;
export type GrantInput = z.input<typeof GrantSchema>;

export const GRANT_REFUSALS = [
  "no_grant", "expired", "revoked", "paused", "consumed", "wrong_kind", "wrong_tab",
  "out_of_scope", "class_not_granted", "digest_mismatch", "one_use_spent", "limit", "version_not_approved",
] as const;
export type GrantRefusalCode = (typeof GRANT_REFUSALS)[number];

export const GRANT_REFUSAL_WORDS: Record<GrantRefusalCode, string> = {
  no_grant: "nothing was allowed for this",
  expired: "what you allowed has expired",
  revoked: "you stopped this",
  paused: "you took over; the assistant is paused",
  consumed: "that permission was for one action, and it was used",
  wrong_kind: "what you allowed was for something else",
  wrong_tab: "this is not the tab you allowed",
  out_of_scope: "this address is outside what you allowed",
  class_not_granted: "this kind of action was not among the ones you allowed",
  digest_mismatch: "the plan changed after you approved it",
  one_use_spent: "that permission was for one action, and it was used",
  limit: "this would pass the limit you set",
  version_not_approved: "this material changed after you approved it",
};

/** Refused, in the person's words and with the code the caller can act on. */
export class GrantRefused extends Error {
  constructor(readonly code: GrantRefusalCode, detail = "") {
    super(`${GRANT_REFUSAL_WORDS[code]}${detail ? `: ${detail}` : ""}.`);
    this.name = "GrantRefused";
  }
}

/** The origin of a URL, for scope checks. Never the path: a grant covers a site, not a page. */
export function originOf(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}

/** What a grant says, in one sentence, for a sheet or a screen reader. */
export function describeGrant(g: Grant): string {
  const what = GRANT_KIND_WORDS[g.kind].label;
  const where = g.origins.length > 0 ? g.origins.join(", ") : g.route === "service_api" ? "the endpoint you configured" : "this tab";
  const who = g.accountLabel ? `, as ${g.accountLabel}` : "";
  const until = `until ${new Date(g.expiresAt).toISOString().slice(0, 16).replace("T", " ")}`;
  const once = g.oneUse ? ", once" : "";
  return `${what} on ${where}${who}, ${until}${once}.`;
}
