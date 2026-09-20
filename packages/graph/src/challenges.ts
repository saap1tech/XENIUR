import type {
  AiPolicy, ChallengeRecord, ChallengeRules, ChallengeRulesInput, Compliance, EntryRecord, EntryRecordForCheck,
  PackageSignature, PublisherRef,
} from "@xeniur/core";
import {
  AI_POLICIES, AI_POLICY_WORDS, ChallengeRulesSchema, canonicalJson, checkAiPolicy, newId, now, sha256Hex,
} from "@xeniur/core";
import type { Db } from "./db.js";
import type { ObjectGraph } from "./graph.js";
import type { PublisherIdentity } from "./publishers.js";
import { verifySignature } from "./publishers.js";

/**
 * Challenges: a World with signed rules; entries with a compliance verdict read from the
 * record. Judging is human and criteria are visible before entry. Nothing here ranks.
 */
export class ChallengeStore {
  constructor(private readonly db: Db, private readonly graph: ObjectGraph) {}

  /** Publishes a challenge from this machine, signed by its identity. */
  create(input: ChallengeRulesInput, publisher: PublisherIdentity): ChallengeRecord {
    const rules = ChallengeRulesSchema.parse(input);
    const digest = rulesDigest(rules);
    return this.#insert(rules, publisher.ref(), publisher.sign(digest));
  }

  /** Records a challenge that arrived from elsewhere. Refused unless its rules verify. */
  adopt(rules: ChallengeRules, publisher: PublisherRef, signature: PackageSignature): ChallengeRecord {
    if (!verifySignature(signature) || signature.rootHash !== rulesDigest(rules) || signature.publicKey !== publisher.publicKey) {
      throw new Error("the challenge's rules do not verify against its publisher's signature");
    }
    return this.#insert(ChallengeRulesSchema.parse(rules), publisher, signature);
  }

