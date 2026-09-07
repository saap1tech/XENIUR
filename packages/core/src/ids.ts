import { z } from "zod";

/** Every XENIUR entity is addressed by a permanent UUID that never changes. */
export const UuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof UuidSchema>;

/**
 * Web Crypto rather than node:crypto: @xeniur/core is bundled into the renderer too, and
 * a static `node:crypto` import breaks that build. `crypto.randomUUID` exists in Node 19+
 * and in every Chromium context, so the only way to reach the throw is a sandbox that has
 * removed a standard global — which is worth saying out loud rather than failing with
 * "cannot read properties of undefined".
 */
export const newId = (): Uuid => {
  const c = globalThis.crypto;
  if (!c?.randomUUID) {
    throw new Error("globalThis.crypto.randomUUID is unavailable in this environment");
  }
  return c.randomUUID();
};

/** SHA-256 content address for a blob on disk. */
export const BlobHashSchema = z.string().regex(/^[0-9a-f]{64}$/, "expected a sha256 hex digest");
export type BlobHash = z.infer<typeof BlobHashSchema>;

export const TimestampSchema = z.number().int().nonnegative();
export const now = (): number => Date.now();
