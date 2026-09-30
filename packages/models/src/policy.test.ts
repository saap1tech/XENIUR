import { describe, it, expect } from "vitest";
import {
  DEFAULT_POLICY, MemoryKeyStore, ModelRegistry, ModelsConfigSchema, acceptanceByModel,
  policyFrom, routeModel, type RoutingPolicy, type ModelProvider,
} from "./index.js";

/** A registry where every price has been checked, so routing has something to choose from. */
const registry = new ModelRegistry(ModelsConfigSchema.parse({
  providers: [
    { id: "anthropic", label: "Anthropic", keyName: "K", verifyUrl: "https://a.example/models", auth: "x-api-key", local: false },
    { id: "openai", label: "OpenAI", keyName: "K", verifyUrl: "https://o.example/models", auth: "bearer", local: false },
    { id: "ollama", label: "Ollama", keyName: null, verifyUrl: "http://127.0.0.1:11434/api/tags", auth: "none", local: true },
  ],
  models: [
    { id: "a.cheap", provider: "anthropic", model: "haiku", label: "Haiku", contextWindow: 200000, tags: ["fast", "cheap"],
      price: { inputPerMTok: 0.8, outputPerMTok: 4, verifiedOn: "2026-09-16" } },
    { id: "a.mid", provider: "anthropic", model: "sonnet", label: "Sonnet", contextWindow: 200000, tags: ["vision"],
      price: { inputPerMTok: 3, outputPerMTok: 15, verifiedOn: "2026-09-16" } },
    { id: "a.strong", provider: "anthropic", model: "fable", label: "Fable", contextWindow: 200000, tags: ["strong"],
      price: { inputPerMTok: 15, outputPerMTok: 75, verifiedOn: "2026-09-16" } },
    { id: "o.strong", provider: "openai", model: "luna", label: "Luna", contextWindow: 128000, tags: ["strong"],
      price: { inputPerMTok: 10, outputPerMTok: 40, verifiedOn: null } },   // unverified: never chosen
    { id: "local", provider: "ollama", model: "llama", label: "Llama", contextWindow: 128000, tags: ["local", "cheap"],
      price: { inputPerMTok: 0, outputPerMTok: 0, verifiedOn: null } },
  ],
}));

const withKeys = (...providers: Array<"anthropic" | "openai">) => {
  const keys = new MemoryKeyStore();
  for (const p of providers) keys.write(p, "sk-test-000000000000000000000000000");
  return (p: ModelProvider) => keys.has(p);
};
const ctx = (over: Partial<{ hasRestrictedSources: boolean; escalation: number; localOnly: boolean }> = {}) =>
  ({ hasRestrictedSources: false, escalation: 0, ...over });

