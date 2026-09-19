import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectGraph } from "./index.js";

let dir: string, g: ObjectGraph, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-env-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "W", emoji: "W" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("three levels of context disclosure", () => {
  it("a first request is expanded (everything is new); after approval the same request is ordinary", () => {
    const included = ["focus:a", "decision:b", "passage:c"];
    expect(g.envelopes.level(worldId, "research_plan", included, false)).toBe("expanded");
    expect(g.envelopes.delta(worldId, "research_plan", included)).toEqual(included);
    g.envelopes.approve(worldId, "research_plan", included);
    expect(g.envelopes.level(worldId, "research_plan", included, false)).toBe("ordinary");
    // New material crosses the boundary: only the delta is new.
    expect(g.envelopes.delta(worldId, "research_plan", [...included, "passage:d"])).toEqual(["passage:d"]);
    expect(g.envelopes.level(worldId, "research_plan", [...included, "passage:d"], false)).toBe("expanded");
  });

  it("envelopes are per intent and per World — approval for one does not leak to another", () => {
    g.envelopes.approve(worldId, "research_plan", ["decision:b"]);
    expect(g.envelopes.level(worldId, "write_document", ["decision:b"], false)).toBe("expanded");
    const other = g.createWorld({ title: "O", emoji: "O" }).id;
    expect(g.envelopes.level(other, "research_plan", ["decision:b"], false)).toBe("expanded");
  });

  it("acting outward is always consequential, however familiar the material", () => {
    g.envelopes.approve(worldId, "prepare_delivery", ["focus:a"]);
    expect(g.envelopes.level(worldId, "prepare_delivery", ["focus:a"], true)).toBe("consequential");
  });

  it("Don't send this to AI revokes the item from every envelope in the World", () => {
    g.envelopes.approve(worldId, "research_plan", ["decision:b", "passage:b:abc"]);
    g.envelopes.approve(worldId, "find_evidence", ["decision:b"]);
    g.envelopes.revoke(worldId, "decision:b");
    expect(g.envelopes.approvedIds(worldId, "research_plan")).toEqual(new Set(["passage:b:abc"]));
    expect(g.envelopes.approvedIds(worldId, "find_evidence")).toEqual(new Set());
  });
});
