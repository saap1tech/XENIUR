import type {
  ClaimSupport, Locator, SupportChecker, SupportStatus, SupportSummary,
} from "@xeniur/core";
import { LocatorSchema, SUPPORT_STATUSES, emptyLocator, newId, now } from "@xeniur/core";
import type { Db } from "./db.js";

/**
 * Whether a cited passage actually bears on the thing that cites it.
 *
 * Lives in the graph rather than in sensemaking because two kinds of Object cite passages —
 * claims and decisions — and both need the same fact recorded the same way. Traceability
 * (the locator resolves) is a different fact and is never inferred into this one.
 *
 * One row per citation. A model may write a row with `checkedBy: "model"`; that is a proposal
 * and is shown as one. Only a human review settles a citation.
 */
export class SupportStore {
  constructor(private readonly db: Db) {}

  record(input: {
    claimObjectId: string; sourceVersionId: string; locator?: Locator;
    status?: SupportStatus; checkedBy?: SupportChecker; note?: string;
  }): ClaimSupport {
    const row: ClaimSupport = {
      id: newId(), claimObjectId: input.claimObjectId, sourceVersionId: input.sourceVersionId,
      locator: input.locator ?? emptyLocator(),
      status: input.status ?? "unresolved",
      checkedBy: input.checkedBy ?? "unchecked",
      checkedAt: input.checkedBy && input.checkedBy !== "unchecked" ? now() : null,
      note: input.note ?? "", createdAt: now(),
    };
    this.db.prepare(
      `INSERT INTO claim_support (id, claim_object_id, source_version_id, locator, status,
                                  checked_by, checked_at, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.claimObjectId, row.sourceVersionId, JSON.stringify(row.locator),
          row.status, row.checkedBy, row.checkedAt, row.note, row.createdAt);
    return row;
  }

  /** A person's review. This is the only thing that settles a citation. */
  review(supportId: string, status: SupportStatus, note = ""): ClaimSupport | null {
    this.db.prepare(
      `UPDATE claim_support SET status = ?, checked_by = 'human', checked_at = ?, note = ? WHERE id = ?`,
    ).run(status, now(), note, supportId);
    return this.get(supportId);
  }

  get(supportId: string): ClaimSupport | null {
    const r = this.db.prepare(`SELECT * FROM claim_support WHERE id = ?`).get(supportId) as
      Record<string, unknown> | undefined;
    return r ? toSupport(r) : null;
  }

  of(claimObjectId: string): ClaimSupport[] {
    return (this.db.prepare(
      `SELECT * FROM claim_support WHERE claim_object_id = ? ORDER BY created_at, rowid`,
    ).all(claimObjectId) as Array<Record<string, unknown>>).map(toSupport);
  }

  /**
   * The counts a chip or a Trust Strip cell is drawn from.
   *
   * `reviewedSupported` is deliberately strict: at least one human-reviewed supported citation
   * and no contradiction from anyone. A model saying "supported" does not make it so, and a
   * single contradiction is a reason to look regardless of how many agree.
   */
  summary(claimObjectId: string): SupportSummary {
    const rows = this.of(claimObjectId);
    const counts = Object.fromEntries(SUPPORT_STATUSES.map((s) => [s, 0])) as Record<SupportStatus, number>;
    for (const r of rows) counts[r.status] += 1;
    return {
      claimObjectId, counts,
      reviewedSupported: rows.some((r) => r.status === "supported" && r.checkedBy === "human") &&
                         !rows.some((r) => r.status === "contradicted"),
      hasUnreviewed: rows.some((r) => r.checkedBy !== "human"),
      hasContradiction: rows.some((r) => r.status === "contradicted"),
    };
  }

  /** Summaries for many claims at once, for a Support Map or a World's Trust Strip. */
  summaries(claimObjectIds: readonly string[]): Map<string, SupportSummary> {
    return new Map(claimObjectIds.map((id) => [id, this.summary(id)]));
  }
}

function toSupport(r: Record<string, unknown>): ClaimSupport {
  return {
    id: r["id"] as string, claimObjectId: r["claim_object_id"] as string,
    sourceVersionId: r["source_version_id"] as string,
    locator: LocatorSchema.parse(JSON.parse((r["locator"] as string) || "{}")) as Locator,
    status: r["status"] as SupportStatus, checkedBy: r["checked_by"] as SupportChecker,
    checkedAt: (r["checked_at"] as number | null) ?? null,
    note: r["note"] as string, createdAt: r["created_at"] as number,
  };
}