describe("which model is a policy the person can see, applied deterministically", () => {
  it("routes the same intent under the same policy to the same model, every time", () => {
    const keys = withKeys("anthropic");
    const first = routeModel("explain_check", DEFAULT_POLICY, registry, keys, ctx());
    for (let i = 0; i < 20; i += 1) {
      expect(routeModel("explain_check", DEFAULT_POLICY, registry, keys, ctx())!.model.id).toBe(first!.model.id);
    }
  });

  it("sends a cheap intent to the cheap model and a hard one to the strong model", () => {
    const keys = withKeys("anthropic");
    expect(routeModel("explain_check", DEFAULT_POLICY, registry, keys, ctx())!.model.id).toBe("local");
    expect(routeModel("draft_decision", DEFAULT_POLICY, registry, keys, ctx())!.model.id).toBe("a.strong");
  });

  it("moves when the person moves the slider, and only then", () => {
    const keys = withKeys("anthropic");
    const strongForChecks: RoutingPolicy = { ...DEFAULT_POLICY, strength: { ...DEFAULT_POLICY.strength, explain_check: 1 } };
    expect(routeModel("explain_check", strongForChecks, registry, keys, ctx())!.model.id).toBe("a.strong");
  });

  it("never chooses a model whose price is unverified", () => {
    const keys = withKeys("anthropic", "openai");
    for (const intent of ["explain_check", "draft_decision", "research_plan"] as const) {
      const r = routeModel(intent, DEFAULT_POLICY, registry, keys, ctx({ escalation: 1 }));
      expect(r!.model.id).not.toBe("o.strong");
    }
  });

  it("escalates one step up on repair, and says so in words", () => {
    const keys = withKeys("anthropic");
    const first = routeModel("describe_impact", DEFAULT_POLICY, registry, keys, ctx());
    const second = routeModel("describe_impact", DEFAULT_POLICY, registry, keys, ctx({ escalation: 1 }));
    expect(second!.escalation).toBe(1);
    expect(second!.because).toContain("escalated 1 step");
    // Escalation never goes down.
    const strengthOf = (id: string) => registry.model(id)!.tags.includes("strong") ? 1 : registry.model(id)!.tags.includes("cheap") ? 0 : 0.5;
    expect(strengthOf(second!.model.id)).toBeGreaterThanOrEqual(strengthOf(first!.model.id));
  });

  it("is bounded by the policy's escalation cap", () => {
    const keys = withKeys("anthropic");
    const capped = routeModel("explain_check", DEFAULT_POLICY, registry, keys, ctx({ escalation: 5 }));
    const once = routeModel("explain_check", DEFAULT_POLICY, registry, keys, ctx({ escalation: 1 }));
    expect(capped!.model.id).toBe(once!.model.id);
    expect(capped!.escalation).toBe(1);
  });

  it("forces the local route when a restricted source is in view", () => {
    const keys = withKeys("anthropic");
    const r = routeModel("draft_decision", DEFAULT_POLICY, registry, keys, ctx({ hasRestrictedSources: true }));
    expect(r!.model.tags).toContain("local");
    expect(r!.because).toContain("restricted source is in view");
  });

  it("refuses rather than falling back to a remote model when nothing local exists", () => {
    const noLocal = new ModelRegistry({
      ...registry.config, models: registry.config.models.filter((m) => !m.tags.includes("local")),
    });
    const r = routeModel("draft_decision", DEFAULT_POLICY, noLocal, withKeys("anthropic"), ctx({ hasRestrictedSources: true }));
    expect(r).toBeNull();
  });

  /* M6 B1 — a Sealed Session forces local-or-refuse whatever the policy says. */
  it("a Sealed Session routes local only, and refuses when nothing local exists — the relaxed policy does not help", () => {
    const relaxed: RoutingPolicy = { ...DEFAULT_POLICY, localOnlyForRestricted: false };
    expect(routeModel("draft_decision", relaxed, registry, withKeys("anthropic"), ctx({ localOnly: true }))!.model.id).toBe("local");
    const noLocal = new ModelRegistry({ ...registry.config, models: registry.config.models.filter((m) => !m.tags.includes("local")) });
    expect(routeModel("draft_decision", relaxed, noLocal, withKeys("anthropic"), ctx({ localOnly: true }))).toBeNull();
  });

  it("lets the person turn the restricted rule off, visibly, and then routes remote", () => {
    const relaxed: RoutingPolicy = { ...DEFAULT_POLICY, localOnlyForRestricted: false };
    const r = routeModel("draft_decision", relaxed, registry, withKeys("anthropic"), ctx({ hasRestrictedSources: true }));
    expect(r!.model.id).toBe("a.strong");
  });

  it("offers nothing remote with no key, and local with none", () => {
    expect(routeModel("draft_decision", DEFAULT_POLICY, registry, () => false, ctx())!.model.id).toBe("local");
  });
});

describe("the policy is read from two constraint values", () => {
  it("falls to defaults for anything missing or malformed", () => {
    const p = policyFrom({ draft_decision: 0.1, nonsense: 9, explain_check: "high" }, "yes");
    expect(p.strength.draft_decision).toBe(0.1);
    expect(p.strength.explain_check).toBe(DEFAULT_POLICY.strength.explain_check);
    expect((p.strength as Record<string, unknown>)["nonsense"]).toBeUndefined();
    expect(p.localOnlyForRestricted).toBe(true);
  });
});

describe("what the person accepted, per model — shown, never acted on", () => {
  it("counts acceptance per intent and model", () => {
    const rows = acceptanceByModel([
      { intent: "draft_decision", modelId: "a.strong", accepted: true },
      { intent: "draft_decision", modelId: "a.strong", accepted: true },
      { intent: "draft_decision", modelId: "a.cheap", accepted: false },
      { intent: "draft_decision", modelId: "a.cheap", accepted: true },
    ]);
    expect(rows).toEqual([
      { intent: "draft_decision", modelId: "a.cheap", accepted: 1, total: 2 },
      { intent: "draft_decision", modelId: "a.strong", accepted: 2, total: 2 },
    ]);
  });
});
