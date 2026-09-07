import type {
  DnaReport, Ingredient, IngredientKind, IngredientSummary, OriginStatement,
} from "@xeniur/core";
import { describeIngredients, emptySummary } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";

/**
 * What an Object is made of, answered as two separate questions.
 *
 * *Where did this material come from?* is a property of the lineage's **roots** —
 * deterministic transforms are transparent, so a cropped, recoloured, re-exported
 * photograph is still the photograph you took.
 *
 * *Who or what performed each step?* is a property of the **whole ancestry**. Asking only
 * the first question made a model applied to your own photograph invisible: the root
 * stayed human and nothing recorded that a model had been involved at all.
 */
export function ingredientsOf(graph: ObjectGraph, objectId: string): IngredientSummary {
  const state = graph.currentState(objectId);
  if (!state) return emptySummary(objectId);
  return summarise(graph, objectId, state.forms.map((f) => f.representationId), state.forms);
}

/**
 * The same classification for a set of inputs rather than an Object's current forms.
 *
 * This is the pre-flight: before AI produces anything consequential, XENIUR can show what
 * it is about to think with, while there is still time to add something.
 */
export function ingredientsForInputs(
  graph: ObjectGraph, representationIds: readonly string[], objectId = "",
): IngredientSummary {
  return summarise(graph, objectId, representationIds, []);
}

function summarise(
  graph: ObjectGraph,
  objectId: string,
  from: readonly string[],
  forms: ReadonlyArray<{ role: string; representationId: string }>,
): IngredientSummary {
  const summary = emptySummary(objectId);
  const seenRoot = new Set<string>();
  const seenStep = new Set<string>();

  for (const start of from) {
    for (const step of graph.ancestryOf(start)) {
      const rep = graph.getRepresentation(step.representationId);
      if (!rep) continue;

      // Every step, root or not: did a model perform this operation?
      if (!seenStep.has(rep.id)) {
        seenStep.add(rep.id);
        if (rep.provenance === "generated" || rep.provenance === "mock") {
          summary.modelTouchedSteps += 1;
          summary.modelTouchedRepresentationIds.push(rep.id);
        }
      }

      // Roots only: whose material is this?
      if (graph.edgesInto(rep.id).length > 0) continue;
      if (seenRoot.has(rep.id)) continue;
      seenRoot.add(rep.id);

      const kind = classify(graph, rep.id);
      const ingredient: Ingredient = {
        representationId: rep.id, kind, objectId: rep.objectId,
        formRole: forms.find((f) => f.representationId === rep.id)?.role ?? null,
        sourceId: sourceIdOf(graph, rep.id),
        label: labelFor(kind, rep.modality, rep.format, rep.provider),
      };
      summary.ingredients.push(ingredient);
      summary.counts[kind] += 1;
      summary.rootIds.push(rep.id);
    }
  }

  summary.humanSignalPresent =
    summary.counts.your_observation > 0 || summary.counts.external_human > 0;
  return summary;
}

function classify(graph: ObjectGraph, representationId: string): IngredientKind {
  const rep = graph.getRepresentation(representationId);
  if (!rep) return "unattributed";

  switch (rep.provenance) {
    case "human":
      return "your_observation";
    case "generated":
    case "mock":
      return "ai_suggested";
    case "imported":
      // An import with a recorded source is somebody's work; one without is honestly
      // unattributed rather than quietly counted as human thinking.
      return sourceIdOf(graph, representationId) ? "external_human" : "unattributed";
    case "deterministic":
      // A deterministic root came from a tool with no recorded input. There is nobody
      // behind it, and a check that says the file is well-formed does not change that.
      return "unattributed";
    default:
      return "unattributed";
  }
}

