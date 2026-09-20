import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChallengeRulesInput } from "@xeniur/core";
import { MemorySigningKeyStore, RECORD_LIMITS, documentDigest } from "@xeniur/core";
import { ObjectGraph, PublisherIdentity } from "./index.js";

/**
 * Judging is human, signed, and never summed. A judge sees one sheet; their assessment is
 * their own signed document; the publisher's results are placings as written. Nothing here
 * computes a rank, and a test reads the store's source to be sure nothing could.
 */
const DAY = 86_400_000;
let dir: string, g: ObjectGraph;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-judging-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const rules = (over: Partial<ChallengeRulesInput> = {}): ChallengeRulesInput => ({
  title: "Water · Sun · Digital", brief: "Cut the energy cost of a litre of desalinated water.",
  rules: ["one entry per team"], startsAt: Date.now() - 3 * DAY, endsAt: Date.now() - DAY,
  deliverable: { formRoles: ["doc.proposal"], description: "a proposal" },
  judging: { criteria: ["works on the stated problem", "the making is inspectable"], by: "panel", scale: "one_to_five" },
  aiPolicy: "research_only", ...over,
});

/** A closed challenge with two entries from two participants, each with a small record. */
function closedWithEntries() {
  const c = g.challenges.create(rules({ endsAt: Date.now() + DAY }), g.publishers.self());
  const p1 = PublisherIdentity.load(new MemorySigningKeyStore(), "Team Adrar");
  const p2 = PublisherIdentity.load(new MemorySigningKeyStore(), "Team Oran");
  const mk = (title: string, who: PublisherIdentity) => {
    const objectId = g.createObject({ worldId: c.worldId, semanticType: "proposal", title }).object.id;
    const rep = g.addRepresentation({ objectId, modality: "text", format: "md", provenance: "human", blobHash: g.putBlob(Buffer.from(title), "text/markdown", "md") });
    g.commitVersion({ objectId, forms: [{ role: "doc.proposal", representationId: rep.id }] });
    g.process.record({ objectId, versionId: null, kind: "manual_edit", actor: "human", label: "wrote", tool: null, model: null, inputHashes: [], outputHashes: [], durationMs: 0 });
    return g.challenges.enter(c.worldId, objectId, who.ref());
  };
  const e1 = mk("Leak finder", p1), e2 = mk("Solar still", p2);
  const closedAt = Date.now() - 1;
  g.db.prepare(`UPDATE challenges SET ends_at = ?, rules = json_set(rules, '$.endsAt', ?) WHERE world_id = ?`).run(closedAt, closedAt, c.worldId);
  return { c, e1, e2, p1, p2 };
}

describe("judges are invited, judging opens after close", () => {
  it("only the publisher invites; an invited judge becomes trusted; judging waits for close", () => {
    const { c } = closedWithEntries();
    const judge = PublisherIdentity.load(new MemorySigningKeyStore(), "Engineer, SEAAL");
    g.judging.invite(c.worldId, judge.ref());
    expect(g.publishers.trustOf(judge.publicKey)).toBe("trusted");
    expect(g.judging.isJudge(c.worldId, judge.publicKey)).toBe(true);
    expect(g.judging.status(c.worldId).judgingOpenedAt).toBeNull();
    g.judging.open(c.worldId);
    expect(g.judging.status(c.worldId).judgingOpenedAt).not.toBeNull();
  });

  it("refuses to open judging while the challenge is still open", () => {
    const c = g.challenges.create(rules({ endsAt: Date.now() + DAY }), g.publishers.self());
    expect(() => g.judging.open(c.worldId)).toThrow(/after the challenge closes/);
  });
});

