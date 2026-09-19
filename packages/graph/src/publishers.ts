import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import type {
  PackageSignature, PublisherRef, PublisherReport, PublisherView, ReportReason, SigningKeyStore, TrustLevel,
} from "@xeniur/core";
import {
  DAILY_IMPORT_LIMITS, ImportRateExceeded, PackageSignatureSchema, PublisherBlocked, newId, now, sha256Hex, canonicalJson,
} from "@xeniur/core";
import type { Db } from "./db.js";

/* ------------------------------------------------------------------------------------------ */
/* Identity — an Ed25519 keypair. Public key is who you are; private key never leaves the store. */
/* ------------------------------------------------------------------------------------------ */

const b64url = (buf: Buffer): string => buf.toString("base64url");

/**
 * This machine's publisher identity. Created on first use, which in practice is the first
 * share. `sign` is the only thing that ever touches the private key, and it never returns it.
 */
export class PublisherIdentity {
  /** A true private field: it does not appear in JSON.stringify, spread, or a console dump. */
  readonly #privateJwkD: string;

  private constructor(readonly publicKey: string, readonly displayName: string, privateJwkD: string) {
    this.#privateJwkD = privateJwkD;
  }

  static load(store: SigningKeyStore, displayName = "Unnamed publisher"): PublisherIdentity {
    const existing = store.load();
    if (existing) return new PublisherIdentity(existing.publicKey, existing.displayName, existing.privateKey);
    const pair = generateKeyPairSync("ed25519");
    const pub = pair.publicKey.export({ format: "jwk" }) as { x: string };
    const priv = pair.privateKey.export({ format: "jwk" }) as { d: string };
    store.save({ publicKey: pub.x, privateKey: priv.d, displayName });
    return new PublisherIdentity(pub.x, displayName, priv.d);
  }

  ref(): PublisherRef { return { publicKey: this.publicKey, displayName: this.displayName }; }

  /** Signs a root hash. The private key is rebuilt for the call and discarded with it. */
  sign(rootHash: string): PackageSignature {
    const key = createPrivateKey({
      key: { kty: "OKP", crv: "Ed25519", x: this.publicKey, d: this.#privateJwkD }, format: "jwk",
    });
    const signature = b64url(sign(null, Buffer.from(rootHash, "utf8"), key));
    return { publicKey: this.publicKey, displayName: this.displayName, signedAt: now(), rootHash, signature };
  }
}

/** Verifies that `signature` was made over `rootHash` by the holder of `publicKey`. Pure. */
export function verifySignature(sig: PackageSignature): boolean {
  const parsed = PackageSignatureSchema.safeParse(sig);
  if (!parsed.success) return false;
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: sig.publicKey }, format: "jwk" });
    return verify(null, Buffer.from(sig.rootHash, "utf8"), key, Buffer.from(sig.signature, "base64url"));
  } catch {
    return false;
  }
}

/**
 * The root hash of a manifest: everything in it except the signature block itself. The
 * manifest names every blob by sha256, so a swapped blob changes nothing here and is caught
 * by the blob check instead — the two checks together cover the whole package.
 */
export function packageRootHash(manifest: Record<string, unknown>): string {
  const { publisher: _omit, ...rest } = manifest;
  return sha256Hex(canonicalJson(rest));
}

/* ------------------------------------------------------------------------------------------ */
/* Store — who this machine has seen, how the person trusts them, what they reported            */
/* ------------------------------------------------------------------------------------------ */

