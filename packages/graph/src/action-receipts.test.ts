import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planDigest, sha256Hex, zeroCost } from "@xeniur/core";
import { ObjectGraph } from "./graph.js";

let dir: string; let graph: ObjectGraph;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "xeniur-receipt-")); graph = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") }); });
afterEach(() => { graph.close(); rmSync(dir, { recursive: true, force: true }); });

describe("Action Receipt Objects", () => {
  it("turns a consequential external action into a durable Living Object", () => {
    const world = graph.createWorld({ title: "Tokyo", emoji: "T" });
    const stay = graph.createObject({ worldId: world.id, title: "Kanda stay", semanticType: "hotel", properties: { traits: ["locatable", "priced", "temporal", "bookable"] } });
    const args = { capability: "hotel.reserve", domain: "stay.example", priceUsd: 240 };
    const action = graph.beginAction({ worldId: world.id, intent: "Reserve Kanda stay", tool: "browser.submit",
      plan: { intent: "Reserve Kanda stay", objects: [stay.object.id], tool: "browser.submit", args, confirmation: true },
      permissionLevel: "PURCHASE", provenance: "deterministic", provider: "xeniur.hands" });
    const digest = planDigest({ tool: "browser.submit", args, objectId: stay.object.id, destination: "stay.example" });
    graph.completeAction(action.id, { cost: { ...zeroCost(), usd: 240 }, receipt: {
      screenshotBlobHash: null, domDigest: "d".repeat(64), url: "https://stay.example/confirmed", params: { tool: "browser.submit" },
      sessionGrantId: null, attempted: "Reserve Kanda stay", planDigest: digest, destination: "stay.example",
      dataSent: [{ name: "traveller", valueDigest: sha256Hex(JSON.stringify("Ada")), valueType: "string" }],
      quotedPrice: { ...zeroCost(), usd: 240 }, actualPrice: { ...zeroCost(), usd: 238 },
      providerResponse: { status: "confirmed", reference: "R-1840", digest: "d".repeat(64) },
      outcome: "reservation confirmed", at: 100,
    } });
    const receipt = graph.actionReceipts.getByAction(action.id)!;
    expect(receipt.planDigest).toBe(digest);
    expect(receipt.destination).toBe("stay.example");
    expect(receipt.quotedPrice?.usd).toBe(240);
    expect(receipt.actualPrice.usd).toBe(238);
    const state = graph.currentState(receipt.objectId)!;
    expect(state.properties.semanticType).toBe("action_receipt");
    expect(state.properties.traits).toEqual(["consequential", "deliverable", "external", "versioned"]);
    expect((state.properties.settings["actionReceipt"] as { planDigest: string }).planDigest).toBe(digest);
    expect(state.object.parentId).toBe(stay.object.id);
  });

  it("falls back to the exact persisted ActionPlan digest rather than rebuilding a similar plan", () => {
    const world = graph.createWorld({ title: "Publish", emoji: "P" });
    const object = graph.createObject({ worldId: world.id, title: "Release note", semanticType: "document" });
    const plan = {
      intent: "Publish release note", objects: [object.object.id], tool: "browser.submit" as const,
      args: { capability: "document.publish", domain: "publisher.example" }, confirmation: true,
    };
    const action = graph.beginAction({ worldId: world.id, intent: plan.intent, tool: plan.tool,
      plan, permissionLevel: "COMMIT", provenance: "deterministic" });
    graph.completeAction(action.id, { receipt: {
      screenshotBlobHash: null, domDigest: null, url: "https://publisher.example/done", params: {},
      sessionGrantId: null, attempted: plan.intent, planDigest: null, destination: "publisher.example",
      dataSent: [], quotedPrice: null, actualPrice: zeroCost(), providerResponse: null,
      outcome: "published", at: 101,
    } });
    expect(graph.actionReceipts.getByAction(action.id)?.planDigest).toBe(planDigest(action.plan));
  });
});
