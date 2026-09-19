import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImportRateExceeded, MemorySigningKeyStore } from "@xeniur/core";
import {
  ObjectGraph, PackageRefused, PublisherIdentity, exportPackage, importPackage, inspectPackage,
  packageRootHash, verifySignature,
} from "./index.js";

let dir: string, source: ObjectGraph, target: ObjectGraph, worldId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-pub-"));
  source = ObjectGraph.open({ dbPath: join(dir, "a.db"), blobDir: join(dir, "a-blobs") });
  target = ObjectGraph.open({ dbPath: join(dir, "b.db"), blobDir: join(dir, "b-blobs") });
  worldId = source.createWorld({ title: "Asteroid Game", emoji: "R" }).id;
});
afterEach(() => { source.close(); target.close(); rmSync(dir, { recursive: true, force: true }); });

/** One Object with one human form, exported to `name`. */
async function packageOf(title: string, name: string): Promise<{ objectId: string; path: string }> {
  const objectId = source.createObject({ worldId, semanticType: "rocket", title }).object.id;
  const rep = source.addRepresentation({
    objectId, modality: "image", format: "png",
    blobHash: source.putBlob(Buffer.from(`circle for ${title}`), "image/png", "png"), provenance: "human",
  });
  source.commitVersion({ objectId, forms: [{ role: "source.primary", representationId: rep.id }] });
  const path = join(dir, name);
  await exportPackage(source, objectId, path);
  return { objectId, path };
}

