import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecipeStepDraft } from "@xeniur/core";
import { formOf } from "@xeniur/core";
import {
  ObjectGraph, PackageRefused, ReadinessEvaluator, deliveryReport, exportPackage,
  importPackage, inspectPackage, loadProfiles,
} from "./index.js";

let dir: string, source: ObjectGraph, objectId: string, worldId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-pkg-"));
  source = ObjectGraph.open({ dbPath: join(dir, "a.db"), blobDir: join(dir, "a-blobs") });
  worldId = source.createWorld({ title: "Asteroid Game", emoji: "R" }).id;
  objectId = source.createObject({
    worldId, semanticType: "rocket", title: "Rocket",
    properties: { units: "mm", tags: ["hero", "printable"] },
  }).object.id;
});
afterEach(() => { source.close(); rmSync(dir, { recursive: true, force: true }); });

function buildRocket() {
  const circle = source.addRepresentation({
    objectId, modality: "image", format: "png",
    blobHash: source.putBlob(Buffer.from("a yellow circle"), "image/png", "png"),
    provenance: "human",
  });
  source.commitVersion({ objectId, forms: [{ role: "source.primary", representationId: circle.id }] });

  const action = source.beginAction({
    worldId, intent: "make it printable", tool: "3d.export",
    plan: { intent: "make it printable", objects: [objectId], tool: "3d.export", args: {}, confirmation: false },
    permissionLevel: "CREATE", provenance: "deterministic", provider: "local.blender",
  });
  const stl = source.commitResult({
    actionId: action.id, objectId,
    representations: [{
      objectId, modality: "mesh", format: "stl",
      blobHash: source.putBlob(Buffer.from("printable solid"), "model/stl", "stl"),
      producedByActionId: action.id, provenance: "deterministic", provider: "local.blender",
    }],
    formRoles: ["print.stl"],
    inputs: [{ representationId: circle.id, role: "source" }],
    cost: { inputTokens: 0, outputTokens: 0, credits: 0, usd: 0.12, ms: 400 },
  }).representations[0]!;

  const steps: RecipeStepDraft[] = [{
    key: "print_stl", tool: "3d.export", replayPolicy: "deterministic", args: { format: "stl" },
    inputs: [{ slot: "source", sourceKind: "form", sourceRef: "source.primary", accepts: {}, required: true }],
    outputs: [{ slot: "primary", modality: "mesh", format: "stl", formRole: "print.stl" }],
  }];
  const recipe = source.recipes.saveRecipe({ objectId, name: "asset", steps });
  source.commitVersion({ objectId, recipeId: recipe.id, label: "pin recipe" });
  source.recipes.recordDerivation({
    representationId: stl.id, recipeId: recipe.id, stepKey: "print_stl",
    fingerprint: "f".repeat(64), capabilityVersion: "1.0.0",
  });
  return { circle, stl, recipe };
}

