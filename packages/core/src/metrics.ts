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
  "gesture_used",            // completed through a direct visual path
  "typed_instead",           // typed where a visual path existed; concept only, never words
  "delivery_mistake",         // a release later superseded or withdrawn
  // The goal — what the person is trying to accomplish
  "goal_set",                 // a goal was written, in the person's words
  "goal_status_changed",      // they moved to another way of working
  "goal_finished",
  // The model layer, made inspectable
  "model_routed",             // which model an intent went to, and whether it escalated
  "context_reviewed",         // a person confirmed what the model would see
  "context_excluded",         // how many items were left out, and why (by kind, never by content)
  "support_reviewed",         // a citation's support state was settled by a person
  "proposal_accepted",        // a model's proposed claim or step became the person's
  "proposal_rejected",
  "steelman_recorded",        // a reason the decision could be wrong was written down
  "steelman_skipped",         // it was not — recorded as a skip, never as agreement
  // Modes and rhythm — written here, never read by the code that chooses timing
  "mode_started",
  "mode_exited",
  "mode_emergency_exit",      // the exit that always exists was used; a fact, not a failure
  "reward_offered",
  "reward_taken",
  "reward_skipped",
  "streak_day",
  "critique_received",        // someone else's reasoned disagreement arrived and was opened
  "package_imported",
  "outreach_sent",            // one receipted send inside a bounded campaign
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
  visualPaths: {
    gestureUsed: number;
    typedInstead: number;
    byConcept: Record<string, number>;
  };
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
  gesture_used: "you completed an action by touching or moving something",
  typed_instead: "you typed where a visual path was available",
  delivery_mistake: "a delivery was later replaced",
  reflection_dismissed: "you dismissed a reflection prompt",
  goal_set: "you wrote down what you are trying to accomplish",
  goal_status_changed: "you moved to another way of working on it",
  goal_finished: "you finished a goal",
  model_routed: "an intent was routed to a model, cheap first",
  context_reviewed: "you read what the model would see before it saw it",
  context_excluded: "something was left out of a context, and why",
  support_reviewed: "you settled whether a source bears on a claim",
  proposal_accepted: "you accepted a model's proposed claim or step",
  proposal_rejected: "you rejected one",
  steelman_recorded: "you wrote down one way a decision could be wrong",
  steelman_skipped: "you skipped that, and it was recorded as a skip",
  mode_started: "you started a mode you set the terms of",
  mode_exited: "you ended a mode",
  mode_emergency_exit: "you left a mode early — recorded, not judged",
  reward_offered: "XENIUR offered something from your own work",
  reward_taken: "you took an offer",
  reward_skipped: "you skipped an offer, and offers became rarer",
  streak_day: "a day on which something became",
  critique_received: "you opened someone's critique beside your work",
  package_imported: "you brought a package in",
  outreach_sent: "a message left inside a campaign you bounded",
  session_ended: "you closed XENIUR",
};
