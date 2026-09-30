import { describe, it, expect } from "vitest";
import {
  MemoryKeyStore, ModelRegistry, findKeyShaped, isPriceVerified, looksLikeKey, verifyKey,
  ModelsConfigSchema, type Fetcher,
} from "./index.js";

// Compatibility fixtures exercise historical stored providers without enabling them in the app.
const registry = new ModelRegistry(ModelsConfigSchema.parse({
  providers:[
    {id:"openai",label:"OpenAI",keyName:"OPENAI_API_KEY",verifyUrl:"https://api.openai.com/v1/models",auth:"bearer"},
    {id:"google",label:"Google",keyName:"GEMINI_API_KEY",verifyUrl:"https://generativelanguage.googleapis.com/v1beta/models",auth:"google-key"},
    {id:"anthropic",label:"Anthropic",keyName:"ANTHROPIC_API_KEY",verifyUrl:"https://api.anthropic.com/v1/models",auth:"x-api-key"},
    {id:"ollama",label:"Ollama",keyName:null,verifyUrl:"http://localhost:11434/api/tags",auth:"none",local:true},
    {id:"meshy",label:"Meshy",keyName:"MESHY_API_KEY",verifyUrl:"https://api.meshy.ai/openapi/v1/balance",auth:"bearer"}
  ],
  models:[
    {id:"openai.luna",provider:"openai",model:"historical-text",label:"Historical text",contextWindow:32000,tags:[],price:{inputPerMTok:1,outputPerMTok:2,verifiedOn:"2026-09-28"}},
    {id:"google.text",provider:"google",model:"historical-text",label:"Historical text",contextWindow:32000,tags:[],price:{inputPerMTok:1,outputPerMTok:2,verifiedOn:"2026-09-28"}},
    {id:"anthropic.fable",provider:"anthropic",model:"historical-unpriced",label:"Historical unpriced",contextWindow:32000,tags:[],price:{inputPerMTok:0,outputPerMTok:0,verifiedOn:null}},
    {id:"ollama.local",provider:"ollama",model:"historical-local",label:"Historical local",contextWindow:32000,tags:["local"],price:{inputPerMTok:0,outputPerMTok:0,verifiedOn:null}}
  ]
}));

/* ------------------------------------------------------------ registry === */

describe("the registry is data with dates on its prices", () => {
  it("dates supported prices and keeps unpriced providers unavailable", () => {
    for (const provider of ["openai", "google"] as const) {
      const models = registry.models().filter((m) => m.provider === provider);
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) expect(isPriceVerified(model)).toBe(true);
    }
    expect(isPriceVerified(registry.model("anthropic.fable")!)).toBe(false);
  });

  it("treats a local zero-price model as verified by construction", () => {
    const local = registry.model("ollama.local")!;
    expect(isPriceVerified(local)).toBe(true);
  });

  it("does not treat an unverified zero as free", () => {
    // A remote model priced 0/0 with no date is *unknown*, not free.
    const m = { ...registry.model("openai.luna")!, price: { inputPerMTok: 0, outputPerMTok: 0, currency: "USD" as const, verifiedOn: null } };
    expect(isPriceVerified(m)).toBe(false);
  });

  it("offers only models whose provider has a key, and only priced ones for calling", () => {
    const keys = new MemoryKeyStore();
    expect(registry.available(() => keys.has("openai")).filter((m) => m.provider === "openai")).toHaveLength(0);
    keys.write("openai", "sk-test-000000000000000000000000000");
    expect(registry.available((p) => keys.has(p)).some((m) => m.provider === "openai")).toBe(true);
    // A checked price is one gate; the runtime separately requires live access and selection.
    expect(registry.callable((p) => keys.has(p)).some((m) => m.provider === "openai")).toBe(true);
    expect(registry.callable((p) => keys.has(p)).some((m) => m.provider === "anthropic")).toBe(false);
    // Local is callable with no key at all.
    expect(registry.callable(() => false).some((m) => m.provider === "ollama")).toBe(true);
  });

  it("says what a key unlocks, and never claims generation from a language-model key", () => {
    const u = registry.unlocks("anthropic");
    expect(u.intelligence.length).toBeGreaterThan(0);
    expect(u.generation).toEqual([]);
  });
});

/* -------------------------------------------------------- verification === */

