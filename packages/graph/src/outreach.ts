import type {
  ActionPlan, Authorization, CampaignRecord, CampaignState, OutboundMessage, OutreachEnvelope, OutreachEnvelopeInput,
  OutreachTransport, Receipt, SentData,
} from "@xeniur/core";
import {
  OutreachEnvelopeSchema, OutsideCampaign, TransportUnavailable, assertAuthorizes, campaignPlan, campaignScope,
  newId, now, recipientAllowed, sha256Hex, zeroCost,
} from "@xeniur/core";
import type { Db } from "./db.js";
import type { ObjectGraph } from "./graph.js";

/**
 * Campaigns and sends.
 *
 * The authorisation is checked twice: once when the campaign is created (does this approval
 * cover exactly this envelope?) and again on every send (has it expired? is it still the
 * same envelope?). Then the send itself is checked against the envelope — recipient, cap,
 * expiry, which data may leave — and only then is the transport touched. A refusal at any
 * step is an action with a receipt whose outcome says refused: the audit trail records what
 * was *attempted*, not only what got through.
 */
export class OutreachStore {
  constructor(private readonly db: Db, private readonly graph: ObjectGraph) {}

  /** Records a campaign the person approved. The approval must be over exactly this envelope. */
  create(worldId: string, input: OutreachEnvelopeInput, authorization: Authorization): CampaignRecord {
    const envelope = OutreachEnvelopeSchema.parse(input);
    if (envelope.expiresAt <= now()) throw new OutsideCampaign("expired", "the campaign would already be over");
    try {
      assertAuthorizes(authorization, campaignPlan(envelope), campaignScope(envelope));
    } catch (err) {
      throw new OutsideCampaign("authorization", err instanceof Error ? err.message : "the approval does not cover this envelope");
    }
    const record: CampaignRecord = {
      id: newId(), worldId, envelope, authorization, sent: 0, state: "active", createdAt: now(),
    };
    this.db.prepare(
      `INSERT INTO outreach_campaigns (id, world_id, envelope, authorization, sent, state, created_at)
       VALUES (?, ?, ?, ?, 0, 'active', ?)`,
    ).run(record.id, worldId, JSON.stringify(envelope), JSON.stringify(authorization), record.createdAt);
    return record;
  }

  get(id: string): CampaignRecord | null {
    const row = this.db.prepare(`SELECT * FROM outreach_campaigns WHERE id = ?`).get(id) as Row | undefined;
    if (!row) return null;
    const record = fromRow(row);
    // Expiry is a fact about the clock, applied when read.
    if (record.state === "active" && record.envelope.expiresAt <= now()) {
      this.#setState(id, "expired");
      record.state = "expired";
    }
    return record;
  }

  list(worldId: string): CampaignRecord[] {
    return (this.db.prepare(`SELECT id FROM outreach_campaigns WHERE world_id = ? ORDER BY created_at DESC`)
      .all(worldId) as Array<{ id: string }>).map((r) => this.get(r.id)!);
  }

  revoke(id: string): CampaignRecord | null {
    this.#setState(id, "revoked");
    return this.get(id);
  }

