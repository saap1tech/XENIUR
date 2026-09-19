import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OutreachEnvelopeSchema, OutsideCampaign, authorizeFor, campaignPlan, campaignScope, needsCampaign, type OutreachEnvelopeInput,
} from "@xeniur/core";
import { DisabledTransport, MockTransport, ObjectGraph } from "./index.js";

let dir: string, g: ObjectGraph, worldId: string, templateId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xeniur-outreach-"));
  g = ObjectGraph.open({ dbPath: ":memory:", blobDir: join(dir, "blobs") });
  worldId = g.createWorld({ title: "Rainwear", emoji: "R" }).id;
  templateId = g.createObject({ worldId, semanticType: "document", title: "Interview invitation" }).object.id;
});
afterEach(() => { g.close(); rmSync(dir, { recursive: true, force: true }); });

const envelope = (over: Partial<OutreachEnvelopeInput> = {}): OutreachEnvelopeInput => ({
  purpose: "invite pilot customers to a 20-minute interview",
  templateObjectId: templateId,
  recipients: { kind: "list", addresses: ["ana@example.com", "bo@example.com", "cy@example.com"] },
  maxSends: 2,
  expiresAt: Date.now() + 60 * 60_000,
  dataAllowed: ["recipient.name"],
  transport: "mail",
  ...over,
});
/** The approval a person gives on the review sheet: over exactly this envelope. */
const approve = (e: OutreachEnvelopeInput) => {
  const full = OutreachEnvelopeSchema.parse(e);
  return authorizeFor(campaignPlan(full), { scope: campaignScope(full), ttlMs: 60 * 60_000 });
};
const msg = (to: string, fields: Record<string, string> = { "recipient.name": to.split("@")[0]! }) => ({
  to, subject: "A 20-minute conversation?", body: "We are choosing a colour and would value your view.", fields,
});

describe("a campaign is one approval over one envelope", () => {
  it("two recipients or a domain need a campaign; one does not", () => {
    expect(needsCampaign({ kind: "list", addresses: ["ana@example.com"] })).toBe(false);
    expect(needsCampaign({ kind: "list", addresses: ["ana@example.com", "bo@example.com"] })).toBe(true);
    expect(needsCampaign({ kind: "domain", domain: "example.com" })).toBe(true);
  });

  it("refuses an approval that does not cover this exact envelope", () => {
    const e = envelope();
    const other = approve(envelope({ maxSends: 50 }));
    expect(() => g.outreach.create(worldId, e, other)).toThrow(OutsideCampaign);
    expect(g.outreach.list(worldId)).toHaveLength(0);
    const c = g.outreach.create(worldId, e, approve(e));
    expect(c.state).toBe("active");
    expect(c.sent).toBe(0);
  });
});