describe("an Object can leave XENIUR without falling apart", () => {
  it("round-trips identity, forms, properties, lineage, recipes and bytes", async () => {
    const { circle, stl, recipe } = buildRocket();
    const before = source.currentState(objectId)!;

    const pkg = await exportPackage(source, objectId, join(dir, "rocket.xeniur"));
    expect(pkg.bytes).toBeGreaterThan(0);

    // A clean install with nothing in it.
    const target = ObjectGraph.open({ dbPath: join(dir, "b.db"), blobDir: join(dir, "b-blobs") });
    try {
      const result = await importPackage(target, pkg.path);
      expect(result.alreadyPresent).toBe(false);
      expect(result.objectId).toBe(objectId);   // the same uuid, not a copy

      const after = target.currentState(objectId)!;
      expect(after.properties.title).toBe("Rocket");
      expect(after.properties.units).toBe("mm");
      expect(after.properties.tags).toEqual(["hero", "printable"]);
      expect(after.versionId).toBe(before.versionId);
      expect(after.forms.map((f) => f.role).sort()).toEqual(before.forms.map((f) => f.role).sort());
      expect(formOf(after, "print.stl")?.representationId).toBe(stl.id);

      // Lineage survived, so the STL can still be traced back to the circle.
      expect(target.ancestryOf(stl.id).map((s) => s.representationId)).toEqual([stl.id, circle.id]);
      expect(target.verifyLineageConsistency().ok).toBe(true);
      expect(target.costOfLineage(stl.id).usd).toBeCloseTo(0.12, 6);

      // The recipe that built it is readable in the new install.
      const imported = target.recipes.getRecipe(recipe.id)!;
      expect(imported.steps).toHaveLength(1);
      expect(imported.steps[0]!.inputs[0]!.sourceRef).toBe("source.primary");

      // And the bytes are really there.
      expect(target.readBlob(target.getRepresentation(stl.id)!.blobHash!).toString())
        .toBe("printable solid");
    } finally { target.close(); }
  }, 60_000);

  it("carries branches and their tips across", async () => {
    buildRocket();
    const chain = source.versionChain(objectId);
    const wide = source.addRepresentation({
      objectId, modality: "mesh", format: "glb",
      blobHash: source.putBlob(Buffer.from("wide wings"), "model/gltf-binary", "glb"),
      provenance: "deterministic",
    });
    source.branchFrom({
      versionId: chain[1]!.id, name: "wide-wings",
      forms: [{ role: "model.mesh", representationId: wide.id }],
    });

    const pkg = await exportPackage(source, objectId, join(dir, "branched.xeniur"));
    const target = ObjectGraph.open({ dbPath: join(dir, "c.db"), blobDir: join(dir, "c-blobs") });
    try {
      await importPackage(target, pkg.path);
      expect(target.listBranches(objectId).map((b) => b.name).sort()).toEqual(["main", "wide-wings"]);
      expect(target.headsOf(objectId)).toHaveLength(2);
      expect(target.listBranches(objectId).every((b) => b.headVersionId !== null)).toBe(true);
    } finally { target.close(); }
  }, 60_000);

  it("carries checks and releases, so a release still shows why it was approved", async () => {
    buildRocket();
    const state = source.currentState(objectId)!;
    source.db.prepare(
      `INSERT INTO checks (id, object_id, representation_id, validator, status, summary, detail, form_role, at)
       VALUES ('11111111-1111-4111-8111-111111111111', ?, NULL, 'mesh.watertight', 'pass',
               'the surface is closed', '{"boundaryEdges":0}', NULL, ?)`,
    ).run(objectId, Date.now());
    source.db.prepare(
      `INSERT INTO releases (id, object_id, version_id, profile_id, note, evidence, approved_at)
       VALUES ('22222222-2222-4222-8222-222222222222', ?, ?, 'print3d', 'v1', '{"ready":true}', ?)`,
    ).run(objectId, state.versionId, Date.now());

    const pkg = await exportPackage(source, objectId, join(dir, "released.xeniur"));
    const target = ObjectGraph.open({ dbPath: join(dir, "d.db"), blobDir: join(dir, "d-blobs") });
    try {
      await importPackage(target, pkg.path);
      const check = target.db.prepare(`SELECT * FROM checks WHERE object_id = ?`).get(objectId) as { summary: string };
      expect(check.summary).toBe("the surface is closed");
      const release = target.db.prepare(`SELECT * FROM releases WHERE object_id = ?`).get(objectId) as { profile_id: string; evidence: string };
      expect(release.profile_id).toBe("print3d");
      expect(JSON.parse(release.evidence)).toEqual({ ready: true });
    } finally { target.close(); }
  }, 60_000);

  it("leaves an Object alone rather than merging two histories into one", async () => {
    buildRocket();
    const pkg = await exportPackage(source, objectId, join(dir, "again.xeniur"));
    const result = await importPackage(source, pkg.path);
    expect(result.alreadyPresent).toBe(true);
    // created, circle, STL, recipe pin — all four still there, none duplicated.
    expect(source.versionChain(objectId)).toHaveLength(4);
  }, 60_000);
});

