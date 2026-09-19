import type { Stance, SupportMap, SupportMapClaim, SupportLane } from "@xeniur/core";
import { describeSupportMap, laneFor } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";

/**
 * The claims behind an Object, laned by support state.
 *
 * A report's claims are the atoms linked to it (semantic_links in either direction) plus
 * atoms that cite the same sources its decisions cite. When nothing is linked, every claim
 * atom in the World is the report's material — the World *is* the project.
 */
export function supportMapFor(graph: ObjectGraph, objectId: string): SupportMap | null {
  const state = graph.currentState(objectId);
  if (!state) return null;
  const worldId = state.object.worldId;

  const linked = new Set<string>([
    ...graph.decisions.linksFrom(objectId).map((l) => l.toObjectId),
    ...graph.decisions.linksTo(objectId).map((l) => l.fromObjectId),
  ]);
  const rows = graph.db.prepare(
    `SELECT a.object_id id, a.stance, a.atom_type, a.source_id FROM atoms a JOIN objects o ON o.id = a.object_id
     WHERE o.world_id = ? AND a.atom_type IN ('claim', 'evidence', 'contradiction') ORDER BY a.stated_at`,
  ).all(worldId) as Array<{ id: string; stance: Stance; atom_type: string; source_id: string | null }>;
  const chosen = linked.size > 0 ? rows.filter((r) => linked.has(r.id)) : rows;

  const claims: SupportMapClaim[] = chosen.map((r) => {
    const s = graph.support.summary(r.id);
    const support = graph.support.of(r.id);
    const checkedBy: SupportMapClaim["checkedBy"] = support.some((x) => x.checkedBy === "human") ? "human"
      : support.some((x) => x.checkedBy === "model") ? "model" : "unchecked";
    const title = graph.currentState(r.id)?.properties.title ?? "";
    const sources = [...new Set(support.map((x) => {
      const v = graph.db.prepare(`SELECT s.title FROM source_versions v JOIN sources s ON s.id = v.source_id WHERE v.id = ?`)
        .get(x.sourceVersionId) as { title: string } | undefined;
      return v?.title ?? "a source";
    }))];
    return { objectId: r.id, text: title, stance: r.stance, lane: laneFor(r.stance, s), checkedBy, counts: s.counts, sources };
  });

  const lanes: Record<SupportLane, number> = { supported: 0, ambiguous: 0, unresolved: 0, contradicted: 0, own: 0 };
  for (const c of claims) lanes[c.lane] += 1;
  const map: SupportMap = { objectId, title: state.properties.title, claims, lanes, summary: "" };
  map.summary = describeSupportMap(map);
  return map;
}
