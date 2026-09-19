import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";
import type { KeyStore, ModelProvider } from "@xeniur/models";

/**
 * API keys, encrypted by the operating system.
 *
 * Electron's `safeStorage` uses the platform keychain (Keychain on macOS, DPAPI on Windows,
 * libsecret on Linux) to encrypt; the ciphertext lives in one small file under userData that
 * is useless without the OS user's login. Nothing here touches SQLite, and nothing here is
 * reachable from the renderer — the preload exposes `has`, `add`, `remove` and `verify`,
 * never `read`.
 *
 * When the OS keychain is unavailable (a headless CI runner), the store refuses to write
 * rather than falling back to plaintext. A key XENIUR cannot protect is a key XENIUR does
 * not hold.
 */
export class SafeStorageKeyStore implements KeyStore {
  readonly #file: string;
  #cache: Map<ModelProvider, Buffer> | null = null;

  constructor(userDataDir: string) {
    mkdirSync(userDataDir, { recursive: true });
    this.#file = join(userDataDir, "keys.enc.json");
  }

  static available(): boolean {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  }

  has(p: ModelProvider): boolean { return this.#load().has(p); }

  read(p: ModelProvider): string | null {
    const enc = this.#load().get(p);
    if (!enc) return null;
    return safeStorage.decryptString(enc);
  }

  write(p: ModelProvider, key: string): void {
    if (!SafeStorageKeyStore.available()) {
      throw new Error("this machine's keychain is not available, so XENIUR will not store a key here");
    }
    const all = this.#load();
    all.set(p, safeStorage.encryptString(key.trim()));
    this.#save(all);
  }

  remove(p: ModelProvider): void {
    const all = this.#load();
    all.delete(p);
    this.#save(all);
  }

  present(): ModelProvider[] { return [...this.#load().keys()]; }

  #load(): Map<ModelProvider, Buffer> {
    if (this.#cache) return this.#cache;
    const out = new Map<ModelProvider, Buffer>();
    if (existsSync(this.#file)) {
      const raw = JSON.parse(readFileSync(this.#file, "utf8")) as Record<string, string>;
      for (const [k, v] of Object.entries(raw)) out.set(k as ModelProvider, Buffer.from(v, "base64"));
    }
    this.#cache = out;
    return out;
  }

  #save(all: Map<ModelProvider, Buffer>): void {
    const raw = Object.fromEntries([...all].map(([k, v]) => [k, v.toString("base64")]));
    if (all.size === 0 && existsSync(this.#file)) { unlinkSync(this.#file); this.#cache = all; return; }
    writeFileSync(this.#file, JSON.stringify(raw), { mode: 0o600 });
    this.#cache = all;
  }
}
