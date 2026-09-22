import { z } from "zod";
import type { Availability } from "./availability.js";
import type { ActionClass, Route } from "./grant.js";
import { TimestampSchema, UuidSchema } from "./ids.js";

/**
 * A delegated action, and the four states an attempt can honestly be in.
 *
 * A click is not a success. When an operation is dispatched, the attempt is **attempted**;
 * it becomes **confirmed** only on evidence from the destination, **failed** only on evidence
 * of rejection, and otherwise stays **uncertain** — which is a state, not an error, and is
 * answered by *Check status*, never by trying again. Attempts are immutable: later evidence
 * is another row, so the history says what was known and when.
 */
export const ATTEMPT_STATES = ["attempted", "confirmed", "failed", "uncertain"] as const;
export const AttemptStateSchema = z.enum(ATTEMPT_STATES);
export type AttemptState = z.infer<typeof AttemptStateSchema>;

export const ATTEMPT_WORDS: Record<AttemptState, { label: string; means: string }> = {
  attempted: { label: "attempted", means: "It was sent. Whether it arrived is not established yet." },
  confirmed: { label: "confirmed", means: "The destination gave evidence that matches what you approved." },
  failed: { label: "failed", means: "The destination said no, and why." },
  uncertain: { label: "uncertain", means: "No answer that establishes either way. Check the status; do not send it again." },
};

/** The material an action carries: named, versioned, and digested — never the values. */
export const ActionItemSchema = z.object({
  title: z.string().min(1).max(200),
  objectId: UuidSchema.nullable().default(null),
  versionId: z.string().nullable().default(null),
  digest: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
}).strict();
export type ActionItem = z.infer<typeof ActionItemSchema>;

export const ActionRequestSchema = z.object({
  route: z.enum(["embedded_tab", "service_api"]),
  actionClass: z.enum(["read", "fill", "click", "submit", "api_post"]),
  /** For the embedded route: the tab and the control. For a service route: the endpoint id. */
  tabId: z.string().nullable().default(null),
  elementRef: z.string().nullable().default(null),
  endpointId: z.string().nullable().default(null),
  /** The fields that will be sent, as the person wrote them. Values never leave the machine in a receipt. */
  fields: z.record(z.string(), z.string()).default({}),
  items: z.array(ActionItemSchema).max(32).default([]),
  amount: z.number().nonnegative().nullable().default(null),
  currency: z.string().max(8).nullable().default(null),
}).strict();
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

/** What a person is shown before approving. Every line is a fact from the request or the route. */
export interface ActionDescription {
  destination: string;
  accountLabel: string | null;
  effect: string;
  actionClass: ActionClass;
  route: Route;
  items: ActionItem[];
  /** Field names and the size of each value — never the values. */
  fields: Array<{ name: string; chars: number }>;
  amount: number | null;
  currency: string | null;
  /** What this route can and cannot establish about the outcome. */
  verification: string;
}

export interface AttemptResult {
  state: Exclude<AttemptState, "attempted">;
  reference: string | null;
  responseDigest: string | null;
  detail: string;
}

export interface StatusResult {
  state: AttemptState | "unsupported";
  detail: string;
}

/**
 * One way of carrying out an action. Each adapter says what it can establish about an
 * outcome, and never claims more: a route with no status endpoint answers `unsupported`
 * rather than guessing.
 */
export interface RouteAdapter {
  readonly id: string;
  readonly route: Route;
  availability(): { state: Availability; because: string };
  describe(request: ActionRequest): Promise<ActionDescription>;
  execute(request: ActionRequest, ctx: { grantId: string; attemptId: string; idempotencyKey: string }): Promise<AttemptResult>;
  checkStatus(reference: string | null, ctx: { attemptId: string; endpointId: string | null }): Promise<StatusResult>;
}

export const AttemptSchema = z.object({
  id: UuidSchema,
  actionId: UuidSchema,
  idempotencyKey: z.string().min(1),
  state: AttemptStateSchema,
  reference: z.string().nullable().default(null),
  responseDigest: z.string().nullable().default(null),
  detail: z.string().max(500).default(""),
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable().default(null),
}).strict();
export type Attempt = z.infer<typeof AttemptSchema>;

export interface AttemptCheck { id: string; attemptId: string; result: AttemptState | "unsupported"; detail: string; at: number }

/** How an attempt's state reads in the durable receipt. `partial` is unused by this path. */
export const RECEIPT_OUTCOME_OF: Record<AttemptState, "succeeded" | "failed" | "unknown"> = {
  attempted: "unknown", confirmed: "succeeded", failed: "failed", uncertain: "unknown",
};
