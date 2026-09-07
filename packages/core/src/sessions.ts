import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";

/**
 * The visible Electron browser and Playwright Hands are separate browsers — correct for
 * privilege isolation, and therefore *separate identities*. A user signed into a site in
 * the XENIUR browser has not signed Hands in.
 *
 * The wrong fix is copying cookies across, which silently converts a clean boundary into
 * an unscoped credential handover. So identity is modelled as a capability: scoped to a
 * domain and a task, expiring, revocable, and recorded on every receipt.
 */
export const IdentityRefSchema = z.object({
  id: UuidSchema,
  domain: z.string().min(1),
  label: z.string(),          // "signed in as ada@example.com" — display only
  partition: z.string(),      // the Electron partition holding it; never leaves main
  lastSeenAt: TimestampSchema,
});
export type IdentityRef = z.infer<typeof IdentityRefSchema>;

export const TaskRefSchema = z.object({
  id: UuidSchema,
  title: z.string(),
});
export type TaskRef = z.infer<typeof TaskRefSchema>;

export const SessionGrantSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("anonymous"),
    grantId: UuidSchema,
    domain: z.string(),
    taskId: UuidSchema.nullable(),
    expiresAt: TimestampSchema,
  }),
  /** M2+. Declared now so nothing has to be reshaped later; never issued in M1. */
  z.object({
    kind: z.literal("delegated"),
    grantId: UuidSchema,
    domain: z.string(),
    taskId: UuidSchema.nullable(),
    identityId: UuidSchema,
    scope: z.array(z.string()),
    expiresAt: TimestampSchema,
  }),
]);
export type SessionGrant = z.infer<typeof SessionGrantSchema>;

/** Returned instead of a grant when a plan genuinely needs a signed-in identity. */
export class IdentityRequiredError extends Error {
  readonly code = "identity_required" as const;
  constructor(readonly domain: string, readonly taskId: string | null) {
    super(
      `This step needs a signed-in identity for ${domain}. Sign in inside the XENIUR ` +
      `browser, then approve scoped access for this task. XENIUR will not copy your session.`,
    );
    this.name = "IdentityRequiredError";
  }
}
