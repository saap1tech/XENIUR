import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HttpsJsonAdapter, readAnswer, type RouteEndpoint } from "./https-json.js";

/**
 * The route to an endpoint the person configured. What an answer establishes — and what it
 * does not — is decided here, once, and the token never appears in anything that is kept.
 */
const endpoint: RouteEndpoint = { id: "receiver", label: "My receiver", endpoint: "https://receiver.example/hook", origins: ["https://receiver.example"], statusEndpoint: "https://receiver.example/hook", fields: ["order"] };
const tokens = (has = true) => ({ has: () => has, read: () => (has ? "tok-secret-value" : null) });
const resolve = async () => [{ address: "93.184.216.34", family: 4 }];
const request = { route: "service_api" as const, actionClass: "api_post" as const, tabId: null, elementRef: null,
  endpointId: "receiver", fields: { order: "120 m taped tape" }, items: [], amount: null, currency: null };

describe("what an answer establishes", () => {
  it("2xx confirms with the id it gave; 4xx fails with the reason; 5xx, a timeout or nothing stays uncertain", () => {
    expect(readAnswer({ status: 201, body: JSON.stringify({ id: "ord-9" }) })).toMatchObject({ state: "confirmed", reference: "ord-9" });
    expect(readAnswer({ status: 200, body: "not json" })).toMatchObject({ state: "confirmed", reference: null });
    expect(readAnswer({ status: 422, body: "unknown order number" })).toMatchObject({ state: "failed" });
    expect(readAnswer({ status: 422, body: "unknown order number" }).detail).toMatch(/refused it: 422/);
    for (const status of [500, 502, 0]) expect(readAnswer({ status, body: "" }).state, `${status}`).toBe("uncertain");
  });
});

describe("the adapter", () => {
  it("says what it can and cannot establish, per endpoint", async () => {
    const withStatus = new HttpsJsonAdapter({ endpoints: [endpoint], tokens: tokens() });
    expect((await withStatus.describe(request)).verification).toMatch(/can be asked again afterwards/);
    const without = new HttpsJsonAdapter({ endpoints: [{ ...endpoint, statusEndpoint: null }], tokens: tokens() });
    expect((await without.describe(request)).verification).toMatch(/cannot be asked again/);
    // The description names fields and their sizes, never their values.
    expect(JSON.stringify(await withStatus.describe(request))).not.toContain("120 m taped tape");
  });

  it("is needs_setup without an endpoint or without a token, available with both", () => {
    expect(new HttpsJsonAdapter({ endpoints: [], tokens: tokens() }).availability().state).toBe("needs_setup");
    expect(new HttpsJsonAdapter({ endpoints: [endpoint], tokens: tokens(false) }).availability().state).toBe("needs_setup");
    expect(new HttpsJsonAdapter({ endpoints: [endpoint], tokens: tokens() }).availability().state).toBe("available");
  });

  it("sends the attempt's idempotency key, so asking twice cannot do the thing twice", async () => {
    const seen: Array<{ idempotencyKey: string; method: string; body: string; token: string }> = [];
    const send = vi.fn(async (input: { idempotencyKey: string; method: string; body: string; token: string }) => {
      seen.push(input); return { status: 200, body: JSON.stringify({ id: "ord-1" }) };
    });
    const adapter = new HttpsJsonAdapter({ endpoints: [endpoint], tokens: tokens(), send, resolve });
    const result = await adapter.execute(request, { attemptId: "a-1", idempotencyKey: "a-1" });
    expect(result).toMatchObject({ state: "confirmed", reference: "ord-1" });
    expect(seen[0]).toMatchObject({ idempotencyKey: "a-1", method: "POST" });
    expect(seen[0]!.body).toContain("120 m taped tape");
  });

  it("refuses without a token, and never writes one into what it returns", async () => {
    const adapter = new HttpsJsonAdapter({ endpoints: [endpoint], tokens: tokens(false) });
    const result = await adapter.execute(request, { attemptId: "a-1", idempotencyKey: "a-1" });
    expect(result).toMatchObject({ state: "failed" });
    expect(JSON.stringify(result)).not.toContain("tok-secret-value");
  });

  it("a status check on an endpoint that cannot be asked says so, rather than guessing", async () => {
    const adapter = new HttpsJsonAdapter({ endpoints: [{ ...endpoint, statusEndpoint: null }], tokens: tokens() });
    expect(await adapter.checkStatus("ord-1", { endpointId: "receiver" })).toMatchObject({ state: "unsupported" });
  });

  it("the route never reaches for a model", () => {
    const src = readFileSync(join(__dirname, "https-json.ts"), "utf8");
    for (const forbidden of ["@xeniur/brain", "GatedBrain", "llm", "prompt"]) expect(src).not.toContain(forbidden);
  });
});
