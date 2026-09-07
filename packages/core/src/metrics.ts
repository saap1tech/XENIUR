import { z } from "zod";

/**
 * What XENIUR records about your own use of it, and nothing else.
 *
 * The list is closed and it is short, because the question it exists to answer is narrow:
 * *is the second revision easier than the first?* Not engagement, not time on task, not
 * anything a person would be uncomfortable seeing written down.
 *
 * Every kind here is a moment in the loop the product claims to make easier. If a kind
 * cannot be justified by that sentence, it does not belong in this list.
 */
export const SESSION_EVENT_KINDS = [
  "session_started",
  "first_import",             // how long before anything is in the workspace at all
  "capture_accepted",         // a suggestion became a claim somebody stands behind
  "decision_accepted",        // the moment thinking became something a build can bind to
  "delivery_approved",        // a release, with which profile
  "source_changed",           // something upstream moved
  "impact_reviewed",          // they opened the rebuild/review split
  "rebuild_run",              // they acted on the rebuild half
  "decision_reaffirmed",      // they acted on the review half
  "compared_versions",
  "traced_cause",             // "show how this happened" — can they answer *why*?
  "delivery_mistake",         // a release later superseded or withdrawn
  "reflection_dismissed",     // friction turned off; a prompt nobody wants is a bad prompt
  "session_ended",
] as const;
export const SessionEventKindSchema = z.enum(SESSION_EVENT_KINDS);
export type SessionEventKind = z.infer<typeof SessionEventKindSchema>;

export interface SessionEvent {
  id: string;
  sessionId: string;
  kind: SessionEventKind;
  objectId: string | null;
  detail: Record<string, unknown>;
  at: number;
}

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number | null;
  activeMs: number;
  waitingMs: number;
  worldId: string | null;
}

/**
 * The second-revision report: the one number the product is actually judged on.
 *
 * A first delivery is impressive and proves nothing — anybody can be impressed once. The
 * claim is that coming *back*, changing something, understanding what it affected, and
 * shipping the next correct version is faster than the first time. Either these durations
 * fall or they do not.
 */
export interface RevisionMetrics {
  deliveries: number;
  /** From the first import to the first approved delivery. */
  firstDeliveryMs: number | null;
  /** From the change that started it to the next approved delivery. */
  secondDeliveryMs: number | null;
  /** Whether the second was faster, and by how much. Null until there are two. */
  fasterBy: number | null;
  /** Did they open the impact split before rebuilding, or guess? */
  reviewedImpactFirst: boolean;
  /** Did they ever ask why something was out of date? */
  tracedCause: boolean;
  mistakes: number;
  reflectionDismissals: number;
}

/** Everything stored about a person's own use, in the words it will be shown in. */
export interface MetricsDisclosure {
  sessions: number;
  events: number;
  kinds: Array<{ kind: SessionEventKind; count: number; means: string }>;
  /** True when nothing recorded here could identify a person or their work. */
  containsNoContent: boolean;
  revision: RevisionMetrics;
}

/** What each recorded kind means, in a sentence, shown beside its count. */
export const EVENT_MEANINGS: Record<SessionEventKind, string> = {
  session_started: "you opened XENIUR",
  first_import: "you brought the first thing into a project",
  capture_accepted: "you accepted a suggested claim",
  decision_accepted: "you accepted a decision",
  delivery_approved: "you approved a delivery, and against which profile",
  source_changed: "something a build depends on changed",
  impact_reviewed: "you looked at what changed before acting",
  rebuild_run: "you rebuilt what was out of date",
  decision_reaffirmed: "you looked at a decision and stood by it",
  compared_versions: "you compared two versions",
  traced_cause: "you asked how something happened",
  delivery_mistake: "a delivery was later replaced",
  reflection_dismissed: "you dismissed a reflection prompt",
  session_ended: "you closed XENIUR",
};
