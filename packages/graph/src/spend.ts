import { newId, now } from "@xeniur/core";
import type { Db } from "./db.js";

export interface SpendCaps {
  perActionUsdMax: number;
  perTaskUsdMax: number;
  totalUsdMax: number;
  monthlyUsdMax?: number;
}

export interface Hold {
  id: string;
  reservedUsd: number;
  expiresAt: number;
}

export class BudgetRefused extends Error {
  readonly code = "budget_refused" as const;
  constructor(
    readonly limit: "perAction" | "perTask" | "total" | "unpriced",
    readonly wouldBe: number,
    readonly cap: number,
    detail: string,
  ) {
    super(detail);
    this.name = "BudgetRefused";
  }
}

/** A hold nobody settled is released after this, so a crash cannot block the cap forever. */
export const HOLD_TTL_MS = 10 * 60 * 1000;

/**
 * The spend ledger: reserve, dispatch, settle.
 *
 * The ordering is the whole point. Checking settled spending and *then* making a call is a
 * race — two tasks read the same "$4.20 of $5 spent" and both proceed, and the cap a person
 * set turns out not to have been a cap. Reserving inside the same transaction as the check
 * closes that: the second task sees the first one's claim whether or not it has finished.
 *
 * Every attempt is written, including repairs and failures, because a model that returned
 * unusable JSON twice still cost money.
 */
export class SpendLedger {
  constructor(private readonly db: Db, private caps: SpendCaps) {}

  limits(): SpendCaps { return { ...this.caps }; }
  setLimits(caps: SpendCaps): void { this.caps = { ...caps }; }
  monthlySpent(at = now()): number {
    const month = new Date(at); month.setDate(1); month.setHours(0, 0, 0, 0);
    const row = this.db.prepare(`SELECT COALESCE(SUM(CASE WHEN status = 'settled' THEN actual_usd ELSE reserved_usd END), 0) usd
      FROM spend WHERE (status = 'settled' OR (status = 'held' AND expires_at > ?)) AND held_at >= ?`)
      .get(at, month.getTime()) as { usd: number };
    return row.usd;
  }

  /**
   * Claims headroom for a call that has not been made yet.
   *
   * Throws rather than returning a flag: a caller that forgets to check a boolean makes
   * the call anyway, and the failure mode of that is a bill.
   */
  reserve(input: {
    estimateUsd: number; provider: string; model: string | null;
    taskId?: string | null; attempt?: number;
  }): Hold {
    return this.db.transaction(() => {
      this.#expireStaleHolds();

      const estimate = input.estimateUsd;
      if (!Number.isFinite(estimate) || estimate < 0) {
        throw new BudgetRefused("unpriced", 0, 0,
          "this call has no verified price, so XENIUR will not make it");
      }
      if (estimate > this.caps.perActionUsdMax) {
        throw new BudgetRefused("perAction", estimate, this.caps.perActionUsdMax,
          `one call at $${estimate.toFixed(2)} is over the $${this.caps.perActionUsdMax.toFixed(2)} limit for a single action`);
      }

      const committed = this.#committed(null);
      if (committed + estimate > this.caps.totalUsdMax) {
        throw new BudgetRefused("total", committed + estimate, this.caps.totalUsdMax,
          `this would take total spending to $${(committed + estimate).toFixed(2)}, over the $${this.caps.totalUsdMax.toFixed(2)} cap`);
      }
      if (this.caps.monthlyUsdMax !== undefined && this.monthlySpent() + estimate > this.caps.monthlyUsdMax) {
        throw new BudgetRefused("total", this.monthlySpent() + estimate, this.caps.monthlyUsdMax,
          `this would exceed the $${this.caps.monthlyUsdMax.toFixed(2)} monthly AI limit`);
      }
      if (input.taskId) {
        const onTask = this.#committed(input.taskId);
        if (onTask + estimate > this.caps.perTaskUsdMax) {
          throw new BudgetRefused("perTask", onTask + estimate, this.caps.perTaskUsdMax,
            `this task would reach $${(onTask + estimate).toFixed(2)}, over its $${this.caps.perTaskUsdMax.toFixed(2)} limit`);
        }
      }

      const hold: Hold = { id: newId(), reservedUsd: estimate, expiresAt: now() + HOLD_TTL_MS };
      this.db.prepare(
        `INSERT INTO spend (id, task_id, provider, model, status, reserved_usd, attempt,
                            held_at, expires_at)
         VALUES (?, ?, ?, ?, 'held', ?, ?, ?, ?)`,
      ).run(hold.id, input.taskId ?? null, input.provider, input.model,
            estimate, input.attempt ?? 1, now(), hold.expiresAt);
      return hold;
    })();
  }

  /**
   * Records what a call actually cost, whatever became of it.
   *
   * `outcome` is kept because the distinction matters when reading a bill later: a call
   * that produced unusable output cost the same as one that worked.
   */
  settle(holdId: string, actual: {
    usd: number; inputTokens?: number; outputTokens?: number;
    requestId?: string | null; outcome: "ok" | "invalid_output" | "refused" | "error";
  }): void {
    this.db.prepare(
      `UPDATE spend SET status = 'settled', actual_usd = ?, input_tokens = ?, output_tokens = ?,
                        request_id = ?, outcome = ?, settled_at = ?
       WHERE id = ? AND status = 'held'`,
    ).run(actual.usd, actual.inputTokens ?? 0, actual.outputTokens ?? 0,
          actual.requestId ?? null, actual.outcome, now(), holdId);
  }

  /** Gives headroom back when a call was never made at all. */
  release(holdId: string): void {
    this.db.prepare(
      `UPDATE spend SET status = 'released', actual_usd = 0, settled_at = ? WHERE id = ? AND status = 'held'`,
    ).run(now(), holdId);
  }

  /** What has been spent, and what is currently claimed but not yet settled. */
  summary(taskId: string | null = null): {
    settledUsd: number; heldUsd: number; committedUsd: number; calls: number;
  } {
    const where = taskId ? `AND task_id = ?` : "";
    const params = taskId ? [taskId] : [];
    const settled = (this.db.prepare(
      `SELECT COALESCE(SUM(actual_usd), 0) AS usd, COUNT(*) AS n FROM spend
       WHERE status = 'settled' ${where}`,
    ).get(...params) as { usd: number; n: number });
    const held = (this.db.prepare(
      `SELECT COALESCE(SUM(reserved_usd), 0) AS usd FROM spend
       WHERE status = 'held' AND expires_at > ? ${where}`,
    ).get(now(), ...params) as { usd: number });

    return {
      settledUsd: settled.usd, heldUsd: held.usd,
      committedUsd: settled.usd + held.usd, calls: settled.n,
    };
  }

  /** Settled spending plus live holds — what the caps are actually compared against. */
  #committed(taskId: string | null): number {
    return this.summary(taskId).committedUsd;
  }

  #expireStaleHolds(): void {
    this.db.prepare(
      `UPDATE spend SET status = 'released', actual_usd = 0, settled_at = ?
       WHERE status = 'held' AND expires_at <= ?`,
    ).run(now(), now());
  }
}
