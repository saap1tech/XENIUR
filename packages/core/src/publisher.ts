import { z } from "zod";

/**
 * Publisher identity — the prerequisite for anything public.
 *
 * A package that arrives from someone else is exactly as trustworthy as an email attachment.
 * Before Shared Worlds, critique or challenges can exist, XENIUR needs to know *who* sent a
 * thing, that it was not altered since they sent it, how much of it this machine will take
 * from them in a day, and how to stop taking any. Otherwise AI-generated critique spam
 * arrives on day one.
 *
 * The identity is a local Ed25519 keypair made on first share. The public key *is* the
 * identity — there is no account, no server, no name that someone else assigns. The private
 * key lives in the keychain and never in SQLite, a version, a package or a metrics row.
 */

/** Base64url of the raw 32-byte Ed25519 public key. Short enough to read aloud in chunks. */
export const PublicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const PublisherRefSchema = z.object({
  publicKey: PublicKeySchema,
  displayName: z.string().min(1).max(80),
}).strict();
export type PublisherRef = z.infer<typeof PublisherRefSchema>;

/**
 * What travels in a manifest. `rootHash` is the digest of everything else in the manifest
 * (which names every blob by sha256, so the blobs are covered too); `signature` is over it.
 */
export const PackageSignatureSchema = PublisherRefSchema.extend({
  signedAt: z.number().int().positive(),
  rootHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Base64url Ed25519 signature over `rootHash`. */
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();
export type PackageSignature = z.infer<typeof PackageSignatureSchema>;

/**
 * Trust is assigned by the person, never computed from popularity. A publisher nobody here
 * has judged is `unknown` and is treated as such — quarantined and rate-limited — however
 * many other machines like them.
 */
export const TRUST_LEVELS = ["unknown", "known", "trusted", "blocked"] as const;
export const TrustLevelSchema = z.enum(TRUST_LEVELS);
export type TrustLevel = z.infer<typeof TrustLevelSchema>;

/** Packages this machine will accept from one publisher in one local day. `null` is no limit. */
export const DAILY_IMPORT_LIMITS: Record<TrustLevel, number | null> = {
  unknown: 3,
  known: 20,
  trusted: null,
  blocked: 0,
};

/** What a person sees beside a package: who, how they are trusted here, and what is known. */
export interface PublisherView extends PublisherRef {
  trust: TrustLevel;
  /** When this machine first saw a package from them. */
  firstSeen: number | null;
  /** Their own Process Shares this machine has verified. Proof history, not reputation. */
  proofHistory: number;
  importsToday: number;
  dailyLimit: number | null;
  /** True for this machine's own identity. */
  self: boolean;
}

export const REPORT_REASONS = ["spam", "misrepresented", "harmful", "impersonation", "other"] as const;
export const ReportReasonSchema = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReasonSchema>;

export interface PublisherReport {
  id: string;
  publisherId: string;
  packageRoot: string | null;
  reason: ReportReason;
  note: string;
  at: number;
}

/**
 * Where the signing key lives. The graph never sees the private key's storage; it asks for
 * the pair, and the desktop answers from the keychain. Tests answer from memory.
 */
export interface SigningKeyStore {
  load(): { publicKey: string; privateKey: string; displayName: string } | null;
  save(keys: { publicKey: string; privateKey: string; displayName: string }): void;
}

export class MemorySigningKeyStore implements SigningKeyStore {
  #keys: { publicKey: string; privateKey: string; displayName: string } | null = null;
  load() { return this.#keys; }
  save(keys: { publicKey: string; privateKey: string; displayName: string }) { this.#keys = keys; }
}

export class PublisherBlocked extends Error {
  readonly code = "publisher_blocked" as const;
  constructor(readonly publicKey: string, readonly displayName: string) {
    super(`refused before inspection: you have blocked "${displayName}" (${publicKey.slice(0, 8)}…)`);
    this.name = "PublisherBlocked";
  }
}

export class ImportRateExceeded extends Error {
  readonly code = "import_rate_exceeded" as const;
  constructor(readonly publicKey: string, readonly trust: TrustLevel, readonly limit: number) {
    super(`"${publicKey.slice(0, 8)}…" is ${trust} here and has reached today's limit of ${limit} ` +
      `package${limit === 1 ? "" : "s"}. Mark them known or trusted to take more.`);
    this.name = "ImportRateExceeded";
  }
}

/** Thrown when something tries to change an Object that belongs to someone else's work. */
export class ReadOnlyOriginal extends Error {
  readonly code = "read_only_original" as const;
  constructor(readonly objectId: string, readonly displayName: string) {
    super(`this is ${displayName}'s work, here for review. Your claims and decisions sit beside it and link to it; ` +
      "it is not changed here.");
    this.name = "ReadOnlyOriginal";
  }
}