describe("every send is inside the envelope, and every send is receipted", () => {
  it("sends inside the set, up to the cap, then refuses — each with a receipt", async () => {
    const e = envelope();
    const c = g.outreach.create(worldId, e, approve(e));
    const t = new MockTransport();
    const a = await g.outreach.send(c.id, msg("ana@example.com"), t);
    const b = await g.outreach.send(c.id, msg("bo@example.com"), t);
    expect([a.outcome, b.outcome]).toEqual(["sent", "sent"]);
    expect(t.sent).toHaveLength(2);
    expect(g.outreach.get(c.id)!.state).toBe("exhausted");

    const over = await g.outreach.send(c.id, msg("cy@example.com"), t);
    expect(over.outcome).toBe("refused");
    expect(over.reason).toMatch(/exhausted|sends are used/);
    expect(t.sent).toHaveLength(2);                                   // transport never touched

    // Three attempts, three receipts, three sends rows; the refusal is in the record.
    const sends = g.outreach.sendsOf(c.id);
    expect(sends.map((s) => s.outcome)).toEqual(["sent", "sent", "refused"]);
    for (const s of [a, b, over]) {
      const receipt = g.actionReceipts.getByAction(s.actionId)!;
      expect(receipt.objectId).toBe(s.receiptObjectId);
      expect(receipt.capability).toBe("outreach.send");
    }
    const refusedReceipt = g.actionReceipts.getByAction(over.actionId)!;
    expect(refusedReceipt.outcome).toBe("refused");
    expect(refusedReceipt.destination).toBe("cy@example.com");
  });

  it("refuses a recipient outside the set, and data not allowed to leave, before the transport", async () => {
    const e = envelope();
    const c = g.outreach.create(worldId, e, approve(e));
    const t = new MockTransport();
    const stranger = await g.outreach.send(c.id, msg("zed@elsewhere.org"), t);
    expect(stranger.outcome).toBe("refused");
    expect(stranger.reason).toMatch(/not in the campaign/);
    const leak = await g.outreach.send(c.id, msg("ana@example.com", { "recipient.name": "Ana", "project.budget": "€80k" }), t);
    expect(leak.outcome).toBe("refused");
    expect(leak.reason).toMatch(/project\.budget may not leave/);
    expect(t.sent).toHaveLength(0);
    expect(g.outreach.get(c.id)!.sent).toBe(0);
  });

  it("a domain campaign admits anyone at the domain and nobody else", async () => {
    const e = envelope({ recipients: { kind: "domain", domain: "example.com" }, maxSends: 10 });
    const c = g.outreach.create(worldId, e, approve(e));
    const t = new MockTransport();
    expect((await g.outreach.send(c.id, msg("someone@example.com"), t)).outcome).toBe("sent");
    expect((await g.outreach.send(c.id, msg("someone@example.com.evil.io"), t)).outcome).toBe("refused");
    expect((await g.outreach.send(c.id, msg("someone@sub.example.com"), t)).outcome).toBe("refused");
  });

  it("refuses past expiry, and after revocation", async () => {
    const e = envelope({ maxSends: 10 });
    const c = g.outreach.create(worldId, e, approve(e));
    const t = new MockTransport();
    g.db.prepare(`UPDATE outreach_campaigns SET envelope = json_set(envelope, '$.expiresAt', ?) WHERE id = ?`)
      .run(Date.now() - 1, c.id);
    // The stored envelope changed, so the approval no longer matches it either: refused on
    // authorisation, which is the stricter reason and the right one.
    const late = await g.outreach.send(c.id, msg("ana@example.com"), t);
    expect(late.outcome).toBe("refused");
    expect(t.sent).toHaveLength(0);

    const e2 = envelope({ maxSends: 10 });
    const c2 = g.outreach.create(worldId, e2, approve(e2));
    g.outreach.revoke(c2.id);
    const after = await g.outreach.send(c2.id, msg("ana@example.com"), t);
    expect(after.outcome).toBe("refused");
    expect(after.reason).toMatch(/revoked/);
  });

  it("the receipt carries the recipient and digests, never the words", async () => {
    const e = envelope();
    const c = g.outreach.create(worldId, e, approve(e));
    const r = await g.outreach.send(c.id, msg("ana@example.com", { "recipient.name": "Ana" }), new MockTransport());
    const receipt = g.actionReceipts.getByAction(r.actionId)!;
    expect(receipt.destination).toBe("ana@example.com");
    expect(receipt.dataSent.map((d) => d.name).sort()).toEqual(["body", "recipient.name", "subject"]);
    const text = JSON.stringify(receipt);
    expect(text).not.toContain("20-minute conversation");
    expect(text).not.toContain("choosing a colour");
    expect(text).not.toContain('"Ana"');
    expect(receipt.providerResponse?.reference).toBe("mock-1");
  });
});

describe("no transport is reachable without a configured key", () => {
  it("a disabled transport fails the send before anything leaves, and says why", async () => {
    const e = envelope();
    const c = g.outreach.create(worldId, e, approve(e));
    const r = await g.outreach.send(c.id, msg("ana@example.com"), new DisabledTransport());
    expect(r.outcome).toBe("failed");
    expect(r.reason).toMatch(/no key configured/);
    expect(g.outreach.get(c.id)!.sent).toBe(0);
    expect(g.actionReceipts.getByAction(r.actionId)!.outcome).toBe("failed");
  });

  it("a transport that does not answer clearly leaves an unknown receipt, never an assumed send", async () => {
    const e = envelope();
    const c = g.outreach.create(worldId, e, approve(e));
    const r = await g.outreach.send(c.id, msg("ana@example.com"), new MockTransport({ fail: true }));
    expect(r.outcome).toBe("failed");
    expect(g.actionReceipts.getByAction(r.actionId)!.outcome).toBe("failed");
    expect(g.outreach.get(c.id)!.sent).toBe(0);
  });
});
