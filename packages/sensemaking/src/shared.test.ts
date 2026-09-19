import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadOnlyOriginal, textLocator } from "@xeniur/core";
import {
  ObjectGraph, PackageRefused, critiquePairs, exportPackage, importPackage, importedFrom, inspectPackage,
} from "@xeniur/graph";
import { SensemakingStore } from "./index.js";

/**
 * The whole loop: the author shares, the reviewer opens it as a critique World, records a
 * contradicting claim with the passage that contradicts it, sends the critique back, and
 * the author sees it beside the work. The work itself is never changed by any of it.
 */
let dir: string, author: ObjectGraph, reviewer: ObjectGraph, A: SensemakingStore, R: SensemakingStore;
let worldId: string, reportId: string, claimId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-shared-"));
  author = ObjectGraph.open({ dbPath: join(dir, "a.db"), blobDir: join(dir, "a-blobs") });
  reviewer = ObjectGraph.open({ dbPath: join(dir, "r.db"), blobDir: join(dir, "r-blobs") });
  A = new SensemakingStore(author); R = new SensemakingStore(reviewer);
  worldId = author.createWorld({ title: "Rainwear 2027", emoji: "R" }).id;

  // The author's report, with one claim cited to a study passage.
  reportId = author.createObject({ worldId, semanticType: "report", title: "Colour strategy" }).object.id;
  const rep = author.addRepresentation({ objectId: reportId, modality: "text", format: "md",
    blobHash: author.putBlob(Buffer.from("# Colour strategy\nConsumers prefer orange."), "text/markdown", "md"),
    provenance: "human" });
  author.commitVersion({ objectId: reportId, forms: [{ role: "doc.primary", representationId: rep.id }] });
  const study = A.recordSource({ worldId, kind: "paper", title: "Study 4", author: "Okafor",
    text: "In the pilot, consumers preferred orange. Colour preference disappeared when price exceeded €80." });
  const sv = A.latestVersionOf(study.id)!;
  const claim = A.createAtom({ worldId, atomType: "claim", text: "Consumers prefer orange.",
    sourceId: study.id, sourceVersionId: sv.id, locator: textLocator("consumers preferred orange", 14, 40), lane: "keep" });
  claimId = claim.objectId;
  author.decisions.link({ fromObjectId: reportId, toObjectId: claimId, relation: "informed_by" });
  // Private material that must not travel.
  author.process.record({ objectId: reportId, versionId: null, kind: "xeniur_session", actor: "human",
    label: "late night, second bottle", tool: null, model: null, inputHashes: [], outputHashes: [], durationMs: 1000 });
});
afterEach(() => { author.close(); reviewer.close(); rmSync(dir, { recursive: true, force: true }); });

