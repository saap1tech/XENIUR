import type {
  MetricsDisclosure, RevisionMetrics, SessionEvent, SessionEventKind, SessionRecord,
} from "@xeniur/core";
import { EVENT_MEANINGS, SESSION_EVENT_KINDS, newId, now } from "@xeniur/core";
import type { Db } from "./db.js";

/**
 * Local session metrics — recorded on this machine, readable by the person, and sent
 * nowhere.
 *
 * There is one question worth measuring: is the second revision easier than the first?
 * Everything here is chosen to answer it, and the store deliberately has no network code
 * of any kind, so "nothing leaves the machine" is a property of what exists rather than a
 * promise about what runs.
 *
 * The `detail` column is guarded rather than trusted: content is stripped on the way in,
 * so a caller cannot record a title or a path by accident. A metrics store that could
 * quietly accumulate a person's work would be worse than no metrics at all.
 */
export class MetricsStore {
  #sessionId: string | null = null;

  constructor(private readonly db: Db) {}

  /** Starts a session. Ending one that was never ended is fine — the row simply has no end. */
  start(worldId: string | null = null): SessionRecord {
    const record: SessionRecord = {
      id: newId(), startedAt: now(), endedAt: null, activeMs: 0, waitingMs: 0, worldId,
    };
    this.db.prepare(
      `INSERT INTO sessions (id, started_at, ended_at, active_ms, waiting_ms, world_id)
       VALUES (?, ?, NULL, 0, 0, ?)`,
    ).run(record.id, record.startedAt, worldId);
    this.#sessionId = record.id;
    this.record("session_started");
    return record;
  }

