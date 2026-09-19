import { newId, type ComputeQuote, type EconomySnapshot } from "@xeniur/core";
import type { Db } from "./db.js";

export interface EconomyPolicy {
  usdPerCompute: number | null;
  intelligenceRolling: number;
  intelligenceReserve: number;
  rollingHours: number;
}
export const DEFAULT_ECONOMY: EconomyPolicy = {
  usdPerCompute: null, intelligenceRolling: 0, intelligenceReserve: 0, rollingHours: 5,
};

/** Separate capacity and compute ledgers. The installed app never invents a purchased balance. */
export class ComputeLedger {
  constructor(private readonly db: Db, readonly policy: EconomyPolicy = DEFAULT_ECONOMY) {}
  preference(key: string, fallback: string): string {
    return (this.db.prepare("SELECT value FROM app_preferences WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? fallback;
  }
  setPreference(key: string, value: string): void {
    this.db.prepare("INSERT INTO app_preferences (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
  /** Called only by a trusted entitlement importer, never exposed over renderer IPC. */
  grant(units: number, receiptId: string): void {
    if (!Number.isSafeInteger(units) || units <= 0 || !receiptId) throw new Error("Invalid Compute entitlement.");
    this.db.prepare("INSERT OR IGNORE INTO compute_entries (id,units,reason,at) VALUES (?,?,?,?)").run(receiptId, units, "entitlement", Date.now());
  }
  balance(): number {
    return (this.db.prepare("SELECT COALESCE(SUM(units),0) AS n FROM compute_entries").get() as { n: number }).n;
  }
  unitsFor(usd: number): number {
    if (!Number.isFinite(usd) || usd < 0) throw new Error("A verified cloud price is required.");
    if (usd === 0) return 0;
    if (!this.policy.usdPerCompute || this.policy.usdPerCompute <= 0) throw new Error("Compute pricing is not configured. Local work remains available.");
    return Math.ceil(usd / this.policy.usdPerCompute - 1e-9);
  }
  offer(input: Omit<ComputeQuote, "id" | "balance" | "expiresAt" | "compute">): ComputeQuote {
    const quote: ComputeQuote = { ...input, id: newId(), balance: this.balance(), expiresAt: Date.now() + 10 * 60_000, compute: this.unitsFor(input.estimatedUsd) };
    this.db.prepare("INSERT INTO compute_quotes (id,body,status,expires_at) VALUES (?,?,'offered',?)").run(quote.id, JSON.stringify(quote), quote.expiresAt);
    return quote;
  }
  get(id: string): ComputeQuote {
    const row = this.db.prepare("SELECT body FROM compute_quotes WHERE id=?").get(id) as { body: string } | undefined;
    if (!row) throw new Error("This estimate is no longer available.");
    return JSON.parse(row.body) as ComputeQuote;
  }
  confirm<T>(id: string, enqueue: (quote: ComputeQuote) => T): T {
    return this.db.transaction(() => {
      const quote = this.get(id);
      if (quote.expiresAt <= Date.now()) throw new Error("This estimate has expired. Request a new estimate.");
      if (quote.compute > this.balance()) throw new Error("There is not enough Compute for this generation.");
      const claimed = this.db.prepare("UPDATE compute_quotes SET status='queued' WHERE id=? AND status='offered'").run(id);
      if (!claimed.changes) throw new Error("This estimate has already been used or cancelled.");
      return enqueue(quote);
    })();
  }
  reserve(id: string, fingerprint: string): void {
    this.db.transaction(() => {
      const quote = this.get(id);
      if (quote.fingerprint !== fingerprint || quote.expiresAt <= Date.now()) throw new Error("The generation changed. Review its new estimate.");
      if (quote.compute > this.balance()) throw new Error("The Compute balance changed. Review before generating.");
      const claimed = this.db.prepare("UPDATE compute_quotes SET status='reserved' WHERE id=? AND status='queued'").run(id);
      if (!claimed.changes) throw new Error("Generation requires an unused confirmed estimate.");
      this.db.prepare("INSERT INTO compute_entries (id,units,reason,quote_id,at) VALUES (?,?,'generation_hold',?,?)").run(newId(), -quote.compute, id, Date.now());
    })();
  }
  settle(id: string, actualUsd: number): void {
    this.db.transaction(() => {
      const quote = this.get(id), actual = this.unitsFor(actualUsd);
      if (actual > quote.compute) throw new Error("The provider exceeded the approved estimate. The difference requires reconciliation.");
      const changed = this.db.prepare("UPDATE compute_quotes SET status='settled',actual_units=? WHERE id=? AND status='reserved'").run(actual, id);
      if (!changed.changes) return;
      this.db.prepare("INSERT INTO compute_entries (id,units,reason,quote_id,at) VALUES (?,?,'unused_estimate',?,?)").run(newId(), quote.compute - actual, id, Date.now());
    })();
  }
  cancel(id: string): void { this.db.prepare("UPDATE compute_quotes SET status='cancelled' WHERE id=? AND status='offered'").run(id); }
  useIntelligence(units = 1, at = Date.now()): void {
    if (!Number.isSafeInteger(units) || units < 1) throw new Error("Invalid capacity amount.");
    this.db.transaction(() => {
      const capacity = this.snapshot(at).intelligence;
      if (!capacity.configured) throw new Error("Cloud Intelligence capacity is not configured.");
      const rolling = Math.min(units, capacity.rollingRemaining), reserve = units - rolling;
      if (reserve > capacity.reserveRemaining) throw new Error("Intelligence capacity is replenishing.");
      for (const [bucket, amount] of [["rolling", rolling], ["reserve", reserve]] as const) {
        if (amount) this.db.prepare("INSERT INTO intelligence_usage (id,bucket,units,at) VALUES (?,?,?,?)").run(newId(), bucket, amount, at);
      }
    })();
  }
  snapshot(at = Date.now()): EconomySnapshot {
    const cutoff = at - this.policy.rollingHours * 3600_000;
    const date = new Date(at), month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const used = (bucket: string, after: number) => (this.db.prepare("SELECT COALESCE(SUM(units),0) AS n FROM intelligence_usage WHERE bucket=? AND at>?").get(bucket, after) as { n: number }).n;
    const earliest = (this.db.prepare("SELECT MIN(at) AS at FROM intelligence_usage WHERE bucket='rolling' AND at>?").get(cutoff) as { at: number | null }).at;
    const held = (this.db.prepare("SELECT body FROM compute_quotes WHERE status='reserved'").all() as { body: string }[]).reduce((sum, row) => sum + (JSON.parse(row.body) as ComputeQuote).compute, 0);
    return { local: { metered: false, label: "Unlimited Local" },
      intelligence: { configured: this.policy.intelligenceRolling > 0, rollingLimit: this.policy.intelligenceRolling,
        rollingRemaining: Math.max(0, this.policy.intelligenceRolling - used("rolling", cutoff)),
        reserveLimit: this.policy.intelligenceReserve, reserveRemaining: Math.max(0, this.policy.intelligenceReserve - used("reserve", month - 1)),
        resetsAt: (earliest ?? at) + this.policy.rollingHours * 3600_000 },
      compute: { configured: this.policy.usdPerCompute !== null, balance: this.balance(), usdPerCompute: this.policy.usdPerCompute, held } };
  }
}
