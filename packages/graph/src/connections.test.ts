import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectGraph, connectionsFor } from "./index.js";

let dir: string, g: ObjectGraph, worldId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-conn-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "W", emoji: "W" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("Connect it — the graph first", () => {
  it("finds shared sources, linked decisions and shared traits, each with why it may connect, and no score", () => {
    const src = crypto.randomUUID();
    g.db.prepare(`INSERT INTO sources (id, world_id, kind, title, retrieved_at, metadata) VALUES (?, ?, 'paper', 'Study 4', ?, '{}')`).run(src, worldId, Date.now());
    const a = g.createObject({ worldId, semanticType: "claim", title: "Taped seams hold" }).object.id;
    const b = g.createObject({ worldId, semanticType: "claim", title: "Welded seams are cheaper" }).object.id;
    for (const id of [a, b]) g.db.prepare(`INSERT INTO atoms (object_id, atom_type, source_id, stated_at) VALUES (?, 'claim', ?, ?)`).run(id, src, Date.now());
    const jacket = g.createObject({ worldId, semanticType: "prop", title: "Jacket", properties: { traits: ["printable"] } }).object.id;
    const mount = g.createObject({ worldId, semanticType: "prop", title: "Mount", properties: { traits: ["printable"] } }).object.id;
    g.decisions.link({ fromObjectId: jacket, toObjectId: a, relation: "informed_by" });
    const other = g.createWorld({ title: "Elsewhere", emoji: "E" }).id;
    g.createObject({ worldId: other, semanticType: "prop", title: "Unrelated", properties: { traits: ["printable"] } });

    const forA = connectionsFor(g, a);
    expect(forA.map((c) => [c.title, c.by])).toEqual(expect.arrayContaining([
      ["Welded seams are cheaper", "shared_source"], ["Jacket", "linked_decision"],
    ]));
    expect(forA.find((c) => c.title === "Welded seams are cheaper")!.because).toBe('Both come from "Study 4".');
    const forJacket = connectionsFor(g, jacket);
    expect(forJacket.map((c) => c.title)).toEqual(expect.arrayContaining(["Mount"]));
    expect(forJacket.map((c) => c.title)).not.toContain("Unrelated");
    expect(JSON.stringify([...forA, ...forJacket])).not.toMatch(/score|\d+%/);
  });
});
