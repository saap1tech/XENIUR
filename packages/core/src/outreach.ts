import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";
import type { Authorization } from "./errors.js";
import { type PlanShape, planDigest } from "./authorization.js";

/**
 * Delegated outreach — the person authorises a bounded campaign once; every send inside it is
 * still a COMMUNICATE with an Action Receipt.
 *
 * The failure this exists to prevent is one vague approval covering many sends. So the
 * envelope names everything a send can vary in: who may receive, for what purpose, from
 * which template, how many at most, until when, and which fields of data may leave. A send
 * that steps outside any of these is refused before the transport is touched, and the
 * refusal is receipted too.
 *
 * One recipient for one purpose needs no campaign; a person can just send. Two or more, or a
 * whole domain, does.
 */
export const RecipientSetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), addresses: z.array(z.string().email()).min(1).max(500) }).strict(),
  z.object({ kind: z.literal("domain"), domain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i) }).strict(),
]);
export type RecipientSet = z.infer<typeof RecipientSetSchema>;

export const OutreachEnvelopeSchema = z.object({
  /** Why these people are being written to, in one sentence. Shown on every receipt. */
  purpose: z.string().min(3).max(200),
  /** The Document Object the message is drawn from. The same words go to everyone. */
  templateObjectId: UuidSchema,
  recipients: RecipientSetSchema,
  maxSends: z.number().int().min(1).max(500),
  expiresAt: TimestampSchema,
  /** Field names that may leave the machine, e.g. "recipient.name", "project.title". Nothing else does. */
  dataAllowed: z.array(z.string().min(1).max(60)).max(20).default([]),
  transport: z.literal("mail"),
}).strict();
export type OutreachEnvelope = z.infer<typeof OutreachEnvelopeSchema>;
export type OutreachEnvelopeInput = z.input<typeof OutreachEnvelopeSchema>;

export const CAMPAIGN_STATES = ["active", "exhausted", "expired", "revoked"] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export interface CampaignRecord {
  id: string;
  worldId: string;
  envelope: OutreachEnvelope;
  /** Approval for exactly this envelope, recorded once. Re-verified on every send. */
  authorization: Authorization;
  sent: number;
  state: CampaignState;
  createdAt: number;
}

/** A message as it leaves: the fields are what varied per recipient, and are receipted as digests. */
export interface OutboundMessage {
  to: string;
  subject: string;
  body: string;
  fields: Record<string, string | number | boolean | null>;
}

/**
 * The bounded plan the person approves. Its digest binds the approval to this exact
 * envelope, the same way a plan digest binds any other authorisation.
 */
export function campaignPlan(envelope: OutreachEnvelope): PlanShape {
  return {
    tool: "outreach.send",
    args: { campaign: envelope as unknown as Record<string, unknown> },
    destination: describeRecipients(envelope.recipients),
  };
}

export function campaignScope(envelope: OutreachEnvelope): string {
  return `outreach:${planDigest(campaignPlan(envelope)).slice(0, 16)}`;
}

export function describeRecipients(r: RecipientSet): string {
  return r.kind === "domain" ? `anyone at ${r.domain}` : `${r.addresses.length} named recipient${r.addresses.length === 1 ? "" : "s"}`;
}

/** Whether a set of recipients is big enough to need a campaign at all. */
export function needsCampaign(recipients: RecipientSet): boolean {
  return recipients.kind === "domain" || recipients.addresses.length > 1;
}

export function recipientAllowed(r: RecipientSet, address: string): boolean {
  const a = address.trim().toLowerCase();
  if (r.kind === "list") return r.addresses.some((x) => x.toLowerCase() === a);
  const at = a.lastIndexOf("@");
  return at > 0 && a.slice(at + 1) === r.domain.toLowerCase();
}

/** What a transport is. Disabled with an empty key: `configured()` false means nothing is reachable. */
export interface OutreachTransport {
  readonly id: string;
  configured(): boolean;
  send(message: OutboundMessage): Promise<{ status: string; reference: string | null }>;
}

export class OutsideCampaign extends Error {
  readonly code = "outside_campaign" as const;
  constructor(readonly why: "recipient" | "expired" | "cap" | "data" | "state" | "authorization", detail: string) {
    super(`refused: ${detail}`);
    this.name = "OutsideCampaign";
  }
}

export class TransportUnavailable extends Error {
  readonly code = "transport_unavailable" as const;
  constructor(id: string) {
    super(`the ${id} transport has no key configured, so nothing can be sent through it`);
    this.name = "TransportUnavailable";
  }
}