function sourceIdOf(graph: ObjectGraph, representationId: string): string | null {
  // `sources` arrives with Sensemaking; until then an import simply has no attribution.
  const exists = graph.db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'atoms'`,
  ).get();
  if (!exists) return null;
  const row = graph.db.prepare(
    `SELECT a.source_id FROM atoms a
     WHERE a.object_id = (SELECT object_id FROM representations WHERE id = ?)
     LIMIT 1`,
  ).get(representationId) as { source_id: string | null } | undefined;
  return row?.source_id ?? null;
}

function labelFor(
  kind: IngredientKind, modality: string, format: string, provider: string | null,
): string {
  const what = `${modality}/${format}`;
  switch (kind) {
    case "your_observation": return `your ${what}`;
    case "external_human":   return `an external source (${what})`;
    case "previous_object":  return `a previous XENIUR object (${what})`;
    case "ai_suggested":     return `AI-suggested ${what}${provider ? ` via ${provider}` : ""}`;
    default:                 return `${what}, origin not recorded`;
  }
}

const INVITATIONS = [
  "an experience of your own",
  "something you disagree with",
  "an experiment or its result",
  "an unusual connection you have noticed",
  "a customer conversation",
  "a photograph or a sketch",
  "a dataset or a measurement",
  "an original hypothesis",
];

/**
 * What XENIUR is about to think with, said precisely.
 *
 * Every statement is a decidable fact with a path you can follow, and none of them is a
 * score. It never blocks: where nothing came from a person it invites one ingredient, and
 * proceeding anyway is recorded rather than prevented.
 */
export function ideaDna(
  graph: ObjectGraph,
  input: { representationIds?: readonly string[]; objectId?: string; comparedAgainst?: string[][] },
): DnaReport {
  const summary = input.representationIds
    ? ingredientsForInputs(graph, input.representationIds, input.objectId ?? "")
    : ingredientsOf(graph, input.objectId ?? "");

  const overlaps = (input.comparedAgainst ?? []).map((previous) => {
    const setB = new Set(previous);
    const shared = summary.rootIds.filter((id) => setB.has(id)).length;
    const union = new Set([...summary.rootIds, ...previous]).size;
    return union === 0 ? 0 : shared / union;
  });
  const highestOverlap = overlaps.length === 0 ? 0 : Math.max(...overlaps);

  const idsOfKind = (kind: IngredientKind): string[] =>
    summary.ingredients.filter((i) => i.kind === kind).map((i) => i.representationId);

  const statements: OriginStatement[] = [];
  const generated = idsOfKind("ai_suggested");
  const unknown = idsOfKind("unattributed");
  const mine = idsOfKind("your_observation");
  const external = idsOfKind("external_human");

  // "Every root is generated" is a different claim from "no human root was found", and
  // only the first one is ever true of material whose origin was simply never recorded.
  if (summary.rootIds.length > 0 && generated.length === summary.rootIds.length) {
    statements.push({
      kind: "all_roots_generated",
      text: `All ${generated.length} recorded root${generated.length === 1 ? " is" : "s are"} generated`,
      count: generated.length, representationIds: generated,
    });
  }
  if (unknown.length > 0) {
    statements.push({
      kind: "origin_unknown",
      text: `Origin unknown for ${unknown.length} input${unknown.length === 1 ? "" : "s"}`,
      count: unknown.length, representationIds: unknown,
    });
  }
  if (mine.length > 0) {
    statements.push({
      kind: "personal_observations",
      text: `${mine.length} personal observation${mine.length === 1 ? " is" : "s are"} included`,
      count: mine.length, representationIds: mine,
    });
  }
  if (external.length > 0) {
    statements.push({
      kind: "external_sources",
      text: `${external.length} external source${external.length === 1 ? "" : "s"} cited`,
      count: external.length, representationIds: external,
    });
  }
  if (summary.modelTouchedSteps > 0) {
    statements.push({
      kind: "model_applied",
      text: `A model was applied at ${summary.modelTouchedSteps} step${summary.modelTouchedSteps === 1 ? "" : "s"}`,
      count: summary.modelTouchedSteps,
      representationIds: summary.modelTouchedRepresentationIds,
    });
  }

  const nothingHuman = summary.rootIds.length > 0 && !summary.humanSignalPresent;
  return {
    summary, statements, highestOverlap: Number(highestOverlap.toFixed(3)),
    composition: describeIngredients(summary),
    invitation: nothingHuman
      ? `Nothing here came from a person yet. Add ${INVITATIONS[summary.rootIds.length % INVITATIONS.length]} before going on.`
      : null,
  };
}
