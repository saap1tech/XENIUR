import { describe, it, expect } from "vitest";
import { resolveAsk } from "./resolve.js";

const A = { id: "11111111-1111-4111-8111-111111111111", title: "Taped seams", semanticType: "claim" };
const B = { id: "22222222-2222-4222-8222-222222222222", title: "Welded seams", semanticType: "claim" };

describe("a request is read into one of the things XENIUR can do — and the reading is shown", () => {
  it("compare these two → find what the sources say about A and B", () => {
    const r = resolveAsk("Compare these two approaches", [A, B]);
    expect(r.intent).toBe("find_evidence");
    expect(r.objects).toEqual([A.id, B.id]);
    expect(r.interpretation).toBe('Find what the sources say → "Taped seams" and "Welded seams" → inspect context → proceed');
    expect(r.by).toBe("rule");
  });

  it("compare with one thing selected does not pretend to have two", () => {
    const r = resolveAsk("compare", [A]);
    expect(r.intent).toBeNull();
    expect(r.nearest[0]).toBe("find_evidence");
  });

  it("reads plans, documents, checks, changes, decisions, challenges and tests", () => {
    expect(resolveAsk("What should we do about the returns?", [A]).intent).toBe("research_plan");
    expect(resolveAsk("Write the introduction to the report", [A]).intent).toBe("write_document");
    expect(resolveAsk("Explain this check", [A]).intent).toBe("explain_check");
    expect(resolveAsk("What changed since the last delivery?", [A]).intent).toBe("describe_impact");
    expect(resolveAsk("Help me decide between the options", [A]).intent).toBe("draft_decision");
    expect(resolveAsk("Challenge this claim", [A]).intent).toBe("challenge_claim");
    expect(resolveAsk("How could we test this?", [A]).intent).toBe("propose_test");
  });

  it("an unreadable request offers the nearest things, never a guess dressed as a reading", () => {
    const r = resolveAsk("hmm banana", []);
    expect(r.intent).toBeNull();
    expect(r.by).toBe("unresolved");
    expect(r.interpretation).toMatch(/did not read/);
    expect(r.nearest).toEqual(["research_plan", "write_document", "find_evidence"]);
  });
});
