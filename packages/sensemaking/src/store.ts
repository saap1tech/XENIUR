import { createHash } from "node:crypto";
import type {
  Atom, AtomLink, AtomType, CandidateRecord, CandidateState, ClaimSupport, FrictionState, Lane,
  Locator, MoveKind, ProposedCitation, Relation, ResolvedPassage, Rights, Source, SourceKind,
  SourceVersion, Stance, SupportChecker, SupportStatus, SupportSummary,
} from "@xeniur/core";
import {
  FRICTION_PROMPTS, LocatorSchema, OWN_STANCES, emptyLocator, newId, now,
} from "@xeniur/core";
import type { ObjectGraph } from "@xeniur/graph";
import type { Candidate } from "./extract.js";
import { normaliseText, resolvePassage } from "./locator.js";

export interface SensemakingOptions {
  /** Sources taken in without a single human move before XENIUR stops surfacing more. */
  frictionThreshold?: number;
}

interface AtomRow {
  object_id: string; atom_type: string; source_id: string | null;
  source_version_id: string | null; locator: string;
  confidence: number | null; lane: string | null; extraction: string; stance: string;
  stated_at: number;
}

const parseLocator = (raw: string): Locator =>
  LocatorSchema.parse(JSON.parse(raw || "{}")) as Locator;

const ATOM_TEXT_ROLE = "atom.text";

/**
 * Living Knowledge Objects.
 *
 * An atom is an Object, so it inherits identity, versions, lineage, checks and readiness
 * without any of that being rebuilt here. What lives in this store is only what is
 * particular to knowledge: where it came from, exactly where in the source, how sure the
 * person is, and how it relates to everything else they have thought.
 */
export class SensemakingStore {
  private readonly frictionThreshold: number;

  constructor(private readonly graph: ObjectGraph, opts: SensemakingOptions = {}) {
    this.frictionThreshold = opts.frictionThreshold ?? 8;
  }

  /* ---------------------------------------------------------------- sources */