  end(activeMs = 0, waitingMs = 0): void {
    if (!this.#sessionId) return;
    this.record("session_ended");
    this.db.prepare(
      `UPDATE sessions SET ended_at = ?, active_ms = ?, waiting_ms = ? WHERE id = ?`,
    ).run(now(), activeMs, waitingMs, this.#sessionId);
    this.#sessionId = null;
  }

  /**
   * Records one moment in the loop.
   *
   * Silently does nothing outside a session rather than starting one implicitly: a metric
   * recorded by a background job is not a person doing something.
   */
  record(
    kind: SessionEventKind, opts: { objectId?: string | null; detail?: Record<string, unknown> } = {},
  ): void {
    if (!this.#sessionId) return;
    this.db.prepare(
      `INSERT INTO session_events (id, session_id, kind, object_id, detail, at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId(), this.#sessionId, kind, opts.objectId ?? null,
          JSON.stringify(safeDetail(opts.detail ?? {})), now());
  }

  events(sessionId?: string): SessionEvent[] {
    return (this.db.prepare(
      sessionId
        ? `SELECT * FROM session_events WHERE session_id = ? ORDER BY at, rowid`
        : `SELECT * FROM session_events ORDER BY at, rowid`,
    ).all(...(sessionId ? [sessionId] : [])) as Array<Record<string, unknown>>).map((r) => ({
      id: r["id"] as string, sessionId: r["session_id"] as string,
      kind: r["kind"] as SessionEventKind,
      objectId: (r["object_id"] as string | null) ?? null,
      detail: JSON.parse((r["detail"] as string) || "{}") as Record<string, unknown>,
      at: r["at"] as number,
    }));
  }

  sessions(): SessionRecord[] {
    return (this.db.prepare(`SELECT * FROM sessions ORDER BY started_at`).all() as
      Array<Record<string, unknown>>).map((r) => ({
      id: r["id"] as string, startedAt: r["started_at"] as number,
      endedAt: (r["ended_at"] as number | null) ?? null,
      activeMs: r["active_ms"] as number, waitingMs: r["waiting_ms"] as number,
      worldId: (r["world_id"] as string | null) ?? null,
    }));
  }

  /**
   * Whether the second delivery was easier than the first.
   *
   * The first delivery is timed from the first import, because that is when the work
   * actually began. The second is timed from the change that started it, not from the
   * first delivery — the gap in between is a person living their life, and counting it
   * would make every measurement a measurement of how busy they were.
   */
  revision(): RevisionMetrics {
    const events = this.events();
    const at = (kind: SessionEventKind): number[] =>
      events.filter((e) => e.kind === kind).map((e) => e.at);

    const firstImport = at("first_import")[0] ?? null;
    const deliveries = at("delivery_approved");
    const changes = at("source_changed");

    const firstDeliveryMs = firstImport !== null && deliveries[0] !== undefined
      ? deliveries[0] - firstImport : null;

    // The change that started the second delivery: the last one before it.
    let secondDeliveryMs: number | null = null;
    if (deliveries[1] !== undefined) {
      const started = [...changes].filter((t) => t < deliveries[1]! && t > (deliveries[0] ?? 0)).pop();
      if (started !== undefined) secondDeliveryMs = deliveries[1] - started;
    }

    const impactAt = at("impact_reviewed")[0];
    const rebuildAt = at("rebuild_run")[0];

    return {
      deliveries: deliveries.length,
      firstDeliveryMs, secondDeliveryMs,
      fasterBy: firstDeliveryMs !== null && secondDeliveryMs !== null
        ? firstDeliveryMs - secondDeliveryMs : null,
      // Did they understand the change before acting on it, or guess and rebuild?
      reviewedImpactFirst: impactAt !== undefined &&
        (rebuildAt === undefined || impactAt <= rebuildAt),
      tracedCause: at("traced_cause").length > 0,
      mistakes: at("delivery_mistake").length,
      reflectionDismissals: at("reflection_dismissed").length,
    };
  }

  /**
   * Everything stored, in the words it will be shown in.
   *
   * This is what the "What XENIUR recorded" view renders and what an export contains —
   * the same data, so a person cannot be shown one thing and send another.
   */
  disclose(): MetricsDisclosure {
    const events = this.events();
    const counts = new Map<SessionEventKind, number>();
    for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

    return {
      sessions: this.sessions().length,
      events: events.length,
      kinds: SESSION_EVENT_KINDS
        .filter((kind) => counts.has(kind))
        .map((kind) => ({ kind, count: counts.get(kind)!, means: EVENT_MEANINGS[kind] })),
      // Checked, not asserted: the guard on the way in is what makes this true, and this
      // re-reads what was actually stored rather than trusting it.
      containsNoContent: events.every((e) => Object.values(e.detail).every(isNonContent)),
      revision: this.revision(),
    };
  }

  /** A sanitised summary a person can choose to send. Nothing sends it for them. */
  exportSummary(): string {
    const d = this.disclose();
    const seconds = (ms: number | null) => ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
    return [
      "XENIUR — what this machine recorded about your own use",
      "",
      `Sessions: ${d.sessions}`,
      `Events:   ${d.events}`,
      `Contains no titles, text or paths: ${d.containsNoContent ? "yes" : "NO — do not send"}`,
      "",
      "The second revision",
      `  deliveries approved:      ${d.revision.deliveries}`,
      `  first delivery took:      ${seconds(d.revision.firstDeliveryMs)}`,
      `  second delivery took:     ${seconds(d.revision.secondDeliveryMs)}`,
      `  faster by:                ${seconds(d.revision.fasterBy)}`,
      `  looked before rebuilding: ${d.revision.reviewedImpactFirst ? "yes" : "no"}`,
      `  asked how it happened:    ${d.revision.tracedCause ? "yes" : "no"}`,
      `  deliveries replaced:      ${d.revision.mistakes}`,
      "",
      "What was counted",
      ...d.kinds.map((k) => `  ${String(k.count).padStart(4)}  ${k.means}`),
      "",
      "This file was written only because you asked for it. Nothing here has been sent",
      "anywhere, and XENIUR has no code that could send it.",
    ].join("\n");
  }
}

/**
 * Numbers, booleans and short enum-shaped strings only.
 *
 * A metric detail is a count, a duration or a profile id. Free text is where a title, a
 * filename or a customer's name would get in, so it does not survive the trip.
 */
const isNonContent = (value: unknown): boolean =>
  typeof value === "number" || typeof value === "boolean" ||
  (typeof value === "string" && value.length <= 40 && /^[\w.:-]*$/.test(value));

function safeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (isNonContent(value)) out[key] = value;
  }
  return out;
}