describe("a judge sees one sheet and records one signed assessment", () => {
  it("the sheet carries the entry's making, its record, the limits — and the entry number is arrival order", () => {
    const { c, e1, e2 } = closedWithEntries();
    g.judging.open(c.worldId);
    const s1 = g.judging.sheetFor(c.worldId, e1.id)!;
    const s2 = g.judging.sheetFor(c.worldId, e2.id)!;
    expect([s1.entryNumber, s2.entryNumber]).toEqual([1, 2]);
    expect(s1.entryCount).toBe(2);
    expect(s1.title).toBe("Leak finder");
    expect(s1.forms).toEqual([{ role: "doc.proposal", provenance: "human", modality: "text" }]);
    expect(s1.build.versions).toBeGreaterThanOrEqual(1);
    expect(s1.aiActivity).toEqual([]);
    expect(s1.observation.density).toBeNull();                              // no seal covered it: said, not hidden
    expect(s1.criteria).toEqual(["works on the stated problem", "the making is inspectable"]);
    expect(s1.own).toBeNull();
    expect(RECORD_LIMITS.map((r) => r.what)).toEqual(["Recorded provenance", "Record integrity", "Independent human contribution"]);
  });

  it("the publisher, when judging is by panel, is not a judge until invited; an assessment is signed and verifies", () => {
    const { c, e1 } = closedWithEntries();
    g.judging.open(c.worldId);
    expect(() => g.judging.assess(c.worldId, e1.id, [{ criterion: "works on the stated problem", mark: 4, note: "" }])).toThrow(/invited judge/);
    g.judging.invite(c.worldId, g.publishers.self().ref());
    const doc = g.judging.assess(c.worldId, e1.id, [
      { criterion: "works on the stated problem", mark: 4, note: "a real leak, a real sensor" },
      { criterion: "the making is inspectable", mark: null, note: "no seal covered it; I did not mark this" },
    ], "Strong on the problem, thin on the record.");
    expect(doc.kind).toBe("xeniur.judging/1");
    expect(doc.signature.rootHash).toBe(documentDigest(doc.body));
    expect(doc.body.inspected.verdict).toBe(e1.compliance.verdict);
    expect(g.judging.sheetFor(c.worldId, e1.id)!.own?.id).toBe(doc.body.id);
    // Recording again replaces, one per judge per entry.
    g.judging.assess(c.worldId, e1.id, [{ criterion: "works on the stated problem", mark: 5, note: "" }]);
    expect(g.judging.assessments(c.worldId)).toHaveLength(1);
  });

  it("refuses a criterion the challenge does not have, and an assessment before judging opens", () => {
    const { c, e1 } = closedWithEntries();
    g.judging.invite(c.worldId, g.publishers.self().ref());
    expect(() => g.judging.assess(c.worldId, e1.id, [{ criterion: "vibes", mark: 5, note: "" }])).toThrow(/has not opened/);
    g.judging.open(c.worldId);
    expect(() => g.judging.assess(c.worldId, e1.id, [{ criterion: "vibes", mark: 5, note: "" }])).toThrow(/not one of this challenge's criteria/);
  });

  it("an assessment from another machine is adopted only when it verifies and the judge was invited", () => {
    const { c, e1 } = closedWithEntries();
    g.judging.open(c.worldId);
    const judge = PublisherIdentity.load(new MemorySigningKeyStore(), "Designer");
    const body = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", challengeWorldId: c.worldId, entryId: e1.id, entryObjectId: e1.objectId,
      judge: judge.ref(), criteria: [{ criterion: "works on the stated problem", mark: 3, note: "" }], note: "",
      inspected: { proofRoot: null, verdict: "complies" as const, density: null, modelEvents: 0 }, recordedAt: Date.now(),
    };
    const signed = { kind: "xeniur.judging/1" as const, body, signature: judge.sign(documentDigest(body)) };
    expect(() => g.judging.adopt(signed)).toThrow(/not invited/);
    g.judging.invite(c.worldId, judge.ref());
    expect(g.judging.adopt(signed).id).toBe(body.id);
    expect(() => g.judging.adopt({ ...signed, body: { ...body, note: "changed" } })).toThrow(/does not verify/);
  });
});

describe("results are the publisher's placings, as written", () => {
  it("publishes signed placings in the given order with each finalist's proof link and verdict; never a computed rank", () => {
    const { c, e1, e2 } = closedWithEntries();
    g.judging.open(c.worldId);
    g.judging.invite(c.worldId, g.publishers.self().ref());
    g.judging.assess(c.worldId, e1.id, [{ criterion: "works on the stated problem", mark: 2, note: "" }]);
    g.judging.assess(c.worldId, e2.id, [{ criterion: "works on the stated problem", mark: 5, note: "" }]);
    // The publisher places the lower-marked entry first, on purpose: the order is theirs.
    const doc = g.judging.publishResults(c.worldId, [
      { place: "First", entryId: e1.id, objectId: e1.objectId, reason: "The only entry that would work in Adrar." },
      { place: "Special mention", entryId: e2.id, objectId: e2.objectId, reason: "Elegant, and untested." },
    ], "Two entries, two placings, as the panel discussed them.");
    expect(doc.kind).toBe("xeniur.results/1");
    expect(doc.body.placings.map((p) => p.place)).toEqual(["First", "Special mention"]);
    expect(doc.body.finalists.map((f) => f.title)).toEqual(["Leak finder", "Solar still"]);
    expect(doc.body.finalists[0]!.proofRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.body.assessmentsRead).toBe(2);
    expect(doc.signature.publicKey).toBe(g.publishers.self().publicKey);
    expect(g.judging.results(c.worldId)!.body.publishedAt).toBe(doc.body.publishedAt);
    expect(g.judging.status(c.worldId).resultsPublishedAt).toBe(doc.body.publishedAt);
    expect(JSON.stringify(doc.body)).not.toMatch(/"rank"|"score"|"average"|"total"/);
  });

  it("refuses a placing that names an entry the challenge does not have, and results from anyone but the publisher", () => {
    const { c, e1 } = closedWithEntries();
    g.judging.open(c.worldId);
    expect(() => g.judging.publishResults(c.worldId, [{ place: "First", entryId: e1.id, objectId: "00000000-0000-4000-8000-000000000000", reason: "x" }])).toThrow(/does not have/);
    const other = PublisherIdentity.load(new MemorySigningKeyStore(), "Not the organizer");
    const body = { challengeWorldId: c.worldId, placings: [], finalists: [], note: "", assessmentsRead: 0, publishedAt: Date.now() };
    expect(() => g.judging.adoptResults({ kind: "xeniur.results/1", body, signature: other.sign(documentDigest(body)) })).toThrow(/do not verify/);
  });

  it("the store's source holds no sum, average, sort-by-mark or rank", () => {
    const raw = require("node:fs").readFileSync(join(__dirname, "judging.ts"), "utf8") as string;
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");        // code, not the comments that say why
    for (const forbidden of ["AVG(", "SUM(", "rank", "leaderboard", ".sort(", "average"]) {
      expect(src, `judging.ts must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});
