import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANNOT_ESTABLISH, checkAiPolicy, describeEnvelope, recordDensity, type ModeEnvelopeInput } from "@xeniur/core";
import { ObjectGraph } from "./index.js";

/**
 * The Sealed Session records; it does not watch. Heartbeats, edit origins and model calls
 * are rows; the facts are read from them; a gap or a paste can make the record say less,
 * never more. The emergency exit exists here like in every mode, and is a fact for judges.
 */
const MIN = 60_000;
let dir: string, g: ObjectGraph, worldId: string, entry: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-seal-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Water · Sun · Digital", emoji: "◷", kind: "challenge" }).id;
  entry = g.createObject({ worldId, semanticType: "proposal", title: "Leak finder" }).object.id;
  // The entry existed before any seal in these tests began.
  g.db.prepare(`UPDATE versions SET created_at = ? WHERE object_id = ?`).run(Date.now() - 3 * 60 * MIN, entry);
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const envelope = (over: Partial<ModeEnvelopeInput> = {}): ModeEnvelopeInput => ({
  durationMinutes: 120, restrictions: ["remote models off"], exitPolicy: "always",
  remoteModels: false, entryObjectId: entry, heartbeatSeconds: 60, ...over,
});
const seal = (startedAt: number) => {
  const sheet = describeEnvelope("sealed_session", envelope());
  const mode = g.modes.start({ kind: "sealed_session", envelope: envelope(), sheetDigest: sheet.digest, worldId });
  g.db.prepare(`UPDATE modes SET started_at = ? WHERE id = ?`).run(startedAt, mode.id);
  return mode.id;
};
const commit = (at: number) => {
  const rep = g.addRepresentation({ objectId: entry, modality: "text", format: "md", provenance: "human", blobHash: g.putBlob(Buffer.from(`v${at}`), "text/markdown", "md") });
  const v = g.commitVersion({ objectId: entry, forms: [{ role: "doc.proposal", representationId: rep.id }] });
  g.db.prepare(`UPDATE versions SET created_at = ? WHERE id = ?`).run(at, v.versionId);
  return v.versionId;
};

describe("the sheet says what is recorded before anything is", () => {
  it("names remote models off, the heartbeat, what is not recorded, and the exit", () => {
    const sheet = describeEnvelope("sealed_session", envelope());
    const text = sheet.lines.map((l) => `${l.label}: ${l.value}`).join("\n");
    expect(sheet.name).toBe("Sealed Session");
    expect(sheet.verb).toBe("Seal the session");
    expect(text).toMatch(/Remote models: none/);
    expect(text).toMatch(/heartbeat every 60 s/);
    expect(text).toMatch(/Not recorded: your screen, other applications/);
    expect(text).toMatch(/never a score/);
    expect(sheet.exit).toMatch(/leave at any moment/);
  });

  it("a seal cannot start from an envelope that was not shown, like every mode", () => {
    expect(() => g.modes.start({ kind: "sealed_session", envelope: envelope(), sheetDigest: "nope", worldId })).toThrow(/not shown/);
  });
});

describe("gaps and pastes are read from rows", () => {
  it("a 20-minute gap across a version change is a gap the record does not say about", () => {
    const t0 = Date.now() - 60 * MIN;
    const id = seal(t0);
    for (let m = 1; m <= 10; m += 1) g.seal.beat({ modeId: id, focusObjectId: entry, versionId: null, at: t0 + m * MIN });
    commit(t0 + 20 * MIN);                                              // made in the dark
    for (let m = 30; m <= 40; m += 1) g.seal.beat({ modeId: id, focusObjectId: entry, versionId: null, at: t0 + m * MIN });
    g.modes.end(id, "completed");
    g.db.prepare(`UPDATE modes SET ended_at = ? WHERE id = ?`).run(t0 + 40 * MIN, id);

    const f = g.seal.factsFor(entry)!;
    expect(f.heartbeats).toBe(21);
    expect(f.gaps).toHaveLength(1);
    expect(f.gaps[0]).toMatchObject({ minutes: 20, versionChanged: true });
    expect(f.recordedMinutes).toBe(20);
    expect(f.sessionMinutes).toBe(40);
    expect(f.modelEvents).toBe(0);
    expect(recordDensity(f).sentence).toBe("20 of 40 minutes recorded · 1 gap (1 across a version change) · no unexplained pastes · ran to the end");
  });

  it("a gap with no version change is a gap, not a gap across a version change", () => {
    const t0 = Date.now() - 30 * MIN;
    const id = seal(t0);
    g.seal.beat({ modeId: id, focusObjectId: entry, versionId: null, at: t0 + MIN });
    g.seal.beat({ modeId: id, focusObjectId: entry, versionId: null, at: t0 + 10 * MIN });
    const f = g.seal.facts(id)!;
    expect(f.gaps.map((x) => x.versionChanged)).toEqual([false, false]);      // the 9-minute span, and start→now tail
  });

  it("a paste of 400+ characters with no Source Object is unexplained; with one, or smaller, it is not", () => {
    const t0 = Date.now() - 10 * MIN;
    const id = seal(t0);
    const v = commit(t0 + MIN);
    const source = g.createObject({ worldId, semanticType: "source", title: "Field notes" }).object.id;
    g.process.recordPaste({ objectId: entry, versionId: v, chars: 1200, at: t0 + 2 * MIN });
    g.process.recordPaste({ objectId: entry, versionId: v, chars: 1200, sourceObjectId: source, at: t0 + 3 * MIN });
    g.process.recordPaste({ objectId: entry, versionId: v, chars: 80, at: t0 + 4 * MIN });
    const f = g.seal.facts(id)!;
    expect(f.unexplainedPastes).toHaveLength(1);
    expect(f.unexplainedPastes[0]!.chars).toBe(1200);
    const events = g.process.events(entry);
    expect(events.filter((e) => e.origin === "pasted")).toHaveLength(3);
    expect(events.every((e) => e.actor === "human")).toBe(true);                // a paste is never a model event
  });

  it("heartbeats after the mode ended, or for another kind, are not written", () => {
    const id = seal(Date.now() - MIN);
    g.modes.end(id, "left");
    g.seal.beat({ modeId: id, focusObjectId: entry, versionId: null });
    expect(g.seal.facts(id)!.heartbeats).toBe(0);
  });
});

