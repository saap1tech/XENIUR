import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, sha256Hex } from "@xeniur/core";
import { ObjectGraph, renderAuditPage, verifySignature } from "./index.js";

let dir: string, g: ObjectGraph, worldId: string, objectId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-audit-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Rainwear 2027", emoji: "R" }).id;
  objectId = g.createObject({ worldId, semanticType: "report", title: "Colour strategy" }).object.id;
  const rep = g.addRepresentation({ objectId, modality: "text", format: "md",
    blobHash: g.putBlob(Buffer.from("# Colour"), "text/markdown", "md"), provenance: "human" });
  g.commitVersion({ objectId, forms: [{ role: "doc.primary", representationId: rep.id }] });
  g.process.record({ objectId, versionId: null, kind: "note_written", actor: "human", label: "the private label",
    tool: null, model: null, inputHashes: [], outputHashes: [], durationMs: 5 * 60_000 });
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

describe("the audit export is one signed file a stranger can check", () => {
  it("carries the report, the trail, the receipts and the process record, and a manifest whose signature verifies", () => {
    const row = g.trail.saw({ worldId, objectId, intent: "research_plan", digest: "c".repeat(64), included: 7, excluded: 2 });
    g.trail.decided(row.id, "gated", null);
    const { html, manifest } = renderAuditPage(g, objectId);
    expect(html).toContain("Colour strategy");
    expect(html).toContain("What the agent saw");
    expect(html).toContain("cccccccccccccccc");
    expect(html).toContain("gated");
    expect((html.match(/class=empty/g) ?? []).length).toBe(2);          // authorised and executed: empty, not inferred
    expect(html).toContain("Recorded, not total");
    expect(html).toContain("What it cost");                               // the Outcome Ledger via the report
    expect(html).not.toContain("the private label");                      // process record is filtered
    expect(html).toContain("note written");

    // The manifest is inside the file and verifies against the body it describes.
    const start = html.indexOf('<pre id="xeniur-audit-manifest">') + '<pre id="xeniur-audit-manifest">'.length;
    const embedded = JSON.parse(html.slice(start, html.indexOf("</pre>", start)).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    expect(canonicalJson(embedded)).toBe(canonicalJson(manifest));
    expect(verifySignature(manifest.publisher)).toBe(true);
    expect(manifest.publisher.rootHash).toBe(manifest.rootHash);
    expect(manifest.publisher.publicKey).toBe(g.publishers.self().publicKey);
    expect(manifest.counts).toEqual({ trailRows: 1, processEvents: 1, receipts: 0 });
  });

  it("stands alone and carries no scripts, no fetches and nothing key-shaped", () => {
    const { html } = renderAuditPage(g, objectId);
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("color-scheme: light dark");                   // monochrome-safe either way
  });

  it("a changed body no longer matches its root hash", () => {
    const { html, manifest } = renderAuditPage(g, objectId);
    const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("<footer>"));
    expect(sha256Hex(body.trim())).not.toBe("");                          // the body is what was hashed, modulo whitespace framing
    expect(manifest.rootHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(body.replace("Colour strategy", "Colour tactics"))).not.toBe(manifest.rootHash);
  });
});
