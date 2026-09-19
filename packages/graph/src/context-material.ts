import type { ObjectGraph } from "./graph.js";
import { impactOf } from "./impact.js";

/**
 * Assembles what the Context Compiler is offered, from the graph, for one focus Object.
 *
 * The host offers; the compiler chooses. So this gathers *generously* — every accepted or
 * reviewing decision linked to the focus, every passage those decisions cite, every
 * constraint attached, what changed since the last delivery — and leaves exclusion, budget
 * and rights to the pure compiler, where they are tested. Nothing here reads a clock.
 *
 * The shape returned is the compiler's `ContextMaterial`, described structurally so the graph
 * does not depend on the grammar package.
 */
export function contextMaterialFor(graph: ObjectGraph, focusId: string): Record<string, unknown> | null {
  const state = graph.currentState(focusId);
  if (!state) return null;
  const worldId = state.object.worldId;

  // Decisions linked to the focus in either direction, plus any the focus was released under.
  const linked = new Set<string>([
    ...graph.decisions.linksFrom(focusId).map((l) => l.toObjectId),
    ...graph.decisions.linksTo(focusId).map((l) => l.fromObjectId),
  ]);
  // "Don't send this to AI": a versioned processing permission on the Object's settings. It
  // never changes rights or removes anything; the compiler names it as the reason.
  const aiAllowed = (objectId: string): boolean =>
    graph.currentState(objectId)?.properties.settings["aiProcessing"] !== "never";
  const decisions = graph.decisions.list(worldId).map((d) => ({
    objectId: d.objectId, question: d.question, chosenOption:
      d.options.find((o) => o.key === d.chosenOption)?.label ?? d.chosenOption,
    rationale: d.rationale, state: d.state, acceptedVersionId: d.acceptedVersionId,
    assumptions: d.assumptions.map((a) => ({ text: a.text, reviewTrigger: a.reviewTrigger, kind: a.kind })),
    rejectedOptions: d.options.filter((o) => o.key !== d.chosenOption).map((o) => o.label),
    relatedToFocus: linked.has(d.objectId) || d.objectId === focusId,
    aiAllowed: aiAllowed(d.objectId),
  }));

  // Passages: every source copy cited by a related decision, as stored words.
  const passages: Array<Record<string, unknown>> = [];
  for (const d of decisions.filter((x) => x.relatedToFocus)) {
    const detail = graph.decisions.detail(d.objectId);
    for (const e of detail?.evidence ?? []) {
      if (!e.sourceVersionId) continue;
      const v = graph.db.prepare(`SELECT * FROM source_versions WHERE id = ?`).get(e.sourceVersionId) as
        Record<string, unknown> | undefined;
      if (!v) continue;
      const source = graph.db.prepare(`SELECT title FROM sources WHERE id = ?`).get(v["source_id"]) as
        { title: string } | undefined;
      const text = graph.readBlob(v["text_blob_hash"] as string).toString("utf8");
      const support = graph.support.of(d.objectId).find((s) => s.sourceVersionId === e.sourceVersionId);
      passages.push({
        sourceVersionId: e.sourceVersionId, sourceTitle: source?.title ?? "a source",
        // The compiler bounds the budget; the host offers a readable excerpt, not the whole copy.
        text: text.length > 1200 ? `${text.slice(0, 1200)}…` : text,
        rights: (v["rights"] as string) ?? "unknown",
        citedBy: d.objectId,
        supportReviewed: support?.checkedBy === "human",
        relatedToFocus: true,
        // A passage travels with the decision that cites it; if the person barred the atom
        // that carries it, the passage stays home too.
        aiAllowed: e.atomObjectId ? aiAllowed(e.atomObjectId) : true,
      });
    }
  }

  const constraints = graph.constraints.list(worldId).map((c) => ({
    objectId: c.objectId, title: graph.currentState(c.objectId)?.properties.title ?? "a constraint",
    kind: c.definition.kind, value: c.value,
    relatedToFocus: c.appliesTo === focusId || c.appliesTo === worldId,
    aiAllowed: aiAllowed(c.objectId),
  }));

  const impact = impactOf(graph, focusId);
  const changes = [
    ...impact.rebuild.map((r) => ({ kind: "rebuild" as const, subject: r.formRoles.join(", ") || r.stepKey, because: r.because })),
    ...impact.review.map((r) => ({ kind: "review" as const, subject: r.title, because: r.because })),
  ];

  return {
    focus: {
      id: focusId, title: state.properties.title, semanticType: state.properties.semanticType,
      formRoles: state.forms.map((f) => f.role),
      summary: state.properties.tags.length ? `tags: ${state.properties.tags.join(", ")}` : "",
    },
    decisions, passages, constraints, changes,
  };
}