describe("a package carries the reasons, not just the files", () => {
  it("travels with the decision a delivery was made under, and the passages behind it", async () => {
    const world = source.createWorld({ title: "Rainwear", emoji: "R" });

    // A stored copy of something read, a claim kept from it, and a decision citing both.
    const sourceId = "11111111-1111-4111-8111-111111111111";
    const copyId = "22222222-2222-4222-8222-222222222222";
    const text = "A 2024 study found that 63% of returns were caused by seam failure.";
    source.db.prepare(
      `INSERT INTO sources (id, world_id, kind, title, retrieved_at, metadata)
       VALUES (?, ?, 'paper', 'Seam durability', ?, '{}')`,
    ).run(sourceId, world.id, Date.now());
    source.db.prepare(
      `INSERT INTO source_versions (id, source_id, retrieved_at, content_hash, text_blob_hash,
                                    extractor, partial, rights)
       VALUES (?, ?, ?, 'abc', ?, 'verbatim/1', 0, 'unknown')`,
    ).run(copyId, sourceId, Date.now(),
          source.putBlob(Buffer.from(text, "utf8"), "text/plain", "txt"));

    const claim = source.createObject({ worldId: world.id, semanticType: "evidence", title: text });
    const claimRep = source.addRepresentation({
      objectId: claim.object.id, modality: "text", format: "md",
      blobHash: source.putBlob(Buffer.from(text, "utf8"), "text/markdown", "md"),
      provenance: "imported",
    });
    source.commitVersion({
      objectId: claim.object.id, forms: [{ role: "atom.text", representationId: claimRep.id }],
    });
    source.db.prepare(
      `INSERT INTO atoms (object_id, atom_type, source_id, source_version_id, locator,
                          confidence, lane, extraction, stated_at)
       VALUES (?, 'evidence', ?, ?, '{"selectors":[]}', NULL, NULL, 'heuristic', ?)`,
    ).run(claim.object.id, sourceId, copyId, Date.now());

    const decision = source.decisions.create({
      worldId: world.id, question: "Which seam method?",
      options: [{ key: "taped", label: "Taped seams", note: "" }],
      chosenOption: "taped", rationale: "The returns evidence is decisive.",
    });
    source.decisions.cite(decision.objectId, {
      sourceVersionId: copyId, atomObjectId: claim.object.id, atomVersionId: null,
      relation: "supports", note: "the 63% figure",
    });
    source.decisions.accept(decision.objectId, "Ada", { skipSteelman: true });

    // An asset built under it, released, and linked to it.
    const asset = source.createObject({ worldId: world.id, semanticType: "prop", title: "Prop" });
    const objectId = asset.object.id;
    const rep = source.addRepresentation({
      objectId, modality: "mesh", format: "stl",
      blobHash: source.putBlob(Buffer.from("stl bytes"), "model/stl", "stl"),
      provenance: "deterministic",
    });
    source.commitVersion({ objectId, forms: [{ role: "print.stl", representationId: rep.id }] });
    source.decisions.link({
      fromObjectId: objectId, toObjectId: decision.objectId, relation: "satisfies",
    });
    const release = new ReadinessEvaluator(source, loadProfiles(process.cwd()))
      .approve({ objectId, profileId: "client", force: true });
    expect(release.decisionIds).toContain(decision.objectId);

    const out = join(dir, "prop.xeniur");
    await exportPackage(source, objectId, out);

    // A clean install: nothing here has ever seen any of it.
    const clean = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "clean-blobs") });
    const result = await importPackage(clean, out);

    expect(result.related.decisions).toBe(1);
    expect(result.related.sources).toBe(1);
    expect(result.unresolved).toEqual([]);

    // The recipient can ask why, not merely what.
    const influence = clean.decisions.influenceOn(objectId, release.id);
    expect(influence.decisions[0]!.question).toBe("Which seam method?");
    expect(influence.decisions[0]!.acceptedBy).toBe("Ada");
    expect(influence.sourceVersionIds).toEqual([copyId]);

    // And the brief and the stored copy are readable, not merely named.
    expect(clean.decisions.briefOf(decision.objectId)).toContain("Taped seams");
    const copy = clean.db.prepare(`SELECT text_blob_hash FROM source_versions WHERE id = ?`)
      .get(copyId) as { text_blob_hash: string };
    expect(clean.readBlob(copy.text_blob_hash).toString("utf8")).toBe(text);

    clean.close();
  });

  it("leaves no dangling reference when a build consumed another Object's form", async () => {
    const world = source.createWorld({ title: "W", emoji: "W" });

    const spec = source.createObject({ worldId: world.id, semanticType: "decision", title: "Spec" });
    const specRep = source.addRepresentation({
      objectId: spec.object.id, modality: "text", format: "md",
      blobHash: source.putBlob(Buffer.from("# spec"), "text/markdown", "md"),
      provenance: "deterministic",
    });
    source.commitVersion({
      objectId: spec.object.id, forms: [{ role: "decision.brief", representationId: specRep.id }],
    });

    const asset = source.createObject({ worldId: world.id, semanticType: "prop", title: "Prop" });
    const objectId = asset.object.id;
    const action = source.beginAction({
      worldId: world.id, intent: "build", tool: "3d.export",
      plan: { intent: "build", objects: [], tool: "3d.export", args: {}, confirmation: false },
      permissionLevel: "CREATE", provenance: "deterministic", provider: "local.blender",
      model: null, toolVersion: "blender 5.2.0", generationParams: {},
    });
    source.commitResult({
      actionId: action.id, objectId,
      representations: [{
        objectId, modality: "mesh", format: "stl",
        blobHash: source.putBlob(Buffer.from("built"), "model/stl", "stl"),
        producedByActionId: action.id, provenance: "deterministic", provider: "local.blender",
      }],
      formRoles: ["print.stl"],
      // The build genuinely consumed a form belonging to another Object.
      inputs: [{ representationId: specRep.id, role: "source" }],
      cost: { inputTokens: 0, outputTokens: 0, credits: 0, usd: 0, ms: 1 },
      label: "built",
    });

    const out = join(dir, "closed.xeniur");
    await exportPackage(source, objectId, out);

    const clean = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "closed-blobs") });
    const result = await importPackage(clean, out);

    // Version 1 wrote the edge and left its other end behind, and the import failed on a
    // foreign key. The closure is what makes the package openable at all.
    expect(clean.getRepresentation(specRep.id)).not.toBeNull();
    expect(clean.edgesInto(result.objectId)).toBeDefined();
    expect(clean.db.pragma("foreign_key_check")).toEqual([]);
    clean.close();
  });
});

