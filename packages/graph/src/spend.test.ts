import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectGraph } from "./graph.js";
import { BudgetRefused, SpendLedger } from "./spend.js";

let root: string, graph: ObjectGraph;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "xeniur-spend-")); graph = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(root, "blobs") }); });
afterEach(() => { graph.close(); rmSync(root, { recursive: true, force: true }); });

describe("user-set AI spending limits", () => {
  it("reserves against the monthly cap before another call can begin", () => {
    const ledger = new SpendLedger(graph.db, { perActionUsdMax: 1, perTaskUsdMax: 5, totalUsdMax: 100, monthlyUsdMax: .5 });
    const first = ledger.reserve({ estimateUsd: .4, provider: "openai", model: "luna" });
    expect(ledger.monthlySpent()).toBeCloseTo(.4);
    expect(() => ledger.reserve({ estimateUsd: .2, provider: "openai", model: "luna" })).toThrow(BudgetRefused);
    ledger.release(first.id);
    expect(ledger.monthlySpent()).toBe(0);
    ledger.setLimits({ ...ledger.limits(), monthlyUsdMax: .1 });
    expect(() => ledger.reserve({ estimateUsd: .2, provider: "openai", model: "luna" })).toThrow(/monthly/);
  });
});
