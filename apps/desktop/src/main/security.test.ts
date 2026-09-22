import { describe, it, expect, beforeEach } from "vitest";
import { assertTrustedSender, registerTrustedRenderer, UntrustedSenderError } from "./security.js";

/**
 * Stands in for an IpcMainInvokeEvent. Only the fields assertTrustedSender reads.
 */
const event = (over: {
  id?: number; url?: string; parent?: unknown; storagePath?: string; noFrame?: boolean;
} = {}) => ({
  senderFrame: over.noFrame ? null : { url: over.url ?? "http://localhost:5173/index.html", parent: over.parent ?? null },
  sender: {
    id: over.id ?? 42,
    getURL: () => over.url ?? "http://localhost:5173/index.html",
    session: { storagePath: over.storagePath ?? "/Users/x/Library/Application Support/Xeniur" },
  },
}) as unknown as Parameters<typeof assertTrustedSender>[0];

const TRUSTED = { id: 42, origin: "http://localhost:5173" };

beforeEach(() => {
  registerTrustedRenderer(
    { id: TRUSTED.id } as never,
    (url) => url.startsWith(TRUSTED.origin),
    TRUSTED.origin,
  );
});

describe("who is asking, before what they are asking", () => {
  it("accepts XENIUR's own main frame", () => {
    expect(() => assertTrustedSender(event())).not.toThrow();
  });

  it("refuses a call from an iframe, even in the trusted renderer", () => {
    expect(() => assertTrustedSender(event({ parent: {} })))
      .toThrow(/only a main frame/);
  });

  it("refuses a different webContents, which is what a browsed page would be", () => {
    expect(() => assertTrustedSender(event({ id: 99 })))
      .toThrow(/not XENIUR's own renderer/);
  });

  it("refuses a foreign origin on the trusted webContents", () => {
    expect(() => assertTrustedSender(event({ url: "https://evil.example/page" })))
      .toThrow(/is not http:\/\/localhost:5173/);
  });

  it("accepts a packaged file:// renderer, whose origin is the string \"null\"", () => {
    const href = "file:///Applications/Xeniur.app/Contents/out/renderer/index.html";
    registerTrustedRenderer({ id: 7 } as never, (url) => url.split("#")[0] === href, href);
    expect(() => assertTrustedSender(event({ id: 7, url: href }))).not.toThrow();
    expect(() => assertTrustedSender(event({ id: 7, url: `${href}#/world` }))).not.toThrow();
    expect(() => assertTrustedSender(event({ id: 7, url: "file:///etc/passwd" }))).toThrow();
  });

  it("refuses anything coming from a web browsing partition", () => {
    // A sign-in profile's partition keeps the prefix, so the same guard refuses it.
    for (const partition of ["persist:web:profile:abc", "/Users/x/.../Partitions/persist_web_profile_abc"]) {
      expect(() => assertTrustedSender(event({ storagePath: partition })), partition).toThrow();
    }
    expect(() => assertTrustedSender(event({ storagePath: "/Users/x/.../Partitions/persist_web_default" })))
      .toThrow(/web browsing partition/);
  });

  it("refuses when the sending frame is already gone", () => {
    expect(() => assertTrustedSender(event({ noFrame: true }))).toThrow(/sending frame is gone/);
  });

  it("throws a typed error carrying the offending origin, for the log", () => {
    try {
      assertTrustedSender(event({ id: 99, url: "https://evil.example/x" }));
      expect.unreachable("should have refused");
    } catch (err) {
      expect(err).toBeInstanceOf(UntrustedSenderError);
      if (err instanceof UntrustedSenderError) {
        expect(err.code).toBe("untrusted_sender");
        expect(err.origin).toBe("https://evil.example");
      }
    }
  });
});