describe("a package that arrives from somebody else is not trusted", () => {
  const tarUp = async (dir: string, out: string, entries: string[]) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("tar", ["-czf", out, "-C", dir, ...entries]);
    return out;
  };

  /** Every row in the database, so "left no state" can be checked rather than asserted. */
  const census = (g: ObjectGraph) => {
    const tables = (g.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    ).all() as Array<{ name: string }>).map((t) => t.name);
    return Object.fromEntries(tables.map((t) =>
      [t, (g.db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get() as { n: number }).n]));
  };

  it("refuses an archive that tries to write outside the package", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const evil = join(dir, "evil");
    mkdirSync(join(evil, "blobs"), { recursive: true });
    writeFileSync(join(evil, "manifest.json"), "{}");
    // The classic traversal: a path that climbs out of wherever it is unpacked.
    mkdirSync(join(evil, "sneaky"), { recursive: true });
    writeFileSync(join(evil, "sneaky", "payload"), "owned");

    const out = join(dir, "evil.xeniur");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    // Build the archive with a literal ".." entry name.
    await promisify(execFile)("tar", [
      "-czf", out, "-C", evil, "manifest.json", "blobs",
      "--transform", "s|sneaky/payload|../../../../tmp/xeniur-owned|", "sneaky/payload",
    ]).catch(async () => {
      // BSD tar spells it differently; either way the entry name is what matters.
      await promisify(execFile)("tar", [
        "-czf", out, "-C", evil, "-s", "|sneaky/payload|../../../../tmp/xeniur-owned|",
        "manifest.json", "blobs", "sneaky/payload",
      ]);
    });

    const clean = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "b1") });
    const before = census(clean);
    const inspection = await inspectPackage(clean, out);

    expect(inspection.ok).toBe(false);
    expect(inspection.problems.join(" ")).toMatch(/outside the package|not part of a XENIUR package/);
    await expect(importPackage(clean, out)).rejects.toBeInstanceOf(PackageRefused);
    expect(census(clean)).toEqual(before);
    clean.close();
  });

  it("refuses an archive whose bytes are not what their names claim", async () => {
    buildRocket();
    const out = join(dir, "swapped.xeniur");
    await exportPackage(source, objectId, out);

    // Unpack, swap a blob's contents, and repack under the same names.
    const { mkdtempSync, readdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const unpacked = mkdtempSync(join(tmpdir(), "xeniur-swap-"));
    await promisify(execFile)("tar", ["-xzf", out, "-C", unpacked]);
    const blob = readdirSync(join(unpacked, "blobs"))[0]!;
    writeFileSync(join(unpacked, "blobs", blob), "not what the manifest says this is");
    const swapped = join(dir, "swapped2.xeniur");
    await tarUp(unpacked, swapped, ["manifest.json", "blobs"]);

    const clean = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "b2") });
    const before = census(clean);
    await expect(importPackage(clean, swapped)).rejects.toThrow(/do not match its name/);
    expect(census(clean)).toEqual(before);
    clean.close();
  });

  it("refuses a manifest that names rows it does not carry", async () => {
    buildRocket();
    const out = join(dir, "incomplete.xeniur");
    await exportPackage(source, objectId, out);

    const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const unpacked = mkdtempSync(join(tmpdir(), "xeniur-cut-"));
    await promisify(execFile)("tar", ["-xzf", out, "-C", unpacked]);

    const manifest = JSON.parse(readFileSync(join(unpacked, "manifest.json"), "utf8"));
    // Every form still names its bytes; the bytes are simply no longer carried.
    manifest.blobs = [];
    writeFileSync(join(unpacked, "manifest.json"), JSON.stringify(manifest));
    const cut = join(dir, "incomplete2.xeniur");
    await tarUp(unpacked, cut, ["manifest.json", "blobs"]);

    const clean = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "b3") });
    const before = census(clean);
    const inspection = await inspectPackage(clean, cut);

    expect(inspection.ok).toBe(false);
    expect(inspection.problems.join(" ")).toContain("does not carry");
    await expect(importPackage(clean, cut)).rejects.toBeInstanceOf(PackageRefused);
    expect(census(clean)).toEqual(before);
    clean.close();
  });

  it("refuses a file that is not an archive at all, without pretending it tried", async () => {
    const { writeFileSync } = await import("node:fs");
    const notAnArchive = join(dir, "notes.txt");
    writeFileSync(notAnArchive, "just some text");

    const clean = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "b4") });
    const before = census(clean);
    const inspection = await inspectPackage(clean, notAnArchive);
    expect(inspection.ok).toBe(false);
    expect(inspection.problems[0]).toContain("not a readable archive");
    expect(census(clean)).toEqual(before);
    clean.close();
  });
});

