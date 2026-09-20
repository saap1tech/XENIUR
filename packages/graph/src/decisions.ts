import type {
  Assumption, AssumptionInput, Decision, DecisionDetail, DecisionEvidence, DecisionOption, DecisionState,
  InfluenceReport, ReviewItem, SemanticLink, SemanticRelation,
} from "@xeniur/core";
import { SteelmanRequired, newId, now } from "@xeniur/core";
import type { ObjectGraph } from "./graph.js";

const BRIEF_ROLE = "decision.brief";

/**
 * Decisions, and the review edges that hang off them.
 *
 * A Decision is an ordinary Object, so everything about identity, versioning and undo is
 * inherited rather than reimplemented. What lives here is the part that is particular:
 * the question, the options weighed, the evidence a person cited, the assumptions they
 * were making, and — once accepted — a rendered brief that builds can bind to.
 *
 * The brief matters more than it looks. An accepted decision that only exists as database
 * rows cannot be an input to a recipe; rendered as an ordinary Markdown form it becomes a
 * version-pinned dependency of a delivered asset, which is the whole connection between
 * the thinking half of XENIUR and the making half. No model is involved in producing it.
 */
export class DecisionStore {
  constructor(private readonly graph: ObjectGraph) {}

  /* ------------------------------------------------------------- authoring */

  create(input: {
    worldId: string; question: string;
    options?: readonly DecisionOption[];
    rationale?: string;
    chosenOption?: string | null;
  }): Decision {
    return this.graph.db.transaction(() => {
      const state = this.graph.createObject({
        worldId: input.worldId, semanticType: "decision", title: input.question,
        properties: { tags: ["decision"] },
      });
      const objectId = state.object.id;

      this.graph.db.prepare(
        `INSERT INTO decisions (object_id, question, chosen_option, rationale, state)
         VALUES (?, ?, ?, ?, 'draft')`,
      ).run(objectId, input.question, input.chosenOption ?? null, input.rationale ?? "");

      this.#writeOptions(objectId, input.options ?? []);
      return this.get(objectId)!;
    })();
  }

  /** Editing a draft, or reopening an accepted decision as a new draft state. */
  update(objectId: string, patch: {
    question?: string; chosenOption?: string | null; rationale?: string;
    options?: readonly DecisionOption[];
  }): Decision | null {
    const existing = this.get(objectId);
    if (!existing) return null;

    return this.graph.db.transaction(() => {
      this.graph.db.prepare(
        `UPDATE decisions SET question = ?, chosen_option = ?, rationale = ? WHERE object_id = ?`,
      ).run(patch.question ?? existing.question,
            patch.chosenOption !== undefined ? patch.chosenOption : existing.chosenOption,
            patch.rationale ?? existing.rationale, objectId);
      if (patch.options) this.#writeOptions(objectId, patch.options);
      if (patch.question) {
        this.graph.setProperties(objectId, { title: patch.question }, "reworded the question");
      }
      return this.get(objectId)!;
    })();
  }

