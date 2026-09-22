import { describe, it, expect } from "vitest";
import { cspFor, partitionFor, requestRule, safeFilename } from "./rules.js";

/**
 * The rules a browsing session is held to, read without Electron. Signing in must work; the
 * assistant's turn must not become the page's turn to post elsewhere.
 */
const mode = (over: Partial<Parameters<typeof requestRule>[0]> = {}) =>
  ({ profileKind: "signed_in" as const, acting: false, grantOrigins: [] as string[], ...over });
const req = (method: string, url = "https://supplier.example/x", resourceType = "mainFrame") => ({ method, url, resourceType });

describe("what may leave a browsing session", () => {
  it("a signed-in profile may POST — that is how signing in works", () => {
    expect(requestRule(mode(), req("POST", "https://supplier.example/login")).allow).toBe(true);
    expect(requestRule(mode(), req("GET")).allow).toBe(true);
  });

  it("an ephemeral profile reads only, and says why", () => {
    const v = requestRule(mode({ profileKind: "ephemeral" }), req("POST"));
    expect(v.allow).toBe(false);
    expect(v.allow === false && v.because).toMatch(/This tab is for reading/);
    expect(requestRule(mode({ profileKind: "ephemeral" }), req("HEAD")).allow).toBe(true);
  });

  it("while the assistant is acting, nothing is sent outside the origins you allowed", () => {
    const acting = mode({ acting: true, grantOrigins: ["https://supplier.example"] });
    expect(requestRule(acting, req("POST", "https://supplier.example/orders")).allow).toBe(true);
    expect(requestRule(acting, req("GET", "https://tracker.example/pixel", "image")).allow).toBe(true);   // reading is not sending
    const out = requestRule(acting, req("POST", "https://tracker.example/collect", "xhr"));
    expect(out.allow).toBe(false);
    expect(out.allow === false && out.because).toMatch(/outside what you allowed/);
    // An acting grant with no origins sends nowhere.
    expect(requestRule(mode({ acting: true }), req("POST")).allow).toBe(false);
  });
});

describe("partitions, policy and filenames", () => {
  it("a signed-in profile persists and keeps the prefix the IPC guard refuses", () => {
    expect(partitionFor("p1", "signed_in")).toBe("persist:web:profile:p1");
    expect(partitionFor("p1", "signed_in")).toContain("persist:web");
    expect(partitionFor("p1", "ephemeral")).toBe("web:profile:p1");
    expect(partitionFor("p1", "ephemeral")).not.toContain("persist:");
  });

  it("forms are disabled for a reading tab and left to the person in a signed-in one; plugins and base tags stay off in both", () => {
    expect(cspFor("ephemeral")).toContain("form-action 'none'");
    expect(cspFor("signed_in")).not.toContain("form-action");
    for (const kind of ["ephemeral", "signed_in"] as const) {
      expect(cspFor(kind)).toContain("object-src 'none'");
      expect(cspFor(kind)).toContain("base-uri 'self'");
    }
  });

  it("a download's name is never trusted as given", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("report 2026.pdf")).toBe("report-2026.pdf");
    expect(safeFilename("")).toBe("download");
    expect(safeFilename("..")).toBe("download");
  });
});
