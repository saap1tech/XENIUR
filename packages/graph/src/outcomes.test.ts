import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionPlan, Tool } from "@xeniur/core";
import { ObjectGraph, ReadinessEvaluator, SpendLedger, loadProfiles, outcomeOf, trustFactsFor } from "./index.js";

let dir: string, g: ObjectGraph, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-outcomes-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Rainwear", emoji: "R" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const plan = (tool: Tool): ActionPlan => ({ intent: "x", objects: [], tool, args: {}, confirmation: false });

/** A delivered asset whose lineage carries a priced generative step and a free deterministic one. */
function delivered() {
  const taskId = "99999999-9999-4999-8999-999999999999";
  g.db.prepare(
    `INSERT INTO tasks (id, world_id, title, status, tool, payload, progress, attempts, created_at, updated_at)
     VALUES (?, ?, 'build', 'completed', '3d.export', '{}', 1, 1, ?, ?)`,
  ).run(taskId, worldId, Date.now(), Date.now());

  const state = g.createObject({ worldId, semanticType: "prop", title: "Rocket" });
  const objectId = state.object.id;
  const src = g.addRepresentation({
    objectId, modality: "image", format: "png",
    blobHash: g.putBlob(Buffer.from("circle"), "image/png", "png"), provenance: "human",
  });
  g.commitVersion({ objectId, forms: [{ role: "source.primary", representationId: src.id }] });

  const gen = g.beginAction({
    worldId, taskId, intent: "imagine", tool: "image.generate", plan: plan("image.generate"),
    permissionLevel: "CREATE", provenance: "generated", provider: "mock.image", model: "m", toolVersion: "1", generationParams: {},
  });
  const art = g.commitResult({
    actionId: gen.id, objectId,
    representations: [{ objectId, modality: "image", format: "png", blobHash: g.putBlob(Buffer.from("art"), "image/png", "png"),
                        producedByActionId: gen.id, provenance: "generated", provider: "mock.image" }],
    formRoles: ["art.primary"], inputs: [{ representationId: src.id, role: "source" }],
    cost: { inputTokens: 0, outputTokens: 0, credits: 0, usd: 0.10, ms: 1 },
  }).representations[0]!;

  const exp = g.beginAction({
    worldId, taskId, intent: "export", tool: "3d.export", plan: plan("3d.export"),
    permissionLevel: "CREATE", provenance: "deterministic", provider: "local.blender", model: null, toolVersion: "5.2", generationParams: {},
  });
  g.commitResult({
    actionId: exp.id, objectId,
    representations: [{ objectId, modality: "mesh", format: "stl", blobHash: g.putBlob(Buffer.from("stl"), "model/stl", "stl"),
                        producedByActionId: exp.id, provenance: "deterministic", provider: "local.blender" }],
    formRoles: ["print.stl"], inputs: [{ representationId: art.id, role: "source" }],
    cost: { inputTokens: 0, outputTokens: 0, credits: 0, usd: 0, ms: 1 },
  });

  // Two Brain calls under the same task: one cheap, one escalated.
  const ledger = new SpendLedger(g.db, { perActionUsdMax: 1, perTaskUsdMax: 5, totalUsdMax: 100 });
  const h1 = ledger.reserve({ estimateUsd: 0.01, provider: "cheap", model: "c", taskId, attempt: 1 });
  ledger.settle(h1.id, { usd: 0.004, outcome: "invalid_output" });
  const h2 = ledger.reserve({ estimateUsd: 0.05, provider: "strong", model: "s", taskId, attempt: 2 });
  ledger.settle(h2.id, { usd: 0.03, outcome: "ok" });

  g.process.record({ objectId, versionId: null, kind: "xeniur_session", actor: "human", label: "session",
                     tool: null, model: null, inputHashes: [], outputHashes: [], durationMs: 47 * 60_000 });

  const release = new ReadinessEvaluator(g, loadProfiles(process.cwd()))
    .approve({ objectId, profileId: "client", force: true });
  return { objectId, release };
}

