import { now } from "@xeniur/core";
import type { Db } from "./db.js";

/**
 * Three levels of context disclosure.
 *
 * A full review on every call would exhaust the person and teach them to click through. So:
 * an **ordinary** request stays within what they already approved for this World and intent
 * and shows a compact indicator; an **expanded** one would carry new material and shows only
 * that delta; a **consequential** one — acting outward — shows everything. Approval grows
 * the envelope; nothing else does.
 */
export type DisclosureLevel = "ordinary" | "expanded" | "consequential";

export class EnvelopeStore {
  constructor(private readonly db: Db) {}

  approvedIds(worldId: string, intent: string): Set<string> {
    const row = this.db.prepare(`SELECT item_ids FROM context_envelopes WHERE world_id = ? AND intent = ?`)
      .get(worldId, intent) as { item_ids: string } | undefined;
    return new Set(row ? (JSON.parse(row.item_ids) as string[]) : []);
  }

  /** Which items in `included` the person has not approved for this World × intent before. */
  delta(worldId: string, intent: string, included: readonly string[]): string[] {
    const approved = this.approvedIds(worldId, intent);
    return included.filter((id) => !approved.has(id));
  }

  level(worldId: string, intent: string, included: readonly string[], consequential: boolean): DisclosureLevel {
    if (consequential) return "consequential";
    return this.delta(worldId, intent, included).length === 0 ? "ordinary" : "expanded";
  }

  /** The person approved exactly these items. The envelope grows by them and never shrinks here. */
  approve(worldId: string, intent: string, included: readonly string[]): void {
    const next = [...new Set([...this.approvedIds(worldId, intent), ...included])];
    this.db.prepare(
      `INSERT INTO context_envelopes (world_id, intent, item_ids, approved_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(world_id, intent) DO UPDATE SET item_ids = excluded.item_ids, approved_at = excluded.approved_at`,
    ).run(worldId, intent, JSON.stringify(next), now());
  }

  /** The person withdrew an item (e.g. "Don't send this to AI"). */
  revoke(worldId: string, itemId: string): void {
    const rows = this.db.prepare(`SELECT intent, item_ids FROM context_envelopes WHERE world_id = ?`).all(worldId) as
      Array<{ intent: string; item_ids: string }>;
    for (const r of rows) {
      const ids = (JSON.parse(r.item_ids) as string[]).filter((id) => id !== itemId && !id.startsWith(`${itemId}:`));
      this.db.prepare(`UPDATE context_envelopes SET item_ids = ? WHERE world_id = ? AND intent = ?`)
        .run(JSON.stringify(ids), worldId, r.intent);
    }
  }
}
