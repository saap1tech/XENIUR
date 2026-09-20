import type { PublisherRef, SignedDocument, Ticket } from "@xeniur/core";
import { TicketSchema, documentDigest, newId, now } from "@xeniur/core";
import type { Db } from "./db.js";
import type { ObjectGraph } from "./graph.js";
import { verifySignature } from "./publishers.js";

/**
 * Entry tickets. The organizer issues one per participant on their own channel — after a
 * fee, a waiver, an invitation, whatever they require — and signs it. Here a ticket is
 * verified against the challenge's publisher, held for the participant it names, and used
 * once when they enter. There is no amount and no payment status anywhere in this file:
 * XENIUR knows that a ticket verifies, not how it was earned.
 */
export class TicketStore {
  constructor(private readonly db: Db, private readonly graph: ObjectGraph) {}

  /** The organizer signs a ticket for one participant. Only the challenge's publisher can. */
  issue(challengeWorldId: string, participant: PublisherRef, expiresAt: number): SignedDocument<Ticket> {
    const c = this.graph.challenges.get(challengeWorldId);
    if (!c) throw new Error(`no such challenge: ${challengeWorldId}`);
    const self = this.graph.publishers.self();
    if (c.publisher.publicKey !== self.publicKey) throw new Error("only the challenge's publisher issues tickets");
    const body = TicketSchema.parse({ id: newId(), challengeDigest: c.signature.rootHash, participantPublicKey: participant.publicKey, issuedAt: now(), expiresAt });
    const signature = self.sign(documentDigest(body));
    // The organizer's own ledger of issued tickets: an entry arriving here spends it the same way.
    this.graph.publishers.seen(participant);
    this.#hold(c.worldId, body, signature);
    return { kind: "xeniur.ticket/1", body, signature };
  }

  /** A ticket that arrived. Held only when it verifies against the challenge's publisher and names this machine. */
  adopt(doc: SignedDocument<unknown>): Ticket {
    if (doc.kind !== "xeniur.ticket/1") throw new Error("not a ticket");
    const body = TicketSchema.parse(doc.body);
    // The challenge is found by its signed identity, which is the same on every machine.
    const c = this.graph.challenges.known(body.challengeDigest);
    if (!c) throw new Error("this ticket names a challenge that is not here — bring the challenge in first");
    if (!verifySignature(doc.signature) || doc.signature.rootHash !== documentDigest(body) || doc.signature.publicKey !== c.publisher.publicKey) {
      throw new Error("the ticket does not verify against the challenge's publisher");
    }
    if (body.participantPublicKey !== this.graph.publishers.self().publicKey) throw new Error("this ticket was issued to someone else");
    this.#hold(c.worldId, body, doc.signature);
    return body;
  }

  #hold(worldId: string, body: Ticket, signature: SignedDocument<Ticket>["signature"]): void {
    this.db.prepare(
      `INSERT INTO entry_tickets (id, challenge_world_id, participant_public_key, issued_at, expires_at, signature, used_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(challenge_world_id, participant_public_key) DO UPDATE SET
         id = excluded.id, issued_at = excluded.issued_at, expires_at = excluded.expires_at, signature = excluded.signature
         WHERE entry_tickets.used_at IS NULL`,
    ).run(body.id, worldId, body.participantPublicKey, body.issuedAt, body.expiresAt, JSON.stringify(signature));
  }

  /** The ticket held here for a challenge, and whether it is still usable. */
  held(challengeWorldId: string, participantPublicKey = this.graph.publishers.self().publicKey): { ticket: Ticket; usedAt: number | null; valid: boolean } | null {
    const r = this.db.prepare(
      `SELECT * FROM entry_tickets WHERE challenge_world_id = ? AND participant_public_key = ?`,
    ).get(challengeWorldId, participantPublicKey) as Row | undefined;
    if (!r) return null;
    const digest = this.graph.challenges.get(r.challenge_world_id)?.signature.rootHash ?? "0".repeat(64);
    const ticket: Ticket = { id: r.id, challengeDigest: digest, participantPublicKey: r.participant_public_key, issuedAt: r.issued_at, expiresAt: r.expires_at };
    return { ticket, usedAt: r.used_at, valid: r.used_at === null && r.expires_at > now() };
  }

  /** Spend the ticket on entering. Refused when there is none, it expired, or it was used. */
  use(challengeWorldId: string, participantPublicKey: string): Ticket {
    const h = this.held(challengeWorldId, participantPublicKey);
    if (!h) throw new Error("this challenge needs an entry ticket from the organizer, and none is held here");
    if (h.usedAt !== null) throw new Error("this ticket was already used");
    if (h.ticket.expiresAt <= now()) throw new Error("this ticket has expired");
    this.db.prepare(`UPDATE entry_tickets SET used_at = ? WHERE id = ?`).run(now(), h.ticket.id);
    return h.ticket;
  }
}

type Row = { id: string; challenge_world_id: string; participant_public_key: string; issued_at: number; expires_at: number; signature: string; used_at: number | null };
