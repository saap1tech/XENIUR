import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectGraph, ingredientsOf } from "@xeniur/graph";
import { positionSelectorOf, quoteSelectorOf, timecodeOf } from "@xeniur/core";
import {
  SensemakingStore, buildThinkingMap, extractCandidates, extractMoments, resolvePassage,
  similarity,
} from "./index.js";

let dir: string, g: ObjectGraph, store: SensemakingStore, worldId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-sense-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Rainwear 2027", emoji: "R" }).id;
  store = new SensemakingStore(g, { frictionThreshold: 3 });
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const ARTICLE = `
Waterproof membranes are the single largest cost in technical outerwear.
A 2024 study found that 63% of returns were caused by seam failure, not fabric failure.
For example, taped seams outperform welded seams in cold weather.
However, welded seams are cheaper at volume, which contradicts the usual advice.
Should we be optimising for durability or for margin?
This might possibly be worth revisiting later.
`.trim();

describe("extraction is heuristic, and says so", () => {
  it("finds candidates and keeps the characters each came from", () => {
    const found = extractCandidates(ARTICLE);
    const types = found.map((c) => c.atomType);

    expect(types).toContain("question");
    expect(types).toContain("evidence");
    expect(types).toContain("example");
    expect(types).toContain("contradiction");

    // Every candidate can be taken back to the exact text that produced it, by position
    // and by quotation — the pair is what survives the source being re-extracted.
    for (const c of found) {
      const position = positionSelectorOf(c.locator)!;
      const quote = quoteSelectorOf(c.locator)!;
      expect(ARTICLE.slice(position.start, position.end)).toBe(c.text);
      expect(quote.exact).toBe(c.text);
      expect(c.because.length).toBeGreaterThan(0);
    }
  });

  it("does not treat a hedged sentence as a claim", () => {
    const found = extractCandidates(ARTICLE);
    expect(found.some((c) => c.text.includes("might possibly"))).toBe(false);
  });

  it("keeps a useful twelve seconds of video addressable by timecode", () => {
    const moments = extractMoments([
      { start: 0, text: "Hello and welcome." },
      { start: 12.5, text: "The data shows that 40% of heat loss happens through the hood." },
      { start: 60, text: "So what should we change first?" },
    ]);
    expect(moments).toHaveLength(2);
    expect(timecodeOf(moments[0]!.locator)).toBe(12.5);
    expect(moments[0]!.because).toContain("0:12");
    expect(moments[1]!.atomType).toBe("question");
  });
});

describe("an atom is an Object like anything else", () => {
  it("gets identity, a form, a version and provenance", () => {
    const atom = store.createAtom({
      worldId, atomType: "claim", text: "Seam failure drives returns, not fabric failure.",
      provenance: "human",
    });

    const state = g.currentState(atom.objectId)!;
    expect(state.properties.semanticType).toBe("claim");
    expect(state.forms.map((f) => f.role)).toEqual(["atom.text"]);
    expect(g.getRepresentation(state.forms[0]!.representationId)!.provenance).toBe("human");
    expect(store.getAtom(atom.objectId)!.text).toBe("Seam failure drives returns, not fabric failure.");
  });

  it("counts a person's own observation as their thinking, and a source as external", () => {
    const source = store.recordSource({ worldId, kind: "article", title: "Outerwear economics" });
    const quoted = store.createAtom({
      worldId, atomType: "claim", text: "Welded seams are cheaper at volume.", sourceId: source.id,
    });
    const mine = store.observe(worldId, "Our returns data disagrees with this entirely.");

    expect(ingredientsOf(g, quoted.objectId).counts.your_observation).toBe(0);
    expect(ingredientsOf(g, mine.objectId).counts.your_observation).toBe(1);
    expect(ingredientsOf(g, mine.objectId).humanSignalPresent).toBe(true);
  });

  it("leaves confidence unrated rather than inventing one", () => {
    const source = store.recordSource({ worldId, kind: "article", title: "A", text: ARTICLE });
    const version = store.latestVersionOf(source.id)!;
    const [atom] = store.acceptCandidates(worldId, version.id, extractCandidates(ARTICLE).slice(0, 1));
    expect(atom!.confidence).toBeNull();
    expect(atom!.extraction).toBe("heuristic");

    store.rate(atom!.objectId, 0.7);
    expect(store.getAtom(atom!.objectId)!.confidence).toBe(0.7);
  });
});