  /**
   * Records a source and, when the text is given, keeps the copy XENIUR actually read.
   *
   * `text` is not optional in spirit. A source recorded without it can be listed and
   * counted but nothing captured from it can ever be shown again, so anything that has
   * text should pass it — the signature stays permissive only because a conversation or a
   * physical book genuinely has none.
   */
  recordSource(input: {
    worldId: string; kind: SourceKind; title: string;
    url?: string | null; author?: string | null; publishedAt?: number | null; hash?: string | null;
    metadata?: Record<string, unknown>;
    /** The content itself. Stored, hashed, and what every locator resolves against. */
    text?: string;
    raw?: Buffer | null;
    extractor?: string;
    partial?: boolean;
    publicationId?: string | null;
    rights?: Rights;
  }): Source {
    const source: Source = {
      id: newId(), worldId: input.worldId, kind: input.kind, title: input.title,
      url: input.url ?? null, author: input.author ?? null,
      publishedAt: input.publishedAt ?? null, retrievedAt: now(),
      hash: input.hash ?? null, metadata: input.metadata ?? {},
    };
    this.graph.db.prepare(
      `INSERT INTO sources (id, world_id, kind, url, title, author, published_at,
                            retrieved_at, hash, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(source.id, source.worldId, source.kind, source.url, source.title, source.author,
          source.publishedAt, source.retrievedAt, source.hash, JSON.stringify(source.metadata));

    if (input.text !== undefined) {
      this.addSourceVersion({
        sourceId: source.id, text: input.text,
        raw: input.raw ?? null,
        ...(input.extractor !== undefined ? { extractor: input.extractor } : {}),
        ...(input.partial !== undefined ? { partial: input.partial } : {}),
        canonicalUrl: input.url ?? null,
        publicationId: input.publicationId ?? null,
        author: input.author ?? null,
        publishedAt: input.publishedAt ?? null,
        ...(input.rights !== undefined ? { rights: input.rights } : {}),
      });
    }

    // Consuming something is recorded whether or not it ever converts into a move.
    this.graph.db.prepare(
      `INSERT INTO intake (id, world_id, source_id, kind, at) VALUES (?, ?, ?, ?, ?)`,
    ).run(newId(), input.worldId, source.id, input.kind, now());
    return source;
  }

  /* -------------------------------------------------------- source versions */

  /**
   * Stores the copy that was read: normalised text in the blob store, hashed.
   *
   * Two captures of one article produce two versions with the same `contentHash`, which is
   * exactly the fact the Thinking Map needs — capturing something twice is not two sources
   * agreeing with each other.
   */
  addSourceVersion(input: {
    sourceId: string; text: string; raw?: Buffer | null;
    extractor?: string; partial?: boolean;
    canonicalUrl?: string | null; publicationId?: string | null;
    author?: string | null; publishedAt?: number | null; rights?: Rights;
  }): SourceVersion {
    const text = normaliseText(input.text);
    const version: SourceVersion = {
      id: newId(), sourceId: input.sourceId, retrievedAt: now(),
      contentHash: createHash("sha256").update(text, "utf8").digest("hex"),
      textBlobHash: this.graph.putBlob(Buffer.from(text, "utf8"), "text/plain", "txt"),
      rawBlobHash: input.raw
        ? this.graph.putBlob(input.raw, "application/octet-stream", "bin")
        : null,
      extractor: input.extractor ?? "verbatim/1",
      partial: input.partial ?? false,
      canonicalUrl: input.canonicalUrl ?? null,
      publicationId: input.publicationId ?? null,
      author: input.author ?? null,
      publishedAt: input.publishedAt ?? null,
      rights: input.rights ?? "unknown",
    };
    this.graph.db.prepare(
      `INSERT INTO source_versions (id, source_id, retrieved_at, content_hash, raw_blob_hash,
                                    text_blob_hash, extractor, partial, canonical_url,
                                    publication_id, author, published_at, rights)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(version.id, version.sourceId, version.retrievedAt, version.contentHash,
          version.rawBlobHash, version.textBlobHash, version.extractor, version.partial ? 1 : 0,
          version.canonicalUrl, version.publicationId, version.author, version.publishedAt,
          version.rights);
    return version;
  }

  getSourceVersion(id: string): SourceVersion | null {
    const r = this.graph.db.prepare(`SELECT * FROM source_versions WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return r ? toSourceVersion(r) : null;
  }

  /** Every stored copy of a source, newest first. */
  versionsOf(sourceId: string): SourceVersion[] {
    return (this.graph.db.prepare(
      `SELECT * FROM source_versions WHERE source_id = ? ORDER BY retrieved_at DESC, rowid DESC`,
    ).all(sourceId) as Array<Record<string, unknown>>).map(toSourceVersion);
  }

  /** The most recent copy of a source, which is what a fresh capture reads from. */
  latestVersionOf(sourceId: string): SourceVersion | null {
    return this.versionsOf(sourceId)[0] ?? null;
  }

  /** The stored text of a copy, exactly as it was normalised when captured. */
  textOfVersion(sourceVersionId: string): string | null {
    const v = this.getSourceVersion(sourceVersionId);
    return v ? this.graph.readBlob(v.textBlobHash).toString("utf8") : null;
  }

  /**
   * The passage an atom came from, in the stored copy.
   *
   * This is the question durable capture exists to answer. `moved` says the quote was
   * found somewhere other than its recorded offsets — the source was re-extracted and
   * everything shifted — and null says the words are genuinely no longer there, which is
   * a real answer rather than a failure.
   */
  passageOf(objectId: string): ResolvedPassage | null {
    const atom = this.getAtom(objectId);
    if (!atom?.sourceVersionId) return null;
    const text = this.textOfVersion(atom.sourceVersionId);
    if (text === null) return null;
    return resolvePassage(text, atom.locator, atom.sourceVersionId);
  }

  getSource(id: string): Source | null {
    const r = this.graph.db.prepare(`SELECT * FROM sources WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: r["id"] as string, worldId: (r["world_id"] as string | null) ?? null,
      kind: r["kind"] as SourceKind, url: (r["url"] as string | null) ?? null,
      title: r["title"] as string, author: (r["author"] as string | null) ?? null,
      publishedAt: (r["published_at"] as number | null) ?? null,
      retrievedAt: r["retrieved_at"] as number, hash: (r["hash"] as string | null) ?? null,
      metadata: JSON.parse((r["metadata"] as string) || "{}") as Record<string, unknown>,
    };
  }

  listSources(worldId: string): Source[] {
    return (this.graph.db.prepare(
      `SELECT id FROM sources WHERE world_id = ? ORDER BY retrieved_at DESC`,
    ).all(worldId) as Array<{ id: string }>)
      .map((r) => this.getSource(r.id))
      .filter((s): s is Source => s !== null);
  }

  /* ------------------------------------------------------------------ atoms */

  /**
   * Creates an atom as a full Object: the text becomes a form, so it versions, carries
   * provenance, and can be transformed into anything else later.
   */
  createAtom(input: {
    worldId: string; atomType: AtomType; text: string;
    sourceId?: string | null; sourceVersionId?: string | null;
    locator?: Locator; confidence?: number | null;
    lane?: Lane | null; extraction?: Atom["extraction"];
    /** What kind of statement this is. Defaults to an assertion about the world. */
    stance?: Stance;
    /** Whose thinking this is. A person's own observation is not an import. */
    provenance?: "human" | "imported";
  }): Atom {
    return this.graph.db.transaction(() => {
      const title = input.text.length > 72 ? `${input.text.slice(0, 71)}…` : input.text;
      const state = this.graph.createObject({
        worldId: input.worldId, semanticType: input.atomType, title,
        properties: { tags: [input.atomType] },
      });
      const objectId = state.object.id;

      const rep = this.graph.addRepresentation({
        objectId, modality: "text", format: "md",
        blobHash: this.graph.putBlob(Buffer.from(input.text, "utf8"), "text/markdown", "md"),
        provenance: input.provenance ?? (input.sourceId ? "imported" : "human"),
        generationParams: {
          atomType: input.atomType,
          extraction: input.extraction ?? "manual",
          locator: input.locator ?? emptyLocator(),
          sourceVersionId: input.sourceVersionId ?? null,
        },
      });
      this.graph.commitVersion({
        objectId, forms: [{ role: ATOM_TEXT_ROLE, representationId: rep.id }],
        label: `captured a ${input.atomType}`,
      });

      const atom: Atom = {
        objectId, atomType: input.atomType, sourceId: input.sourceId ?? null,
        sourceVersionId: input.sourceVersionId ?? null,
        locator: input.locator ?? emptyLocator(), confidence: input.confidence ?? null,
        lane: input.lane ?? null, extraction: input.extraction ?? "manual",
        stance: input.stance ?? "assertion",
        statedAt: now(), text: input.text,
      };
      this.graph.db.prepare(
        `INSERT INTO atoms (object_id, atom_type, source_id, source_version_id, locator,
                            confidence, lane, extraction, stance, stated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(objectId, atom.atomType, atom.sourceId, atom.sourceVersionId,
            JSON.stringify(atom.locator), atom.confidence, atom.lane, atom.extraction,
            atom.stance, atom.statedAt);
      const sourceVersion = atom.sourceVersionId ? this.getSourceVersion(atom.sourceVersionId) : null;
      this.graph.process.record({
        objectId, versionId: this.graph.currentState(objectId)?.versionId ?? null,
        kind: atom.sourceId ? "source_collected" : "note_written", actor: "human",
        label: atom.sourceId ? `Captured ${atom.atomType} from a source` : `Wrote ${atom.atomType}`,
        tool: null, model: null,
        inputHashes: sourceVersion ? [sourceVersion.contentHash] : [],
        outputHashes: rep.blobHash ? [rep.blobHash] : [], durationMs: 0,
      });
      return atom;
    })();
  }

  /* -------------------------------------------------------------- candidates */

  /**
   * Files pattern matches as suggestions, which is all they are.
   *
   * Nothing here becomes an atom. Extraction used to create atoms outright, and that
   * quietly attributed a regular expression's guess to the person — the same category
   * error as calling a passing file check a verified fact.
   */
  propose(
    worldId: string, sourceVersionId: string, candidates: readonly Candidate[],
    extractor = "heuristic/1",
  ): CandidateRecord[] {
    const insert = this.graph.db.prepare(
      `INSERT INTO capture_candidates (id, world_id, source_version_id, atom_type, text, locator,
                               because, extractor, state, accepted_object_id, decided_at, created_at,
                               stance, citations)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed', NULL, NULL, ?, ?, ?)`,
    );
    return this.graph.db.transaction(() => candidates.map((c) => {
      const record: CandidateRecord = {
        id: newId(), worldId, sourceVersionId, atomType: c.atomType, text: c.text,
        locator: c.locator, because: c.because, extractor, state: "proposed",
        stance: c.stance ?? "assertion", citations: c.citations ?? [],
        acceptedObjectId: null, decidedAt: null, createdAt: now(),
      };
      insert.run(record.id, worldId, sourceVersionId, record.atomType, record.text,
                 JSON.stringify(record.locator), record.because, extractor, record.createdAt,
                 record.stance, JSON.stringify(record.citations));
      return record;
    }))();
  }

  pendingCandidates(worldId: string): CandidateRecord[] {
    return (this.graph.db.prepare(
      `SELECT * FROM capture_candidates WHERE world_id = ? AND state = 'proposed' ORDER BY rowid`,
    ).all(worldId) as Array<Record<string, unknown>>).map(toCandidate);
  }

  getCandidate(id: string): CandidateRecord | null {
    const r = this.graph.db.prepare(`SELECT * FROM capture_candidates WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return r ? toCandidate(r) : null;
  }

  /**
   * Turns one suggestion into an atom, on a person's say-so.
   *
   * Editing the text before accepting is recorded as `edited` rather than `accepted`, so
   * the atom's own wording is never mistaken for the source's.
   */
  /**
   * Turns one suggestion into an atom, on a person's say-so.
   *
   * An assertion that arrives with citations none of which a person has reviewed stays a
   * candidate: a model's opinion that a passage supports a claim is a proposal, and turning it
   * into a sourced atom would be exactly the quiet upgrade this table exists to prevent. The
   * person may accept anyway with `acceptUnreviewed`, and the citations are then recorded as
   * unresolved rather than dropped — the chips stay visibly empty.
   */
  accept(
    candidateId: string,
    edit?: { text?: string; atomType?: AtomType; stance?: Stance; acceptUnreviewed?: boolean },
  ): Atom | null {
    const c = this.getCandidate(candidateId);
    if (!c || c.state !== "proposed") return null;

    // A candidate's citations are unreviewed by definition — a proposed status is the
    // proposer's opinion, not a review. So the question is only whether there are any.
    const stance = edit?.stance ?? c.stance;
    if (stance === "assertion" && c.citations.length > 0 && !edit?.acceptUnreviewed) {
      throw new UnreviewedCitations(candidateId, c.citations.length);
    }

    return this.graph.db.transaction(() => {
      const changed = edit?.text !== undefined && edit.text !== c.text;
      const version = this.getSourceVersion(c.sourceVersionId);
      const atom = this.createAtom({
        worldId: c.worldId, atomType: edit?.atomType ?? c.atomType,
        text: edit?.text ?? c.text,
        sourceId: version?.sourceId ?? null, sourceVersionId: c.sourceVersionId,
        // An edited quote is the person's wording, so it stops claiming to be a quotation.
        locator: changed ? emptyLocator() : c.locator,
        extraction: changed ? "manual" : "heuristic",
        stance,
        provenance: changed ? "human" : "imported",
      });
      // Proposed citations become support rows. A model's proposed status is kept as the
      // model's, and the row stays unsettled until a person looks.
      for (const cite of c.citations) {
        this.recordSupport({
          claimObjectId: atom.objectId, sourceVersionId: cite.sourceVersionId,
          locator: cite.locator, status: cite.proposedStatus, checkedBy: "model",
        });
      }
      this.graph.db.prepare(
        `UPDATE capture_candidates SET state = ?, accepted_object_id = ?, decided_at = ? WHERE id = ?`,
      ).run(changed ? "edited" : "accepted", atom.objectId, now(), candidateId);
      return atom;
    })();
  }

  /* ----------------------------------------------------------- claim support */

  /** Records whether a cited passage bears on a claim. Delegates to the graph's SupportStore. */
  recordSupport(input: {
    claimObjectId: string; sourceVersionId: string; locator?: Locator;
    status?: SupportStatus; checkedBy?: SupportChecker; note?: string;
  }): ClaimSupport {
    return this.graph.support.record(input);
  }

  /** A person's review of one citation — the only thing that settles it. Recorded as a move. */
  reviewSupport(supportId: string, status: SupportStatus, note = ""): ClaimSupport | null {
    const row = this.graph.support.review(supportId, status, note);
    if (row) {
      this.#recordMove(row.claimObjectId, status === "contradicted" ? "challenged" : "rated",
        `support reviewed: ${status}`);
    }
    return row;
  }

  supportOf(claimObjectId: string): ClaimSupport[] { return this.graph.support.of(claimObjectId); }
  supportSummary(claimObjectId: string): SupportSummary { return this.graph.support.summary(claimObjectId); }

  /** Whether an atom speaks for the person rather than about the world. */
  static isOwnStance(stance: Stance): boolean { return OWN_STANCES.includes(stance); }

  /** Rejecting is kept, not deleted: what a person threw away says something about them. */
  reject(candidateId: string): void {
    this.graph.db.prepare(
      `UPDATE capture_candidates SET state = 'rejected', decided_at = ? WHERE id = ? AND state = 'proposed'`,
    ).run(now(), candidateId);
  }

  /** Proposes and accepts in one go, for flows where a person is reviewing as they read. */
  acceptCandidates(
    worldId: string, sourceVersionId: string, candidates: readonly Candidate[],
  ): Atom[] {
    return this.propose(worldId, sourceVersionId, candidates)
      .map((c) => this.accept(c.id))
      .filter((a): a is Atom => a !== null);
  }

  getAtom(objectId: string): Atom | null {
    const r = this.graph.db.prepare(`SELECT * FROM atoms WHERE object_id = ?`).get(objectId) as
      AtomRow | undefined;
    if (!r) return null;
    return {
      objectId: r.object_id, atomType: r.atom_type as AtomType,
      sourceId: r.source_id, sourceVersionId: r.source_version_id,
      locator: parseLocator(r.locator),
      confidence: r.confidence, lane: (r.lane as Lane | null) ?? null,
      extraction: r.extraction as Atom["extraction"],
      stance: (r.stance as Stance) ?? "assertion", statedAt: r.stated_at,
      text: this.#textOf(r.object_id),
    };
  }

  listAtoms(worldId: string): Atom[] {
    return (this.graph.db.prepare(
      `SELECT a.object_id FROM atoms a JOIN objects o ON o.id = a.object_id
       WHERE o.world_id = ? AND o.archived_at IS NULL ORDER BY a.stated_at`,
    ).all(worldId) as Array<{ object_id: string }>)
      .map((r) => this.getAtom(r.object_id))
      .filter((a): a is Atom => a !== null);
  }

  #textOf(objectId: string): string {
    const state = this.graph.currentState(objectId);
    const form = state?.forms.find((f) => f.role === ATOM_TEXT_ROLE);
    const rep = form ? this.graph.getRepresentation(form.representationId) : null;
    return rep?.blobHash ? this.graph.readBlob(rep.blobHash).toString("utf8") : "";
  }

  /* ------------------------------------------------------- the six verbs */

  /** Keep, Question, Connect, Test, Build, Ignore. Each one counts as a human move. */
  sort(objectId: string, lane: Lane): Atom | null {
    this.graph.db.prepare(`UPDATE atoms SET lane = ? WHERE object_id = ?`).run(lane, objectId);
    this.#recordMove(objectId, "sorted", `moved to ${lane}`);
    return this.getAtom(objectId);
  }

  /** The person's confidence, never a model's. */
  rate(objectId: string, confidence: number | null): Atom | null {
    this.graph.db.prepare(`UPDATE atoms SET confidence = ? WHERE object_id = ?`)
      .run(confidence, objectId);
    this.#recordMove(objectId, "rated", confidence === null ? "cleared" : `set to ${confidence}`);
    return this.getAtom(objectId);
  }

  link(input: {
    fromObjectId: string; toObjectId: string; relation: Relation; note?: string | null;
  }): AtomLink {
    const link: AtomLink = {
      id: newId(), fromObjectId: input.fromObjectId, toObjectId: input.toObjectId,
      relation: input.relation, note: input.note ?? null, createdAt: now(),
    };
    this.graph.db.prepare(
      `INSERT OR IGNORE INTO atom_links (id, from_object_id, to_object_id, relation, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(link.id, link.fromObjectId, link.toObjectId, link.relation, link.note, link.createdAt);
    this.#recordMove(input.fromObjectId, input.relation === "contradicts" ? "challenged" : "linked",
      `${input.relation} → ${input.toObjectId.slice(0, 8)}`);
    return link;
  }

  linksOf(objectId: string): AtomLink[] {
    return (this.graph.db.prepare(
      `SELECT * FROM atom_links WHERE from_object_id = ? OR to_object_id = ?`,
    ).all(objectId, objectId) as Array<Record<string, unknown>>).map((r) => ({
      id: r["id"] as string, fromObjectId: r["from_object_id"] as string,
      toObjectId: r["to_object_id"] as string, relation: r["relation"] as Relation,
      note: (r["note"] as string | null) ?? null, createdAt: r["created_at"] as number,
    }));
  }

  /** An observation of the person's own. The highest-value thing in the system. */
  observe(worldId: string, text: string, opts: { about?: string; lane?: Lane } = {}): Atom {
    const atom = this.createAtom({
      worldId, atomType: "claim", text, extraction: "manual",
      provenance: "human", lane: opts.lane ?? "keep",
    });
    if (opts.about) {
      this.link({ fromObjectId: atom.objectId, toObjectId: opts.about, relation: "supports" });
    }
    this.#recordMove(atom.objectId, "observed", text.slice(0, 60));
    return atom;
  }

  /**
   * A move against something in particular.
   *
   * The world alone was not enough: "have I thought about this?" is a question about one
   * Object, and the version matters too, because rating a claim and then rewriting it are
   * different states of mind about different text.
   */
  #recordMove(objectId: string, kind: MoveKind, note: string): void {
    const object = this.graph.getObject(objectId);
    if (!object) return;
    this.graph.db.prepare(
      `INSERT INTO moves (id, world_id, kind, note, at, object_id, version_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), object.worldId, kind, note, now(), objectId, object.currentVersionId);
  }

  recordMove(worldId: string, kind: MoveKind, note = ""): void {
    this.graph.db.prepare(
      `INSERT INTO moves (id, world_id, kind, note, at, object_id, version_id)
       VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(newId(), worldId, kind, note, now());
  }

  /** Every move made against one Object, so "have I thought about this?" has an answer. */
  movesOn(objectId: string): Array<{ kind: MoveKind; note: string; at: number; versionId: string | null }> {
    return (this.graph.db.prepare(
      `SELECT kind, note, at, version_id FROM moves WHERE object_id = ? ORDER BY at, rowid`,
    ).all(objectId) as Array<Record<string, unknown>>).map((r) => ({
      kind: r["kind"] as MoveKind, note: (r["note"] as string | null) ?? "",
      at: r["at"] as number, versionId: (r["version_id"] as string | null) ?? null,
    }));
  }

  /* ------------------------------------------------ productive friction */

  /**
   * Notices when intake has stopped converting into thinking.
   *
   * Past the threshold, XENIUR stops surfacing more and asks for one human move. The
   * threshold is visible, the count is visible, and the prompt is always dismissible with
   * the dismissal recorded — friction a person cannot see or overrule is manipulation, not
   * design.
   */
  friction(worldId: string): FrictionState {
    const lastMove = this.graph.db.prepare(
      `SELECT MAX(at) AS at FROM moves WHERE world_id = ?`,
    ).get(worldId) as { at: number | null };

    const since = lastMove.at ?? 0;
    const intake = this.graph.db.prepare(
      `SELECT COUNT(*) AS n FROM intake WHERE world_id = ? AND at > ?`,
    ).get(worldId, since) as { n: number };

    const active = intake.n >= this.frictionThreshold;
    // Rotated by count so the same question is not asked twice in a row.
    const prompt = active
      ? FRICTION_PROMPTS[intake.n % FRICTION_PROMPTS.length]!
      : null;

    return {
      worldId, intakeSinceMove: intake.n, threshold: this.frictionThreshold,
      active, prompt, dismissible: true, lastMoveAt: lastMove.at,
    };
  }

  /** Dismissing is a recorded decision, not a silent bypass. */
  dismissFriction(worldId: string, reason = ""): void {
    this.recordMove(worldId, "dismissed_friction", reason);
  }
}

/* ------------------------------------------------------------ row mapping */

function toSourceVersion(r: Record<string, unknown>): SourceVersion {
  return {
    id: r["id"] as string, sourceId: r["source_id"] as string,
    retrievedAt: r["retrieved_at"] as number, contentHash: r["content_hash"] as string,
    rawBlobHash: (r["raw_blob_hash"] as string | null) ?? null,
    textBlobHash: r["text_blob_hash"] as string,
    extractor: r["extractor"] as string, partial: Number(r["partial"]) === 1,
    canonicalUrl: (r["canonical_url"] as string | null) ?? null,
    publicationId: (r["publication_id"] as string | null) ?? null,
    author: (r["author"] as string | null) ?? null,
    publishedAt: (r["published_at"] as number | null) ?? null,
    rights: r["rights"] as Rights,
  };
}

function toCandidate(r: Record<string, unknown>): CandidateRecord {
  return {
    id: r["id"] as string, worldId: r["world_id"] as string,
    sourceVersionId: r["source_version_id"] as string,
    atomType: r["atom_type"] as AtomType, text: r["text"] as string,
    locator: parseLocator(r["locator"] as string),
    because: r["because"] as string, extractor: r["extractor"] as string,
    state: r["state"] as CandidateState,
    stance: ((r["stance"] as string | undefined) ?? "assertion") as Stance,
    citations: parseCitations(r["citations"] as string | undefined),
    acceptedObjectId: (r["accepted_object_id"] as string | null) ?? null,
    decidedAt: (r["decided_at"] as number | null) ?? null,
    createdAt: r["created_at"] as number,
  };
}

function parseCitations(raw: string | undefined): ProposedCitation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return parsed.map((c) => ({
      sourceVersionId: c["sourceVersionId"] as string,
      locator: LocatorSchema.parse(c["locator"] ?? {}) as Locator,
      proposedStatus: ((c["proposedStatus"] as string | undefined) ?? "unresolved") as SupportStatus,
    }));
  } catch { return []; }
}

/**
 * Raised when an assertion would be accepted on citations nobody has reviewed.
 *
 * Not a failure: the claim is still there as a candidate. The person may review the citations
 * or accept deliberately with `acceptUnreviewed`, in which case the chips stay visibly empty.
 */
export class UnreviewedCitations extends Error {
  readonly code = "unreviewed_citations" as const;
  constructor(readonly candidateId: string, readonly count: number) {
    super(`this assertion cites ${count} passage${count === 1 ? "" : "s"} nobody has reviewed yet — ` +
          `review them, or accept it knowing the citations stay unresolved`);
    this.name = "UnreviewedCitations";
  }
}
