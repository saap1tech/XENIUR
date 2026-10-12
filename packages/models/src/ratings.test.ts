import { describe, expect, it } from "vitest";
import { byFit, rateModel, TESTED_MODELS } from "./ratings.js";

const text = (model: string, extra: { contextWindow?: number; reasoning?: boolean } = {}) =>
  ({ model, output: "text" as const, contextWindow: extra.contextWindow ?? 131072, ...(extra.reasoning ? { reasoning: true } : {}) });

describe("model ratings", () => {
  it("reports a tested model exactly as tested, with its date and step results", () => {
    const r = rateModel(text("qwen/qwen3-235b-a22b-2507"));
    expect(r).toBe(TESTED_MODELS["qwen/qwen3-235b-a22b-2507"]);
    expect(r.fit).toBe("best"); expect(r.testedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rateModel(text("openai/gpt-4o-mini")).steps?.draft).toBe("fail");
  });
  it("names a known risk for an untested model, and otherwise promises nothing", () => {
    expect(rateModel(text("x/thinker", { reasoning: true })).fit).toBe("care");
    expect(rateModel(text("x/llama-3.2-3b-instruct")).fit).toBe("care");
    expect(rateModel(text("x/short", { contextWindow: 32000 })).fit).toBe("care");
    expect(rateModel(text("x/solid-70b"))).toMatchObject({ fit: "untested" });
    expect(rateModel({ model: "x/painter", output: "image", contextWindow: 1 }).fit).toBe("untested");
  });
  it("orders better fits first, then cheaper", () => {
    const list = [{ fit: "care" as const, price: 0 }, { fit: "untested" as const, price: 2 }, { fit: "best" as const, price: 9 }, { fit: "untested" as const, price: 1 }];
    expect(list.sort(byFit).map((m) => `${m.fit}:${m.price}`)).toEqual(["best:9", "untested:1", "untested:2", "care:0"]);
  });
});