  /**
   * Cites a passage, or an atom, as having borne on this decision.
   *
   * The source *version* is what is stored, never the source: "the article said X" stops
   * being checkable the moment the article is edited, and the point of citing it is that
   * somebody can go and read exactly what was read.
   */
  cite(objectId: string, evidence: DecisionEvidence): void {
    let atomVersionId = evidence.atomVersionId;
    if (evidence.atomObjectId && !atomVersionId) {
      atomVersionId = this.graph.currentState(evidence.atomObjectId)?.versionId ?? null;
    }
    this.graph.db.prepare(
      `INSERT INTO decision_evidence (id, decision_id, source_version_id, atom_object_id,
                                      atom_version_id, relation, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), objectId, evidence.sourceVersionId, evidence.atomObjectId,
          atomVersionId, evidence.relation, evidence.note);

    // Citing a passage says it was in view. Whether it *bears on* the decision is a separate
    // fact nobody has established yet, so the support row starts unresolved — and the card
    // shows an empty chip until a person reviews it.
    if (evidence.sourceVersionId) {
      this.graph.support.record({
        claimObjectId: objectId, sourceVersionId: evidence.sourceVersionId,
        status: "unresolved", checkedBy: "unchecked", note: evidence.note,
      });
    }

    // Citing an atom is an assertion about a relationship, so it becomes a review edge.
    // A later edit to that claim should make somebody look at this decision again — and
    // should never, on its own, rebuild anything.
    if (evidence.atomObjectId) {
      this.link({
        fromObjectId: evidence.atomObjectId, fromVersionId: atomVersionId,
        toObjectId: objectId, relation: evidence.relation, note: evidence.note,
      });
    }
  }

  /**
   * "We know the evidence is incomplete, but we are proceeding because of cost and time."
   * A real record on the decision — what is uncertain and why the person went ahead — that
   * the delivery report names. It is a decision, not a verification badge.
   */
  acceptUncertainty(objectId: string, uncertainty: string, because: string): void {
    this.assume(objectId, { text: uncertainty, reviewTrigger: because, kind: "accepted_uncertainty" });
  }

  assume(objectId: string, assumption: AssumptionInput): void {
    this.graph.db.prepare(
      `INSERT INTO decision_assumptions (id, decision_id, text, review_trigger, kind) VALUES (?, ?, ?, ?, ?)`,
    ).run(newId(), objectId, assumption.text, assumption.reviewTrigger ?? "", assumption.kind ?? "assumption");
  }

  /**
   * One reason this could be wrong, asked for before acceptance.
   *
   * Stored as an assumption tagged `steelman`, with an optional review trigger — the
   * condition under which the person would want to look again. The cheapest critical-thinking
   * move there is, and the one most often skipped, which is why it is asked at the moment
   * that matters rather than offered as a feature.
   */
  steelman(objectId: string, text: string, reviewTrigger = ""): void {
    this.graph.db.transaction(() => {
      this.assume(objectId, { text, reviewTrigger, kind: "steelman" });
      this.graph.db.prepare(`UPDATE decisions SET steelman = 'recorded' WHERE object_id = ?`).run(objectId);
    })();
  }

  /** Declining the question is a recorded choice — never silence, never agreement. */
  skipSteelman(objectId: string): void {
    this.graph.db.prepare(
      `UPDATE decisions SET steelman = 'skipped' WHERE object_id = ? AND steelman = 'none'`,
    ).run(objectId);
  }

  /**
   * Accepts a decision, and renders the brief that builds bind to.
   *
   * The brief is generated from the stored fields by string concatenation — deterministic,
   * offline, and reproducible from the same rows forever. Nothing about this step needs a
   * model, and having one write it would make the one document that explains a delivery
   * the least trustworthy thing in the package.
   */
  accept(
    objectId: string, by = "you",
    opts: { steelman?: string; reviewTrigger?: string; skipSteelman?: boolean } = {},
  ): DecisionDetail | null {
    const existing = this.detail(objectId);
    if (!existing) return null;
    if (!existing.chosenOption) throw new Error("a decision cannot be accepted without a choice");

    // Asked once, at the moment it matters. An answer is recorded; a skip is recorded; an
    // accepted decision never carries neither. Re-acceptance keeps whatever was already said.
    if (existing.steelman === "none") {
      if (opts.steelman) this.steelman(objectId, opts.steelman, opts.reviewTrigger ?? "");
      else if (opts.skipSteelman) this.skipSteelman(objectId);
      else throw new SteelmanRequired(objectId);
    }
    const detail = this.detail(objectId)!;

    return this.graph.db.transaction(() => {
      const markdown = renderBrief(detail, this.graph);
      const rep = this.graph.addRepresentation({
        objectId, modality: "text", format: "md",
        blobHash: this.graph.putBlob(Buffer.from(markdown, "utf8"), "text/markdown", "md"),
        provenance: "deterministic", provider: "local.decisions",
        toolVersion: "xeniur decisions 1.0.0",
        generationParams: { chosenOption: detail.chosenOption },
      });
      const state = this.graph.commitVersion({
        objectId, forms: [{ role: BRIEF_ROLE, representationId: rep.id }],
        label: `accepted: ${detail.chosenOption}`,
      });

      this.graph.db.prepare(
        `UPDATE decisions SET state = 'accepted', accepted_by = ?, accepted_at = ?,
                              accepted_version_id = ? WHERE object_id = ?`,
      ).run(by, now(), state.versionId, objectId);
      this.graph.process.record({
        objectId, versionId: state.versionId, kind: "decision_accepted", actor: "human",
        label: `Accepted ${detail.chosenOption}`, tool: null, model: null,
        inputHashes: detail.evidence.flatMap((item) => {
          if (!item.sourceVersionId) return [];
          const row = this.graph.db.prepare(`SELECT content_hash FROM source_versions WHERE id = ?`)
            .get(item.sourceVersionId) as { content_hash: string } | undefined;
          return row ? [row.content_hash] : [];
        }),
        outputHashes: rep.blobHash ? [rep.blobHash] : [], durationMs: 0,
      });
      return this.detail(objectId)!;
    })();
  }

  /**
   * Records a new decision that replaces an older one.
   *
   * The old decision is not edited or deleted: it stays exactly as it was accepted, marked
   * superseded, because a delivery made under it was made under it. Rewriting history to
   * match a later opinion is how a workbench stops being able to explain itself.
   */
  supersede(oldObjectId: string, replacement: {
    worldId: string; question: string; options?: readonly DecisionOption[];
    chosenOption: string; rationale?: string;
  }): Decision {
    const old = this.get(oldObjectId);
    return this.graph.db.transaction(() => {
      const created = this.create(replacement);
      this.graph.db.prepare(
        `UPDATE decisions SET supersedes_decision_id = ?, supersedes_version_id = ? WHERE object_id = ?`,
      ).run(oldObjectId, old?.acceptedVersionId ?? null, created.objectId);
      this.graph.db.prepare(`UPDATE decisions SET state = 'superseded' WHERE object_id = ?`)
        .run(oldObjectId);
      return this.get(created.objectId)!;
    })();
  }

  /** Marks a decision as worth another look, without asserting that it became wrong. */
  flagForReview(objectId: string): void {
    this.graph.db.prepare(
      `UPDATE decisions SET state = 'needs_review' WHERE object_id = ? AND state = 'accepted'`,
    ).run(objectId);
  }

  /** A person has looked, and stands by it. */
  reaffirm(objectId: string, by = "you"): void {
    this.graph.db.prepare(
      `UPDATE decisions SET state = 'accepted', accepted_by = ?, accepted_at = ?
       WHERE object_id = ? AND state = 'needs_review'`,
    ).run(by, now(), objectId);
  }

  /* --------------------------------------------------------------- reading */

  get(objectId: string): Decision | null {
    const r = this.graph.db.prepare(`SELECT * FROM decisions WHERE object_id = ?`).get(objectId) as
      Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      objectId: r["object_id"] as string, question: r["question"] as string,
      chosenOption: (r["chosen_option"] as string | null) ?? null,
      rationale: r["rationale"] as string, state: r["state"] as DecisionState,
      acceptedBy: (r["accepted_by"] as string | null) ?? null,
      acceptedAt: (r["accepted_at"] as number | null) ?? null,
      acceptedVersionId: (r["accepted_version_id"] as string | null) ?? null,
      supersedesDecisionId: (r["supersedes_decision_id"] as string | null) ?? null,
      supersedesVersionId: (r["supersedes_version_id"] as string | null) ?? null,
      steelman: ((r["steelman"] as string | undefined) ?? "none") as Decision["steelman"],
    };
  }

  detail(objectId: string): DecisionDetail | null {
    const decision = this.get(objectId);
    if (!decision) return null;
    return {
      ...decision,
      options: (this.graph.db.prepare(
        `SELECT key, label, note FROM decision_options WHERE decision_id = ? ORDER BY position, key`,
      ).all(objectId) as Array<Record<string, unknown>>).map((r) => ({
        key: r["key"] as string, label: r["label"] as string, note: r["note"] as string,
      })),
      evidence: (this.graph.db.prepare(
        `SELECT * FROM decision_evidence WHERE decision_id = ? ORDER BY rowid`,
      ).all(objectId) as Array<Record<string, unknown>>).map((r) => ({
        sourceVersionId: (r["source_version_id"] as string | null) ?? null,
        atomObjectId: (r["atom_object_id"] as string | null) ?? null,
        atomVersionId: (r["atom_version_id"] as string | null) ?? null,
        relation: r["relation"] as DecisionEvidence["relation"],
        note: r["note"] as string,
      })),
      assumptions: (this.graph.db.prepare(
        `SELECT text, review_trigger, kind FROM decision_assumptions WHERE decision_id = ? ORDER BY rowid`,
      ).all(objectId) as Array<Record<string, unknown>>).map((r) => ({
        text: r["text"] as string, reviewTrigger: r["review_trigger"] as string,
        kind: ((r["kind"] as string | undefined) ?? "assumption") as Assumption["kind"],
      })),
    };
  }

  list(worldId: string, state?: DecisionState): DecisionDetail[] {
    const rows = this.graph.db.prepare(
      `SELECT d.object_id FROM decisions d JOIN objects o ON o.id = d.object_id
       WHERE o.world_id = ? AND o.archived_at IS NULL ${state ? "AND d.state = ?" : ""}
       ORDER BY o.created_at`,
    ).all(...(state ? [worldId, state] : [worldId])) as Array<{ object_id: string }>;
    return rows.map((r) => this.detail(r.object_id)!).filter((d) => d !== null);
  }

  /** The rendered brief of an accepted decision, as stored. */
  briefOf(objectId: string): string | null {
    const decision = this.get(objectId);
    if (!decision?.acceptedVersionId) return null;
    const form = this.graph.formAt(decision.acceptedVersionId, BRIEF_ROLE);
    return form?.blobHash ? this.graph.readBlob(form.blobHash).toString("utf8") : null;
  }

  /* -------------------------------------------------------- semantic links */

  /**
   * Asserts a relationship between two Objects. Propagates review, never rebuild.
   *
   * Self-links and duplicates are rejected outright; the propagation column is written by
   * this method alone, so no caller can create an edge that quietly rebuilds something.
   */
  link(input: {
    fromObjectId: string; toObjectId: string; relation: SemanticRelation;
    fromVersionId?: string | null; toVersionId?: string | null; note?: string;
  }): SemanticLink | null {
    if (input.fromObjectId === input.toObjectId) return null;

    const link: SemanticLink = {
      id: newId(), fromObjectId: input.fromObjectId, toObjectId: input.toObjectId,
      fromVersionId: input.fromVersionId
        ?? this.graph.currentState(input.fromObjectId)?.versionId ?? null,
      toVersionId: input.toVersionId
        ?? this.graph.currentState(input.toObjectId)?.versionId ?? null,
      relation: input.relation, note: input.note ?? "", createdAt: now(),
    };
    const result = this.graph.db.prepare(
      `INSERT OR IGNORE INTO semantic_links
         (id, from_object_id, from_version_id, to_object_id, to_version_id,
          relation, propagates, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'review', ?, ?)`,
    ).run(link.id, link.fromObjectId, link.fromVersionId, link.toObjectId, link.toVersionId,
          link.relation, link.note, link.createdAt);
    return result.changes > 0 ? link : null;
  }

  linksFrom(objectId: string): SemanticLink[] {
    return this.#links(`SELECT * FROM semantic_links WHERE from_object_id = ? ORDER BY rowid`, objectId);
  }

  linksTo(objectId: string): SemanticLink[] {
    return this.#links(`SELECT * FROM semantic_links WHERE to_object_id = ? ORDER BY rowid`, objectId);
  }

  #links(sql: string, id: string): SemanticLink[] {
    return (this.graph.db.prepare(sql).all(id) as Array<Record<string, unknown>>).map((r) => ({
      id: r["id"] as string,
      fromObjectId: r["from_object_id"] as string,
      fromVersionId: (r["from_version_id"] as string | null) ?? null,
      toObjectId: r["to_object_id"] as string,
      toVersionId: (r["to_version_id"] as string | null) ?? null,
      relation: r["relation"] as SemanticRelation,
      note: r["note"] as string, createdAt: r["created_at"] as number,
    }));
  }

  /**
   * What a person should look at again, because something they cited has changed.
   *
   * A link stores the version that was cited. When the cited Object has moved past it, the
   * dependent is worth reviewing — and that is the whole claim. Nothing is marked wrong,
   * nothing is rebuilt, and the sentence explaining it is generated from the edge that
   * caused it rather than written by hand.
   */
  reviewQueue(worldId: string, opts: { depth?: number } = {}): ReviewItem[] {
    const maxDepth = opts.depth ?? 4;
    const links = (this.graph.db.prepare(
      `SELECT l.* FROM semantic_links l
       JOIN objects o ON o.id = l.to_object_id
       WHERE o.world_id = ? AND o.archived_at IS NULL`,
    ).all(worldId) as Array<Record<string, unknown>>).map((r) => ({
      fromObjectId: r["from_object_id"] as string,
      fromVersionId: (r["from_version_id"] as string | null) ?? null,
      toObjectId: r["to_object_id"] as string,
      // Needed as well as the `from` version: for `satisfies` the decision is the cause,
      // and the version pinned when the link was made lives on this end.
      toVersionId: (r["to_version_id"] as string | null) ?? null,
      relation: r["relation"] as SemanticRelation,
    }));

    const titleOf = (id: string): string =>
      this.graph.currentState(id)?.properties.title ?? "something no longer here";

    const items = new Map<string, ReviewItem>();
    const changed = new Set<string>();

    /**
     * Which end of a link is the *cause* and which is the thing worth reviewing.
     *
     * For a citation the reasoning runs forwards: a claim was cited, the claim changed, so
     * look at the decision. For `satisfies` it runs the other way — an asset satisfies a
     * decision, so a changed *decision* is what makes the asset worth checking. Getting
     * this backwards flagged the decision every time the mesh was edited, which put a
     * review beside every rebuild and blurred the one line the product exists to hold.
     */
    const oriented = links.map((link) => link.relation === "satisfies"
      ? { cause: link.toObjectId, causeVersionId: link.toVersionId,
          subject: link.fromObjectId, relation: link.relation }
      : { cause: link.fromObjectId, causeVersionId: link.fromVersionId,
          subject: link.toObjectId, relation: link.relation });

    // First pass: direct citations whose cause has moved on since the link was made.
    for (const link of oriented) {
      const current = this.graph.currentState(link.cause)?.versionId ?? null;
      if (!link.causeVersionId || current === link.causeVersionId) continue;

      changed.add(link.subject);
      items.set(`${link.cause}->${link.subject}`, {
        objectId: link.subject, title: titleOf(link.subject),
        causeObjectId: link.cause, causeTitle: titleOf(link.cause),
        relation: link.relation,
        because: becauseSentence(titleOf(link.cause), titleOf(link.subject), link.relation),
        citedVersionId: link.causeVersionId, currentVersionId: current,
      });
    }

    // Then the review travels along further semantic edges — and only semantic edges.
    for (let depth = 1; depth < maxDepth; depth += 1) {
      const next = new Set(changed);
      for (const link of oriented) {
        if (!changed.has(link.cause) || changed.has(link.subject)) continue;
        next.add(link.subject);
        items.set(`${link.cause}->${link.subject}`, {
          objectId: link.subject, title: titleOf(link.subject),
          causeObjectId: link.cause, causeTitle: titleOf(link.cause),
          relation: link.relation,
          because: `${titleOf(link.cause)} is itself under review, and this depends on it`,
          citedVersionId: link.causeVersionId,
          currentVersionId: this.graph.currentState(link.cause)?.versionId ?? null,
        });
      }
      if (next.size === changed.size) break;
      for (const id of next) changed.add(id);
    }

    // A decision with something to review says so in its own state, so the queue and the
    // decision card never disagree about whether it was looked at. `flagForReview` only
    // touches rows in `decisions`, so an asset in the queue is left alone.
    for (const item of items.values()) this.flagForReview(item.objectId);
    return [...items.values()];
  }

  /**
   * Which accepted decisions and which exact source versions influenced a delivery.
   *
   * Deliberately not a causal claim. Everything here is something a person asserted, at a
   * version that was pinned when they asserted it, and the summary says so in those terms
   * — "decided under", not "caused by". `changedSince` is the honest flag: the decision
   * has moved or been flagged since this delivery went out.
   */
  influenceOn(objectId: string, releaseId?: string): InfluenceReport {
    const release = (this.graph.db.prepare(
      releaseId
        ? `SELECT * FROM releases WHERE id = ?`
        : `SELECT * FROM releases WHERE object_id = ? ORDER BY approved_at DESC LIMIT 1`,
    ).get(releaseId ?? objectId) as Record<string, unknown> | undefined) ?? null;

    const ids: string[] = release
      ? JSON.parse((release["decision_ids"] as string) || "[]") as string[]
      : [];

    const sourceVersionIds = new Set<string>();
    const decisions = ids.map((id) => {
      const detail = this.detail(id);
      const sources = (detail?.evidence ?? [])
        .map((e) => e.sourceVersionId).filter((v): v is string => v !== null);
      for (const v of sources) sourceVersionIds.add(v);

      const currentVersion = this.graph.currentState(id)?.versionId ?? null;
      return {
        objectId: id,
        question: detail?.question ?? "a decision no longer here",
        chosenOption: detail?.chosenOption ?? null,
        acceptedVersionId: detail?.acceptedVersionId ?? null,
        acceptedBy: detail?.acceptedBy ?? null,
        state: (detail?.state ?? "draft") as DecisionState,
        changedSince: detail?.state === "needs_review" || detail?.state === "superseded" ||
                      (detail?.acceptedVersionId !== null && detail?.acceptedVersionId !== currentVersion),
        sourceVersionIds: sources,
        atomObjectIds: (detail?.evidence ?? [])
          .map((e) => e.atomObjectId).filter((v): v is string => v !== null),
      };
    });

    const n = decisions.length;
    const sourceCount = sourceVersionIds.size;
    const changed = decisions.filter((d) => d.changedSince).length;

    return {
      objectId,
      releaseId: (release?.["id"] as string | null) ?? null,
      versionId: (release?.["version_id"] as string | null) ?? null,
      decisions, sourceVersionIds: [...sourceVersionIds],
      summary: n === 0
        ? "No accepted decisions were recorded for this delivery."
        : `Decided under ${n} accepted decision${n === 1 ? "" : "s"}` +
          (sourceCount > 0
            ? `, citing ${sourceCount} stored source cop${sourceCount === 1 ? "y" : "ies"}`
            : ", citing no stored sources") +
          (changed > 0 ? `. ${changed} ${changed === 1 ? "has" : "have"} changed since.` : "."),
    };
  }

  #writeOptions(objectId: string, options: readonly DecisionOption[]): void {
    this.graph.db.prepare(`DELETE FROM decision_options WHERE decision_id = ?`).run(objectId);
    const insert = this.graph.db.prepare(
      `INSERT INTO decision_options (decision_id, key, label, note, position) VALUES (?, ?, ?, ?, ?)`,
    );
    options.forEach((o, i) => insert.run(objectId, o.key, o.label, o.note, i));
  }
}

/** Plain language for one review edge, built from the edge rather than written by hand. */
function becauseSentence(cause: string, subject: string, relation: SemanticRelation): string {
  switch (relation) {
    case "contradicts":
      return `"${cause}" changed, and it was cited as disagreeing with "${subject}" — review recommended`;
    case "supports":
      return `"${cause}" changed, and it was cited as support for "${subject}" — review recommended`;
    case "satisfies":
      return `the decision "${cause}" changed, and "${subject}" was built to satisfy it — review recommended`;
    default:
      return `"${cause}" changed, and "${subject}" was decided with it in view — review recommended`;
  }
}

/**
 * The brief, rendered deterministically from the decision's own rows.
 *
 * Ordinary Markdown, in a fixed order, with no generated prose: the same decision produces
 * the same bytes on any machine, forever. That is what lets a recipe bind to it, a package
 * carry it, and a recipient read it without XENIUR installed.
 */
export function renderBrief(detail: DecisionDetail, graph: ObjectGraph): string {
  const lines: string[] = [];
  const chosen = detail.options.find((o) => o.key === detail.chosenOption);

  lines.push(`# ${detail.question}`, "");
  lines.push(`**Chosen:** ${chosen?.label ?? detail.chosenOption ?? "—"}`, "");
  if (detail.rationale) lines.push("## Why", "", detail.rationale, "");

  const others = detail.options.filter((o) => o.key !== detail.chosenOption);
  if (others.length > 0) {
    lines.push("## Considered and not chosen", "");
    for (const o of others) lines.push(`- **${o.label}**${o.note ? ` — ${o.note}` : ""}`);
    lines.push("");
  }

  if (detail.evidence.length > 0) {
    lines.push("## What this was decided with", "");
    for (const e of detail.evidence) {
      const title = e.atomObjectId
        ? graph.currentState(e.atomObjectId)?.properties.title ?? "a captured claim"
        : "a source";
      const where = e.sourceVersionId ? ` (source copy ${e.sourceVersionId.slice(0, 8)})` : "";
      lines.push(`- ${e.relation.replace(/_/g, " ")}: ${title}${where}${e.note ? ` — ${e.note}` : ""}`);
    }
    lines.push("");
  }

  const assumed = detail.assumptions.filter((a) => a.kind === "assumption");
  const steelmen = detail.assumptions.filter((a) => a.kind === "steelman");
  const acceptedUncertainty = detail.assumptions.filter((a) => a.kind === "accepted_uncertainty");
  if (assumed.length > 0) {
    lines.push("## Assumed", "");
    for (const a of assumed) {
      lines.push(`- ${a.text}${a.reviewTrigger ? `\n  - Revisit if: ${a.reviewTrigger}` : ""}`);
    }
    lines.push("");
  }
  if (acceptedUncertainty.length > 0) {
    // Chosen despite uncertainty: named, with the reason for proceeding. Never a green badge.
    lines.push("## Chosen despite", "");
    for (const a of acceptedUncertainty) {
      lines.push(`- ${a.text}${a.reviewTrigger ? `\n  - Proceeding because: ${a.reviewTrigger}` : ""}`);
    }
    lines.push("");
  }
  if (steelmen.length > 0) {
    lines.push("## How this could be wrong", "");
    for (const a of steelmen) {
      lines.push(`- ${a.text}${a.reviewTrigger ? `\n  - Revisit if: ${a.reviewTrigger}` : ""}`);
    }
    lines.push("");
  } else if (detail.steelman === "skipped") {
    lines.push("## How this could be wrong", "", "_The question was asked and deliberately skipped._", "");
  }

  lines.push("---", "",
    "This brief was generated from the decision record, without a model. " +
    "Citations point at the exact stored copy that was read.");
  return lines.join("\n");
}
