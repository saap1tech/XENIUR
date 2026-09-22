import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionPlan, Tool } from "@xeniur/core";
import { SteelmanRequired, zeroCost } from "@xeniur/core";
import { ObjectGraph, ReadinessEvaluator, loadProfiles } from "./index.js";

let dir: string, g: ObjectGraph, worldId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-decisions-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Rainwear 2027", emoji: "R" }).id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const plan = (tool: Tool, intent: string): ActionPlan =>
  ({ intent, objects: [], tool, args: {}, confirmation: false });

/** A claim captured from reading, as an ordinary Object. */
function claim(text: string) {
  const state = g.createObject({ worldId, semanticType: "claim", title: text });
  const rep = g.addRepresentation({
    objectId: state.object.id, modality: "text", format: "md",
    blobHash: g.putBlob(Buffer.from(text, "utf8"), "text/markdown", "md"),
    provenance: "imported",
  });
  g.commitVersion({
    objectId: state.object.id, forms: [{ role: "atom.text", representationId: rep.id }],
  });
  return state.object.id;
}

/** A mesh with an STL genuinely built from it, so lineage is real rather than asserted. */
function asset() {
  const state = g.createObject({ worldId, semanticType: "prop", title: "Rocket" });
  const objectId = state.object.id;
  const mesh = g.addRepresentation({
    objectId, modality: "mesh", format: "glb",
    blobHash: g.putBlob(Buffer.from("mesh v1"), "model/gltf-binary", "glb"),
    provenance: "imported",
  });
  g.commitVersion({ objectId, forms: [{ role: "source.primary", representationId: mesh.id }] });

  const action = g.beginAction({
    worldId, intent: "printable", tool: "3d.export", plan: plan("3d.export", "printable"),
    permissionLevel: "CREATE", provenance: "deterministic", provider: "local.blender",
    model: null, toolVersion: "blender 5.2.0", generationParams: {},
  });
  const built = g.commitResult({
    actionId: action.id, objectId,
    representations: [{
      objectId, modality: "mesh", format: "stl",
      blobHash: g.putBlob(Buffer.from("stl v1"), "model/stl", "stl"),
      producedByActionId: action.id, provenance: "deterministic", provider: "local.blender",
    }],
    formRoles: ["print.stl"],
    inputs: [{ representationId: mesh.id, role: "source" }],
    cost: zeroCost(), label: "printable",
  });
  return { objectId, meshId: mesh.id, stlId: built.representations[0]!.id };
}

describe("a decision is an ordinary Object with a rendered brief", () => {
  it("accepts, and renders a brief nothing generated", () => {
    const d = g.decisions.create({
      worldId, question: "Which seam method for the 2027 shell?",
      options: [
        { key: "taped", label: "Taped seams", note: "more durable in cold cycling" },
        { key: "welded", label: "Welded seams", note: "cheaper at volume" },
      ],
      chosenOption: "taped", rationale: "Our own returns data says seams fail first.",
    });
    g.decisions.assume(d.objectId, {
      text: "Cold-weather use dominates the range",
      reviewTrigger: "if the range moves to milder markets",
    });
    const accepted = g.decisions.accept(d.objectId, "Ada", { skipSteelman: true })!;

    expect(accepted.state).toBe("accepted");
    expect(accepted.acceptedVersionId).toBe(g.currentState(d.objectId)!.versionId);

    const brief = g.decisions.briefOf(d.objectId)!;
    expect(brief).toContain("Which seam method for the 2027 shell?");
    expect(brief).toContain("**Chosen:** Taped seams");
    expect(brief).toContain("Welded seams");                  // what was weighed and rejected
    expect(brief).toContain("if the range moves to milder markets");
    expect(brief).toContain("without a model");

    // The brief is a form, so it versions and travels like anything else.
    const state = g.currentState(d.objectId)!;
    expect(state.forms.map((f) => f.role)).toContain("decision.brief");
    const rep = g.getRepresentation(
      state.forms.find((f) => f.role === "decision.brief")!.representationId)!;
    expect(rep.provenance).toBe("deterministic");
  });

  it("renders the same bytes from the same decision", () => {
    const make = () => {
      const d = g.decisions.create({
        worldId, question: "Which finish?",
        options: [{ key: "matte", label: "Matte", note: "" }],
        chosenOption: "matte", rationale: "It photographs better.",
      });
      g.decisions.accept(d.objectId, "you", { skipSteelman: true });
      return g.decisions.briefOf(d.objectId)!;
    };
    expect(make()).toBe(make());
  });

  it("refuses to accept a decision with no choice in it", () => {
    const d = g.decisions.create({ worldId, question: "Which finish?" });
    expect(() => g.decisions.accept(d.objectId, "you", { skipSteelman: true })).toThrow(/without a choice/);
  });

  it("keeps a superseded decision exactly as it was accepted", () => {
    const first = g.decisions.create({
      worldId, question: "Which finish?",
      options: [{ key: "matte", label: "Matte", note: "" }],
      chosenOption: "matte", rationale: "Photographs better.",
    });
    g.decisions.accept(first.objectId, "you", { skipSteelman: true });
    const acceptedVersion = g.decisions.get(first.objectId)!.acceptedVersionId;
    const briefBefore = g.decisions.briefOf(first.objectId);

    const second = g.decisions.supersede(first.objectId, {
      worldId, question: "Which finish, after the client review?",
      options: [{ key: "gloss", label: "Gloss", note: "" }], chosenOption: "gloss",
    });

    expect(g.decisions.get(first.objectId)!.state).toBe("superseded");
    expect(g.decisions.get(first.objectId)!.acceptedVersionId).toBe(acceptedVersion);
    expect(g.decisions.briefOf(first.objectId)).toBe(briefBefore);
    expect(g.decisions.get(second.objectId)!.supersedesDecisionId).toBe(first.objectId);
  });
});