describe("the Thinking Map answers from the graph, not from an impression", () => {
  function seed() {
    const a = store.recordSource({
      worldId, kind: "article", title: "Outerwear economics", author: "Lin",
      text: ARTICLE, publicationId: "economics-weekly",
    });
    const b = store.recordSource({
      worldId, kind: "paper", title: "Seam durability study", author: "Okafor",
      text: "A 2024 study measured seam failure across 4,000 returned garments.",
      publicationId: "textile-journal",
    });
    const av = store.latestVersionOf(a.id)!;
    const bv = store.latestVersionOf(b.id)!;

    const claim = store.createAtom({
      worldId, atomType: "claim", sourceId: a.id, sourceVersionId: av.id,
      text: "Seam failure causes most technical outerwear returns.",
    });
    const echo = store.createAtom({
      worldId, atomType: "claim", sourceId: b.id, sourceVersionId: bv.id,
      text: "Most outerwear returns are caused by seam failure rather than fabric.",
    });
    const evidence = store.createAtom({
      worldId, atomType: "evidence", sourceId: b.id, sourceVersionId: bv.id,
      text: "63% of returns in the 2024 sample were seam-related.",
    });
    const counter = store.createAtom({
      worldId, atomType: "claim", sourceId: a.id, sourceVersionId: av.id,
      text: "Welded seams are cheaper at volume and good enough.",
    });
    const unbacked = store.createAtom({
      worldId, atomType: "claim",
      text: "Customers will pay more for a five-year guarantee.",
    });
    return { a, b, claim, echo, evidence, counter, unbacked };
  }

  it("says what you know, and why", () => {
    const { claim, evidence } = seed();
    store.link({ fromObjectId: evidence.objectId, toObjectId: claim.objectId, relation: "supports" });
    store.rate(claim.objectId, 0.8);

    const map = buildThinkingMap(g, store, worldId);
    expect(map.known.map((e) => e.atom.objectId)).toContain(claim.objectId);
    expect(map.known[0]!.because).toContain("you rated this 80%");
    expect(map.known[0]!.because).toContain("as support");
  });

  it("shows conflicts, and which two ideas disagree", () => {
    const { claim, counter } = seed();
    store.link({ fromObjectId: counter.objectId, toObjectId: claim.objectId, relation: "contradicts" });

    const map = buildThinkingMap(g, store, worldId);
    const ids = map.conflicts.map((e) => e.atom.objectId);
    expect(ids).toContain(claim.objectId);
    expect(ids).toContain(counter.objectId);
    expect(map.conflicts.find((e) => e.atom.objectId === counter.objectId)!.because)
      .toContain("Seam failure causes most");
  });

  it("notices the same claim arriving from two different sources", () => {
    seed();
    const map = buildThinkingMap(g, store, worldId);
    expect(map.repeating.length).toBeGreaterThan(0);
    expect(map.repeating[0]!.because).toContain("say something very close to this");
  });

  it("does not call one article repeating itself repetition", () => {
    const a = store.recordSource({ worldId, kind: "article", title: "One article", text: ARTICLE });
    const v = store.latestVersionOf(a.id)!;
    store.createAtom({ worldId, atomType: "claim", sourceId: a.id, sourceVersionId: v.id,
                       text: "Seam failure causes most returns." });
    store.createAtom({ worldId, atomType: "claim", sourceId: a.id, sourceVersionId: v.id,
                       text: "Most returns are caused by seam failure." });
    expect(buildThinkingMap(g, store, worldId).repeating).toHaveLength(0);
  });

  it("separates what is unverified from what is merely unrated", () => {
    const { unbacked } = seed();
    const map = buildThinkingMap(g, store, worldId);
    const found = map.unverified.find((e) => e.atom.objectId === unbacked.objectId)!;
    expect(found).toBeDefined();
    expect(found.because).toContain("nothing is linked to it as support");
  });

  it("lists what deserves action, and stops once something is happening", () => {
    const { unbacked } = seed();
    store.sort(unbacked.objectId, "test");
    expect(buildThinkingMap(g, store, worldId).actionable.map((e) => e.atom.objectId))
      .toContain(unbacked.objectId);

    g.db.prepare(
      `INSERT INTO tasks (id, world_id, title, status, tool, payload, progress, attempts, created_at, updated_at)
       VALUES (?, ?, 'test it', 'queued', 'doc.write', ?, 0, 0, ?, ?)`,
    ).run("33333333-3333-4333-8333-333333333333", worldId,
          JSON.stringify({ objectId: unbacked.objectId }), Date.now(), Date.now());

    expect(buildThinkingMap(g, store, worldId).actionable.map((e) => e.atom.objectId))
      .not.toContain(unbacked.objectId);
  });
});