  /**
   * One send. Refused before the transport is touched when it steps outside the envelope;
   * receipted either way.
   */
  async send(campaignId: string, message: OutboundMessage, transport: OutreachTransport): Promise<{
    outcome: "sent" | "refused" | "failed"; actionId: string; receiptObjectId: string; reason: string | null;
  }> {
    const campaign = this.get(campaignId);
    if (!campaign) throw new Error(`no such campaign: ${campaignId}`);
    const e = campaign.envelope;

    const plan: ActionPlan = {
      intent: `outreach: ${e.purpose}`, objects: [e.templateObjectId], tool: "outreach.send",
      args: { campaignId, to: message.to, purpose: e.purpose, transport: transport.id }, confirmation: false,
    };
    const action = this.graph.beginAction({
      worldId: campaign.worldId, intent: plan.intent, tool: "outreach.send", plan,
      permissionLevel: "COMMUNICATE", provenance: "human", provider: transport.id,
    });

    const refuse = (why: OutsideCampaign["why"], detail: string) => {
      this.graph.completeAction(action.id, { status: "refused", cost: zeroCost() });
      const receipt = this.graph.actionReceipts.record(action.id, this.#receipt(message, e, {
        outcome: "refused", providerResponse: { status: `refused: ${why}`, reference: null, digest: null },
      }));
      this.#recordSend(campaign.id, action.id, message.to, "refused");
      return { outcome: "refused" as const, actionId: action.id, receiptObjectId: receipt.objectId, reason: detail };
    };

    // The envelope, in the order a person would ask: is this still on? may they receive it?
    // is there room? may these words leave?
    if (campaign.state !== "active") return refuse("state", `the campaign is ${campaign.state}`);
    try {
      assertAuthorizes(campaign.authorization, campaignPlan(e), campaignScope(e));
    } catch (err) {
      return refuse("authorization", err instanceof Error ? err.message : "the approval no longer applies");
    }
    if (!recipientAllowed(e.recipients, message.to)) {
      return refuse("recipient", `${message.to} is not in the campaign's recipients`);
    }
    if (campaign.sent >= e.maxSends) return refuse("cap", `the campaign's ${e.maxSends} sends are used`);
    const notAllowed = Object.keys(message.fields).filter((k) => !e.dataAllowed.includes(k));
    if (notAllowed.length > 0) {
      return refuse("data", `${notAllowed.join(", ")} may not leave this machine under this campaign`);
    }
    if (!transport.configured()) {
      this.graph.failAction(action.id, new TransportUnavailable(transport.id).message);
      const receipt = this.graph.actionReceipts.record(action.id, this.#receipt(message, e, {
        outcome: "failed", providerResponse: { status: "transport not configured", reference: null, digest: null },
      }));
      this.#recordSend(campaign.id, action.id, message.to, "failed");
      return { outcome: "failed", actionId: action.id, receiptObjectId: receipt.objectId,
        reason: new TransportUnavailable(transport.id).message };
    }

    try {
      const response = await transport.send(message);
      this.graph.completeAction(action.id, { cost: zeroCost() });
      const receipt = this.graph.actionReceipts.record(action.id, this.#receipt(message, e, {
        outcome: "sent", providerResponse: { status: response.status, reference: response.reference, digest: null },
      }));
      this.db.transaction(() => {
        this.#recordSend(campaign.id, action.id, message.to, "sent");
        this.db.prepare(`UPDATE outreach_campaigns SET sent = sent + 1 WHERE id = ?`).run(campaign.id);
        if (campaign.sent + 1 >= e.maxSends) this.#setState(campaign.id, "exhausted");
      })();
      return { outcome: "sent", actionId: action.id, receiptObjectId: receipt.objectId, reason: null };
    } catch (err) {
      const detail = err instanceof Error ? err.message : "the transport failed";
      this.graph.failAction(action.id, detail);
      const receipt = this.graph.actionReceipts.record(action.id, this.#receipt(message, e, {
        // The transport was reached and did not answer clearly: unknown, never assumed sent.
        outcome: "unknown", providerResponse: { status: "no clear answer", reference: null, digest: null },
      }));
      this.#recordSend(campaign.id, action.id, message.to, "failed");
      return { outcome: "failed", actionId: action.id, receiptObjectId: receipt.objectId, reason: detail };
    }
  }

  sendsOf(campaignId: string): Array<{ actionId: string; recipient: string; outcome: string; at: number }> {
    return (this.db.prepare(`SELECT action_id, recipient, outcome, at FROM outreach_sends WHERE campaign_id = ? ORDER BY at`)
      .all(campaignId) as Array<{ action_id: string; recipient: string; outcome: string; at: number }>)
      .map((r) => ({ actionId: r.action_id, recipient: r.recipient, outcome: r.outcome, at: r.at }));
  }

  /** The receipt names the recipient and digests of what varied. Never the words themselves. */
  #receipt(message: OutboundMessage, e: OutreachEnvelope, over: Partial<Receipt> & { outcome: string }): Receipt {
    const dataSent: SentData[] = [
      { name: "subject", valueDigest: sha256Hex(message.subject), valueType: "string" },
      { name: "body", valueDigest: sha256Hex(message.body), valueType: "string" },
      ...Object.entries(message.fields).map(([name, value]) => ({
        name, valueDigest: sha256Hex(JSON.stringify(value)),
        valueType: (value === null ? "null" : typeof value) as SentData["valueType"],
      })),
    ];
    return {
      screenshotBlobHash: null, domDigest: null, url: null, params: { purpose: e.purpose }, sessionGrantId: null,
      attempted: `send to ${message.to} — ${e.purpose}`, planDigest: null, destination: message.to,
      dataSent, quotedPrice: null, actualPrice: null, providerResponse: null, at: now(),
      ...over,
    };
  }

  #recordSend(campaignId: string, actionId: string, recipient: string, outcome: "sent" | "refused" | "failed"): void {
    this.db.prepare(
      `INSERT INTO outreach_sends (id, campaign_id, action_id, recipient, outcome, at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId(), campaignId, actionId, recipient, outcome, now());
  }

  #setState(id: string, state: CampaignState): void {
    this.db.prepare(`UPDATE outreach_campaigns SET state = ? WHERE id = ? AND state = 'active'`).run(state, id);
  }
}

/** A transport with nothing behind it. What the desktop ships until a mail provider has a key. */
export class DisabledTransport implements OutreachTransport {
  readonly id = "mail";
  configured(): boolean { return false; }
  send(): Promise<{ status: string; reference: string | null }> {
    return Promise.reject(new TransportUnavailable(this.id));
  }
}

/** For tests and demos: records what it was asked to send and answers like a provider would. */
export class MockTransport implements OutreachTransport {
  readonly id = "mock.mail";
  readonly sent: OutboundMessage[] = [];
  constructor(private readonly opts: { configured?: boolean; fail?: boolean } = {}) {}
  configured(): boolean { return this.opts.configured ?? true; }
  async send(message: OutboundMessage): Promise<{ status: string; reference: string | null }> {
    if (this.opts.fail) throw new Error("mock provider timed out");
    this.sent.push(message);
    return { status: "accepted", reference: `mock-${this.sent.length}` };
  }
}

type Row = { id: string; world_id: string; envelope: string; authorization: string; sent: number; state: CampaignState; created_at: number };
const fromRow = (r: Row): CampaignRecord => ({
  id: r.id, worldId: r.world_id, envelope: OutreachEnvelopeSchema.parse(JSON.parse(r.envelope)),
  authorization: JSON.parse(r.authorization) as Authorization, sent: r.sent, state: r.state, createdAt: r.created_at,
});
