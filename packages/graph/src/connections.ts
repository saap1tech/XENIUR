import type { ObjectGraph } from "./graph.js";

/**
 * Connect it — deterministic first.
 *
 * Before any model is asked, the graph already knows a great deal about how an idea relates
 * to the rest of the World: which Objects cite the same source copy, which share a trait or a
 * type, which a decision links. Each connection says *why it may connect* in words drawn from
 * the two subjects, and is offered as a proposal the person confirms with a drop or a click.
 */
export interface Connection {
  objectId: string;
  title: string;
  /** From the two subjects, never a score. */
  because: string;
  /** How it was found. A model's suggestion is labelled as one; these are all from the graph. */
  by: "shared_source" | "same_type" | "shared_trait" | "linked_decision";
}

export function connectionsFor(graph: ObjectGraph, objectId: string, limit = 8): Connection[] {
  const state = graph.currentState(objectId);
  if (!state) return [];
  const worldId = state.object.worldId;
  const out = new Map<string, Connection>();
  const add = (id: string, because: string, by: Connection["by"]) => {
    if (id === objectId || out.has(id)) return;
    const s = graph.currentState(id);
    if (!s) return;
    out.set(id, { objectId: id, title: s.properties.title, because, by });
  };

  // 1. The same source copy, cited elsewhere.
  const mine = graph.db.prepare(`SELECT source_id, source_version_id FROM atoms WHERE object_id = ?`)
    .get(objectId) as { source_id: string | null; source_version_id: string | null } | undefined;
  if (mine?.source_id) {
    const title = (graph.db.prepare(`SELECT title FROM sources WHERE id = ?`).get(mine.source_id) as { title: string } | undefined)?.title ?? "the same source";
    const siblings = graph.db.prepare(
      `SELECT a.object_id id FROM atoms a JOIN objects o ON o.id = a.object_id WHERE a.source_id = ? AND o.world_id = ? AND a.object_id != ?`,
    ).all(mine.source_id, worldId, objectId) as Array<{ id: string }>;
    for (const s of siblings) add(s.id, `Both come from "${title}".`, "shared_source");
    const decisions = graph.db.prepare(
      `SELECT DISTINCT e.decision_id id FROM decision_evidence e JOIN source_versions v ON v.id = e.source_version_id WHERE v.source_id = ?`,
    ).all(mine.source_id) as Array<{ id: string }>;
    for (const d of decisions) add(d.id, `This decision cites "${title}" too.`, "linked_decision");
  }

  // 2. Decisions linked to it, and what they link to.
  for (const l of graph.decisions.linksFrom(objectId)) add(l.toObjectId, `Linked: ${l.relation.replaceAll("_", " ")}.`, "linked_decision");
  for (const l of graph.decisions.linksTo(objectId)) add(l.fromObjectId, `Links here: ${l.relation.replaceAll("_", " ")}.`, "linked_decision");

  // 3. Shared traits, then the same type — in this World only.
  const traits = new Set(state.properties.traits);
  for (const other of graph.listStates(worldId)) {
    if (out.size >= limit) break;
    if (other.object.id === objectId) continue;
    const shared = other.properties.traits.filter((t) => traits.has(t));
    if (shared.length > 0) add(other.object.id, `Both are ${shared[0]}.`, "shared_trait");
    else if (other.properties.semanticType === state.properties.semanticType && state.properties.semanticType !== "claim") {
      add(other.object.id, `Both are a ${state.properties.semanticType}.`, "same_type");
    }
  }
  return [...out.values()].slice(0, limit);
}