describe("productive friction", () => {
  it("stays quiet while intake is converting into thinking", () => {
    const s = store.recordSource({ worldId, kind: "article", title: "One" });
    store.createAtom({ worldId, atomType: "claim", text: "Something.", sourceId: s.id });
    store.rate(store.listAtoms(worldId)[0]!.objectId, 0.5);
    expect(store.friction(worldId).active).toBe(false);
  });

  it("stops surfacing more once intake stops converting, and asks for one move", () => {
    for (let i = 0; i < 3; i += 1) {
      store.recordSource({ worldId, kind: "article", title: `Article ${i}` });
    }
    const state = store.friction(worldId);
    expect(state.active).toBe(true);
    expect(state.intakeSinceMove).toBe(3);
    expect(state.threshold).toBe(3);
    expect(state.prompt).toBeTruthy();
    expect(state.dismissible).toBe(true);
  });

  it("clears the moment the person makes a move", () => {
    for (let i = 0; i < 4; i += 1) store.recordSource({ worldId, kind: "video", title: `Clip ${i}` });
    expect(store.friction(worldId).active).toBe(true);

    store.observe(worldId, "My own conclusion: seams matter more than fabric.");
    const after = store.friction(worldId);
    expect(after.active).toBe(false);
    expect(after.intakeSinceMove).toBe(0);
  });

  it("records a dismissal rather than silently bypassing it", () => {
    for (let i = 0; i < 3; i += 1) store.recordSource({ worldId, kind: "article", title: `A${i}` });
    expect(store.friction(worldId).active).toBe(true);

    store.dismissFriction(worldId, "just skimming for now");
    expect(store.friction(worldId).active).toBe(false);
    const move = g.db.prepare(
      `SELECT kind, note FROM moves WHERE world_id = ? ORDER BY at DESC LIMIT 1`,
    ).get(worldId) as { kind: string; note: string };
    expect(move.kind).toBe("dismissed_friction");
    expect(move.note).toBe("just skimming for now");
  });
});

describe("the source behind a claim is kept, not merely referenced", () => {
  it("stores the copy it read, and can show the exact passage again", () => {
    const source = store.recordSource({
      worldId, kind: "article", title: "Outerwear economics", text: ARTICLE,
    });
    const version = store.latestVersionOf(source.id)!;
    const [atom] = store.acceptCandidates(
      worldId, version.id, extractCandidates(ARTICLE).filter((c) => c.atomType === "evidence"),
    );

    const passage = store.passageOf(atom!.objectId)!;
    expect(passage).not.toBeNull();
    expect(passage.text).toBe(atom!.text);
    expect(passage.moved).toBe(false);
    expect(passage.sourceVersionId).toBe(version.id);
    // And the surrounding words, so the claim can be read in context rather than alone.
    expect(passage.context.before.length + passage.context.after.length).toBeGreaterThan(0);
  });

  it("finds the passage again after re-extraction moves every offset", () => {
    const source = store.recordSource({ worldId, kind: "article", title: "A", text: ARTICLE });
    const first = store.latestVersionOf(source.id)!;
    const [atom] = store.acceptCandidates(
      worldId, first.id, extractCandidates(ARTICLE).filter((c) => c.atomType === "evidence"),
    );

    // The same article, re-extracted with a parser that keeps the headline and byline.
    const reExtracted = `Seams and Returns\nBy Lin, for Economics Weekly\n\n${ARTICLE}`;
    const second = store.addSourceVersion({
      sourceId: source.id, text: reExtracted, extractor: "readability/2",
    });

    const stored = store.textOfVersion(second.id)!;
    const found = resolvePassage(stored, store.getAtom(atom!.objectId)!.locator, second.id)!;

    expect(found).not.toBeNull();
    expect(found.text).toBe(atom!.text);
    expect(found.start).toBeGreaterThan(positionSelectorOf(store.getAtom(atom!.objectId)!.locator)!.start);
    // XENIUR says the offsets moved rather than pretending nothing happened.
    expect(found.moved).toBe(true);
  });

  it("says the words are gone rather than highlighting whatever took their place", () => {
    const source = store.recordSource({ worldId, kind: "article", title: "A", text: ARTICLE });
    const v1 = store.latestVersionOf(source.id)!;
    const [atom] = store.acceptCandidates(
      worldId, v1.id, extractCandidates(ARTICLE).filter((c) => c.atomType === "evidence"),
    );

    const rewritten = "The publisher replaced this article with an apology and a correction notice.";
    const v2 = store.addSourceVersion({ sourceId: source.id, text: rewritten });
    expect(resolvePassage(store.textOfVersion(v2.id)!, store.getAtom(atom!.objectId)!.locator, v2.id))
      .toBeNull();
  });

  it("gives two captures of one article the same content hash", () => {
    const s1 = store.recordSource({ worldId, kind: "article", title: "Seams", text: ARTICLE });
    const s2 = store.recordSource({ worldId, kind: "article", title: "Seams (again)", text: ARTICLE });
    expect(store.latestVersionOf(s1.id)!.contentHash)
      .toBe(store.latestVersionOf(s2.id)!.contentHash);
  });
});

