import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { KeyWouldLeak, findKeyShaped, formRoleName } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";
import { inspectArchive, verifyBlobs } from "./package-safety.js";
import { outcomeOf } from "./outcomes.js";

const exec = promisify(execFile);

/**
 * 2 — closure over decisions, sources and the Objects a build actually consumed.
 *
 * Version 1 exported one Object's own rows and nothing else, which was fine until a build
 * could consume something that belonged to another Object. An accepted decision's brief is
 * a real lineage input, so its representation appeared in the exported edges while the
 * representation itself stayed behind: the package carried a dangling foreign key, and
 * importing it failed outright rather than quietly losing the reason for the delivery.
 */
export const PACKAGE_VERSION = 2;

export interface PackageManifest {
  version: number;
  exportedAt: number;
  world: { id: string; title: string; emoji: string };
  object: Record<string, unknown>;
  branches: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
  versionForms: Array<Record<string, unknown>>;
  representations: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  actionInputs: Array<Record<string, unknown>>;
  actionOutputs: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  recipes: Array<Record<string, unknown>>;
  recipeSteps: Array<Record<string, unknown>>;
  recipeStepInputs: Array<Record<string, unknown>>;
  recipeStepOutputs: Array<Record<string, unknown>>;
  derivations: Array<Record<string, unknown>>;
  checks: Array<Record<string, unknown>>;
  releases: Array<Record<string, unknown>>;
  blobs: Array<Record<string, unknown>>;

  /* Closure — everything outside this Object that its history actually refers to. */

  /** Identity rows for Objects this one consumed or cited. */
  relatedObjects: Array<Record<string, unknown>>;
  relatedVersions: Array<Record<string, unknown>>;
  relatedVersionForms: Array<Record<string, unknown>>;
  relatedBranches: Array<Record<string, unknown>>;
  /** Representations belonging to those Objects that this one was built from. */
  relatedRepresentations: Array<Record<string, unknown>>;

  /** The thinking half: what was read, what was kept from it, and what was asserted. */
  sources: Array<Record<string, unknown>>;
  sourceVersions: Array<Record<string, unknown>>;
  atoms: Array<Record<string, unknown>>;
  atomLinks: Array<Record<string, unknown>>;

  /** The bridge: accepted decisions, their evidence, and the review edges. */
  decisions: Array<Record<string, unknown>>;
  decisionOptions: Array<Record<string, unknown>>;
  decisionEvidence: Array<Record<string, unknown>>;
  decisionAssumptions: Array<Record<string, unknown>>;
  semanticLinks: Array<Record<string, unknown>>;

  /** Named, not resolved: anything referenced that deliberately did not travel. */
  unresolved: Array<{ kind: string; id: string; why: string }>;
}

const rows = (graph: ObjectGraph, sql: string, ...params: unknown[]): Array<Record<string, unknown>> =>
  graph.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

/**
 * Writes everything an Object *is* into one portable file: its identity, every branch and
 * version with its complete form set and properties, the lineage that produced each form,
 * the recipe revisions that built them, the evidence, the releases, and the bytes.
 *
 * The point is that a XENIUR Object can leave XENIUR without becoming a folder of
 * disconnected files. Written with the system `tar` rather than a new dependency.
 */
/**
 * Why a package is being written, which decides what belongs in it.
 *
 * **archive** is your own working history: every version, every prompt, every note. It is
 * for you, another machine of yours, or a collaborator you trust with the lot.
 *
 * **delivery** is what a client receives: the released version and the material that
 * explains it, with the private half left out. The two are different documents, and
 * pretending one can serve as both is how private notes end up in a client's inbox.
 */
export type PackageIntent = "archive" | "delivery";

export interface ExportOptions {
  intent?: PackageIntent;
  /** For a delivery: which release. Defaults to the most recent. */
  releaseId?: string;
}

