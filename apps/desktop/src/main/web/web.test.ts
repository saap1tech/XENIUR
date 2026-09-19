import { describe, expect, it, vi } from "vitest";
import { captureWeb, extractReading } from "./capture.js";
import { checkedDestination, localUrlPolicy } from "./policy.js";
import { WebRiskChecker } from "./risk.js";

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
describe("the protected web boundary", () => {
  it("rejects active, credentialed and local-network destinations", async () => {
    for (const url of ["http://example.com", "javascript:alert(1)", "https://me:secret@example.com", "https://localhost", "https://127.0.0.1", "file:///etc/passwd"]) {
      expect(() => localUrlPolicy(url)).toThrow();
    }
    await expect(checkedDestination("https://example.com", async () => [{ address: "10.0.0.4", family: 4 }])).rejects.toThrow(/private|reserved/);
  });

  it("removes script, forms and navigation while keeping readable meaning", () => {
    const result = extractReading(`<html><head><title>Field notes</title><script>steal()</script></head><body><nav>clutter</nav><main><h1>Rainwear</h1><p>Quiet fabric matters.</p><form><input value="private">submit</form></main></body></html>`);
    expect(result).toEqual({ title: "Field notes", text: "Rainwear\n\nQuiet fabric matters." });
  });

  it("checks redirects again and never runs a returned page", async () => {
    const checked: string[] = [];
    const risk = { allow: vi.fn(async (url: string) => { checked.push(url); return { status: "not_checked", provider: "none", checkedAt: null, label: "Local policy" } as const; }) };
    const get = vi.fn(async (url: URL) => url.hostname === "example.com"
      ? { status: 302, location: "https://docs.example.com/paper", type: "text/html", body: "" }
      : { status: 200, type: "text/html", body: "<article><h1>Paper</h1><p>Useful evidence.</p><script>ignored()</script></article>" });
    const result = await captureWeb("https://example.com", risk, publicDns, get);
    expect(checked).toEqual(["https://example.com/", "https://docs.example.com/paper"]);
    expect(result.text).toContain("Useful evidence"); expect(result.text).not.toContain("ignored");
  });

  it("uses deliberate non-safety wording and blocks unavailable reputation checks", async () => {
    const checker = new WebRiskChecker(() => ({ mode: "google_lookup", key: "test" }), vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch);
    await expect(checker.allow("https://example.com")).resolves.toMatchObject({ label: "No listed threat detected" });
    const offline = new WebRiskChecker(() => ({ mode: "google_lookup", key: "test" }), vi.fn(async () => { throw new Error("offline"); }) as typeof fetch);
    await expect(offline.allow("https://example.com")).rejects.toThrow(/unavailable/i);
  });
});