const localDay = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export class PublisherStore {
  #self: PublisherIdentity | null = null;

  constructor(private readonly db: Db, private readonly keys: SigningKeyStore) {}

  /** This machine's identity, created on first call. */
  self(): PublisherIdentity {
    this.#self ??= PublisherIdentity.load(this.keys);
    return this.#self;
  }

  /** Records that a package from this publisher was seen. Idempotent; first_seen stays first. */
  seen(ref: PublisherRef): void {
    this.db.prepare(
      `INSERT INTO publishers (id, display_name, first_seen, proof_history_count) VALUES (?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name`,
    ).run(ref.publicKey, ref.displayName, now());
  }

  trustOf(publicKey: string): TrustLevel {
    const row = this.db.prepare(`SELECT level FROM publisher_trust WHERE publisher_id = ?`).get(publicKey) as
      { level: TrustLevel } | undefined;
    return row?.level ?? "unknown";
  }

  /** Set by the person. There is no other caller and no other `set_by`. */
  setTrust(ref: PublisherRef, level: TrustLevel): void {
    this.seen(ref);
    this.db.prepare(
      `INSERT INTO publisher_trust (publisher_id, level, set_by, set_at) VALUES (?, ?, 'human', ?)
       ON CONFLICT(publisher_id) DO UPDATE SET level = excluded.level, set_at = excluded.set_at`,
    ).run(ref.publicKey, level, now());
  }

  block(ref: PublisherRef): void { this.setTrust(ref, "blocked"); }

  /** Refuses before anything else is looked at. The message names who and that it was you. */
  assertNotBlocked(ref: PublisherRef): void {
    if (this.trustOf(ref.publicKey) === "blocked") throw new PublisherBlocked(ref.publicKey, ref.displayName);
  }

  report(ref: PublisherRef, reason: ReportReason, opts: { packageRoot?: string | null; note?: string } = {}): PublisherReport {
    this.seen(ref);
    const r: PublisherReport = {
      id: newId(), publisherId: ref.publicKey, packageRoot: opts.packageRoot ?? null,
      reason, note: opts.note ?? "", at: now(),
    };
    this.db.prepare(
      `INSERT INTO publisher_reports (id, publisher_id, package_root, reason, note, at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(r.id, r.publisherId, r.packageRoot, r.reason, r.note, r.at);
    return r;
  }

  reportsOn(publicKey: string): PublisherReport[] {
    return (this.db.prepare(`SELECT * FROM publisher_reports WHERE publisher_id = ? ORDER BY at DESC`).all(publicKey) as
      Array<Record<string, unknown>>).map((r) => ({
        id: r["id"] as string, publisherId: r["publisher_id"] as string, packageRoot: r["package_root"] as string | null,
        reason: r["reason"] as ReportReason, note: r["note"] as string, at: r["at"] as number,
      }));
  }

  importsToday(publicKey: string, at = now()): number {
    const row = this.db.prepare(`SELECT count FROM import_rate WHERE publisher_id = ? AND day = ?`)
      .get(publicKey, localDay(at)) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** True when this key is this machine's own. Reads the store; never creates an identity. */
  isSelf(publicKey: string): boolean {
    return (this.#self?.publicKey ?? this.keys.load()?.publicKey) === publicKey;
  }

  /** Whether one more package from this publisher may be taken today. Self is never limited. */
  assertUnderRate(ref: PublisherRef, at = now()): void {
    if (this.isSelf(ref.publicKey)) return;
    const trust = this.trustOf(ref.publicKey);
    const limit = DAILY_IMPORT_LIMITS[trust];
    if (limit === null) return;
    if (this.importsToday(ref.publicKey, at) >= limit) throw new ImportRateExceeded(ref.publicKey, trust, limit);
  }

  /** Counts an import that happened. Called after the write, never before. */
  recordImport(ref: PublisherRef, at = now()): void {
    this.seen(ref);
    this.db.prepare(
      `INSERT INTO import_rate (publisher_id, day, count) VALUES (?, ?, 1)
       ON CONFLICT(publisher_id, day) DO UPDATE SET count = count + 1`,
    ).run(ref.publicKey, localDay(at));
  }

  /** A Process Share from this publisher verified here. Proof history, not reputation. */
  recordProof(ref: PublisherRef): void {
    this.seen(ref);
    this.db.prepare(`UPDATE publishers SET proof_history_count = proof_history_count + 1 WHERE id = ?`).run(ref.publicKey);
  }

  view(ref: PublisherRef, at = now()): PublisherView {
    const row = this.db.prepare(`SELECT first_seen, proof_history_count FROM publishers WHERE id = ?`).get(ref.publicKey) as
      { first_seen: number; proof_history_count: number } | undefined;
    const trust = this.trustOf(ref.publicKey);
    return {
      ...ref, trust,
      firstSeen: row?.first_seen ?? null,
      proofHistory: row?.proof_history_count ?? 0,
      importsToday: this.importsToday(ref.publicKey, at),
      dailyLimit: DAILY_IMPORT_LIMITS[trust],
      self: this.isSelf(ref.publicKey),
    };
  }

  list(): PublisherView[] {
    const rows = this.db.prepare(`SELECT id, display_name FROM publishers ORDER BY first_seen`).all() as
      Array<{ id: string; display_name: string }>;
    return rows.map((r) => this.view({ publicKey: r.id, displayName: r.display_name }));
  }
}