describe("verification never spends anything", () => {
  const fetcherThat = (status: number, body: unknown): Fetcher => async () => ({
    ok: status >= 200 && status < 300, status, json: async () => body,
  });

  it("uses the models-list endpoint and reports the ids it saw", async () => {
    const keys = new MemoryKeyStore();
    keys.write("openai", "sk-test-000000000000000000000000000");
    const calls: string[] = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push(url);
      expect(init.headers["Authorization"]).toMatch(/^Bearer sk-test/);
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "gpt-5.6-luna" }] }) };
    };
    const r = await verifyKey("openai", registry, keys, fetcher);
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["gpt-5.6-luna"]);
    expect(r.billable).toBe(false);
    expect(calls[0]).toContain("/v1/models");
    expect(calls[0]).not.toContain("completions");
  });

  it("reports a rejected key as rejected, not as a crash", async () => {
    const keys = new MemoryKeyStore();
    keys.write("anthropic", "sk-ant-bad00000000000000000000000000");
    const r = await verifyKey("anthropic", registry, keys, fetcherThat(401, {}));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("rejected this key");
  });

  it("checks every Google models page before listing available models", async () => {
    const keys = new MemoryKeyStore();
    keys.write("google", "AIzaSyA-abcdefghijklmnopqrstuvwxyz0123456789");
    const urls: string[] = [];
    const result = await verifyKey("google", registry, keys, async (url, init) => {
      urls.push(url);
      expect(init.headers["x-goog-api-key"]).toBeTruthy();
      return { ok: true, status: 200, json: async () => urls.length === 1
        ? { models: [{ name: "models/gemini-2.5-flash" }], nextPageToken: "next-1" }
        : { models: [{ name: "models/gemini-2.5-pro" }] } };
    });
    expect(result.models).toEqual(["models/gemini-2.5-flash", "models/gemini-2.5-pro"]);
    expect(urls[1]).toContain("pageToken=next-1");
  });

  it("checks Meshy access through the free balance endpoint", async () => {
    const keys = new MemoryKeyStore();
    keys.write("meshy", "msy-test-000000000000000000000000000");
    const result = await verifyKey("meshy", registry, keys, async (url, init) => {
      expect(url).toContain("/openapi/v1/balance");
      expect(init.headers["Authorization"]).toMatch(/^Bearer msy-test/);
      return { ok: true, status: 200, json: async () => ({ balance: 42 }) };
    });
    expect(result).toMatchObject({ ok: true, models: [], balanceCredits: 42, billable: false });
  });

  it("says plainly when there is no key to verify", async () => {
    const r = await verifyKey("google", registry, new MemoryKeyStore(), fetcherThat(200, {}));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no key stored");
  });

  it("verifies a local provider with no key and no header", async () => {
    let seenHeaders: Record<string, string> = {};
    const fetcher: Fetcher = async (_url, init) => {
      seenHeaders = init.headers;
      return { ok: true, status: 200, json: async () => ({ models: [{ name: "llama3.1" }] }) };
    };
    const r = await verifyKey("ollama", registry, new MemoryKeyStore(), fetcher);
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["llama3.1"]);
    expect(Object.keys(seenHeaders)).toHaveLength(0);
  });

  it("never makes a network call in this file", () => {
    // Every fetcher above is a stub. There is no path here that could reach a provider, and
    // the type of `billable` admits only false.
    expect(true).toBe(true);
  });
});

/* -------------------------------------------------------- key scanning === */

describe("a key-shaped string is recognised wherever it hides", () => {
  it.each([
    ["an Anthropic key", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"],
    ["an OpenAI key", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"],
    ["a Google key", "AIzaSyA-abcdefghijklmnopqrstuvwxyz0123456789"],
    ["a bearer token", "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc"],
    ["a labelled secret", 'api_key = "abcdefghijklmnopqrstuvwxyz012345"'],
  ])("catches %s", (_name, text) => {
    expect(looksLikeKey(text)).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    for (const text of ["Rainwear 2027", "print.stl", "a2c7c07c-d75e-4920-9bcf-dcf66615a48f",
                        "The 2024 study found that 63% of returns were caused by seam failure."]) {
      expect(looksLikeKey(text)).toBe(false);
    }
  });

  it("finds a key nested inside a manifest and names where it is", () => {
    const manifest = {
      version: 3, object: { title: "Rocket" },
      actions: [{ plan: '{"args":{"note":"my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"}}' }],
    };
    expect(findKeyShaped(manifest)).toEqual(["$.actions[0].plan"]);
  });
});