describe("review and rebuild travel on different edges and never merge", () => {
  it("marks a decision for review when a cited claim changes, and rebuilds nothing", () => {
    const source = claim("Seam failure causes most returns.");
    const { objectId, stlId } = asset();

    const d = g.decisions.create({
      worldId, question: "Which seam method?",
      options: [{ key: "taped", label: "Taped seams", note: "" }],
      chosenOption: "taped", rationale: "The returns evidence is decisive.",
    });
    g.decisions.cite(d.objectId, {
      sourceVersionId: null, atomObjectId: source, atomVersionId: null,
      relation: "supports", note: "",
    });
    g.decisions.accept(d.objectId, "you", { skipSteelman: true });

    // The claim is edited: the person reworded what they captured.
    g.setProperties(source, { title: "Seam failure causes most returns in cold climates." });

    const queue = g.decisions.reviewQueue(worldId);
    expect(queue.map((r) => r.objectId)).toContain(d.objectId);
    expect(g.decisions.get(d.objectId)!.state).toBe("needs_review");

    // The sentence is built from the edge that caused it, and names both real titles.
    const item = queue.find((r) => r.objectId === d.objectId)!;
    expect(item.because).toContain("cold climates");
    expect(item.because).toContain("cited as support");
    expect(item.because).toContain("review recommended");

    // And the asset is untouched: nothing about a claim can invalidate a mesh export.
    expect(g.recipes.statusOf(objectId).filter((s) => s.state === "stale")).toHaveLength(0);
    expect(g.currentState(objectId)!.forms
      .find((f) => f.role === "print.stl")!.representationId).toBe(stlId);
  });

  it("rebuilds the STL when the mesh changes, and reviews no decision for it", () => {
    const source = claim("Seam failure causes most returns.");
    const { objectId, meshId } = asset();

    const d = g.decisions.create({
      worldId, question: "Which seam method?",
      options: [{ key: "taped", label: "Taped seams", note: "" }],
      chosenOption: "taped", rationale: "Because of the returns data.",
    });
    g.decisions.cite(d.objectId, {
      sourceVersionId: null, atomObjectId: source, atomVersionId: null,
      relation: "supports", note: "",
    });
    g.decisions.accept(d.objectId, "you", { skipSteelman: true });

    // A new mesh: real, mechanical, downstream-invalidating.
    const newMesh = g.addRepresentation({
      objectId, modality: "mesh", format: "glb",
      blobHash: g.putBlob(Buffer.from("mesh v2 — taller"), "model/gltf-binary", "glb"),
      provenance: "imported",
    });
    g.commitVersion({ objectId, forms: [{ role: "source.primary", representationId: newMesh.id }] });

    // Lineage says the STL was built from the previous mesh, which is exactly the fact a
    // rebuild is computed from — mechanical, and nothing to do with anybody's judgement.
    const stl = g.currentState(objectId)!.forms.find((f) => f.role === "print.stl")!;
    const builtFrom = g.edgesInto(stl.representationId).map((e) => e.fromRepresentationId);
    expect(builtFrom).toContain(meshId);
    expect(builtFrom).not.toContain(newMesh.id);

    // And nothing about it touches the decision, which was never built from a mesh.
    expect(g.decisions.reviewQueue(worldId)).toHaveLength(0);
    expect(g.decisions.get(d.objectId)!.state).toBe("accepted");
  });

  it("stores review as the only thing a semantic link propagates", () => {
    const a = claim("A claim.");
    const b = claim("Another claim.");
    g.decisions.link({ fromObjectId: a, toObjectId: b, relation: "informed_by" });

    const rows = g.db.prepare(`SELECT propagates FROM semantic_links`).all() as
      Array<{ propagates: string }>;
    expect(rows.every((r) => r.propagates === "review")).toBe(true);

    // And a semantic edge never appears in the lineage index that drives rebuilds.
    expect(g.db.prepare(
      `SELECT COUNT(*) n FROM representation_edges`,
    ).get() as { n: number }).toEqual({ n: 0 });
  });

  it("refuses a self-link and ignores a duplicate", () => {
    const a = claim("A claim.");
    const b = claim("Another claim.");
    expect(g.decisions.link({ fromObjectId: a, toObjectId: a, relation: "supports" })).toBeNull();
    expect(g.decisions.link({ fromObjectId: a, toObjectId: b, relation: "supports" })).not.toBeNull();
    expect(g.decisions.link({ fromObjectId: a, toObjectId: b, relation: "supports" })).toBeNull();
    expect(g.decisions.linksTo(b)).toHaveLength(1);
  });

  it("carries review along further semantic edges, and stops", () => {
    const article = claim("The original article.");
    const first = g.decisions.create({
      worldId, question: "First question?",
      options: [{ key: "a", label: "A", note: "" }], chosenOption: "a",
    });
    const second = g.decisions.create({
      worldId, question: "Second question?",
      options: [{ key: "b", label: "B", note: "" }], chosenOption: "b",
    });
    g.decisions.cite(first.objectId, {
      sourceVersionId: null, atomObjectId: article, atomVersionId: null,
      relation: "informed_by", note: "",
    });
    g.decisions.accept(first.objectId, "you", { skipSteelman: true });
    g.decisions.link({
      fromObjectId: first.objectId, toObjectId: second.objectId, relation: "informed_by",
    });
    g.decisions.accept(second.objectId, "you", { skipSteelman: true });

    g.setProperties(article, { title: "The article, corrected." });

    const queue = g.decisions.reviewQueue(worldId);
    const ids = queue.map((r) => r.objectId);
    expect(ids).toContain(first.objectId);
    expect(ids).toContain(second.objectId);
    expect(queue.find((r) => r.objectId === second.objectId)!.because)
      .toContain("is itself under review");
  });

  it("lets a person look and stand by the decision", () => {
    const source = claim("A claim.");
    const d = g.decisions.create({
      worldId, question: "Which?", options: [{ key: "a", label: "A", note: "" }],
      chosenOption: "a",
    });
    g.decisions.cite(d.objectId, {
      sourceVersionId: null, atomObjectId: source, atomVersionId: null,
      relation: "supports", note: "",
    });
    g.decisions.accept(d.objectId, "you", { skipSteelman: true });
    g.setProperties(source, { title: "A claim, reworded." });

    g.decisions.reviewQueue(worldId);
    expect(g.decisions.get(d.objectId)!.state).toBe("needs_review");

    g.decisions.reaffirm(d.objectId, "Ada");
    expect(g.decisions.get(d.objectId)!.state).toBe("accepted");
  });
});

