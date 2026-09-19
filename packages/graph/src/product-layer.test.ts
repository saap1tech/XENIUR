import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { ComputeLedger } from "./compute.js"; import { ObjectGraph } from "./graph.js"; import { renderProofPage, shareProcess, verifySharedProcess } from "./proof-page.js"; import { validateWorkflow, WorkflowLibrary } from "./workflows.js";

let dir: string; let graph: ObjectGraph;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "xeniur-product-")); graph = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") }); });
afterEach(() => { graph.close(); rmSync(dir, { recursive: true, force: true }); });

describe("transparent compute", () => {
  it("binds one visible estimate to one exact generation", () => {
    const ledger = new ComputeLedger(graph.db, { usdPerCompute: .02, intelligenceRolling: 100, intelligenceReserve: 500, rollingHours: 5 }); ledger.grant(100, "receipt-1");
    const world = graph.createWorld({ title: "Product", emoji: "P" }); const object = graph.createObject({ worldId: world.id, title: "Model", semanticType: "object" });
    const plan = { intent: "Generate 3D candidate", tool: "3d.generate" as const, objects: [object.object.id], args: {}, confirmation: false };
    const quote = ledger.offer({ worldId: world.id, title: plan.intent, plan, fingerprint: "exact-v1", provider: "cloud", kind: "cloud", estimatedUsd: .76, provenance: "AI recorded", localAlternative: "Extrude locally" });
    expect(quote.compute).toBe(38); expect(quote.balance).toBe(100);
    ledger.confirm(quote.id, () => undefined); expect(() => ledger.confirm(quote.id, () => undefined)).toThrow(/already/);
    expect(() => ledger.reserve(quote.id, "changed-v2")).toThrow(/changed/); ledger.reserve(quote.id, "exact-v1"); expect(ledger.balance()).toBe(62); ledger.settle(quote.id, .7); expect(ledger.balance()).toBe(65);
  });
});

describe("privacy-filtered proof of process", () => {
  it("exports only deliberately selected events and keeps private labels and model names out", () => {
    const world = graph.createWorld({ title: "Rainwear", emoji: "R" }); const object = graph.createObject({ worldId: world.id, title: "Jacket", semanticType: "object" });
    const kept = graph.process.record({ objectId: object.object.id, versionId: object.versionId, kind: "sketch_made", actor: "human", label: "Private customer name on sketch", tool: null, model: null, inputHashes: [], outputHashes: ["a".repeat(64)], durationMs: 4000 });
    graph.process.record({ objectId: object.object.id, versionId: object.versionId, kind: "model_step", actor: "model", label: "Secret prompt", tool: "image.generate", model: "private-model", inputHashes: [], outputHashes: [], durationMs: 20 });
    const options = { title: "Jacket", eventIds: [kept.id], discloseHashes: false, discloseTiming: false }; const shared = shareProcess(graph.process.proof(object.object.id), options);
    expect(shared.events).toHaveLength(1); expect(shared.events[0]!.label).toBe("Human work"); expect(shared.events[0]!.outputHashes).toEqual([]); expect(verifySharedProcess(shared)).toBe(true);
    const { html } = renderProofPage(graph.process.proof(object.object.id), options); expect(html).not.toContain("Private customer"); expect(html).not.toContain("private-model"); expect(html).toContain("Made with XENIUR");
  });
});

describe("data-only workflow exchange", () => {
  it("refuses arbitrary capabilities and applies only validated manifests", () => {
    const base = { format: "xeniur-workflow/1", name: "Local product", author: "Elena", summary: "A trusted local flow", instructions: "Bring your source.", scene: { meaning: "relationship", interaction: "choose", layer: 2 }, constraints: [], readinessProfiles: [], decisionTemplate: { question: "", options: [] }, deliveryRoles: [], sampleObjects: [] } as const;
    const output = { slot: "result", modality: "mesh", format: "glb", formRole: "delivery.godot" } as const;
    expect(() => validateWorkflow({ ...base, recipe: { name: "unsafe", steps: [{ key: "run", tool: "code.patch", args: {}, inputs: [], outputs: [output], replayPolicy: "deterministic" }] } })).toThrow(/not permitted/);
    const safe = { ...base, recipe: { name: "safe", steps: [{ key: "export", tool: "3d.export", args: { format: "glb" }, inputs: [], outputs: [output], replayPolicy: "deterministic" }] } };
    const library = new WorkflowLibrary(graph); const listing = library.install(safe); const worldId = library.apply(listing.id); expect(graph.getWorld(worldId)?.title).toBe("Local product");
  });
});
