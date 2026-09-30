import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleClient } from "./google.js";

afterEach(() => vi.unstubAllGlobals());

describe("GoogleClient", () => {
  it("sends a bounded JSON request with the key in a header and counts thinking tokens", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({
      candidates: [{ content: { parts: [{ text: '{"kind":"answer"}' }] } }],
      usageMetadata: { promptTokenCount: 27, candidatesTokenCount: 11, thoughtsTokenCount: 5 },
    }) }));
    vi.stubGlobal("fetch", fetcher);
    const client = new GoogleClient({ apiKey: "test-secret", model: "gemini-2.5-flash", baseUrl: "https://example.test/v1beta" });
    const reply = await client.complete({ system: "Return JSON", user: "Question", maxOutputTokens: 1200 });
    expect(reply).toEqual({ text: '{"kind":"answer"}', inputTokens: 27, outputTokens: 16, model: "gemini-2.5-flash" });
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://example.test/v1beta/models/gemini-2.5-flash:generateContent");
    expect(url).not.toContain("test-secret");
    expect(options.headers["x-goog-api-key"]).toBe("test-secret");
    expect(JSON.parse(options.body).generationConfig.maxOutputTokens).toBe(1200);
  });
});