describe("a delivery can say what it was decided under", () => {
  it("names the accepted decisions and the exact source copies behind them", () => {
    const article = claim("Seam failure causes most returns.");
    const { objectId } = asset();

    // A stored copy of what was read, exactly as durable capture keeps it.
    const source = g.db.prepare(
      `INSERT INTO sources (id, world_id, kind, title, retrieved_at, metadata)
       VALUES (?, ?, 'article', 'Seam durability', ?, '{}') RETURNING id`,
    ).get("11111111-1111-4111-8111-111111111111", worldId, Date.now()) as { id: string };
    const copy = g.db.prepare(
      `INSERT INTO source_versions (id, source_id, retrieved_at, content_hash,
                                    text_blob_hash, extractor, partial, rights)
       VALUES (?, ?, ?, 'abc', 'def', 'verbatim/1', 0, 'unknown') RETURNING id`,
    ).get("22222222-2222-4222-8222-222222222222", source.id, Date.now()) as { id: string };

    const d = g.decisions.create({
      worldId, question: "Which seam method?",
      options: [{ key: "taped", label: "Taped seams", note: "" }],
      chosenOption: "taped", rationale: "The returns evidence is decisive.",
    });
    g.decisions.cite(d.objectId, {
      sourceVersionId: copy.id, atomObjectId: article, atomVersionId: null,
      relation: "supports", note: "paragraph 3",
    });
    g.decisions.accept(d.objectId, "Ada", { skipSteelman: true });

    // The asset satisfies the decision — asserted by a person, so a semantic link.
    g.decisions.link({
      fromObjectId: objectId, toObjectId: d.objectId, relation: "satisfies",
      note: "built to the taped-seam spec",
    });

    const readiness = new ReadinessEvaluator(g, loadProfiles(process.cwd()));
    const release = readiness.approve({ objectId, profileId: "client", force: true });
    expect(release.decisionIds).toEqual([d.objectId]);

    const influence = g.decisions.influenceOn(objectId, release.id);
    expect(influence.decisions).toHaveLength(1);
    expect(influence.decisions[0]!.question).toBe("Which seam method?");
    expect(influence.decisions[0]!.acceptedBy).toBe("Ada");
    expect(influence.decisions[0]!.changedSince).toBe(false);
    expect(influence.sourceVersionIds).toEqual([copy.id]);
    expect(influence.summary).toBe(
      "Decided under 1 accepted decision, citing 1 stored source copy.");

    // After the cited claim changes, the delivery still names what it went out under —
    // and says the decision has moved since, rather than quietly restating it as current.
    g.setProperties(article, { title: "Seam failure causes most returns in cold climates." });
    g.decisions.reviewQueue(worldId);

    const later = g.decisions.influenceOn(objectId, release.id);
    expect(later.decisions[0]!.acceptedVersionId).toBe(influence.decisions[0]!.acceptedVersionId);
    expect(later.decisions[0]!.changedSince).toBe(true);
    expect(later.summary).toContain("1 has changed since");
  });

  it("says plainly when a delivery has no decisions behind it", () => {
    const { objectId } = asset();
    const release = new ReadinessEvaluator(g, loadProfiles(process.cwd()))
      .approve({ objectId, profileId: "client", force: true });

    expect(release.decisionIds).toEqual([]);
    expect(g.decisions.influenceOn(objectId, release.id).summary)
      .toBe("No accepted decisions were recorded for this delivery.");
  });
});

