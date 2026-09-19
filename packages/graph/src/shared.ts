import type { ClaimSupport, PublisherRef, SupportSummary } from "@xeniur/core";
import { newId, now } from "@xeniur/core";
import type { Db } from "./db.js";
import type { ObjectGraph } from "./graph.js";

/**
 * Shared Worlds — the highest-quality collaboration available: a reasoned disagreement with
 * provenance, in the visual language the work was made in.
 *
 * Nothing here merges. A critique arrives as its own Objects that link to yours by id; this
 * module reads those links and lays the two claims side by side with the passage and the
 * support state the reviewer recorded. Your claim is not changed by being contradicted.
 */

export interface CritiquePair {
  /** Your claim (or decision). */
  leftObjectId: string;
  /** Their claim. */
  rightObjectId: string;
  relation: "supports" | "contradicts";
  /** Who said it, from the import record; null when it was made on this machine. */
  by: PublisherRef | null;
  /** Their support rows, so the chip is coloured by what *they* checked. */
  support: ClaimSupport[];
  summary: SupportSummary;
  note: string;
}

/**
 * Every claim that someone else set against one of this Object's claims — or against the
 * Object itself. Both atom_links (claim ↔ claim) and semantic_links (decision ↔ claim) count.
 */
export function critiquePairs(graph: ObjectGraph, objectId: string): CritiquePair[] {
  const rows = graph.db.prepare(
    `SELECT from_object_id AS other, to_object_id AS mine, relation, COALESCE(note, '') AS note FROM atom_links
     WHERE to_object_id = ? AND relation IN ('supports', 'contradicts')
     UNION ALL
     SELECT from_object_id, to_object_id, relation, note FROM semantic_links
     WHERE to_object_id = ? AND relation IN ('supports', 'contradicts')`,
  ).all(objectId, objectId) as Array<{ other: string; mine: string; relation: "supports" | "contradicts"; note: string }>;

  return rows.map((r) => {
    const from = graph.db.prepare(
      `SELECT p.id, p.display_name FROM imported_from i JOIN publishers p ON p.id = i.publisher_id WHERE i.object_id = ?`,
    ).get(r.other) as { id: string; display_name: string } | undefined;
    return {
      leftObjectId: r.mine, rightObjectId: r.other, relation: r.relation,
      by: from ? { publicKey: from.id, displayName: from.display_name } : null,
      support: graph.support.of(r.other), summary: graph.support.summary(r.other), note: r.note,
    };
  });
}

/** Whether an Object arrived from someone else, and from whom. */
export function importedFrom(graph: ObjectGraph, objectId: string): PublisherRef | null {
  const row = graph.db.prepare(
    `SELECT p.id, p.display_name FROM imported_from i JOIN publishers p ON p.id = i.publisher_id WHERE i.object_id = ?`,
  ).get(objectId) as { id: string; display_name: string } | undefined;
  return row ? { publicKey: row.id, displayName: row.display_name } : null;
}

/* ------------------------------------------------------------------------------------------ */
/* Circles — opt-in groups around commitments. "3 of 4 milestones". No score, no rank.         */
/* ------------------------------------------------------------------------------------------ */

export interface Circle { id: string; title: string; createdAt: number; members: PublisherRef[]; milestones: string[] }

export interface CircleProgress {
  circleId: string;
  completed: number;
  total: number;
  /** "3 of 4 milestones" — a count, never a percentage and never a position. */
  summary: string;
}

export class CircleStore {
  constructor(private readonly db: Db, private readonly graph: ObjectGraph) {}

  create(title: string): Circle {
    const id = newId();
    this.db.prepare(`INSERT INTO circles (id, title, created_at) VALUES (?, ?, ?)`).run(id, title, now());
    return this.get(id)!;
  }

  /** Joining is a choice the person makes; there is no invitation that joins for them. */
  join(circleId: string, member: PublisherRef): void {
    this.graph.publishers.seen(member);
    this.db.prepare(
      `INSERT OR IGNORE INTO circle_members (circle_id, publisher_id, joined_at) VALUES (?, ?, ?)`,
    ).run(circleId, member.publicKey, now());
  }

  leave(circleId: string, publicKey: string): void {
    this.db.prepare(`DELETE FROM circle_members WHERE circle_id = ? AND publisher_id = ?`).run(circleId, publicKey);
  }

  /** A milestone is a boolean Constraint Object. Completed when its value is true. */
  addMilestone(circleId: string, constraintObjectId: string): void {
    const c = this.graph.constraints.get(constraintObjectId);
    if (!c || c.definition.kind !== "boolean") {
      throw new Error("a milestone is a boolean Constraint Object: done, or not yet");
    }
    this.db.prepare(
      `INSERT OR IGNORE INTO circle_milestones (circle_id, constraint_object_id) VALUES (?, ?)`,
    ).run(circleId, constraintObjectId);
  }

  progress(circleId: string): CircleProgress {
    const ids = (this.db.prepare(`SELECT constraint_object_id id FROM circle_milestones WHERE circle_id = ?`)
      .all(circleId) as Array<{ id: string }>).map((r) => r.id);
    const completed = ids.filter((id) => this.graph.constraints.get(id)?.value === true).length;
    return {
      circleId, completed, total: ids.length,
      summary: ids.length === 0 ? "no milestones yet" : `${completed} of ${ids.length} milestone${ids.length === 1 ? "" : "s"}`,
    };
  }

  get(id: string): Circle | null {
    const row = this.db.prepare(`SELECT * FROM circles WHERE id = ?`).get(id) as
      { id: string; title: string; created_at: number } | undefined;
    if (!row) return null;
    const members = (this.db.prepare(
      `SELECT p.id, p.display_name FROM circle_members m JOIN publishers p ON p.id = m.publisher_id
       WHERE m.circle_id = ? ORDER BY m.joined_at`,
    ).all(id) as Array<{ id: string; display_name: string }>).map((m) => ({ publicKey: m.id, displayName: m.display_name }));
    const milestones = (this.db.prepare(`SELECT constraint_object_id id FROM circle_milestones WHERE circle_id = ?`)
      .all(id) as Array<{ id: string }>).map((r) => r.id);
    return { id: row.id, title: row.title, createdAt: row.created_at, members, milestones };
  }

  list(): Circle[] {
    return (this.db.prepare(`SELECT id FROM circles ORDER BY created_at`).all() as Array<{ id: string }>)
      .map((r) => this.get(r.id)!);
  }
}
