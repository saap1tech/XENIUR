import type {
  Assessment, CriterionMark, JudgingSheetData, Placing, PublisherRef, Results, SignedDocument,
} from "@xeniur/core";
import {
  AssessmentSchema, PlacingSchema, ResultsSchema, documentDigest, newId, now, recordDensity,
} from "@xeniur/core";
import type { Db } from "./db.js";
import type { ObjectGraph } from "./graph.js";
import { trustFactsFor } from "./outcomes.js";
import { verifySignature } from "./publishers.js";

/**
 * Judging: invited judges, each one's signed assessment of each entry, and the publisher's
 * signed results — placings as they wrote them.
 *
 * What this store refuses to do is the point: it holds no sum, computes no average and
 * never orders entries by anything but arrival. A judge sees their own assessments; the
 * publisher sees all of them once judging opens; everyone sees the results once published.
 */
export class JudgingStore {
  constructor(private readonly db: Db, private readonly graph: ObjectGraph) {}

  #challenge(worldId: string) {
    const c = this.graph.challenges.get(worldId);
    if (!c) throw new Error(`no such challenge: ${worldId}`);
    return c;
  }
  #isPublisher(worldId: string): boolean {
    return this.#challenge(worldId).publisher.publicKey === this.graph.publishers.self().publicKey;
  }
  #assertPublisher(worldId: string): void {
    if (!this.#isPublisher(worldId)) throw new Error("only the challenge's publisher can do this");
  }

  /** Invite a judge: a publisher this machine now trusts. Only the challenge's publisher can. */
  invite(worldId: string, judge: PublisherRef): void {
    this.#assertPublisher(worldId);
    this.graph.publishers.seen(judge);
    this.graph.publishers.setTrust(judge, "trusted");
    this.db.prepare(
      `INSERT OR IGNORE INTO challenge_judges (challenge_world_id, judge_public_key, display_name, invited_at) VALUES (?, ?, ?, ?)`,
    ).run(worldId, judge.publicKey, judge.displayName, now());
  }

  judges(worldId: string): Array<PublisherRef & { invitedAt: number }> {
    return (this.db.prepare(`SELECT * FROM challenge_judges WHERE challenge_world_id = ? ORDER BY invited_at`).all(worldId) as Array<{
      judge_public_key: string; display_name: string; invited_at: number;
    }>).map((r) => ({ publicKey: r.judge_public_key, displayName: r.display_name, invitedAt: r.invited_at }));
  }

  isJudge(worldId: string, publicKey: string): boolean {
    const c = this.#challenge(worldId);
    if (c.rules.judging.by === "publisher" && c.publisher.publicKey === publicKey) return true;
    return this.judges(worldId).some((j) => j.publicKey === publicKey);
  }

  /** Judging opens after close, at the publisher's word. Entries become visible to judges then. */
  open(worldId: string): void {
    this.#assertPublisher(worldId);
    const c = this.#challenge(worldId);
    if (now() < c.rules.endsAt) throw new Error("judging opens after the challenge closes");
    this.db.prepare(`UPDATE challenges SET judging_opened_at = COALESCE(judging_opened_at, ?) WHERE world_id = ?`).run(now(), worldId);
  }

  status(worldId: string): { judgingOpenedAt: number | null; resultsPublishedAt: number | null } {
    const r = this.db.prepare(`SELECT judging_opened_at, results_published_at FROM challenges WHERE world_id = ?`).get(worldId) as
      { judging_opened_at: number | null; results_published_at: number | null } | undefined;
    return { judgingOpenedAt: r?.judging_opened_at ?? null, resultsPublishedAt: r?.results_published_at ?? null };
  }

  /** What one judge sees for one entry — facts from the graph, and their own marks if any. */
  sheetFor(worldId: string, entryId: string, judgePublicKey = this.graph.publishers.self().publicKey): JudgingSheetData | null {
    const c = this.#challenge(worldId);
    const entries = this.graph.challenges.entries(worldId, { at: Math.max(now(), c.rules.endsAt) });
    const index = entries.findIndex((e) => e.id === entryId);
    const entry = entries[index];
    if (!entry) return null;
    const objectId = entry.objectId;
    const state = this.graph.currentState(objectId);
    const facts = trustFactsFor(this.graph, objectId);
    const influence = this.graph.decisions.influenceOn(objectId);
    const details = influence.decisions.map((d) => this.graph.decisions.detail(d.objectId)).filter((d) => d !== null);
    const proof = this.graph.process.proof(objectId, "private");
    const seal = this.graph.seal.factsFor(objectId);
    const density = seal ? recordDensity(seal) : null;
    const versions = (this.db.prepare(`SELECT COUNT(*) c FROM versions WHERE object_id = ?`).get(objectId) as { c: number }).c;
    const released = (this.db.prepare(`SELECT COUNT(*) c FROM releases WHERE object_id = ?`).get(objectId) as { c: number }).c > 0;
    const sources = (this.db.prepare(`SELECT COUNT(*) c FROM sources WHERE world_id = ?`).get(state?.object.worldId ?? "") as { c: number }).c;
    const claims = (this.db.prepare(
      `SELECT COUNT(*) c FROM atoms a JOIN objects o ON o.id = a.object_id WHERE o.world_id = ? AND a.atom_type = 'claim'`,
    ).get(state?.object.worldId ?? "") as { c: number }).c;
    const own = this.#assessment(entryId, judgePublicKey);
    return {
      challengeWorldId: worldId, entryId, entryObjectId: objectId,
      entryNumber: index + 1, entryCount: entries.length,
      title: state?.properties.title ?? "an entry",
      participant: entry.publisher,
      criteria: c.rules.judging.criteria, scale: c.rules.judging.scale,
      forms: (state?.forms ?? []).map((f) => {
        const rep = this.graph.getRepresentation(f.representationId);
        return { role: f.role, provenance: rep?.provenance ?? "unknown", modality: rep?.modality ?? "unknown" };
      }),
      research: { sources, claims, supported: facts.support.supported, contradicted: facts.support.contradicted, unresolved: facts.support.unresolved },
      decisions: {
        accepted: details.filter((d) => d.state === "accepted").length,
        withSteelman: details.filter((d) => d.steelman !== "none" && d.steelman !== "skipped").length,
        chosenDespite: details.filter((d) => d.assumptions.some((a) => a.kind === "accepted_uncertainty")).length,
      },
      build: { versions, human: facts.provenance.human, tool: facts.provenance.tool, model: facts.provenance.model },
      delivery: { released, verdict: entry.compliance.verdict, because: entry.compliance.because },
      aiActivity: proof.events.filter((e) => e.actor === "model").map((e) => ({ at: e.at, kind: e.kind, tool: e.tool, model: e.model, label: e.label })),
      observation: {
        verdict: entry.compliance.verdict, density: density?.sentence ?? null,
        gaps: seal?.gaps.length ?? 0, unexplainedPastes: seal?.unexplainedPastes.length ?? 0, exitReason: seal?.exitReason ?? null,
      },
      proofRoot: proof.events.length > 0 ? proof.rootHash : null,
      own,
    };
  }

  /** Record this machine's judgment of one entry: signed by its identity, one per judge per entry. */
  assess(worldId: string, entryId: string, criteria: CriterionMark[], note = ""): SignedDocument<Assessment> {
    const self = this.graph.publishers.self();
    if (!this.isJudge(worldId, self.publicKey)) throw new Error("only an invited judge can record an assessment");
    if (this.status(worldId).judgingOpenedAt === null) throw new Error("judging has not opened");
    const sheet = this.sheetFor(worldId, entryId, self.publicKey);
    if (!sheet) throw new Error(`no such entry: ${entryId}`);
    const named = new Set(sheet.criteria);
    for (const m of criteria) if (!named.has(m.criterion)) throw new Error(`"${m.criterion}" is not one of this challenge's criteria`);
    const body = AssessmentSchema.parse({
      id: newId(), challengeWorldId: worldId, entryId, entryObjectId: sheet.entryObjectId, judge: self.ref(),
      criteria, note,
      inspected: { proofRoot: sheet.proofRoot, verdict: sheet.observation.verdict, density: sheet.observation.density, modelEvents: sheet.aiActivity.length },
      recordedAt: now(),
    });
    const signature = self.sign(documentDigest(body));
    this.#store(body, signature);
    return { kind: "xeniur.judging/1", body, signature };
  }

  /** A judge's assessment that arrived from elsewhere. Refused unless it verifies and the judge was invited. */
  adopt(doc: SignedDocument<unknown>): Assessment {
    if (doc.kind !== "xeniur.judging/1") throw new Error("not a judging document");
    const body = AssessmentSchema.parse(doc.body);
    if (!verifySignature(doc.signature) || doc.signature.rootHash !== documentDigest(body) || doc.signature.publicKey !== body.judge.publicKey) {
      throw new Error("the assessment does not verify against its judge's signature");
    }
    if (!this.isJudge(body.challengeWorldId, body.judge.publicKey)) throw new Error("this judge was not invited to this challenge");
    if (!this.db.prepare(`SELECT 1 FROM challenge_entries WHERE id = ? AND challenge_world_id = ?`).get(body.entryId, body.challengeWorldId)) {
      throw new Error("the assessment names an entry this challenge does not have");
    }
    this.#store(body, doc.signature);
    return body;
  }

  #store(body: Assessment, signature: SignedDocument<Assessment>["signature"]): void {
    this.db.prepare(
      `INSERT INTO assessments (id, challenge_world_id, entry_id, judge_public_key, body, signature, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entry_id, judge_public_key) DO UPDATE SET id = excluded.id, body = excluded.body, signature = excluded.signature, recorded_at = excluded.recorded_at`,
    ).run(body.id, body.challengeWorldId, body.entryId, body.judge.publicKey, JSON.stringify(body), JSON.stringify(signature), body.recordedAt);
  }

  #assessment(entryId: string, judgePublicKey: string): Assessment | null {
    const r = this.db.prepare(`SELECT body FROM assessments WHERE entry_id = ? AND judge_public_key = ?`).get(entryId, judgePublicKey) as { body: string } | undefined;
    return r ? AssessmentSchema.parse(JSON.parse(r.body)) : null;
  }

  /** A signed copy of this machine's assessment, to send back. */
  exportAssessment(assessmentId: string): SignedDocument<Assessment> | null {
    const r = this.db.prepare(`SELECT body, signature FROM assessments WHERE id = ?`).get(assessmentId) as { body: string; signature: string } | undefined;
    return r ? { kind: "xeniur.judging/1", body: AssessmentSchema.parse(JSON.parse(r.body)), signature: JSON.parse(r.signature) } : null;
  }

  /**
   * Assessments visible to this machine: its own, always; everyone's once it is the publisher
   * with judging open, or once results are published. In recording order, never by mark.
   */
  assessments(worldId: string): Assessment[] {
    const self = this.graph.publishers.self().publicKey;
    const all = this.#isPublisher(worldId) || this.status(worldId).resultsPublishedAt !== null;
    const rows = this.db.prepare(
      all ? `SELECT body FROM assessments WHERE challenge_world_id = ? ORDER BY recorded_at, rowid`
          : `SELECT body FROM assessments WHERE challenge_world_id = ? AND judge_public_key = ? ORDER BY recorded_at, rowid`,
    ).all(...(all ? [worldId] : [worldId, self])) as Array<{ body: string }>;
    return rows.map((r) => AssessmentSchema.parse(JSON.parse(r.body)));
  }

  /**
   * The publisher writes the placings — a word, an entry, a reason — in their order, and
   * signs them. Every placed entry carries its process proof root and verdict so the results
   * are inspectable. Nothing is sorted; nothing is summed.
   */
  publishResults(worldId: string, placings: Placing[], note = ""): SignedDocument<Results> {
    this.#assertPublisher(worldId);
    if (this.status(worldId).judgingOpenedAt === null) throw new Error("judging has not opened");
    const self = this.graph.publishers.self();
    const c = this.#challenge(worldId);
    const entries = this.graph.challenges.entries(worldId, { at: Math.max(now(), c.rules.endsAt) });
    const finalists = placings.map((p) => {
      const parsed = PlacingSchema.parse(p);
      const entry = entries.find((e) => e.id === parsed.entryId && e.objectId === parsed.objectId);
      if (!entry) throw new Error(`placing "${parsed.place}" names an entry this challenge does not have`);
      const proof = this.graph.process.proof(entry.objectId, "private");
      const seal = this.graph.seal.factsFor(entry.objectId);
      return {
        entryId: entry.id, objectId: entry.objectId,
        title: this.graph.currentState(entry.objectId)?.properties.title ?? "an entry",
        participant: entry.publisher,
        proofRoot: proof.events.length > 0 ? proof.rootHash : null,
        verdict: entry.compliance.verdict,
        density: seal ? recordDensity(seal).sentence : null,
      };
    });
    const body = ResultsSchema.parse({
      challengeWorldId: worldId, placings, finalists, note,
      assessmentsRead: this.assessments(worldId).length, publishedAt: now(),
    });
    const signature = self.sign(documentDigest(body));
    this.db.transaction(() => {
      this.db.prepare(`INSERT OR REPLACE INTO challenge_results (challenge_world_id, body, signature, published_at) VALUES (?, ?, ?, ?)`)
        .run(worldId, JSON.stringify(body), JSON.stringify(signature), body.publishedAt);
      this.db.prepare(`UPDATE challenges SET results_published_at = ? WHERE world_id = ?`).run(body.publishedAt, worldId);
    })();
    return { kind: "xeniur.results/1", body, signature };
  }

  /** Results that arrived from the publisher. Refused unless they verify against the challenge's publisher. */
  adoptResults(doc: SignedDocument<unknown>): Results {
    if (doc.kind !== "xeniur.results/1") throw new Error("not a results document");
    const body = ResultsSchema.parse(doc.body);
    const c = this.#challenge(body.challengeWorldId);
    if (!verifySignature(doc.signature) || doc.signature.rootHash !== documentDigest(body) || doc.signature.publicKey !== c.publisher.publicKey) {
      throw new Error("the results do not verify against the challenge's publisher");
    }
    this.db.transaction(() => {
      this.db.prepare(`INSERT OR REPLACE INTO challenge_results (challenge_world_id, body, signature, published_at) VALUES (?, ?, ?, ?)`)
        .run(body.challengeWorldId, JSON.stringify(body), JSON.stringify(doc.signature), body.publishedAt);
      this.db.prepare(`UPDATE challenges SET results_published_at = ? WHERE world_id = ?`).run(body.publishedAt, body.challengeWorldId);
    })();
    return body;
  }

  results(worldId: string): SignedDocument<Results> | null {
    const r = this.db.prepare(`SELECT body, signature FROM challenge_results WHERE challenge_world_id = ?`).get(worldId) as { body: string; signature: string } | undefined;
    return r ? { kind: "xeniur.results/1", body: ResultsSchema.parse(JSON.parse(r.body)), signature: JSON.parse(r.signature) } : null;
  }
}