describe("a build can depend on an accepted decision", () => {
  const recipeWith = (decisionId: string, objectId: string) =>
    g.recipes.saveRecipe({
      objectId, name: "spec build",
      steps: [{
        key: "export", tool: "3d.export", replayPolicy: "deterministic", args: {},
        inputs: [
          { slot: "source", sourceKind: "form", sourceRef: "source.primary",
            accepts: {}, required: true },
          { slot: "spec", sourceKind: "decision", sourceRef: decisionId,
            accepts: {}, required: true },
        ],
        outputs: [{ slot: "primary", modality: "mesh", format: "stl", formRole: "print.stl" }],
      }],
    });

  it("will not build against a decision nobody has accepted", () => {
    const { objectId } = asset();
    const d = g.decisions.create({
      worldId, question: "Which seam method?",
      options: [{ key: "taped", label: "Taped seams", note: "" }], chosenOption: "taped",
    });
    const recipe = recipeWith(d.objectId, objectId);
    g.commitVersion({ objectId, recipeId: recipe.id });

    const step = g.recipes.statusOf(objectId).find((s) => s.stepKey === "export")!;
    expect(step.state).toBe("unresolvable");
    expect(step.reason).toContain("has not been accepted yet");
  });

  it("becomes buildable once the decision is accepted, and stale when another is", () => {
    const { objectId } = asset();
    const d = g.decisions.create({
      worldId, question: "Which seam method?",
      options: [
        { key: "taped", label: "Taped seams", note: "" },
        { key: "welded", label: "Welded seams", note: "" },
      ],
      chosenOption: "taped", rationale: "Durability first.",
    });
    g.decisions.accept(d.objectId, "you", { skipSteelman: true });

    const recipe = recipeWith(d.objectId, objectId);
    g.commitVersion({ objectId, recipeId: recipe.id });

    const before = g.recipes.statusOf(objectId).find((s) => s.stepKey === "export")!;
    expect(before.state).not.toBe("unresolvable");
    const fingerprintBefore = before.fingerprint;

    // A different choice, accepted: the brief changes, so the build genuinely is out of
    // date. This is the one place a decision drives a rebuild — the brief is a real input.
    g.decisions.update(d.objectId, { chosenOption: "welded", rationale: "Margin won." });
    g.decisions.accept(d.objectId, "you", { skipSteelman: true });

    const after = g.recipes.statusOf(objectId).find((s) => s.stepKey === "export")!;
    expect(after.fingerprint).not.toBe(fingerprintBefore);
  });

  it("ignores an unaccepted edit to the decision", () => {
    const { objectId } = asset();
    const d = g.decisions.create({
      worldId, question: "Which seam method?",
      options: [{ key: "taped", label: "Taped seams", note: "" }],
      chosenOption: "taped", rationale: "Durability first.",
    });
    g.decisions.accept(d.objectId, "you", { skipSteelman: true });
    const recipe = recipeWith(d.objectId, objectId);
    g.commitVersion({ objectId, recipeId: recipe.id });
    const before = g.recipes.statusOf(objectId).find((s) => s.stepKey === "export")!.fingerprint;

    // Reworded, not re-accepted. What was signed off is still what the build is under.
    g.decisions.update(d.objectId, { rationale: "Durability first, and the returns data." });

    expect(g.recipes.statusOf(objectId).find((s) => s.stepKey === "export")!.fingerprint)
      .toBe(before);
  });
});