  #insert(rules: ChallengeRules, publisher: PublisherRef, signature: PackageSignature): ChallengeRecord {
    return this.db.transaction(() => {
      this.graph.publishers.seen(publisher);
      const world = this.graph.createWorld({
        title: rules.title, emoji: "◷", summary: rules.brief.slice(0, 200), kind: "challenge", publisherId: publisher.publicKey,
      });
      // The dates and the policy are Constraint Objects: the same primitives every World uses.
      const deadline = this.graph.createObject({ worldId: world.id, semanticType: "constraint", title: "Dates" }).object.id;
      this.graph.constraints.define(deadline, { kind: "date_range", earliest: rules.startsAt, latest: rules.endsAt },
        "challenge", { start: rules.startsAt, end: rules.endsAt });
      const policy = this.graph.createObject({ worldId: world.id, semanticType: "constraint", title: "AI policy" }).object.id;
      this.graph.constraints.define(policy, {
        kind: "enum", multiple: false,
        options: AI_POLICIES.map((p) => ({ id: p, label: AI_POLICY_WORDS[p].label })),
      }, "challenge", rules.aiPolicy);
      const createdAt = now();
      this.db.prepare(
        `INSERT INTO challenges (world_id, publisher_id, rules, rules_digest, signature, starts_at, ends_at, ai_policy,
                                 deadline_constraint_id, policy_constraint_id, created_at, dismissed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(world.id, publisher.publicKey, JSON.stringify(rules), signature.rootHash, JSON.stringify(signature),
        rules.startsAt, rules.endsAt, rules.aiPolicy, deadline, policy, createdAt);
      return this.get(world.id)!;
    })();
  }

  get(worldId: string): ChallengeRecord | null {
    const r = this.db.prepare(
      `SELECT c.*, p.display_name FROM challenges c JOIN publishers p ON p.id = c.publisher_id WHERE c.world_id = ?`,
    ).get(worldId) as Row | undefined;
    return r ? fromRow(r) : null;
  }

  list(): ChallengeRecord[] {
    return (this.db.prepare(
      `SELECT c.*, p.display_name FROM challenges c JOIN publishers p ON p.id = c.publisher_id ORDER BY c.ends_at`,
    ).all() as Row[]).map(fromRow);
  }

  /** Open right now. */
  active(at = now()): ChallengeRecord[] {
    return this.list().filter((c) => c.rules.startsAt <= at && at < c.rules.endsAt);
  }

  /**
   * Challenges whose deliverable overlaps what this person already makes — for one quiet
   * Today row, once. Dismissing is recorded and it does not come back.
   */
  matching(at = now()): ChallengeRecord[] {
    const roles = new Set(
      (this.db.prepare(`SELECT DISTINCT role FROM version_forms`).all() as Array<{ role: string }>).map((r) => r.role),
    );
    return this.active(at).filter((c) =>
      c.dismissedAt === null && c.rules.deliverable.formRoles.some((role) => roles.has(role)));
  }

  dismiss(worldId: string): void {
    this.db.prepare(`UPDATE challenges SET dismissed_at = ? WHERE world_id = ? AND dismissed_at IS NULL`).run(now(), worldId);
  }

  /** Enter an Object. The verdict is computed now and again whenever `evaluate` is called. */
  enter(challengeWorldId: string, objectId: string, publisher: PublisherRef): EntryRecord {
    const challenge = this.get(challengeWorldId);
    if (!challenge) throw new Error(`no such challenge: ${challengeWorldId}`);
    if (now() >= challenge.rules.endsAt) throw new Error("this challenge has closed");
    this.graph.publishers.seen(publisher);
    const compliance = this.check(objectId, challenge.rules.aiPolicy);
    const id = newId();
    this.db.prepare(
      `INSERT INTO challenge_entries (id, challenge_world_id, object_id, publisher_id, package_root, compliance, submitted_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(challenge_world_id, object_id) DO UPDATE SET compliance = excluded.compliance, submitted_at = excluded.submitted_at`,
    ).run(id, challengeWorldId, objectId, publisher.publicKey, JSON.stringify(compliance), now());
    return this.entry(challengeWorldId, objectId)!;
  }

  /** Re-reads the record and updates the verdict. Live, because the record can grow. */
  evaluate(challengeWorldId: string, objectId: string): EntryRecord | null {
    const challenge = this.get(challengeWorldId);
    const existing = this.entry(challengeWorldId, objectId);
    if (!challenge || !existing) return null;
    const compliance = this.check(objectId, challenge.rules.aiPolicy);
    this.db.prepare(`UPDATE challenge_entries SET compliance = ? WHERE id = ?`).run(JSON.stringify(compliance), existing.id);
    return this.entry(challengeWorldId, objectId);
  }

  /**
   * The pure check over what the graph holds about this Object. Nothing is inferred to fill a
   * gap. When a Sealed Session covered the making, its facts go in too: they can lower the
   * verdict to *the record does not say*, never raise it.
   */
  check(objectId: string, policy: AiPolicy): Compliance {
    return checkAiPolicy(this.recordFor(objectId), policy, this.graph.seal.factsFor(objectId));
  }

  recordFor(objectId: string): EntryRecordForCheck {
    const events = this.graph.process.proof(objectId, "private").events.map((e) => ({
      kind: e.kind, actor: e.actor, tool: e.tool, model: e.model, label: e.label,
    }));
    const state = this.graph.currentState(objectId);
    const representations: EntryRecordForCheck["representations"] = [];
    for (const f of state?.forms ?? []) {
      const rep = this.graph.getRepresentation(f.representationId);
      if (!rep) continue;
      // The whole lineage behind each delivered form: a generated intermediate counts even
      // when the final export is deterministic.
      for (const a of this.graph.actionsInLineage(rep.id)) {
        for (const o of this.graph.outputsOf(a.id)) {
          const r = o.representation;
          representations.push({ id: r.id, modality: r.modality, provenance: r.provenance, formRole: null, tool: a.tool });
        }
      }
      representations.push({ id: rep.id, modality: rep.modality, provenance: rep.provenance, formRole: f.role, tool: null });
    }
    // One row per representation, the form-bearing one winning.
    const seen = new Map<string, EntryRecordForCheck["representations"][number]>();
    for (const r of representations) if (!seen.has(r.id) || r.formRole) seen.set(r.id, r);
    return { events, representations: [...seen.values()] };
  }

  entry(challengeWorldId: string, objectId: string): EntryRecord | null {
    const r = this.db.prepare(
      `SELECT e.*, p.display_name FROM challenge_entries e JOIN publishers p ON p.id = e.publisher_id
       WHERE e.challenge_world_id = ? AND e.object_id = ?`,
    ).get(challengeWorldId, objectId) as EntryRow | undefined;
    return r ? entryFromRow(r) : null;
  }

  /** Entries, in submission order. Other people's appear only after close; never ranked. */
  entries(challengeWorldId: string, opts: { self?: string | null; at?: number } = {}): EntryRecord[] {
    const challenge = this.get(challengeWorldId);
    if (!challenge) return [];
    const closed = (opts.at ?? now()) >= challenge.rules.endsAt;
    const rows = this.db.prepare(
      `SELECT e.*, p.display_name FROM challenge_entries e JOIN publishers p ON p.id = e.publisher_id
       WHERE e.challenge_world_id = ? ORDER BY e.submitted_at, e.rowid`,
    ).all(challengeWorldId) as EntryRow[];
    return rows.map(entryFromRow).filter((e) => closed || e.publisher.publicKey === opts.self);
  }
}

export function rulesDigest(rules: ChallengeRules): string {
  return sha256Hex(canonicalJson(rules));
}

type Row = {
  world_id: string; publisher_id: string; display_name: string; rules: string; rules_digest: string; signature: string;
  starts_at: number; ends_at: number; ai_policy: AiPolicy; deadline_constraint_id: string; policy_constraint_id: string;
  created_at: number; dismissed_at: number | null;
};
const fromRow = (r: Row): ChallengeRecord => ({
  worldId: r.world_id, publisher: { publicKey: r.publisher_id, displayName: r.display_name },
  rules: ChallengeRulesSchema.parse(JSON.parse(r.rules)), signature: JSON.parse(r.signature) as PackageSignature,
  deadlineConstraintId: r.deadline_constraint_id, policyConstraintId: r.policy_constraint_id,
  createdAt: r.created_at, dismissedAt: r.dismissed_at,
});

type EntryRow = {
  id: string; challenge_world_id: string; object_id: string; publisher_id: string; display_name: string;
  package_root: string | null; compliance: string; submitted_at: number;
};
const entryFromRow = (r: EntryRow): EntryRecord => ({
  id: r.id, challengeWorldId: r.challenge_world_id, objectId: r.object_id,
  publisher: { publicKey: r.publisher_id, displayName: r.display_name },
  packageRoot: r.package_root, compliance: JSON.parse(r.compliance) as Compliance, submittedAt: r.submitted_at,
});
