import type { ModelProvider } from "./registry.js";

/**
 * Where keys live, as a contract rather than an implementation.
 *
 * The desktop host implements this over Electron's `safeStorage`, which encrypts with the OS
 * keychain. Tests implement it in memory. Nothing in this package — and nothing in the graph
 * — ever sees the bytes of a key: `has()` answers yes or no, and the only reader is the
 * verification call and the model client, both in the main process.
 *
 * Keys are never written to SQLite, never to a version, never to a package, never to a
 * metrics row. Those boundaries each scan for key-shaped strings, and a test tries to
 * smuggle one through every one of them.
 */
export interface KeyStore {
  has(provider: ModelProvider): boolean;
  /** Read for use, never for display. The renderer has no path to this. */
  read(provider: ModelProvider): string | null;
  write(provider: ModelProvider, key: string): void;
  remove(provider: ModelProvider): void;
  /** Providers with a key present, for the registry's availability check. */
  present(): ModelProvider[];
}

/** For tests and the demos. Holds keys in memory and forgets them at exit. */
export class MemoryKeyStore implements KeyStore {
  #keys = new Map<ModelProvider, string>();
  has(p: ModelProvider): boolean { return this.#keys.has(p); }
  read(p: ModelProvider): string | null { return this.#keys.get(p) ?? null; }
  write(p: ModelProvider, key: string): void { this.#keys.set(p, key); }
  remove(p: ModelProvider): void { this.#keys.delete(p); }
  present(): ModelProvider[] { return [...this.#keys.keys()]; }
}