export async function exportPackage(
  graph: ObjectGraph, objectId: string, outPath: string, opts: ExportOptions = {},
): Promise<{ path: string; bytes: number; manifest: PackageManifest; intent: PackageIntent }> {
  const intent: PackageIntent = opts.intent ?? "archive";
  const object = graph.getObject(objectId);
  if (!object) throw new Error(`no such object: ${objectId}`);
  const world = graph.getWorld(object.worldId);
  if (!world) throw new Error(`object ${objectId} has no world`);

  const versionIds = rows(graph, `SELECT id FROM versions WHERE object_id = ?`, objectId)
    .map((r) => r["id"] as string);
  const inList = versionIds.map(() => "?").join(",") || "''";

  const representations = rows(graph, `SELECT * FROM representations WHERE object_id = ?`, objectId);
  const repIds = representations.map((r) => r["id"] as string);
  const repList = repIds.map(() => "?").join(",") || "''";

  const actionIds = new Set<string>();
  for (const rep of representations) {
    const a = rep["produced_by_action_id"] as string | null;
    if (a) actionIds.add(a);
  }
  const actionList = [...actionIds].map(() => "?").join(",") || "''";

  const manifest: PackageManifest = {
    version: PACKAGE_VERSION,
    exportedAt: Date.now(),
    world: { id: world.id, title: world.title, emoji: world.emoji },
    object: rows(graph, `SELECT * FROM objects WHERE id = ?`, objectId)[0] ?? {},
    branches: rows(graph, `SELECT * FROM branches WHERE object_id = ?`, objectId),
    versions: rows(graph, `SELECT * FROM versions WHERE object_id = ? ORDER BY seq`, objectId),
    versionForms: rows(graph, `SELECT * FROM version_forms WHERE version_id IN (${inList})`, ...versionIds),
    representations,
    actions: rows(graph, `SELECT * FROM actions WHERE id IN (${actionList})`, ...actionIds),
    actionInputs: rows(graph, `SELECT * FROM action_inputs WHERE representation_id IN (${repList})`, ...repIds),
    actionOutputs: rows(graph, `SELECT * FROM action_outputs WHERE representation_id IN (${repList})`, ...repIds),
    edges: rows(graph, `SELECT * FROM representation_edges WHERE to_representation_id IN (${repList})`, ...repIds),
    recipes: rows(graph, `SELECT * FROM recipes WHERE object_id = ?`, objectId),
    recipeSteps: [], recipeStepInputs: [], recipeStepOutputs: [],
    derivations: rows(graph, `SELECT * FROM derivations WHERE representation_id IN (${repList})`, ...repIds),
    checks: rows(graph, `SELECT * FROM checks WHERE object_id = ?`, objectId),
    releases: rows(graph, `SELECT * FROM releases WHERE object_id = ?`, objectId),
    blobs: [],
    relatedObjects: [], relatedVersions: [], relatedVersionForms: [], relatedBranches: [],
    relatedRepresentations: [],
    sources: [], sourceVersions: [], atoms: [], atomLinks: [],
    decisions: [], decisionOptions: [], decisionEvidence: [], decisionAssumptions: [],
    semanticLinks: [], unresolved: [],
  };

  const recipeIds = manifest.recipes.map((r) => r["id"] as string);
  const recipeList = recipeIds.map(() => "?").join(",") || "''";
  manifest.recipeSteps = rows(graph, `SELECT * FROM recipe_steps WHERE recipe_id IN (${recipeList})`, ...recipeIds);
  const stepIds = manifest.recipeSteps.map((r) => r["id"] as string);
  const stepList = stepIds.map(() => "?").join(",") || "''";
  manifest.recipeStepInputs = rows(graph, `SELECT * FROM recipe_step_inputs WHERE step_id IN (${stepList})`, ...stepIds);
  manifest.recipeStepOutputs = rows(graph, `SELECT * FROM recipe_step_outputs WHERE step_id IN (${stepList})`, ...stepIds);

  /* ------------------------------------------------------------- closure -
   *
   * An Object's history can name things that belong to other Objects: an accepted
   * decision's brief is consumed by a build, and a delivery records the decisions it was
   * made under. Those references have to travel or the package carries a dangling
   * foreign key — which is not a smaller package, it is a broken one.
   */
  const ours = new Set(repIds);
  const externalRepIds = new Set<string>();
  for (const edge of manifest.edges) {
    const from = edge["from_representation_id"] as string;
    if (!ours.has(from)) externalRepIds.add(from);
  }
  for (const input of rows(graph,
    `SELECT * FROM action_inputs WHERE action_id IN (${actionList})`, ...actionIds)) {
    const rep = input["representation_id"] as string;
    if (!ours.has(rep)) externalRepIds.add(rep);
  }
  // Inputs are collected against the actions this Object's forms came from, which is
  // where a consumed brief or a cited image actually shows up.
  manifest.actionInputs = rows(graph,
    `SELECT * FROM action_inputs WHERE action_id IN (${actionList})`, ...actionIds);

  const externalList = [...externalRepIds].map(() => "?").join(",") || "''";
  manifest.relatedRepresentations = externalRepIds.size > 0
    ? rows(graph, `SELECT * FROM representations WHERE id IN (${externalList})`, ...externalRepIds)
    : [];

  // Every Object those representations belong to, plus every decision this Object is
  // linked to or was delivered under. Both travel whole: a decision stripped of its
  // options and evidence would answer "what was decided" and not "why".
  const relatedIds = new Set<string>(
    manifest.relatedRepresentations.map((r) => r["object_id"] as string),
  );
  for (const release of manifest.releases) {
    for (const id of JSON.parse((release["decision_ids"] as string) || "[]") as string[]) {
      relatedIds.add(id);
    }
  }
  manifest.semanticLinks = rows(graph,
    `SELECT * FROM semantic_links WHERE from_object_id = ? OR to_object_id = ?`, objectId, objectId);
  for (const link of manifest.semanticLinks) {
    relatedIds.add(link["from_object_id"] as string);
    relatedIds.add(link["to_object_id"] as string);
  }
  relatedIds.delete(objectId);

  // Decisions cite atoms, and atoms belong to Objects of their own. One hop, so a
  // citation resolves to a passage without the package growing to the whole World.
  const relatedList0 = [...relatedIds].map(() => "?").join(",") || "''";
  manifest.decisions = relatedIds.size > 0
    ? rows(graph, `SELECT * FROM decisions WHERE object_id IN (${relatedList0})`, ...relatedIds)
    : [];
  const decisionIds = manifest.decisions.map((d) => d["object_id"] as string);
  const decisionList = decisionIds.map(() => "?").join(",") || "''";
  manifest.decisionEvidence = decisionIds.length > 0
    ? rows(graph, `SELECT * FROM decision_evidence WHERE decision_id IN (${decisionList})`, ...decisionIds)
    : [];
  for (const e of manifest.decisionEvidence) {
    const atom = e["atom_object_id"] as string | null;
    if (atom && atom !== objectId) relatedIds.add(atom);
  }

  const relatedIdList = [...relatedIds];
  const relatedList = relatedIdList.map(() => "?").join(",") || "''";
  manifest.relatedObjects = relatedIdList.length > 0
    ? rows(graph, `SELECT * FROM objects WHERE id IN (${relatedList})`, ...relatedIdList)
    : [];
  manifest.relatedBranches = relatedIdList.length > 0
    ? rows(graph, `SELECT * FROM branches WHERE object_id IN (${relatedList})`, ...relatedIdList)
    : [];
  manifest.relatedVersions = relatedIdList.length > 0
    ? rows(graph, `SELECT * FROM versions WHERE object_id IN (${relatedList}) ORDER BY seq`, ...relatedIdList)
    : [];
  const relatedVersionIds = manifest.relatedVersions.map((v) => v["id"] as string);
  const relatedVersionList = relatedVersionIds.map(() => "?").join(",") || "''";
  manifest.relatedVersionForms = relatedVersionIds.length > 0
    ? rows(graph, `SELECT * FROM version_forms WHERE version_id IN (${relatedVersionList})`, ...relatedVersionIds)
    : [];

  // Everything those related Objects are made of, so a brief or a claim is readable and
  // not merely named.
  const allRelatedReps = relatedIdList.length > 0
    ? rows(graph, `SELECT * FROM representations WHERE object_id IN (${relatedList})`, ...relatedIdList)
    : [];
  const seenRelated = new Set(manifest.relatedRepresentations.map((r) => r["id"] as string));
  for (const rep of allRelatedReps) {
    if (!seenRelated.has(rep["id"] as string)) manifest.relatedRepresentations.push(rep);
  }

  manifest.decisionOptions = decisionIds.length > 0
    ? rows(graph, `SELECT * FROM decision_options WHERE decision_id IN (${decisionList})`, ...decisionIds)
    : [];
  manifest.decisionAssumptions = decisionIds.length > 0
    ? rows(graph, `SELECT * FROM decision_assumptions WHERE decision_id IN (${decisionList})`, ...decisionIds)
    : [];

  // The thinking half: the atoms that travelled, the copies they came out of, and the
  // sources those copies are of. A citation that cannot be read is not a citation.
  manifest.atoms = relatedIdList.length > 0
    ? rows(graph, `SELECT * FROM atoms WHERE object_id IN (${relatedList})`, ...relatedIdList)
    : [];
  const sourceVersionIds = new Set<string>();
  for (const atom of manifest.atoms) {
    const v = atom["source_version_id"] as string | null;
    if (v) sourceVersionIds.add(v);
  }
  for (const e of manifest.decisionEvidence) {
    const v = e["source_version_id"] as string | null;
    if (v) sourceVersionIds.add(v);
  }
  const svList = [...sourceVersionIds].map(() => "?").join(",") || "''";
  manifest.sourceVersions = sourceVersionIds.size > 0
    ? rows(graph, `SELECT * FROM source_versions WHERE id IN (${svList})`, ...sourceVersionIds)
    : [];
  const sourceIds = [...new Set(manifest.sourceVersions.map((v) => v["source_id"] as string))];
  const sourceList = sourceIds.map(() => "?").join(",") || "''";
  manifest.sources = sourceIds.length > 0
    ? rows(graph, `SELECT * FROM sources WHERE id IN (${sourceList})`, ...sourceIds)
    : [];
  const atomIds = manifest.atoms.map((a) => a["object_id"] as string);
  const atomList = atomIds.map(() => "?").join(",") || "''";
  manifest.atomLinks = atomIds.length > 0
    ? rows(graph,
        `SELECT * FROM atom_links WHERE from_object_id IN (${atomList}) AND to_object_id IN (${atomList})`,
        ...atomIds, ...atomIds)
    : [];

  // What was referenced and deliberately did not travel, named rather than dropped.
  const carried = new Set([...relatedIdList, objectId]);
  for (const link of manifest.semanticLinks) {
    for (const end of [link["from_object_id"] as string, link["to_object_id"] as string]) {
      if (!carried.has(end)) {
        manifest.unresolved.push({
          kind: "object", id: end,
          why: "referenced by a semantic link but outside this delivery's closure",
        });
      }
    }
  }

  const hashes = [...new Set([
    ...[...representations, ...manifest.relatedRepresentations]
      .map((r) => r["blob_hash"] as string | null),
    // The stored copies themselves: without these a source chip opens nothing, which is
    // the whole failure durable capture exists to fix.
    ...manifest.sourceVersions.flatMap((v) => [
      v["text_blob_hash"] as string | null, v["raw_blob_hash"] as string | null,
    ]),
  ].filter((h): h is string => typeof h === "string"))];
  const hashList = hashes.map(() => "?").join(",") || "''";
  manifest.blobs = rows(graph, `SELECT * FROM blobs WHERE sha256 IN (${hashList})`, ...hashes);

  if (intent === "delivery") narrowToDelivery(graph, manifest, objectId, opts.releaseId);

  // Staged in a temp directory, then tarred, so a failed export leaves nothing behind.
  const staging = mkdtempSync(join(tmpdir(), "xeniur-pkg-"));
  try {
    // A package leaves the machine. Nothing shaped like a credential goes with it, whatever
    // field it hid in — a prompt, a note, a recorded plan. Refused, and the refusal names where.
    const leaks = findKeyShaped(manifest);
    if (leaks.length > 0) throw new KeyWouldLeak("a .xeniur package", leaks);
    writeFileSync(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
    mkdirSync(join(staging, "blobs"), { recursive: true });
    for (const blob of manifest.blobs) {
      const sha = blob["sha256"] as string;
      const ext = blob["ext"] as string;
      writeFileSync(join(staging, "blobs", `${sha}.${ext}`), graph.blobs.read(sha, ext));
    }
    mkdirSync(dirname(outPath), { recursive: true });
    await exec("tar", ["-czf", outPath, "-C", staging, "manifest.json", "blobs"]);
    return {
      path: outPath,
      bytes: readFileSync(outPath).byteLength,
      manifest, intent,
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * What XENIUR would be taking on, decided before anything is written.
 *
 * `relationship` is the question a person actually has when a package arrives: is this the
 * thing I already have, a newer version of it, or a different history that happens to
 * share its name? XENIUR answers that explicitly and may refuse the third — but it never
 * merges two histories quietly, because doing so loses one of them, and it never reports a
 * package as incorporated when it skipped its contents.
 */
/**
 * A package XENIUR would not open, with every reason it would not.
 *
 * Thrown before anything is written, so a refusal leaves the database exactly as it was.
 * The reasons are the message: "that archive was bad" tells a person nothing they can act
 * on, and quietly importing part of it would be worse than either.
 */
export class PackageRefused extends Error {
  readonly code = "package_refused" as const;
  constructor(
    readonly problems: readonly string[],
    readonly relationship: PackageInspection["relationship"] = "new",
  ) {
    super(`XENIUR will not open this package:\n  ${problems.join("\n  ")}`);
    this.name = "PackageRefused";
  }
}

export interface PackageInspection {
  ok: boolean;
  /** Every reason it would be refused, in the words a person is shown. */
  problems: string[];
  manifest: PackageManifest | null;
  relationship: "new" | "identical" | "descendant" | "ancestor" | "divergent";
  /** What is inside, so it can be read before it is opened. */
  contents: {
    objectId: string | null;
    title: string;
    versions: number;
    representations: number;
    decisions: number;
    sources: number;
    atoms: number;
    releases: number;
    bytes: number;
  };
  /** Things somebody might not want to hand over. Listed, never stripped silently. */
  discloses: string[];
  unresolved: Array<{ kind: string; id: string; why: string }>;
}

/**
 * Narrows an archive down to one delivery.
 *
 * Two separate jobs. First the *history* is cut back to the released version and its
 * ancestry, because a client asked for what was delivered and not for the six attempts
 * before it. Then the *private* half is removed: prompts, generation settings, local
 * paths and release notes, which are working material rather than deliverable material.
 *
 * The decisions and the source copies stay. They are the disclosed supporting material —
 * the whole reason a delivery can answer "why is it like this?" — and removing them would
 * leave a folder of files that happens to have been made by XENIUR.
 */
function narrowToDelivery(
  graph: ObjectGraph, manifest: PackageManifest, objectId: string, releaseId?: string,
): void {
  const release = (releaseId
    ? manifest.releases.find((r) => r["id"] === releaseId)
    : [...manifest.releases].sort(
        (a, b) => (b["approved_at"] as number) - (a["approved_at"] as number))[0]) ?? null;

  if (release) {
    const keep = new Set(
      graph.versionAncestry(release["version_id"] as string).map((v) => v.id),
    );
    manifest.versions = manifest.versions.filter((v) => keep.has(v["id"] as string));
    manifest.versionForms = manifest.versionForms.filter((f) => keep.has(f["version_id"] as string));
    manifest.releases = [release];

    // Only the forms those versions actually name, and only the bytes behind them.
    const reps = new Set(manifest.versionForms.map((f) => f["representation_id"] as string));
    // Lineage is kept whole for what survives, so "how was this made" still answers.
    for (const edge of manifest.edges) {
      if (reps.has(edge["to_representation_id"] as string)) {
        reps.add(edge["from_representation_id"] as string);
      }
    }
    manifest.representations = manifest.representations.filter((r) => reps.has(r["id"] as string));
    // Related forms are kept whole. They are the disclosed supporting material — the
    // accepted brief, the claims it cites — and they are small. Narrowing them was a bug
    // that produced a package naming a form it no longer carried, which the closure check
    // then refused, correctly.
    for (const r of manifest.relatedRepresentations) reps.add(r["id"] as string);
    manifest.edges = manifest.edges.filter((e) =>
      reps.has(e["from_representation_id"] as string) && reps.has(e["to_representation_id"] as string));
    manifest.versionForms = manifest.versionForms.filter((f) => reps.has(f["representation_id"] as string));
    manifest.checks = manifest.checks.filter((c) => {
      const subject = c["subject_id"] as string | null;
      return subject === null || reps.has(subject);
    });

    const blobHashes = new Set([...manifest.representations, ...manifest.relatedRepresentations]
      .map((r) => r["blob_hash"] as string | null)
      .filter((h): h is string => h !== null));
    for (const v of manifest.sourceVersions) {
      const text = v["text_blob_hash"] as string | null;
      if (text) blobHashes.add(text);
    }
    manifest.blobs = manifest.blobs.filter((b) => blobHashes.has(b["sha256"] as string));
  }

  // The private half. Named explicitly, and removed rather than blanked, so nothing about
  // a delivery hints at what was taken out of it.
  manifest.actions = manifest.actions.map((a) => ({
    ...a, generation_params: "{}", plan: "{}",
  }));
  manifest.releases = manifest.releases.map((r) => ({ ...r, note: null }));
  // A raw scrape is the publisher's bytes, not the delivery's; the normalised text that a
  // citation actually resolves against stays.
  manifest.sourceVersions = manifest.sourceVersions.map((v) => ({ ...v, raw_blob_hash: null }));
}

export interface ImportResult {
  objectId: string;
  worldId: string;
  representations: number;
  versions: number;
  blobs: number;
  /** True when this Object was already present and was left untouched. */
  alreadyPresent: boolean;
  /** Objects, decisions and sources that came with it, counted. */
  related: { objects: number; decisions: number; sources: number; atoms: number };
  /** Named references the package deliberately did not carry. */
  unresolved: Array<{ kind: string; id: string; why: string }>;
}

/**
 * Reads a `.xeniur` back, preserving every uuid.
 *
 * Ids are kept deliberately: an Object that comes back with a new identity is a copy, and
 * the whole claim is that a thing keeps its identity wherever it goes. An Object already
 * present is left alone rather than merged, because silently reconciling two histories is
 * how you lose one of them.
 */
/**
 * Reads a package and says what it is, without writing anything anywhere.
 *
 * Everything a person needs before opening or sharing one: whether it is safe, what is in
 * it, what it would disclose, and how it relates to what they already have. `importPackage`
 * runs exactly this first and refuses on any problem, so inspecting and importing can never
 * disagree about whether an archive was acceptable.
 */
export async function inspectPackage(
  graph: ObjectGraph, packagePath: string,
): Promise<PackageInspection> {
  const empty: PackageInspection["contents"] = {
    objectId: null, title: "", versions: 0, representations: 0,
    decisions: 0, sources: 0, atoms: 0, releases: 0, bytes: 0,
  };
  if (!existsSync(packagePath)) {
    return { ok: false, problems: [`no such package: ${packagePath}`], manifest: null,
             relationship: "new", contents: empty, discloses: [], unresolved: [] };
  }

  // 1. The archive itself, from its headers. Nothing is unpacked yet.
  const archive = await inspectArchive(packagePath);
  if (!archive.ok) {
    return { ok: false, problems: archive.problems, manifest: null,
             relationship: "new", contents: empty, discloses: [], unresolved: [] };
  }

  // 2. The manifest, unpacked alone into a scratch directory that is thrown away.
  const staging = mkdtempSync(join(tmpdir(), "xeniur-inspect-"));
  try {
    await exec("tar", ["-xzf", packagePath, "-C", staging, "manifest.json"]);
    let manifest: PackageManifest;
    try {
      manifest = JSON.parse(readFileSync(join(staging, "manifest.json"), "utf8")) as PackageManifest;
    } catch {
      return { ok: false, problems: ["the manifest is not readable"], manifest: null,
               relationship: "new", contents: empty, discloses: [], unresolved: [] };
    }

    const problems: string[] = [];
    if (manifest.version !== PACKAGE_VERSION) {
      problems.push(
        `this package is version ${manifest.version}; XENIUR reads version ${PACKAGE_VERSION}`);
    }

    const objectId = (manifest.object?.["id"] as string | undefined) ?? null;
    if (!objectId) problems.push("the manifest names no Object");

    // 3. Referential closure, checked against the manifest rather than hoped for.
    problems.push(...closureProblems(manifest));

    const relationship = objectId ? relationshipTo(graph, objectId, manifest) : "new";
    if (relationship === "divergent") {
      problems.push(
        "this is a different history of an Object you already have. XENIUR will not merge " +
        "two histories, because doing that quietly loses one of them.",
      );
    }

    return {
      ok: problems.length === 0,
      problems,
      manifest,
      relationship,
      contents: {
        objectId,
        title: (manifest.object?.["title"] as string | undefined)
          ?? manifest.world?.title ?? "an Object",
        versions: manifest.versions?.length ?? 0,
        representations: (manifest.representations?.length ?? 0) +
                         (manifest.relatedRepresentations?.length ?? 0),
        decisions: manifest.decisions?.length ?? 0,
        sources: manifest.sources?.length ?? 0,
        atoms: manifest.atoms?.length ?? 0,
        releases: manifest.releases?.length ?? 0,
        bytes: archive.expandedBytes,
      },
      discloses: disclosures(manifest),
      unresolved: manifest.unresolved ?? [],
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Whether the manifest names anything it does not carry.
 *
 * A package that references a row it left behind is not a smaller package, it is one that
 * cannot be opened — the import fails on a foreign key halfway through. Better to say so
 * while nothing has been written.
 */
function closureProblems(manifest: PackageManifest): string[] {
  const problems: string[] = [];
  const reps = new Set([
    ...(manifest.representations ?? []).map((r) => r["id"] as string),
    ...(manifest.relatedRepresentations ?? []).map((r) => r["id"] as string),
  ]);
  const versions = new Set([
    ...(manifest.versions ?? []).map((v) => v["id"] as string),
    ...(manifest.relatedVersions ?? []).map((v) => v["id"] as string),
  ]);
  const objects = new Set([
    manifest.object?.["id"] as string,
    ...(manifest.relatedObjects ?? []).map((o) => o["id"] as string),
  ].filter(Boolean));
  const blobs = new Set((manifest.blobs ?? []).map((b) => b["sha256"] as string));

  for (const edge of manifest.edges ?? []) {
    for (const end of ["from_representation_id", "to_representation_id"] as const) {
      const id = edge[end] as string;
      if (!reps.has(id)) problems.push(`a lineage edge names a form the package does not carry`);
    }
  }
  for (const form of [...(manifest.versionForms ?? []), ...(manifest.relatedVersionForms ?? [])]) {
    if (!reps.has(form["representation_id"] as string)) {
      problems.push("a version names a form the package does not carry");
    }
    if (!versions.has(form["version_id"] as string)) {
      problems.push("a form names a version the package does not carry");
    }
  }
  for (const rep of [...(manifest.representations ?? []), ...(manifest.relatedRepresentations ?? [])]) {
    if (!objects.has(rep["object_id"] as string)) {
      problems.push("a form belongs to an Object the package does not carry");
    }
    const hash = rep["blob_hash"] as string | null;
    if (hash && !blobs.has(hash)) problems.push("a form names bytes the package does not carry");
  }
  for (const evidence of manifest.decisionEvidence ?? []) {
    const version = evidence["source_version_id"] as string | null;
    if (version && !(manifest.sourceVersions ?? []).some((v) => v["id"] === version)) {
      problems.push("a decision cites a source copy the package does not carry");
    }
  }
  // One line per kind, however many rows are wrong: a person needs to know what is broken,
  // not to scroll past four thousand identical sentences.
  return [...new Set(problems)];
}

/** What a package would hand over that its sender might not have thought about. */
function disclosures(manifest: PackageManifest): string[] {
  const out: string[] = [];
  const push = (text: string) => { if (!out.includes(text)) out.push(text); };

  if ((manifest.sources?.length ?? 0) > 0) {
    push(`${manifest.sources.length} source${manifest.sources.length === 1 ? "" : "s"} you read, with the stored text`);
  }
  if ((manifest.decisions?.length ?? 0) > 0) {
    push(`${manifest.decisions.length} decision${manifest.decisions.length === 1 ? "" : "s"}, including the rationale you wrote`);
  }
  for (const action of manifest.actions ?? []) {
    const params = (action["generation_params"] as string) ?? "{}";
    if (params.length > 2) push("the prompts and settings behind generated work");
    const plan = (action["plan"] as string) ?? "";
    if (plan.includes("/Users/") || plan.includes("/home/") || plan.includes("C:\\")) {
      push("file paths from your own machine, inside recorded plans");
    }
  }
  for (const release of manifest.releases ?? []) {
    if (((release["note"] as string | null) ?? "").length > 0) push("your notes on each release");
  }
  return out;
}

/**
 * How a package relates to what is already here.
 *
 * Version ids are stable, so this is decided by set containment rather than by timestamps:
 * the same versions is identical, a superset is a descendant, a subset is an ancestor, and
 * anything else is two histories that share an identity — which is the case XENIUR refuses
 * rather than reconciles.
 */
function relationshipTo(
  graph: ObjectGraph, objectId: string, manifest: PackageManifest,
): PackageInspection["relationship"] {
  if (!graph.getObject(objectId)) return "new";

  const here = new Set(graph.versionChain(objectId).map((v) => v.id));
  const theirs = new Set((manifest.versions ?? []).map((v) => v["id"] as string));

  const missingHere = [...theirs].filter((id) => !here.has(id));
  const missingThere = [...here].filter((id) => !theirs.has(id));

  if (missingHere.length === 0 && missingThere.length === 0) return "identical";
  if (missingThere.length === 0) return "descendant";
  if (missingHere.length === 0) return "ancestor";
  return "divergent";
}

export async function importPackage(
  graph: ObjectGraph, packagePath: string, opts: { worldId?: string } = {},
): Promise<ImportResult> {
  // Nothing is written until everything has been checked: the archive's shape, the
  // manifest's closure, and how it relates to what is already here.
  const inspection = await inspectPackage(graph, packagePath);
  if (!inspection.ok) {
    throw new PackageRefused(inspection.problems, inspection.relationship);
  }
  const manifest = inspection.manifest!;

  const staging = mkdtempSync(join(tmpdir(), "xeniur-unpkg-"));
  try {
    await exec("tar", ["-xzf", packagePath, "-C", staging]);

    // The bytes are checked against the names they were given. Content addressing is only
    // a guarantee if somebody verifies it, and nobody had been.
    const badBlobs = verifyBlobs(staging, manifest.blobs ?? []);
    if (badBlobs.length > 0) throw new PackageRefused(badBlobs, inspection.relationship);

    const objectId = manifest.object["id"] as string;
    if (graph.getObject(objectId)) {
      return {
        objectId, worldId: manifest.object["world_id"] as string,
        representations: 0, versions: 0, blobs: 0, alreadyPresent: true,
        related: { objects: 0, decisions: 0, sources: 0, atoms: 0 },
        unresolved: manifest.unresolved ?? [],
      };
    }

    // The World is recreated only if it is not already here, so importing two Objects
    // from the same World does not produce two Worlds.
    let worldId = opts.worldId ?? manifest.world.id;
    if (!graph.getWorld(worldId)) {
      graph.db.prepare(
        `INSERT INTO worlds (id, title, emoji, summary, created_at, last_opened_at)
         VALUES (?, ?, ?, '', ?, NULL)`,
      ).run(worldId, manifest.world.title, manifest.world.emoji, Date.now());
      worldId = worldId;
    }

    for (const blob of manifest.blobs) {
      const sha = blob["sha256"] as string;
      const ext = blob["ext"] as string;
      const path = join(staging, "blobs", `${sha}.${ext}`);
      if (existsSync(path)) graph.putBlob(readFileSync(path), blob["mime"] as string, ext);
    }

    const insertAll = (table: string, records: Array<Record<string, unknown>>): void => {
      for (const record of records) {
        const columns = Object.keys(record);
        if (columns.length === 0) continue;
        graph.db.prepare(
          `INSERT OR IGNORE INTO ${table} (${columns.join(", ")})
           VALUES (${columns.map(() => "?").join(", ")})`,
        ).run(...columns.map((c) => record[c] as never));
      }
    };

    // Ordered so a row never references something that is not there yet.
    graph.db.transaction(() => {
      // Related Objects first: this Object's history refers to them, so they have to be
      // there before anything that names them.
      insertAll("objects", manifest.relatedObjects.map((o) => ({
        ...o, world_id: worldId, current_version_id: null, current_branch_id: null,
      })));
      insertAll("objects", [{ ...manifest.object, world_id: worldId, current_version_id: null, current_branch_id: null }]);
      insertAll("branches", [...manifest.relatedBranches, ...manifest.branches]
        .map((b) => ({ ...b, head_version_id: null })));
      insertAll("actions", manifest.actions.map((a) => ({ ...a, world_id: worldId })));
      insertAll("representations", manifest.relatedRepresentations);
      insertAll("representations", manifest.representations);
      insertAll("versions", manifest.relatedVersions);
      insertAll("versions", manifest.versions);
      insertAll("version_forms", manifest.relatedVersionForms);
      insertAll("version_forms", manifest.versionForms);
      insertAll("action_inputs", manifest.actionInputs);
      insertAll("action_outputs", manifest.actionOutputs);
      insertAll("representation_edges", manifest.edges);
      insertAll("recipes", manifest.recipes);
      insertAll("recipe_steps", manifest.recipeSteps);
      insertAll("recipe_step_inputs", manifest.recipeStepInputs);
      insertAll("recipe_step_outputs", manifest.recipeStepOutputs);
      insertAll("derivations", manifest.derivations);
      insertAll("checks", manifest.checks);
      insertAll("releases", manifest.releases);

      // The thinking half and the bridge. Sources before their copies, copies before the
      // atoms that point into them, decisions before what hangs off them.
      insertAll("sources", manifest.sources.map((s) => ({ ...s, world_id: worldId })));
      insertAll("source_versions", manifest.sourceVersions);
      insertAll("atoms", manifest.atoms);
      insertAll("atom_links", manifest.atomLinks);
      insertAll("decisions", manifest.decisions);
      insertAll("decision_options", manifest.decisionOptions);
      insertAll("decision_evidence", manifest.decisionEvidence);
      insertAll("decision_assumptions", manifest.decisionAssumptions);
      insertAll("semantic_links", manifest.semanticLinks);

      // Pointers go back last, once everything they name exists.
      for (const branch of [...manifest.relatedBranches, ...manifest.branches]) {
        graph.db.prepare(`UPDATE branches SET head_version_id = ? WHERE id = ?`)
          .run(branch["head_version_id"] as string | null, branch["id"] as string);
      }
      for (const related of manifest.relatedObjects) {
        graph.db.prepare(`UPDATE objects SET current_version_id = ?, current_branch_id = ? WHERE id = ?`)
          .run(related["current_version_id"] as string | null,
               related["current_branch_id"] as string | null, related["id"] as string);
      }
      graph.db.prepare(`UPDATE objects SET current_version_id = ?, current_branch_id = ? WHERE id = ?`)
        .run(manifest.object["current_version_id"] as string | null,
             manifest.object["current_branch_id"] as string | null, objectId);
    })();

    return {
      objectId, worldId,
      representations: manifest.representations.length,
      versions: manifest.versions.length,
      blobs: manifest.blobs.length,
      alreadyPresent: false,
      related: {
        objects: manifest.relatedObjects.length,
        decisions: manifest.decisions.length,
        sources: manifest.sources.length,
        atoms: manifest.atoms.length,
      },
      unresolved: manifest.unresolved ?? [],
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * A delivery, readable by somebody who has never heard of XENIUR.
 *
 * One self-contained HTML file: what was delivered, against which profile, on what
 * evidence, from which decisions, and out of which sources. No stylesheet to fetch, no
 * script, no fonts — a recipient opens it in a browser three years from now and it still
 * works.
 *
 * This is the answer to "what do I actually hand over?" that does not require the client
 * to install anything. The `.xeniur` beside it is for whoever wants to keep working.
 */
export function deliveryReport(
  graph: ObjectGraph, objectId: string, releaseId?: string,
): string {
  const state = graph.currentState(objectId);
  const releases = rows(graph,
    `SELECT * FROM releases WHERE object_id = ? ORDER BY approved_at DESC`, objectId);
  const release = (releaseId ? releases.find((r) => r["id"] === releaseId) : releases[0]) ?? null;
  const influence = graph.decisions.influenceOn(objectId, release?.["id"] as string | undefined);
  const outcome = outcomeOf(graph, objectId, release?.["id"] as string | undefined);

  const versionId = (release?.["version_id"] as string | undefined) ?? state?.versionId;
  const forms = versionId ? graph.formsAt(versionId) : [];
  const evidence = release
    ? (JSON.parse((release["check_ids"] as string) || "[]") as string[])
        .map((id) => rows(graph, `SELECT * FROM checks WHERE id = ?`, id)[0])
        .filter((c): c is Record<string, unknown> => c !== undefined)
    : [];

  const profileName = (() => {
    const report = release?.["evidence"] as string | undefined;
    if (!report) return (release?.["profile_id"] as string) ?? "—";
    try {
      return (JSON.parse(report) as { profileName?: string }).profileName
        ?? (release!["profile_id"] as string);
    } catch { return (release!["profile_id"] as string); }
  })();

  const rowsHtml = (items: string[]) =>
    items.length > 0 ? items.map((i) => `<li>${i}</li>`).join("") : "<li class=none>—</li>";
  const guard = (html: string): string => {
    const leaks = findKeyShaped(html);
    if (leaks.length > 0) throw new KeyWouldLeak("a delivery report", leaks);
    return html;
  };

  const sourceLines = influence.sourceVersionIds.map((id) => {
    const v = rows(graph, `SELECT * FROM source_versions WHERE id = ?`, id)[0];
    if (!v) return esc("a source copy that did not travel");
    const s = rows(graph, `SELECT * FROM sources WHERE id = ?`, v["source_id"])[0];
    const rights = v["rights"] as string;
    return `${esc((s?.["title"] as string) ?? "a source")}` +
      `${s?.["author"] ? ` — ${esc(s["author"] as string)}` : ""}` +
      ` <span class=meta>read ${new Date(v["retrieved_at"] as number).toISOString().slice(0, 10)}` +
      `, rights ${esc(rights)}${rights === "unknown" ? " (not established)" : ""}</span>`;
  });

  return guard(`<!doctype html>
<html lang=en><head><meta charset=utf-8>
<title>${esc(state?.properties.title ?? "Delivery")} — delivery report</title>
<style>
  :root { color-scheme: light }
  body { max-width: 46rem; margin: 3rem auto; padding: 0 1.5rem;
         font: 16px/1.65 ui-serif, Georgia, serif; color: #1b1b19; background: #fbfaf7 }
  h1 { font-size: 1.8rem; margin: 0 0 .2rem; font-weight: 500 }
  h2 { font-size: .78rem; text-transform: uppercase; letter-spacing: .09em;
       color: #726f68; margin: 2.4rem 0 .6rem; font-weight: 600;
       font-family: ui-sans-serif, system-ui, sans-serif }
  .sub { color: #726f68; margin: 0 0 2rem }
  ul { margin: 0; padding-left: 1.1rem }
  li { margin: .25rem 0 }
  li.none { list-style: none; margin-left: -1.1rem; color: #9b978e }
  .meta { color: #726f68; font-size: .85em }
  .pass { color: #2f6b45 } .warn { color: #8a6116 } .fail { color: #9c3b23 }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid #e2ded4;
           color: #726f68; font-size: .85rem }
  code { font: 12px ui-monospace, monospace; color: #55534d }
</style></head><body>

<h1>${esc(state?.properties.title ?? "Delivery")}</h1>
<p class=sub>
  ${release
    ? `Approved ${new Date(release["approved_at"] as number).toISOString().slice(0, 10)}
       against <strong>${esc(profileName)}</strong>`
    : "Not yet approved against any profile"}
</p>

<h2>What was delivered</h2>
<ul>${rowsHtml(forms.map((f) => {
  const rep = graph.getRepresentation(f.representationId);
  return `${esc(formRoleName(f.role))} <span class=meta>${esc(rep?.format ?? "")}</span>`;
}))}</ul>

<h2>What was measured</h2>
<ul>${rowsHtml(evidence.map((c) => {
  const status = c["status"] as string;
  return `<span class=${status === "pass" ? "pass" : status === "fail" ? "fail" : "warn"}>${
    esc(status)}</span> ${esc(c["validator"] as string)} — ${esc(c["summary"] as string)}`;
}))}</ul>
<p class=meta>${evidence.length} measurement${evidence.length === 1 ? "" : "s"}, each taken
against the exact file delivered. A profile states what it checks and what it does not.</p>

<h2>Decided under</h2>
<ul>${rowsHtml(influence.decisions.map((d) => {
  // The option as it was written, not its key: "matte" is an identifier, "Matte
  // throughout" is what somebody chose.
  const detail = graph.decisions.detail(d.objectId);
  const chosen = detail?.options.find((o) => o.key === d.chosenOption)?.label ?? d.chosenOption;
  return `${esc(d.question)} — <strong>${esc(chosen ?? "—")}</strong>` +
    `<span class=meta>${d.acceptedBy ? `, accepted by ${esc(d.acceptedBy)}` : ""}` +
    `${d.changedSince ? "; this decision has changed since" : ""}</span>`;
}))}</ul>

<h2>Read from</h2>
<ul>${rowsHtml(sourceLines)}</ul>

<h2>What it cost</h2>
<ul>
  <li>Generation <strong>$${outcome.generation.usd.toFixed(2)}</strong>
    <span class=meta>${outcome.generation.actions} action${outcome.generation.actions === 1 ? "" : "s"}, ${
      outcome.generation.generativeActions} generative</span></li>
  <li>Intelligence <strong>$${outcome.intelligence.usd.toFixed(2)}</strong>
    <span class=meta>${outcome.intelligence.calls} model call${outcome.intelligence.calls === 1 ? "" : "s"}${
      outcome.intelligence.escalations > 0 ? `, ${outcome.intelligence.escalations} escalated` : ""}${
      outcome.intelligence.failed > 0 ? `, ${outcome.intelligence.failed} failed and still billed` : ""}</span></li>
  <li>Recorded work <strong>${Math.round(outcome.recordedWork.ms / 60_000)} min</strong>
    <span class=meta>${outcome.recordedWork.sessions} session${outcome.recordedWork.sessions === 1 ? "" : "s"} — recorded, not total</span></li>
</ul>
<p class=meta>Money is summed from the spend rows and action costs behind the delivered files.
Time counts only sessions XENIUR recorded; work done elsewhere is not here and is not estimated.</p>

<footer>
  ${esc(influence.summary)}<br>
  Decisions above were made by a person and recorded against the exact copies they read.
  Nothing here asserts that a source caused a choice — only that it was cited when the
  choice was made.<br><br>
  Generated by XENIUR from its own records, without a model.
  <code>${esc((release?.["id"] as string ?? "").slice(0, 8))}</code>
</footer>
</body></html>`);
}

const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