describe("review travels in the direction the assertion was made", () => {
  it("does not flag a decision because the thing built to satisfy it changed", () => {
    const { objectId } = asset();
    const d = g.decisions.create({
      worldId, question: "Which finish?",
      options: [{ key: "matte", label: "Matte", note: "" }], chosenOption: "matte",
    });
    g.decisions.accept(d.objectId, "you", { skipSteelman: true });
    g.decisions.link({ fromObjectId: objectId, toObjectId: d.objectId, relation: "satisfies" });

    // The mesh is edited. That is a rebuild, and it is not a reason to re-open the choice.
    g.setProperties(objectId, { title: "Rocket, wider fins" });

    expect(g.decisions.reviewQueue(worldId).map((r) => r.objectId)).not.toContain(d.objectId);
    expect(g.decisions.get(d.objectId)!.state).toBe("accepted");
  });

  it("does flag the asset when the decision it was built to satisfy changes", () => {
    const source = claim("Matte reads better under hard light.");
    const { objectId } = asset();
    const d = g.decisions.create({
      worldId, question: "Which finish?",
      options: [{ key: "matte", label: "Matte", note: "" }], chosenOption: "matte",
    });
    g.decisions.cite(d.objectId, {
      sourceVersionId: null, atomObjectId: source, atomVersionId: null,
      relation: "supports", note: "",
    });
    g.decisions.accept(d.objectId, "you", { skipSteelman: true });
    g.decisions.link({ fromObjectId: objectId, toObjectId: d.objectId, relation: "satisfies" });

    // The decision moves — a new acceptance is a new version of it.
    g.decisions.update(d.objectId, { rationale: "Reconsidered after the lighting change." });
    g.decisions.accept(d.objectId, "you", { skipSteelman: true });

    const queue = g.decisions.reviewQueue(worldId);
    const item = queue.find((r) => r.objectId === objectId);
    expect(item, "the asset built to satisfy a changed decision is worth checking").toBeDefined();
    expect(item!.because).toContain("was built to satisfy it");
  });
});