describe("a package says what it is before it is opened or sent", () => {
  it("says how it relates to what you already have", async () => {
    buildRocket();
    const out = join(dir, "same.xeniur");
    await exportPackage(source, objectId, out);

    // Against the very database it came from, it is exactly what is already here.
    expect((await inspectPackage(source, out)).relationship).toBe("identical");

    const clean = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "b5") });
    expect((await inspectPackage(clean, out)).relationship).toBe("new");
    await importPackage(clean, out);

    // A later version here, and the package is now an ancestor of what this machine holds.
    const rep = clean.addRepresentation({
      objectId, modality: "text", format: "md",
      blobHash: clean.putBlob(Buffer.from("later"), "text/markdown", "md"),
      provenance: "human",
    });
    clean.commitVersion({ objectId, forms: [{ role: "doc.primary", representationId: rep.id }] });
    expect((await inspectPackage(clean, out)).relationship).toBe("ancestor");
    clean.close();
  });

  it("will not merge two histories that share an identity", async () => {
    buildRocket();
    const out = join(dir, "theirs.xeniur");
    await exportPackage(source, objectId, out);

    const clean = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "b6") });
    await importPackage(clean, out);
    // Both sides move on separately: the same Object, two histories.
    const rep = clean.addRepresentation({
      objectId, modality: "text", format: "md",
      blobHash: clean.putBlob(Buffer.from("mine"), "text/markdown", "md"),
      provenance: "human",
    });
    clean.commitVersion({ objectId, forms: [{ role: "doc.primary", representationId: rep.id }] });

    const theirRep = source.addRepresentation({
      objectId, modality: "text", format: "md",
      blobHash: source.putBlob(Buffer.from("theirs"), "text/markdown", "md"),
      provenance: "human",
    });
    source.commitVersion({ objectId, forms: [{ role: "doc.primary", representationId: theirRep.id }] });

    const diverged = join(dir, "diverged.xeniur");
    await exportPackage(source, objectId, diverged);
    const inspection = await inspectPackage(clean, diverged);

    expect(inspection.relationship).toBe("divergent");
    expect(inspection.ok).toBe(false);
    expect(inspection.problems.join(" ")).toContain("will not merge two histories");
    clean.close();
  });

  it("lists what it would hand over, before anybody sends it", async () => {
    buildRocket();

    // Something generated, with the prompt that produced it — which is exactly the kind of
    // thing a person forgets is in the file they are about to email.
    const generated = source.beginAction({
      worldId, intent: "imagine a variant", tool: "image.generate",
      plan: { intent: "imagine a variant", objects: [objectId], tool: "image.generate",
              args: {}, confirmation: false },
      permissionLevel: "CREATE", provenance: "generated", provider: "mock.image",
      model: "mock/v1", toolVersion: "mock 0.1.0",
      generationParams: { prompt: "a chrome rocket, dramatic rim light", seed: 7 },
    });
    source.commitResult({
      actionId: generated.id, objectId,
      representations: [{
        objectId, modality: "image", format: "png",
        blobHash: source.putBlob(Buffer.from("generated pixels"), "image/png", "png"),
        producedByActionId: generated.id, provenance: "generated", provider: "mock.image",
        generationParams: { prompt: "a chrome rocket, dramatic rim light", seed: 7 },
      }],
      formRoles: ["art.primary"],
      inputs: [], cost: { inputTokens: 0, outputTokens: 0, credits: 0, usd: 0.04, ms: 900 },
    });

    const out = join(dir, "share.xeniur");
    await exportPackage(source, objectId, out);
    const inspection = await inspectPackage(source, out);

    expect(inspection.contents.versions).toBeGreaterThan(0);
    expect(inspection.contents.bytes).toBeGreaterThan(0);
    // Generated work carries its prompt, and a person should know that before sharing.
    expect(inspection.discloses.join(" ")).toContain("prompts and settings");
  });
});