describe("what a delivery cost, joined from tables that exist", () => {
  it("sums generation from lineage actions and intelligence from the tasks behind them", () => {
    const { objectId, release } = delivered();
    const o = outcomeOf(g, objectId, release.id);
    expect(o.generation.usd).toBeCloseTo(0.10, 6);
    expect(o.generation.actions).toBe(2);
    expect(o.generation.generativeActions).toBe(1);
    expect(o.intelligence.usd).toBeCloseTo(0.034, 6);
    expect(o.intelligence.calls).toBe(2);
    expect(o.intelligence.escalations).toBe(1);
    expect(o.intelligence.failed).toBe(1);
  });

  it("sums to the spend rows behind the release, exactly", () => {
    const { objectId, release } = delivered();
    const o = outcomeOf(g, objectId, release.id);
    const rows = g.db.prepare(`SELECT SUM(actual_usd) s FROM spend WHERE status = 'settled'`).get() as { s: number };
    expect(o.intelligence.usd).toBeCloseTo(rows.s, 9);
  });

  it("says recorded, never total", () => {
    const { objectId, release } = delivered();
    const o = outcomeOf(g, objectId, release.id);
    expect(o.recordedWork.sessions).toBe(1);
    expect(o.recordedWork.ms).toBe(47 * 60_000);
    expect(o.summary).toContain("47 min recorded — recorded, not total");
    expect(o.summary).not.toMatch(/total time|hours worked/);
    expect(o.summary).toContain("Delivery 01");
  });
});

describe("trust facts are read, not asserted", () => {
  it("reads cost from the ledger and goes stale the moment a measured form is rebuilt", () => {
    const { objectId } = delivered();
    const before = trustFactsFor(g, objectId);
    expect(before.cost.usd).toBeCloseTo(0.134, 6);
    expect(before.cost.escalations).toBe(1);
    expect(before.evidence).toEqual({ current: 0, total: 0 });

    // Measure the current STL form, bound to its hash.
    const state = g.currentState(objectId)!;
    const stl = state.forms.find((f) => f.role === "print.stl")!;
    const rep = g.getRepresentation(stl.representationId)!;
    g.db.prepare(
      `INSERT INTO checks (id, object_id, representation_id, validator, status, summary, detail, form_role, at,
                           subject_kind, subject_id, subject_hash)
       VALUES ('33333333-3333-4333-8333-333333333333', ?, ?, 'mesh.printable', 'pass', 'ok', '{}', 'print.stl', ?,
               'representation', ?, ?)`,
    ).run(objectId, rep.id, Date.now(), rep.id, rep.blobHash);
    expect(trustFactsFor(g, objectId).evidence).toEqual({ current: 1, total: 1 });
    expect(trustFactsFor(g, objectId).settled).toBe(true);

    // Rebuild the form: same role, new bytes. The measurement is now about something that no longer exists.
    const fresh = g.addRepresentation({ objectId, modality: "mesh", format: "stl",
      blobHash: g.putBlob(Buffer.from("stl v2"), "model/stl", "stl"), provenance: "deterministic" });
    g.commitVersion({ objectId, forms: state.forms.map((f) => f.role === "print.stl"
      ? { role: f.role, representationId: fresh.id } : { role: f.role, representationId: f.representationId }) });
    const after = trustFactsFor(g, objectId);
    expect(after.evidence).toEqual({ current: 0, total: 1 });
    expect(after.settled).toBe(false);
  });

  it("settles on the strict condition and on nothing less", () => {
    const state = g.createObject({ worldId, semanticType: "note", title: "Plain note" });
    const id = state.object.id;
    const rep = g.addRepresentation({ objectId: id, modality: "text", format: "md",
      blobHash: g.putBlob(Buffer.from("note"), "text/markdown", "md"), provenance: "human" });
    g.commitVersion({ objectId: id, forms: [{ role: "doc.primary", representationId: rep.id }] });
    // No citations, no measurements, no receipts, no decisions: nothing is unsettled, so it is settled.
    expect(trustFactsFor(g, id).settled).toBe(true);

    // One unreviewed citation, and it is not.
    g.db.prepare(`INSERT INTO sources (id, world_id, kind, title, retrieved_at, metadata)
                  VALUES ('11111111-1111-4111-8111-111111111111', ?, 'note', 's', ?, '{}')`).run(worldId, Date.now());
    g.db.prepare(`INSERT INTO source_versions (id, source_id, retrieved_at, content_hash, text_blob_hash, extractor, partial, rights)
                  VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', ?, 'h', 'b', 'v', 0, 'unknown')`).run(Date.now());
    const row = g.support.record({ claimObjectId: id, sourceVersionId: "22222222-2222-4222-8222-222222222222" });
    expect(trustFactsFor(g, id).settled).toBe(false);
    g.support.review(row.id, "supported");
    expect(trustFactsFor(g, id).settled).toBe(true);
    // A single contradiction unsettles it again.
    const c = g.support.record({ claimObjectId: id, sourceVersionId: "22222222-2222-4222-8222-222222222222" });
    g.support.review(c.id, "contradicted");
    expect(trustFactsFor(g, id).settled).toBe(false);
  });
});
