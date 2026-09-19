import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectGraph } from "./graph.js";

describe("process provenance", () => {
  it("keeps factual recorded activity and publishes a privacy-filtered, hash-verifiable proof", () => {
    const dir = mkdtempSync(join(tmpdir(), "xeniur-process-"));
    const graph = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
    const world = graph.createWorld({ title: "Rainwear", emoji: "R" });
    const object = graph.createObject({ worldId: world.id, semanticType: "jacket", title: "Shell" });
    const hash = "a".repeat(64);
    graph.process.record({
      objectId: object.object.id, versionId: object.versionId, kind: "sketch_made", actor: "human",
      label: "Orange shell sketch", tool: null, model: null,
      inputHashes: [], outputHashes: [hash], durationMs: 180_000,
    });
    graph.process.record({
      objectId: object.object.id, versionId: object.versionId, kind: "model_step", actor: "model",
      label: "Removed scan noise", tool: "image.transform", model: "fixture-model",
      inputHashes: [hash], outputHashes: ["b".repeat(64)], durationMs: 400,
    });
    const proof = graph.process.publish(object.object.id, "filtered");
    expect(proof.summary).toContain("1 sketch recorded as user-created");
    expect(proof.summary).not.toContain("original");
    expect(proof.summary).toContain("AI used at 1 recorded step");
    expect(proof.disclosedHashes).toContain(hash);
    expect(proof.rootHash).toHaveLength(64);
    expect(proof.events[0]!.label).toBe("sketch made");
    expect(proof.events[1]!.model).toBeNull();

    const notice = graph.process.noticeDerivation({
      sourceObjectId: object.object.id, derivedObjectId: object.object.id,
      overlap: 0.82, invitation: "disclose_transformation",
    });
    expect(notice.statement).toContain("not proof of theft");
    graph.close(); rmSync(dir, { recursive: true, force: true });
  });
});
