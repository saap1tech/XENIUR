import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectGraph } from "@xeniur/graph";
import { SensemakingStore } from "@xeniur/sensemaking";
import { exploreIntoProposals } from "./explore.js";

/** Gate 0: capture is not acceptance. A captured page proposes; a person accepts. */
let dir: string, g: ObjectGraph, sense: SensemakingStore, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-explore-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  sense = new SensemakingStore(g);
  worldId = g.createWorld({ title: "Water", emoji: "W" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const page = {
  title: "Desalination costs", url: "https://example.org/desal",
  text: "A 2024 study found that 63% of plant energy went to pumping. Reverse osmosis membranes were replaced every 7 years. Operators reported that leaks caused most losses.",
  risk: { status: "not_checked" },
};

describe("Explore proposes and never accepts", () => {
  it("stores the exact copy, proposes candidates, and creates no atom", () => {
    const r = exploreIntoProposals(sense, worldId, page);
    expect(sense.textOfVersion(sense.latestVersionOf(r.sourceId)!.id)).toBe(page.text);
    expect(r.candidateCount).toBeGreaterThan(0);
    expect(sense.pendingCandidates(worldId)).toHaveLength(r.candidateCount);
    expect(sense.listAtoms(worldId)).toHaveLength(0);
  });

  it("acceptance is a separate act that yields exactly one atom per accepted candidate", () => {
    const r = exploreIntoProposals(sense, worldId, page);
    const first = sense.pendingCandidates(worldId)[0]!;
    sense.accept(first.id);
    expect(sense.listAtoms(worldId)).toHaveLength(1);
    expect(sense.pendingCandidates(worldId)).toHaveLength(r.candidateCount - 1);
  });

  it("no IPC handler accepts candidates on capture", () => {
    const ipc = readFileSync(join(__dirname, "..", "ipc.ts"), "utf8");
    expect(ipc).not.toContain("acceptCandidates(");
  });
});