describe("a suggestion stays a suggestion until a person acts on it", () => {
  const capture = () => {
    const source = store.recordSource({ worldId, kind: "article", title: "A", text: ARTICLE });
    const version = store.latestVersionOf(source.id)!;
    return { version, proposed: store.propose(worldId, version.id, extractCandidates(ARTICLE)) };
  };

  it("creates no atoms by extracting", () => {
    const { proposed } = capture();
    expect(proposed.length).toBeGreaterThan(0);
    expect(store.listAtoms(worldId)).toHaveLength(0);
    expect(store.pendingCandidates(worldId)).toHaveLength(proposed.length);
  });

  it("creates one atom per acceptance, and keeps the locator", () => {
    const { proposed } = capture();
    const atom = store.accept(proposed[0]!.id)!;
    expect(store.listAtoms(worldId)).toHaveLength(1);
    expect(atom.extraction).toBe("heuristic");
    expect(quoteSelectorOf(atom.locator)!.exact).toBe(proposed[0]!.text);
    expect(store.getCandidate(proposed[0]!.id)!.state).toBe("accepted");
  });

  it("keeps a rejection instead of deleting it", () => {
    const { proposed } = capture();
    store.reject(proposed[0]!.id);
    expect(store.getCandidate(proposed[0]!.id)!.state).toBe("rejected");
    expect(store.pendingCandidates(worldId)).toHaveLength(proposed.length - 1);
    expect(store.listAtoms(worldId)).toHaveLength(0);
  });

  it("stops an edited atom from claiming to be a quotation", () => {
    const { proposed } = capture();
    const atom = store.accept(proposed[0]!.id, { text: "My own wording of this." })!;
    expect(atom.text).toBe("My own wording of this.");
    expect(atom.extraction).toBe("manual");
    expect(atom.locator.selectors).toHaveLength(0);
    expect(store.getCandidate(proposed[0]!.id)!.state).toBe("edited");
  });

  it("cannot be accepted twice", () => {
    const { proposed } = capture();
    expect(store.accept(proposed[0]!.id)).not.toBeNull();
    expect(store.accept(proposed[0]!.id)).toBeNull();
    expect(store.listAtoms(worldId)).toHaveLength(1);
  });
});

