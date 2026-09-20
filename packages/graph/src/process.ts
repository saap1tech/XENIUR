import type { DerivationNotice, ProcessActor, ProcessEvent, ProcessEventKind, ProcessProof } from "@xeniur/core";
import { newId, now, sha256Hex, zeroProcessCounts } from "@xeniur/core";
import type { Db } from "./db.js";
import { json } from "./db.js";

interface ProcessRow {
  id: string; object_id: string; version_id: string | null; kind: ProcessEventKind; actor: ProcessActor;
  label: string; tool: string | null; model: string | null; input_hashes: string; output_hashes: string;
  duration_ms: number; at: number; origin: ProcessEvent["origin"] | null; origin_size: number | null; origin_source_id: string | null;
}

const toEvent = (row: ProcessRow): ProcessEvent => ({
  id: row.id, objectId: row.object_id, versionId: row.version_id, kind: row.kind, actor: row.actor,
  label: row.label, tool: row.tool, model: row.model,
  inputHashes: json.parse(row.input_hashes, []), outputHashes: json.parse(row.output_hashes, []),
  durationMs: row.duration_ms, at: row.at,
  origin: row.origin ?? null, originSize: row.origin_size ?? null, originSourceId: row.origin_source_id ?? null,
});

export class ProcessStore {
  constructor(private readonly db: Db) {}

  record(input: Omit<ProcessEvent, "id" | "at" | "origin" | "originSize" | "originSourceId">
    & { at?: number; origin?: ProcessEvent["origin"]; originSize?: number | null; originSourceId?: string | null }): ProcessEvent {
    const event: ProcessEvent = {
      ...input, id: newId(), at: input.at ?? now(),
      origin: input.origin ?? null, originSize: input.originSize ?? null, originSourceId: input.originSourceId ?? null,
    };
    this.db.prepare(
      `INSERT INTO process_events (id, object_id, version_id, kind, actor, label, tool, model,
         input_hashes, output_hashes, duration_ms, at, origin, origin_size, origin_source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(event.id, event.objectId, event.versionId, event.kind, event.actor, event.label,
      event.tool, event.model, json.stringify(event.inputHashes), json.stringify(event.outputHashes),
      event.durationMs, event.at, event.origin, event.originSize, event.originSourceId);
    return event;
  }

  /**
   * A paste, as the surface saw it: how much, into which Object, and the Source Object behind
   * it if the person named one. Recorded as a human manual edit with origin `pasted` — a
   * fact about where material came from, never a claim about a model.
   */
  recordPaste(input: { objectId: string; versionId: string | null; chars: number; sourceObjectId?: string | null; at?: number }): ProcessEvent {
    return this.record({
      objectId: input.objectId, versionId: input.versionId, kind: "manual_edit", actor: "human",
      label: `pasted ${input.chars} characters${input.sourceObjectId ? " from a source" : ""}`,
      tool: null, model: null, inputHashes: [], outputHashes: [], durationMs: 0,
      at: input.at, origin: "pasted", originSize: input.chars, originSourceId: input.sourceObjectId ?? null,
    });
  }

  events(objectId: string): ProcessEvent[] {
    return (this.db.prepare(
      `WITH RECURSIVE related(id) AS (
         SELECT ?
         UNION
         SELECT sl.from_object_id FROM semantic_links sl JOIN related r ON sl.to_object_id = r.id
       )
       SELECT pe.* FROM process_events pe JOIN related r ON r.id = pe.object_id ORDER BY pe.at, pe.rowid`,
    )
      .all(objectId) as ProcessRow[]).map(toEvent);
  }

  proof(objectId: string, privacy: ProcessProof["privacy"] = "private"): ProcessProof {
    const all = this.events(objectId);
    const events = privacy === "private" ? all : all.map((event) => ({
      ...event, label: event.kind.replaceAll("_", " "), tool: privacy === "public" ? event.tool : null,
      model: privacy === "public" ? event.model : null,
    }));
    const counts = zeroProcessCounts();
    for (const event of all) {
      if (event.kind === "sketch_made" && event.actor === "human") counts.userCreatedSketches += 1;
      if (event.kind === "source_collected") counts.researchedSources += 1;
      if (event.kind === "decision_accepted" && event.actor === "human") counts.acceptedHumanDecisions += 1;
      if (event.kind === "manual_edit" || (event.kind === "revision" && event.actor === "human")) counts.manualRevisions += 1;
      if (event.kind === "experiment_rejected") counts.rejectedExperiments += 1;
      if (event.actor === "model") counts.modelTouchedSteps += 1;
      if (event.actor === "tool") counts.toolSteps += 1;
      if (event.kind === "xeniur_session") {
        counts.recordedXeniurSessions += 1;
        counts.recordedSessionMs += event.durationMs;
      }
    }
    const named = (count: number, singular: string, plural = `${singular}s`) =>
      `${count} ${count === 1 ? singular : plural}`;
    const pieces = [
      counts.userCreatedSketches && `${named(counts.userCreatedSketches, "sketch")} recorded as user-created`,
      counts.researchedSources && named(counts.researchedSources, "researched source"),
      counts.acceptedHumanDecisions && named(counts.acceptedHumanDecisions, "accepted human decision"),
      counts.manualRevisions && named(counts.manualRevisions, "manual revision"),
      counts.modelTouchedSteps && `AI used at ${named(counts.modelTouchedSteps, "recorded step")}`,
      counts.recordedXeniurSessions && `${named(counts.recordedXeniurSessions, "recorded XENIUR session")} (${Math.round(counts.recordedSessionMs / 60000)} min recorded)`,
    ].filter(Boolean);
    const disclosedHashes = [...new Set(events.flatMap((event) => [...event.inputHashes, ...event.outputHashes]))].sort();
    const canonical = JSON.stringify({ objectId, privacy, events, disclosedHashes });
    return {
      objectId, summary: pieces.join(" / ") || "No process events recorded", counts, events,
      disclosedHashes, rootHash: sha256Hex(canonical), privacy, generatedAt: events.at(-1)?.at ?? 0,
    };
  }

  publish(objectId: string, privacy: "filtered" | "public" = "filtered"): ProcessProof {
    const proof = this.proof(objectId, privacy);
    this.db.prepare(
      `INSERT INTO process_proofs (id, object_id, privacy, proof_hash, snapshot, published_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId(), objectId, privacy, proof.rootHash, json.stringify(proof), proof.generatedAt);
    return proof;
  }

  noticeDerivation(input: Omit<DerivationNotice, "statement">): DerivationNotice {
    const notice: DerivationNotice = {
      ...input,
      statement: "Recorded similarity is context to disclose. It is not proof of theft or legal ownership.",
    };
    this.db.prepare(
      `INSERT INTO derivation_notices (id, source_object_id, derived_object_id, overlap, invitation, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId(), input.sourceObjectId, input.derivedObjectId, input.overlap, input.invitation, now());
    return notice;
  }
}