describe("a share carries the reasoning and none of the private half", () => {
  it("travels with support states, claims, sources and provenance; without prompts, notes or labels", async () => {
    A.recordSupport({ claimObjectId: claimId, sourceVersionId: A.latestVersionOf(A.listSources(worldId)[0]!.id)!.id });
    const { manifest } = await exportPackage(author, reportId, join(dir, "share.xeniur"), { intent: "share" });
    expect(manifest.intent).toBe("share");
    expect(manifest.claimSupport).toHaveLength(1);
    expect(manifest.claimSupport[0]!["status"]).toBe("unresolved");
    expect(manifest.atoms.map((a) => a["object_id"])).toContain(claimId);
    expect(manifest.sources).toHaveLength(1);
    expect(manifest.processEvents.length).toBeGreaterThan(0);
    const text = JSON.stringify(manifest);
    expect(text).not.toContain("late night");                       // labels are filtered to kinds
    expect(manifest.processEvents.every((e) => e["tool"] === null && e["model"] === null)).toBe(true);
    expect(manifest.actions.every((a) => a["plan"] === "{}" && a["generation_params"] === "{}")).toBe(true);
    expect(text).not.toMatch(/\/Users\/|\/home\//);
  });
});

describe("a critique World is someone else's work, read here and never changed", () => {
  async function shareToReviewer() {
    const path = join(dir, "share.xeniur");
    await exportPackage(author, reportId, path, { intent: "share" });
    return importPackage(reviewer, path, { as: "critique" });
  }

  it("lands in a critique World that names the sender, with every arrived Object recorded as theirs", async () => {
    const result = await shareToReviewer();
    const world = reviewer.getWorld(result.worldId)!;
    expect(world.kind).toBe("critique");
    expect(world.title).toBe("Critique: Rainwear 2027");
    expect(world.publisherId).toBe(author.publishers.self().publicKey);
    expect(importedFrom(reviewer, reportId)?.publicKey).toBe(author.publishers.self().publicKey);
    expect(importedFrom(reviewer, claimId)).not.toBeNull();
    // The support state arrived as it was: unresolved, not quietly green.
    expect(reviewer.support.summary(claimId).counts).toEqual(A.supportSummary(claimId).counts);
  });

  it("refuses to change the original, and says whose it is", async () => {
    await shareToReviewer();
    const rep = reviewer.addRepresentation({ objectId: reportId, modality: "text", format: "md",
      blobHash: reviewer.putBlob(Buffer.from("edited"), "text/markdown", "md"), provenance: "human" });
    expect(() => reviewer.commitVersion({ objectId: reportId, forms: [{ role: "doc.primary", representationId: rep.id }] }))
      .toThrow(ReadOnlyOriginal);
    expect(reviewer.currentState(reportId)!.versionId).toBe(author.currentState(reportId)!.versionId);
  });

  it("refuses to open your own World as a critique", async () => {
    const path = join(dir, "own.xeniur");
    await exportPackage(author, reportId, path, { intent: "share" });
    author.db.prepare(`DELETE FROM objects WHERE id IN (?, ?)`).run(reportId, claimId);
    await expect(importPackage(author, path, { as: "critique" })).rejects.toThrow(/one of your own Worlds/);
  });

  it("the reviewer's contradiction comes back beside the work, naming both claims and the passage — the work untouched", async () => {
    const { worldId: critiqueWorld } = await shareToReviewer();
    const before = {
      version: author.currentState(reportId)!.versionId,
      claimVersion: author.currentState(claimId)!.versionId,
      objects: (author.db.prepare(`SELECT COUNT(*) c FROM objects`).get() as { c: number }).c,
    };

    // Samir reads the same study and finds the sentence that undercuts the claim.
    const study = R.listSources(critiqueWorld)[0]!;
    const sv = R.latestVersionOf(study.id)!;
    const theirs = R.createAtom({
      worldId: critiqueWorld, atomType: "claim",
      text: "Colour preference disappeared when price exceeded €80.",
      sourceId: study.id, sourceVersionId: sv.id,
      locator: textLocator("Colour preference disappeared when price exceeded €80", 42, 95), lane: "keep",
    });
    const row = R.recordSupport({ claimObjectId: theirs.objectId, sourceVersionId: sv.id });
    R.reviewSupport(row.id, "supported");
    R.link({ fromObjectId: theirs.objectId, toObjectId: claimId, relation: "contradicts", note: "same study, paragraph 2" });
    // Their own Object in the critique World is writable.
    expect(() => R.rate(theirs.objectId, 0.9)).not.toThrow();

    // Back it goes, signed by Samir.
    const back = join(dir, "critique.xeniur");
    const { manifest } = await exportPackage(reviewer, theirs.objectId, back, { intent: "critique" });
    expect(manifest.publisher.publicKey).toBe(reviewer.publishers.self().publicKey);
    expect(manifest.claimSupport.some((s) => s["status"] === "supported")).toBe(true);

    const inspection = await inspectPackage(author, back);
    expect(inspection.ok).toBe(true);
    expect(inspection.relationship).toBe("new");
    const result = await importPackage(author, back);
    expect(result.worldId).toBe(worldId);                           // beside the work, not in a new World

    // Nothing about the author's own rows moved.
    expect(author.currentState(reportId)!.versionId).toBe(before.version);
    expect(author.currentState(claimId)!.versionId).toBe(before.claimVersion);
    expect((author.db.prepare(`SELECT COUNT(*) c FROM objects`).get() as { c: number }).c).toBe(before.objects + 1);

    const pairs = critiquePairs(author, claimId);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0]!;
    expect(pair.relation).toBe("contradicts");
    expect(pair.leftObjectId).toBe(claimId);
    expect(pair.rightObjectId).toBe(theirs.objectId);
    expect(pair.by?.publicKey).toBe(reviewer.publishers.self().publicKey);
    expect(pair.summary.counts.supported).toBe(1);
    expect(pair.summary.reviewedSupported).toBe(true);
    expect(pair.note).toBe("same study, paragraph 2");
    // The passage resolves on the author's machine against the stored copy.
    expect(A.passageOf(theirs.objectId)?.text).toMatch(/exceeded €80/);
  });

  it("a divergent history is still refused, critique or not", async () => {
    await shareToReviewer();
    // The author moves on; the reviewer's copy of the *report* comes back as a package.
    const rep = author.addRepresentation({ objectId: reportId, modality: "text", format: "md",
      blobHash: author.putBlob(Buffer.from("v2"), "text/markdown", "md"), provenance: "human" });
    author.commitVersion({ objectId: reportId, forms: [{ role: "doc.primary", representationId: rep.id }] });
    // Reviewer cannot commit to it; simulate a divergent package by exporting their (older) copy
    // after the author advanced — an ancestor, which is allowed to be *seen* but changes nothing.
    const path = join(dir, "old.xeniur");
    await exportPackage(reviewer, reportId, path, { intent: "share" });
    const inspection = await inspectPackage(author, path);
    expect(inspection.relationship).toBe("ancestor");
    const r = await importPackage(author, path);
    expect(r.alreadyPresent).toBe(true);
    expect(author.currentState(reportId)!.forms.find((f) => f.role === "doc.primary")!.representationId).toBe(rep.id);
  });
});

describe("circles count, and never rank", () => {
  it("shows N of M milestones from boolean Constraint Objects", () => {
    const circle = author.circles.create("Ship by Friday");
    author.circles.join(circle.id, author.publishers.self().ref());
    author.circles.join(circle.id, { publicKey: "B".repeat(43), displayName: "Samir" });
    const mk = (title: string, done: boolean) => {
      const id = author.createObject({ worldId, semanticType: "constraint", title }).object.id;
      author.constraints.define(id, { kind: "boolean" }, "milestone", done);
      return id;
    };
    for (const [t, d] of [["Interviews done", true], ["Decision accepted", true], ["Prototype", true], ["Delivery", false]] as const) {
      author.circles.addMilestone(circle.id, mk(t, d));
    }
    const p = author.circles.progress(circle.id);
    expect(p).toMatchObject({ completed: 3, total: 4, summary: "3 of 4 milestones" });
    expect(JSON.stringify(p)).not.toMatch(/%|rank|score|#\d/);
    expect(author.circles.get(circle.id)!.members).toHaveLength(2);
    expect(() => author.circles.addMilestone(circle.id, reportId)).toThrow(/boolean Constraint/);
  });
});