describe("a decision's cited passage starts unsettled", () => {
  it("records an unresolved support row when a passage is cited, and shows nothing as sourced", () => {
    const copy = "22222222-2222-4222-8222-222222222222";
    g.db.prepare(
      `INSERT INTO sources (id, world_id, kind, title, retrieved_at, metadata)
       VALUES ('11111111-1111-4111-8111-111111111111', ?, 'paper', 'Seam study', ?, '{}')`,
    ).run(worldId, Date.now());
    g.db.prepare(
      `INSERT INTO source_versions (id, source_id, retrieved_at, content_hash, text_blob_hash,
                                    extractor, partial, rights)
       VALUES (?, '11111111-1111-4111-8111-111111111111', ?, 'h', 'b', 'verbatim/1', 0, 'unknown')`,
    ).run(copy, Date.now());

    const d = g.decisions.create({
      worldId, question: "Which seam method?",
      options: [{ key: "taped", label: "Taped seams", note: "" }], chosenOption: "taped",
    });
    g.decisions.cite(d.objectId, {
      sourceVersionId: copy, atomObjectId: null, atomVersionId: null,
      relation: "supports", note: "paragraph 3",
    });

    const rows = g.support.of(d.objectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("unresolved");
    expect(rows[0]!.checkedBy).toBe("unchecked");
    // The person said "supports" as the *relation*; whether the passage bears on it is a
    // different fact, and it has not been established.
    expect(g.support.summary(d.objectId).reviewedSupported).toBe(false);

    g.support.review(rows[0]!.id, "supported");
    expect(g.support.summary(d.objectId).reviewedSupported).toBe(true);
  });
});

describe("one reason this could be wrong, asked before acceptance", () => {
  const draft = () => g.decisions.create({
    worldId, question: "Which finish?",
    options: [{ key: "matte", label: "Matte", note: "" }], chosenOption: "matte",
    rationale: "Photographs better.",
  });

  it("will not accept without the question being answered or deliberately skipped", () => {
    const d = draft();
    expect(() => g.decisions.accept(d.objectId)).toThrow(SteelmanRequired);
    expect(g.decisions.get(d.objectId)!.state).toBe("draft");
  });

  it("records the steelman as an assumption with a review trigger, and puts it in the brief", () => {
    const d = draft();
    g.decisions.accept(d.objectId, "Ada", {
      steelman: "Matte reads flat under overcast light.", reviewTrigger: "the shoot moves outdoors",
    });
    const detail = g.decisions.detail(d.objectId)!;
    expect(detail.steelman).toBe("recorded");
    expect(detail.assumptions.some((a) => a.kind === "steelman" && a.text.includes("overcast"))).toBe(true);
    expect(g.decisions.briefOf(d.objectId)).toContain("## How this could be wrong");
    expect(g.decisions.briefOf(d.objectId)).toContain("the shoot moves outdoors");
  });

  it("records a skip as a skip — never as silence, never as agreement", () => {
    const d = draft();
    g.decisions.accept(d.objectId, "Ada", { skipSteelman: true });
    expect(g.decisions.get(d.objectId)!.steelman).toBe("skipped");
    expect(g.decisions.briefOf(d.objectId)).toContain("deliberately skipped");
  });

  it("an accepted decision always carries one or the other, never neither", () => {
    const a = draft(); g.decisions.accept(a.objectId, "Ada", { steelman: "It might not." });
    const b = draft(); g.decisions.accept(b.objectId, "Ada", { skipSteelman: true });
    for (const id of [a.objectId, b.objectId]) {
      const d = g.decisions.get(id)!;
      expect(d.state).toBe("accepted");
      expect(d.steelman).not.toBe("none");
    }
    const rows = g.db.prepare(
      `SELECT COUNT(*) n FROM decisions WHERE state = 'accepted' AND steelman = 'none'`,
    ).get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("asks once: re-accepting after an edit does not ask again", () => {
    const d = draft();
    g.decisions.accept(d.objectId, "Ada", { steelman: "Could be wrong." });
    g.decisions.update(d.objectId, { rationale: "Photographs better, and the client agreed." });
    expect(() => g.decisions.accept(d.objectId, "Ada")).not.toThrow();
  });
});

describe("the graph offers the context compiler everything, generously", () => {
  it("gathers linked decisions with their reasons, cited passages with rights, constraints and changes", async () => {
    const { contextMaterialFor } = await import("./context-material.js");
    const { objectId } = asset();

    const copy = "22222222-2222-4222-8222-222222222222";
    g.db.prepare(
      `INSERT INTO sources (id, world_id, kind, title, retrieved_at, metadata)
       VALUES ('11111111-1111-4111-8111-111111111111', ?, 'note', 'Client brief', ?, '{}')`,
    ).run(worldId, Date.now());
    g.db.prepare(
      `INSERT INTO source_versions (id, source_id, retrieved_at, content_hash, text_blob_hash,
                                    extractor, partial, rights)
       VALUES (?, '11111111-1111-4111-8111-111111111111', ?, 'h', ?, 'verbatim/1', 0, 'restricted')`,
    ).run(copy, Date.now(), g.putBlob(Buffer.from("Finish is matte throughout."), "text/plain", "txt"));

    const d = g.decisions.create({
      worldId, question: "Which finish?",
      options: [{ key: "matte", label: "Matte", note: "" }, { key: "satin", label: "Satin", note: "" }],
      chosenOption: "matte", rationale: "The brief says so.",
    });
    g.decisions.cite(d.objectId, { sourceVersionId: copy, atomObjectId: null, atomVersionId: null, relation: "supports", note: "" });
    g.decisions.accept(d.objectId, "Ada", { steelman: "Matte can look flat outdoors." });
    g.decisions.link({ fromObjectId: objectId, toObjectId: d.objectId, relation: "satisfies" });

    const m = contextMaterialFor(g, objectId)! as {
      focus: { title: string }; decisions: Array<Record<string, unknown>>; passages: Array<Record<string, unknown>>;
    };
    expect(m.focus.title).toBe("Rocket");
    const dec = m.decisions.find((x) => x["objectId"] === d.objectId)!;
    expect(dec["relatedToFocus"]).toBe(true);
    expect(dec["chosenOption"]).toBe("Matte");
    expect(dec["rejectedOptions"]).toEqual(["Satin"]);
    expect((dec["assumptions"] as Array<{ kind: string }>).some((a) => a.kind === "steelman")).toBe(true);
    // The passage is offered with its rights — the compiler decides whether it may travel.
    expect(m.passages[0]!["rights"]).toBe("restricted");
    expect(m.passages[0]!["text"]).toBe("Finish is matte throughout.");
    expect(m.passages[0]!["supportReviewed"]).toBe(false);
  });
});

/* M6 Part C — a captured passage compared against a requirement, and what a change does to it. */
describe("comparison survives the browser and answers a change", () => {
  it("pins the requirement's version, marks the comparison for review when it changes, and rewrites nothing", () => {
    const requirement = g.createObject({ worldId, semanticType: "constraint", title: "Client requirement" }).object.id;
    const rep = (t: string) => g.addRepresentation({ objectId: requirement, modality: "text", format: "md", blobHash: g.putBlob(Buffer.from(t), "text/markdown", "md"), provenance: "human" });
    g.commitVersion({ objectId: requirement, forms: [{ role: "doc.primary", representationId: rep("matte throughout").id }] });
    const passage = g.createObject({ worldId, semanticType: "source", title: "Supplier specification" }).object.id;

    // The gesture's outcome, applied: a review_on_change link pinned to the version that exists now.
    g.decisions.link({ fromObjectId: requirement, toObjectId: passage, relation: "review_on_change", note: '"Supplier specification" was compared against "Client requirement" at the version it had then' });
    expect(g.decisions.reviewQueue(worldId)).toHaveLength(0);

    // The requirement changes. The comparison is marked for review — and still says what it said.
    g.commitVersion({ objectId: requirement, forms: [{ role: "doc.primary", representationId: rep("gloss on the hood").id }] });
    const queue = g.decisions.reviewQueue(worldId);
    expect(queue.map((r) => r.objectId)).toContain(passage);
    const links = g.decisions.linksTo(passage);
    expect(links[0]!.relation).toBe("review_on_change");
    expect(links[0]!.note).toContain("was compared against");
    // Closing the tab changes nothing: the meaning is in the graph, not in the browser.
    expect(g.currentState(passage)!.properties.title).toBe("Supplier specification");
  });
});