describe("an archive and a delivery are different documents", () => {
  it("leaves the private half out of a delivery", async () => {
    buildRocket();
    const readiness = new ReadinessEvaluator(source, loadProfiles(process.cwd()));
    const release = readiness.approve({
      objectId, profileId: "client", note: "the client hated the first one", force: true,
    });

    const archive = await exportPackage(source, objectId, join(dir, "a.xeniur"),
                                        { intent: "archive" });
    const delivery = await exportPackage(source, objectId, join(dir, "d.xeniur"),
                                         { intent: "delivery", releaseId: release.id });

    expect(archive.manifest.releases.some((r) => r["note"] !== null)).toBe(true);
    expect(delivery.manifest.releases.every((r) => r["note"] === null)).toBe(true);
    expect(delivery.manifest.actions.every((a) => a["generation_params"] === "{}")).toBe(true);
    expect(delivery.manifest.releases).toHaveLength(1);

    // And it is still a valid package: narrower, never broken.
    const clean = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "b7") });
    const inspection = await inspectPackage(clean, delivery.path);
    expect(inspection.problems).toEqual([]);
    expect(inspection.ok).toBe(true);
    clean.close();
  });
});

describe("a recipient can read the delivery without installing anything", () => {
  it("says what was delivered, measured, decided and read", () => {
    buildRocket();
    const world = worldId;

    const claimText = "A 2024 study found that 63% of returns were caused by seam failure.";
    const sourceId = "33333333-3333-4333-8333-333333333333";
    const copyId = "44444444-4444-4444-8444-444444444444";
    source.db.prepare(
      `INSERT INTO sources (id, world_id, kind, title, author, retrieved_at, metadata)
       VALUES (?, ?, 'paper', 'Seam durability', 'Okafor', ?, '{}')`,
    ).run(sourceId, world, Date.now());
    source.db.prepare(
      `INSERT INTO source_versions (id, source_id, retrieved_at, content_hash, text_blob_hash,
                                    extractor, partial, rights)
       VALUES (?, ?, ?, 'abc', ?, 'verbatim/1', 0, 'unknown')`,
    ).run(copyId, sourceId, Date.now(),
          source.putBlob(Buffer.from(claimText, "utf8"), "text/plain", "txt"));

    const decision = source.decisions.create({
      worldId: world, question: "Which seam method?",
      options: [
        { key: "taped", label: "Taped seams", note: "durable in cold cycling" },
        { key: "welded", label: "Welded seams", note: "cheaper at volume" },
      ],
      chosenOption: "taped", rationale: "The returns evidence is decisive.",
    });
    source.decisions.cite(decision.objectId, {
      sourceVersionId: copyId, atomObjectId: null, atomVersionId: null,
      relation: "supports", note: "",
    });
    source.decisions.accept(decision.objectId, "Ada", { skipSteelman: true });
    source.decisions.link({
      fromObjectId: objectId, toObjectId: decision.objectId, relation: "satisfies",
    });

    const release = new ReadinessEvaluator(source, loadProfiles(process.cwd()))
      .approve({ objectId, profileId: "client", note: "private note", force: true });

    const html = deliveryReport(source, objectId, release.id);

    expect(html).toContain("Rocket");
    expect(html).toContain("No mock output, nothing stale");     // the honest profile name
    expect(html).toContain("Which seam method?");
    // The option as written, never its key.
    expect(html).toContain("Taped seams");
    expect(html).not.toMatch(/>taped</);
    expect(html).toContain("Seam durability");
    expect(html).toContain("Okafor");
    // Unknown rights stay visible rather than being rounded to "fine".
    expect(html).toContain("rights unknown (not established)");
    // And it does not claim the sources caused the choice.
    expect(html).toContain("only that it was cited when the");
    expect(html).toContain("without a model");
  });

  it("stands alone: no scripts, no fetches, nothing to install", () => {
    buildRocket();
    const html = deliveryReport(source, objectId);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
    expect(html).not.toContain("<link");
    expect(html).toContain("<style>");
  });

  it("escapes anything a person typed, so a title cannot become markup", () => {
    source.setProperties(objectId, { title: '<img src=x onerror="alert(1)">' });
    const html = deliveryReport(source, objectId);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("counts one measurement per requirement, not one per time it ever ran", () => {
    buildRocket();
    const readiness = new ReadinessEvaluator(source, loadProfiles(process.cwd()));

    // The same validator run three times, as append-only evidence means it will be.
    const forms = source.currentState(objectId)!.forms;
    const rep = source.getRepresentation(forms[0]!.representationId)!;
    for (let i = 0; i < 3; i += 1) {
      source.db.prepare(
        `INSERT INTO checks (id, object_id, representation_id, validator, status, summary,
                             detail, form_role, at, subject_kind, subject_id, subject_hash,
                             validator_version, params, environment, run_id)
         VALUES (?, ?, ?, 'provenance.no-mock', 'pass', 'nothing is standing in', '{}', NULL,
                 ?, 'representation', ?, ?, '1.0.0', '{}', '{}', ?)`,
      ).run(`${"0".repeat(8)}-0000-4000-8000-00000000000${i}`, objectId, rep.id,
            Date.now() + i, rep.id, rep.blobHash, `run-${i}`);
    }

    const release = readiness.approve({ objectId, profileId: "client", force: true });
    // Three rows exist; readiness consulted one, and that is what the release records.
    expect(release.checkIds).toHaveLength(
      new Set(release.checkIds).size,
    );
    const validators = release.checkIds.map((id) =>
      (source.db.prepare(`SELECT validator FROM checks WHERE id = ?`).get(id) as
        { validator: string }).validator);
    expect(new Set(validators).size).toBe(validators.length);
  });
});
