import type { Atom, MapEntry, ThinkingMap } from "@xeniur/core";
import type { ObjectGraph } from "@xeniur/graph";
import { similarity } from "./extract.js";
import type { SensemakingStore } from "./store.js";

/**
 * How much of the shorter claim must appear in the longer one before they count as the
 * same thing said twice. Containment, so length differences do not hide a repeat.
 */
const SAME_CLAIM = 0.6;

const entry = (atom: Atom, because: string, related: string[] = []): MapEntry =>
  ({ atom, because, related });

/**
 * Compresses what has been consumed into six questions.
 *
 * Not a feed, and not a summary either: every answer is a graph query over atoms the
 * person can trace back to the sentence that produced them. Nothing here is a model's
 * impression of what you have been reading — if XENIUR says two ideas conflict, it is
 * because something in the graph says so, and it will show you which.
 */
export function buildThinkingMap(
  graph: ObjectGraph, store: SensemakingStore, worldId: string,
): ThinkingMap {
  const atoms = store.listAtoms(worldId);
  const byId = new Map(atoms.map((a) => [a.objectId, a]));

  // Which stored copy each atom came out of, and who published it. An atom with no source
  // version is the person's own, and identifies itself so two observations never collapse.
  const copies = new Map(
    (graph.db.prepare(
      `SELECT id, content_hash, publication_id FROM source_versions`,
    ).all() as Array<{ id: string; content_hash: string; publication_id: string | null }>)
      .map((r) => [r.id, r]),
  );
  const contentOf = (a: Atom): string =>
    (a.sourceVersionId ? copies.get(a.sourceVersionId)?.content_hash : null) ?? `own:${a.objectId}`;
  const publisherOf = (a: Atom): string | null =>
    (a.sourceVersionId ? copies.get(a.sourceVersionId)?.publication_id : null) ?? null;
  const links = graph.db.prepare(
    `SELECT l.* FROM atom_links l JOIN objects o ON o.id = l.from_object_id WHERE o.world_id = ?`,
  ).all(worldId) as Array<{ from_object_id: string; to_object_id: string; relation: string }>;

  const supportedBy = new Map<string, string[]>();
  const contradicting = new Map<string, string[]>();
  const sameAs = new Map<string, string[]>();

  for (const link of links) {
    const push = (map: Map<string, string[]>, key: string, value: string) =>
      map.set(key, [...(map.get(key) ?? []), value]);
    if (link.relation === "supports") push(supportedBy, link.to_object_id, link.from_object_id);
    if (link.relation === "contradicts") {
      push(contradicting, link.from_object_id, link.to_object_id);
      push(contradicting, link.to_object_id, link.from_object_id);
    }
    if (link.relation === "same_as") {
      push(sameAs, link.from_object_id, link.to_object_id);
      push(sameAs, link.to_object_id, link.from_object_id);
    }
  }

  /*
   * Your assessed claims — rated above zero, and linked to something in support.
   *
   * Confidence 0 is an explicit "I do not believe this", and `confidence !== null` filed
   * it under knowledge. A disbelieved claim is one of the more useful things a person can
   * record, and the one place it must never appear is the list of what they know.
   */
  const known = atoms
    .filter((a) => a.confidence !== null && a.confidence > 0 &&
                   (supportedBy.get(a.objectId)?.length ?? 0) > 0)
    .map((a) => entry(a,
      `you rated this ${Math.round((a.confidence ?? 0) * 100)}% and linked ${supportedBy.get(a.objectId)!.length} thing(s) as support`,
      supportedBy.get(a.objectId) ?? []));

  /* What conflicts? — something in the graph disagrees with something else. */
  const conflicts = atoms
    .filter((a) => (contradicting.get(a.objectId)?.length ?? 0) > 0 || a.atomType === "contradiction")
    .map((a) => {
      const against = contradicting.get(a.objectId) ?? [];
      return entry(a,
        against.length > 0
          ? `this disagrees with ${against.map((id) => quoteOf(byId, id)).join("; ")}`
          : "it was captured as a contradiction in its source",
        against);
    });

  /*
   * Similar wording — closely worded claims from copies whose content differs.
   *
   * Two things this deliberately stops short of. Capturing one article twice used to read
   * as "2 separate sources say this", because the atoms sat on different source rows; they
   * are now compared by the content hash of the copy they came from, so the same text is
   * the same text however many times it was taken in. And where two publications may be
   * running one report, XENIUR says independence is unknown instead of counting them as
   * agreement — corroboration is a claim about the world that wording cannot establish.
   */
  const repeating: MapEntry[] = [];
  const claimed = atoms.filter((a) => a.atomType === "claim" || a.atomType === "evidence");
  const alreadyGrouped = new Set<string>();

  for (const a of claimed) {
    if (alreadyGrouped.has(a.objectId)) continue;
    const echoes = claimed.filter((b) =>
      b.objectId !== a.objectId &&
      !alreadyGrouped.has(b.objectId) &&
      // Different content, not merely a different row: one article captured twice is one.
      contentOf(a) !== contentOf(b) &&
      (similarity(a.text, b.text) >= SAME_CLAIM || (sameAs.get(a.objectId) ?? []).includes(b.objectId)));

    if (echoes.length > 0) {
      for (const e of echoes) alreadyGrouped.add(e.objectId);
      alreadyGrouped.add(a.objectId);

      const publishers = [a, ...echoes].map((x) => publisherOf(x));
      const distinct = new Set(publishers.filter((p): p is string => p !== null));
      const independent = distinct.size === publishers.length;
      const n = echoes.length + 1;

      repeating.push(entry(a,
        independent
          ? `${n} copies from different publishers say something very close to this`
          : `${n} copies say something very close to this — whether they are independent is unknown`,
        echoes.map((e) => e.objectId)));
    }
  }

  /* What is actually new? — nothing older says the same thing. */
  const novel = atoms
    .filter((a) => a.atomType === "claim" || a.atomType === "evidence" || a.atomType === "concept")
    .filter((a) => {
      if ((sameAs.get(a.objectId)?.length ?? 0) > 0) return false;
      return !atoms.some((b) =>
        b.objectId !== a.objectId && b.statedAt < a.statedAt && similarity(a.text, b.text) >= SAME_CLAIM);
    })
    .map((a) => entry(a, "nothing you captured earlier says this"));

  /*
   * Claims without linked support — per claim, never per article.
   *
   * One evidence sentence used to satisfy every claim sharing its source, so a single
   * statistic quietly verified everything else the article happened to assert. Support is
   * a link somebody made between two particular things, and nothing else counts as one.
   */
  const unverified = atoms
    .filter((a) => a.atomType === "claim")
    .filter((a) => (supportedBy.get(a.objectId)?.length ?? 0) === 0)
    .map((a) => entry(a,
      a.confidence === null
        ? "you have not rated this, and nothing is linked to it as support"
        : "nothing is linked to this as support"));

  /* What deserves action? — sitting in Test or Build with nothing happening. */
  const withTasks = new Set(
    (graph.db.prepare(
      `SELECT DISTINCT json_extract(payload, '$.objectId') AS object_id FROM tasks
       WHERE world_id = ? AND status IN ('queued','running','needs_approval')`,
    ).all(worldId) as Array<{ object_id: string | null }>)
      .map((r) => r.object_id).filter((id): id is string => id !== null),
  );
  const actionable = atoms
    .filter((a) => a.lane === "test" || a.lane === "build")
    .filter((a) => !withTasks.has(a.objectId))
    .map((a) => entry(a, `you put this in ${a.lane} and nothing has happened yet`));

  return {
    worldId, generatedAt: Date.now(),
    known, conflicts, repeating, novel, unverified, actionable,
    counts: {
      sources: store.listSources(worldId).length,
      atoms: atoms.length,
      links: links.length,
    },
  };
}

const quoteOf = (byId: Map<string, Atom>, id: string): string => {
  const atom = byId.get(id);
  if (!atom) return "something no longer here";
  return `"${atom.text.length > 48 ? `${atom.text.slice(0, 47)}…` : atom.text}"`;
};


