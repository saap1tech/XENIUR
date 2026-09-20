import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChallengeRulesInput } from "@xeniur/core";
import { MemorySigningKeyStore, documentDigest } from "@xeniur/core";
import { ObjectGraph, PublisherIdentity } from "./index.js";

/**
 * Distribution: a challenge travels as a signed document and is quarantined by its
 * publisher's trust; an entry ticket is signed by the organizer elsewhere and spent once
 * here. Nothing in either path knows a price.
 */
const DAY = 86_400_000;
let dir: string, organizer: ObjectGraph, participant: ObjectGraph;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-tickets-"));
  organizer = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "a") });
  participant = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "b") });
});
afterEach(() => { organizer.close(); participant.close(); rmSync(dir, { recursive: true, force: true }); });

const rules = (over: Partial<ChallengeRulesInput> = {}): ChallengeRulesInput => ({
  title: "Water · Sun · Digital", brief: "Cut the energy cost of a litre of desalinated water.",
  rules: ["one entry per team"], startsAt: Date.now() - DAY, endsAt: Date.now() + 6 * DAY,
  deliverable: { formRoles: ["doc.proposal"], description: "a proposal" },
  judging: { criteria: ["works on the stated problem"], by: "panel" },
  aiPolicy: "research_only", entry: "ticket", entryNote: "DZD 1,500 via the organizer; waivers on request", ...over,
});

describe("a challenge travels as a signed document", () => {
  it("exports, verifies on another machine, becomes a World there, and is never adopted twice", () => {
    const c = organizer.challenges.create(rules(), organizer.publishers.self());
    const doc = organizer.challenges.exportDocument(c.worldId)!;
    expect(doc.kind).toBe("xeniur.challenge/1");
    const adopted = participant.challenges.adoptDocument(doc)!;
    expect(adopted.rules.title).toBe("Water · Sun · Digital");
    expect(participant.getWorld(adopted.worldId)!.kind).toBe("challenge");
    expect(participant.challenges.adoptDocument(doc)).toBeNull();          // already here
    expect(participant.publishers.trustOf(c.publisher.publicKey)).toBe("unknown");
  });

  it("refuses a tampered document, and quarantines an unknown publisher at three a day", () => {
    const c = organizer.challenges.create(rules(), organizer.publishers.self());
    const doc = organizer.challenges.exportDocument(c.worldId)!;
    const tampered = { ...doc, body: { ...doc.body, rules: { ...doc.body.rules, aiPolicy: "unrestricted" as const } } };
    expect(() => participant.challenges.adoptDocument(tampered)).toThrow(/do not verify/);
    for (let i = 0; i < 3; i += 1) {
      const more = organizer.challenges.create(rules({ title: `Edition ${i}` }), organizer.publishers.self());
      participant.challenges.adoptDocument(organizer.challenges.exportDocument(more.worldId)!);
    }
    expect(() => participant.challenges.adoptDocument(doc)).toThrow(/3/);
    participant.publishers.setTrust(c.publisher, "trusted");
    expect(participant.challenges.adoptDocument(doc)!.rules.title).toBe("Water · Sun · Digital");
  });

  it("a blocked publisher's challenges never arrive", () => {
    const c = organizer.challenges.create(rules(), organizer.publishers.self());
    participant.publishers.block(c.publisher);
    expect(() => participant.challenges.adoptDocument(organizer.challenges.exportDocument(c.worldId)!)).toThrow();
  });
});

describe("entry tickets", () => {
  function distributed() {
    const c = organizer.challenges.create(rules(), organizer.publishers.self());
    const doc = organizer.challenges.exportDocument(c.worldId)!;
    const here = participant.challenges.adoptDocument(doc)!;
    const me = participant.publishers.self().ref();
    const objectId = participant.createObject({ worldId: here.worldId, semanticType: "proposal", title: "Leak finder" }).object.id;
    return { c, here, me, objectId };
  }

  it("a ticketed challenge refuses entry without a ticket, in words", () => {
    const { here, me, objectId } = distributed();
    expect(() => participant.challenges.enter(here.worldId, objectId, me)).toThrow(/needs an entry ticket/);
  });

  it("the organizer issues a signed ticket; it verifies here, is spent once on entering, and re-entering the same Object needs no second ticket", () => {
    const { c, here, me, objectId } = distributed();
    const ticket = organizer.tickets.issue(c.worldId, me, Date.now() + 5 * DAY);
    expect(ticket.kind).toBe("xeniur.ticket/1");
    expect(ticket.signature.rootHash).toBe(documentDigest(ticket.body));
    expect(JSON.stringify(ticket)).not.toMatch(/price|amount|DZD|card|paid/i);
    participant.tickets.adopt(ticket);
    expect(participant.tickets.held(here.worldId)!.valid).toBe(true);
    const entry = participant.challenges.enter(here.worldId, objectId, me);
    expect(entry.objectId).toBe(objectId);
    expect(participant.tickets.held(here.worldId)!.usedAt).not.toBeNull();
    // The same entry re-evaluated or re-entered: the ticket was for the participant, not per click.
    expect(() => participant.challenges.enter(here.worldId, objectId, me)).not.toThrow();
    // A second Object would be a second entry and needs a ticket that is not spent.
    const other = participant.createObject({ worldId: here.worldId, semanticType: "proposal", title: "Second" }).object.id;
    expect(() => participant.challenges.enter(here.worldId, other, me)).toThrow(/already used/);
  });

  it("refuses a ticket for someone else, one from a stranger, and one that expired", () => {
    const { c, here, me } = distributed();
    const stranger = PublisherIdentity.load(new MemorySigningKeyStore(), "Stranger");
    const forged = { ...organizer.tickets.issue(c.worldId, me, Date.now() + DAY) };
    forged.signature = stranger.sign(forged.signature.rootHash);
    expect(() => participant.tickets.adopt(forged)).toThrow(/does not verify/);
    const someoneElse = organizer.tickets.issue(c.worldId, { publicKey: "X".repeat(43), displayName: "Else" }, Date.now() + DAY);
    expect(() => participant.tickets.adopt(someoneElse)).toThrow(/someone else/);
    const expired = organizer.tickets.issue(c.worldId, me, Date.now() + 1);
    participant.tickets.adopt(expired);
    participant.db.prepare(`UPDATE entry_tickets SET expires_at = ? WHERE challenge_world_id = ?`).run(Date.now() - 1, here.worldId);
    expect(participant.tickets.held(here.worldId)!.valid).toBe(false);
    expect(() => participant.tickets.use(here.worldId, me.publicKey)).toThrow(/expired/);
  });

  it("only the challenge's publisher issues tickets; an open challenge needs none", () => {
    const { here, me } = distributed();
    expect(() => participant.tickets.issue(here.worldId, me, Date.now() + DAY)).toThrow(/publisher/);
    const open = organizer.challenges.create(rules({ entry: "open", title: "Open one" }), organizer.publishers.self());
    const openHere = participant.challenges.adoptDocument(organizer.challenges.exportDocument(open.worldId)!)!;
    const objectId = participant.createObject({ worldId: openHere.worldId, semanticType: "proposal", title: "Free" }).object.id;
    expect(() => participant.challenges.enter(openHere.worldId, objectId, me)).not.toThrow();
  });

  it("tickets.ts knows no price, card or payment", () => {
    const src = readFileSync(join(__dirname, "tickets.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of ["price", "amount", "card", "payment", "stripe", "chargily", "usd", "dzd"]) {
      expect(src.toLowerCase(), `tickets.ts must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });
});