/** Unpack, let the caller alter the manifest, and re-pack under a new name. */
function tamper(path: string, edit: (manifest: Record<string, unknown>) => void, out: string): string {
  const staging = join(dir, `tamper-${Math.random().toString(36).slice(2)}`);
  mkdirSync(staging, { recursive: true });
  execFileSync("tar", ["-xzf", path, "-C", staging]);
  const manifest = JSON.parse(readFileSync(join(staging, "manifest.json"), "utf8")) as Record<string, unknown>;
  edit(manifest);
  writeFileSync(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
  const outPath = join(dir, out);
  execFileSync("tar", ["-czf", outPath, "-C", staging, "manifest.json", "blobs"]);
  return outPath;
}

const rowCounts = (g: ObjectGraph) => ({
  objects: (g.db.prepare(`SELECT COUNT(*) c FROM objects`).get() as { c: number }).c,
  versions: (g.db.prepare(`SELECT COUNT(*) c FROM versions`).get() as { c: number }).c,
  blobs: (g.db.prepare(`SELECT COUNT(*) c FROM blobs`).get() as { c: number }).c,
});

describe("identity is a keypair, made on first share", () => {
  it("is created lazily, is stable, and the private key stays in the store", () => {
    const store = new MemorySigningKeyStore();
    expect(store.load()).toBeNull();
    const a = PublisherIdentity.load(store, "Samir");
    const b = PublisherIdentity.load(store);
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Not on the identity's surface: a log line or a serialised object cannot carry it.
    expect(JSON.stringify(a)).not.toContain(store.load()!.privateKey);
    expect(Object.keys(a)).toEqual(["publicKey", "displayName"]);
  });

  it("signs a root hash that anyone with the public key can verify, and nothing else verifies", () => {
    const id = PublisherIdentity.load(new MemorySigningKeyStore(), "Samir");
    const root = "a".repeat(64);
    const sig = id.sign(root);
    expect(verifySignature(sig)).toBe(true);
    expect(verifySignature({ ...sig, rootHash: "b".repeat(64) })).toBe(false);
    expect(verifySignature({ ...sig, publicKey: PublisherIdentity.load(new MemorySigningKeyStore()).publicKey })).toBe(false);
    expect(verifySignature({ ...sig, signature: sig.signature.replace(/^./, (c) => (c === "A" ? "B" : "A")) })).toBe(false);
  });

  it("an exported package is signed by this machine and verifies on arrival", async () => {
    const { path } = await packageOf("Rocket", "rocket.xeniur");
    const inspection = await inspectPackage(target, path);
    expect(inspection.ok).toBe(true);
    expect(inspection.publisher?.publicKey).toBe(source.publishers.self().publicKey);
    expect(inspection.publisher?.trust).toBe("unknown");
    expect(inspection.publisher?.self).toBe(false);
    // And the same package inspected at home is recognised as one's own.
    expect((await inspectPackage(source, path)).publisher?.self).toBe(true);
  });

  it("the private key is nowhere in SQLite, in a package, or in the manifest", async () => {
    const store = new MemorySigningKeyStore();
    const g = ObjectGraph.open({ dbPath: join(dir, "c.db"), blobDir: join(dir, "c-blobs"), signingKeys: store });
    const w = g.createWorld({ title: "W", emoji: "W" }).id;
    const objectId = g.createObject({ worldId: w, semanticType: "note", title: "N" }).object.id;
    const rep = g.addRepresentation({ objectId, modality: "text", format: "md",
      blobHash: g.putBlob(Buffer.from("n"), "text/markdown", "md"), provenance: "human" });
    g.commitVersion({ objectId, forms: [{ role: "doc.primary", representationId: rep.id }] });
    const path = join(dir, "own.xeniur");
    const { manifest } = await exportPackage(g, objectId, path);
    const priv = store.load()!.privateKey;
    expect(priv.length).toBeGreaterThan(20);
    expect(JSON.stringify(manifest)).not.toContain(priv);
    // Every text column of every table.
    const tables = (g.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>)
      .map((t) => t.name);
    for (const t of tables) {
      const rows = g.db.prepare(`SELECT * FROM "${t}"`).all();
      expect(JSON.stringify(rows), `table ${t}`).not.toContain(priv);
    }
    g.close();
  });
});

describe("a package is refused before anything is written", () => {
  it("unsigned: the manifest has no publisher", async () => {
    const { path } = await packageOf("Rocket", "rocket.xeniur");
    const bad = tamper(path, (m) => { delete m["publisher"]; }, "unsigned.xeniur");
    const before = rowCounts(target);
    const inspection = await inspectPackage(target, bad);
    expect(inspection.ok).toBe(false);
    expect(inspection.problems.join(" ")).toMatch(/not signed/);
    await expect(importPackage(target, bad)).rejects.toBeInstanceOf(PackageRefused);
    expect(rowCounts(target)).toEqual(before);
  });

  it("tampered: one field changed after signing", async () => {
    const { path } = await packageOf("Rocket", "rocket.xeniur");
    const bad = tamper(path, (m) => { (m["object"] as Record<string, unknown>)["title"] = "Trojan"; }, "tampered.xeniur");
    const before = rowCounts(target);
    const inspection = await inspectPackage(target, bad);
    expect(inspection.ok).toBe(false);
    expect(inspection.problems.join(" ")).toMatch(/altered after it was signed/);
    await expect(importPackage(target, bad)).rejects.toBeInstanceOf(PackageRefused);
    expect(rowCounts(target)).toEqual(before);
  });

  it("re-signed by someone else: the signature verifies but does not match the claimed root", async () => {
    const { path } = await packageOf("Rocket", "rocket.xeniur");
    const impostor = PublisherIdentity.load(new MemorySigningKeyStore(), "Not Samir");
    const bad = tamper(path, (m) => {
      (m["object"] as Record<string, unknown>)["title"] = "Trojan";
      // Signs the *old* root hash: verifies as a signature, but the contents moved.
      m["publisher"] = impostor.sign((m["publisher"] as { rootHash: string }).rootHash);
    }, "resigned.xeniur");
    expect((await inspectPackage(target, bad)).ok).toBe(false);
    // A properly re-signed package over the new contents is a different publisher's package,
    // which is allowed — identity is the key, not the name.
    const honest = tamper(path, (m) => {
      (m["object"] as Record<string, unknown>)["title"] = "Fork";
      delete m["publisher"];
      m["publisher"] = impostor.sign(packageRootHash(m));
    }, "fork.xeniur");
    const ok = await inspectPackage(target, honest);
    expect(ok.ok).toBe(true);
    expect(ok.publisher?.displayName).toBe("Not Samir");
  });

  it("blocked publisher: refused before inspection, contents never read", async () => {
    const { path } = await packageOf("Rocket", "rocket.xeniur");
    target.publishers.block(source.publishers.self().ref());
    const before = rowCounts(target);
    const inspection = await inspectPackage(target, path);
    expect(inspection.ok).toBe(false);
    expect(inspection.problems[0]).toMatch(/you have blocked/);
    expect(inspection.problems[0]).toMatch(/before inspection/);
    expect(inspection.manifest).toBeNull();
    expect(inspection.contents.versions).toBe(0);
    expect(inspection.publisher?.trust).toBe("blocked");
    await expect(importPackage(target, path)).rejects.toBeInstanceOf(PackageRefused);
    expect(rowCounts(target)).toEqual(before);
  });
});

describe("rate limits hold for publishers nobody here has judged", () => {
  it("an unknown publisher gets three a day; the fourth is refused with nothing written", async () => {
    const paths = await Promise.all(["A", "B", "C", "D"].map((t) => packageOf(t, `${t}.xeniur`)));
    for (const p of paths.slice(0, 3)) await importPackage(target, p.path);
    const before = rowCounts(target);
    await expect(importPackage(target, paths[3]!.path)).rejects.toBeInstanceOf(ImportRateExceeded);
    expect(rowCounts(target)).toEqual(before);
    const view = target.publishers.view(source.publishers.self().ref());
    expect(view.importsToday).toBe(3);
    expect(view.dailyLimit).toBe(3);

    // The person marks them known, and the fourth goes through.
    target.publishers.setTrust(source.publishers.self().ref(), "known");
    await importPackage(target, paths[3]!.path);
    expect(target.publishers.view(source.publishers.self().ref()).importsToday).toBe(4);
  });

  it("one's own packages are never limited", async () => {
    // A second machine holding the same signing key is the same publisher.
    const store = new MemorySigningKeyStore();
    source.publishers.self();
    const g2 = ObjectGraph.open({ dbPath: join(dir, "self.db"), blobDir: join(dir, "self-blobs"), signingKeys: store });
    const paths = await Promise.all(["A", "B", "C", "D", "E"].map((t) => packageOf(t, `${t}.xeniur`)));
    // Copy the identity across: the graph's store is private, so go through the package's
    // own publisher block plus the source store, which the test owns.
    const own = (source as unknown as { publishers: { keys: MemorySigningKeyStore } }).publishers.keys.load()!;
    store.save(own);
    for (const p of paths) await importPackage(g2, p.path);       // five, past the unknown limit
    expect(g2.publishers.view(source.publishers.self().ref()).self).toBe(true);
    expect(g2.publishers.view(source.publishers.self().ref()).importsToday).toBe(5);
    g2.close();
  });

  it("trust is set by a person, defaults to unknown, and reports are recorded", () => {
    const ref = source.publishers.self().ref();
    expect(target.publishers.trustOf(ref.publicKey)).toBe("unknown");
    target.publishers.setTrust(ref, "trusted");
    expect(target.publishers.trustOf(ref.publicKey)).toBe("trusted");
    expect(target.publishers.view(ref).dailyLimit).toBeNull();
    const row = target.db.prepare(`SELECT set_by FROM publisher_trust WHERE publisher_id = ?`).get(ref.publicKey) as { set_by: string };
    expect(row.set_by).toBe("human");
    const r = target.publishers.report(ref, "spam", { note: "forty critique packages in an hour" });
    expect(target.publishers.reportsOn(ref.publicKey)).toEqual([r]);
  });
});