describe("the seal can only lower a verdict", () => {
  const clean = { events: [{ kind: "manual_edit" as const, actor: "human" as const, tool: null, model: null, label: "edit" }],
    representations: [{ id: "r", modality: "text", provenance: "human" as const, formRole: "doc.proposal", tool: null }] };

  it("a 20-minute gap across a version change lowers complies to insufficient_record with zero model events", () => {
    const t0 = Date.now() - 60 * MIN;
    const id = seal(t0);
    g.seal.beat({ modeId: id, focusObjectId: entry, versionId: null, at: t0 + MIN });
    commit(t0 + 10 * MIN);
    g.seal.beat({ modeId: id, focusObjectId: entry, versionId: null, at: t0 + 21 * MIN });
    const f = g.seal.facts(id)!;
    expect(f.modelEvents).toBe(0);
    const c = checkAiPolicy(clean, "human_only", f);
    expect(c.verdict).toBe("insufficient_record");
    expect(c.because[0]).toMatch(/the record does not say: 20 min with no heartbeat .* across a version change/);
    expect(c.density?.gapsAcrossVersionChange).toBe(1);
  });

  it("an unexplained paste lowers complies to insufficient_record and never to violates", () => {
    const t0 = Date.now() - 10 * MIN;
    const id = seal(t0);
    const v = commit(t0 + MIN);
    g.process.recordPaste({ objectId: entry, versionId: v, chars: 900, at: t0 + 2 * MIN });
    for (let m = 1; m <= 9; m += 1) g.seal.beat({ modeId: id, focusObjectId: entry, versionId: v, at: t0 + m * MIN });
    const c = checkAiPolicy(clean, "human_only", g.seal.facts(id)!);
    expect(c.verdict).toBe("insufficient_record");
    expect(c.because[0]).toMatch(/900 characters pasted with no Source Object/);
  });

  it("violates stays violates — the model event earned it, the seal only adds density", () => {
    const t0 = Date.now() - 10 * MIN;
    const id = seal(t0);
    const c = checkAiPolicy({ ...clean, events: [...clean.events, { kind: "model_step", actor: "model", tool: "doc.write", model: "m", label: "wrote" }] }, "human_only", g.seal.facts(id)!);
    expect(c.verdict).toBe("violates");
    expect(c.density).toBeDefined();
  });

  it("a dense, clean seal leaves complies as complies and carries its density", () => {
    const t0 = Date.now() - 10 * MIN;
    const id = seal(t0);
    for (let m = 1; m <= 10; m += 1) g.seal.beat({ modeId: id, focusObjectId: entry, versionId: null, at: t0 + m * MIN });
    const c = checkAiPolicy(clean, "human_only", g.seal.facts(id)!);
    expect(c.verdict).toBe("complies");
    expect(c.density?.gaps).toBe(0);
    expect(c.density?.sentence).toMatch(/still running/);
  });

  it("the challenge store reads the seal for an entry, and an emergency exit is a fact, not a verdict", () => {
    const t0 = Date.now() - 10 * MIN;
    const id = seal(t0);
    g.modes.emergencyExit(id);
    const f = g.seal.factsFor(entry)!;
    expect(f.exitReason).toBe("emergency");
    expect(recordDensity(f).sentence).toMatch(/left by the emergency exit/);
    expect(CANNOT_ESTABLISH).toMatch(/not independently verified/);
  });
});

describe("the seal never reads engagement", () => {
  it("seal.ts contains no reference to sessions, events, clicks, dwell or return", () => {
    const src = readFileSync(join(__dirname, "seal.ts"), "utf8");
    for (const forbidden of [
      "session_events", "SessionEvent", "MetricsStore", "metrics.js", "activeMs", "active_ms",
      "waitingMs", "waiting_ms", "FROM sessions", "dwell", "click", "returned", "gesture_used", "typed_instead",
      "screenshot", "title", "clipboard",
    ]) {
      expect(src, `seal.ts must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });
});