describe("the map claims only what it computed", () => {
  it("does not file an explicitly disbelieved claim under what you know", () => {
    const source = store.recordSource({ worldId, kind: "article", title: "A", text: ARTICLE });
    const v = store.latestVersionOf(source.id)!;
    const claim = store.createAtom({
      worldId, atomType: "claim", sourceId: source.id, sourceVersionId: v.id,
      text: "Welded seams are good enough for every climate.",
    });
    const evidence = store.createAtom({
      worldId, atomType: "evidence", sourceId: source.id, sourceVersionId: v.id,
      text: "63% of returns in the 2024 sample were seam-related.",
    });
    store.link({ fromObjectId: evidence.objectId, toObjectId: claim.objectId, relation: "supports" });

    // 0 is "I do not believe this" — the strongest thing a person can say short of deleting it.
    store.rate(claim.objectId, 0);
    expect(buildThinkingMap(g, store, worldId).known.map((e) => e.atom.objectId))
      .not.toContain(claim.objectId);

    store.rate(claim.objectId, 0.6);
    expect(buildThinkingMap(g, store, worldId).known.map((e) => e.atom.objectId))
      .toContain(claim.objectId);
  });

  it("does not let one statistic verify everything else in the same article", () => {
    const source = store.recordSource({ worldId, kind: "article", title: "A", text: ARTICLE });
    const v = store.latestVersionOf(source.id)!;
    store.createAtom({
      worldId, atomType: "evidence", sourceId: source.id, sourceVersionId: v.id,
      text: "63% of returns in the 2024 sample were seam-related.",
    });
    const unrelated = store.createAtom({
      worldId, atomType: "claim", sourceId: source.id, sourceVersionId: v.id,
      text: "Customers will pay a premium for a five-year guarantee.",
    });

    // Same article, nothing linked. The claim is unsupported and must say so.
    const map = buildThinkingMap(g, store, worldId);
    expect(map.unverified.map((e) => e.atom.objectId)).toContain(unrelated.objectId);
  });

  it("counts one article captured twice as one, not as two sources agreeing", () => {
    const first = store.recordSource({ worldId, kind: "article", title: "Seams", text: ARTICLE });
    const again = store.recordSource({ worldId, kind: "article", title: "Seams", text: ARTICLE });
    const claim = "Seam failure causes most technical outerwear returns.";
    store.createAtom({ worldId, atomType: "claim", sourceId: first.id,
                       sourceVersionId: store.latestVersionOf(first.id)!.id, text: claim });
    store.createAtom({ worldId, atomType: "claim", sourceId: again.id,
                       sourceVersionId: store.latestVersionOf(again.id)!.id,
                       text: "Most outerwear returns are caused by seam failure." });

    expect(buildThinkingMap(g, store, worldId).repeating).toHaveLength(0);
  });

  it("says independence is unknown when the publishers are not distinct", () => {
    const wire = "Seam failure causes most technical outerwear returns this season.";
    const a = store.recordSource({ worldId, kind: "article", title: "Outlet A", text: `${wire} A`,
                                   publicationId: "wire-service" });
    const b = store.recordSource({ worldId, kind: "article", title: "Outlet B", text: `${wire} B`,
                                   publicationId: "wire-service" });
    store.createAtom({ worldId, atomType: "claim", sourceId: a.id,
                       sourceVersionId: store.latestVersionOf(a.id)!.id, text: wire });
    store.createAtom({ worldId, atomType: "claim", sourceId: b.id,
                       sourceVersionId: store.latestVersionOf(b.id)!.id,
                       text: "Most outerwear returns are caused by seam failure this season." });

    const map = buildThinkingMap(g, store, worldId);
    expect(map.repeating).toHaveLength(1);
    expect(map.repeating[0]!.because).toContain("whether they are independent is unknown");
  });

  it("does not read a denial as agreement", () => {
    expect(similarity(
      "Seam failure causes most technical outerwear returns.",
      "Seam failure does not cause most technical outerwear returns.",
    )).toBe(0);

    // And the same two sentences never group as similar wording.
    const a = store.recordSource({ worldId, kind: "article", title: "For", text: ARTICLE,
                                   publicationId: "one" });
    const b = store.recordSource({ worldId, kind: "article", title: "Against",
                                   text: "A rebuttal.", publicationId: "two" });
    store.createAtom({ worldId, atomType: "claim", sourceId: a.id,
                       sourceVersionId: store.latestVersionOf(a.id)!.id,
                       text: "Seam failure causes most technical outerwear returns." });
    store.createAtom({ worldId, atomType: "claim", sourceId: b.id,
                       sourceVersionId: store.latestVersionOf(b.id)!.id,
                       text: "Seam failure does not cause most technical outerwear returns." });

    expect(buildThinkingMap(g, store, worldId).repeating).toHaveLength(0);
  });

  it("records a move against the thing it was made about", () => {
    const atom = store.observe(worldId, "Our own returns data says seams fail first.");
    const moves = store.movesOn(atom.objectId);
    expect(moves.map((m) => m.kind)).toContain("observed");
    expect(moves.every((m) => m.versionId !== null)).toBe(true);
  });
});
