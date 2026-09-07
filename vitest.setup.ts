import { webcrypto } from "node:crypto";

/**
 * Vitest's node sandbox does not expose `globalThis.crypto`, though Node 22 and every
 * Chromium context do. XENIUR's id generation uses Web Crypto so that @xeniur/core can be
 * bundled into the renderer without dragging `node:crypto` in, so the standard global is
 * restored here rather than weakening the product code to suit the test runner.
 */
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}
