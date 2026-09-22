import type {
  ActionDescription, ActionRequest, Attempt, AttemptCheck, AttemptState, RouteAdapter,
} from "@xeniur/core";
import {
  ActionRequestSchema, AttemptSchema, GrantRefused, RECEIPT_OUTCOME_OF, newId, now, planDigest, sha256Hex,
} from "@xeniur/core";
import type { Db } from "./db.js";
import type { ObjectGraph } from "./graph.js";

/**
 * A delegated action: drafted, described, approved, dispatched once, and answered honestly.
 *
 * The draft lives here, never on the page — a website can send a field's value before Submit,
 * so nothing is typed into a form until the operation is authorised. Dispatch passes two
 * independent gates: the grant (this class of action, this digest, this tab, once) and the
 * permission broker. An attempt is written before the adapter is called and its end state
 * written once; later evidence is a check row, never an edit.
 *
 * A click is not a success. `uncertain` is a state, not an error: it is answered by
 * *Check status*, and a second attempt is refused until a check says the first failed.
 */
export class DelegatedActionStore {
  private readonly adapters = new Map<string, RouteAdapter>();

  constructor(private readonly db: Db, private readonly graph: ObjectGraph) {}

  register(adapter: RouteAdapter): void { this.adapters.set(adapter.id, adapter); }
  adapter(id: string): RouteAdapter | null { return this.adapters.get(id) ?? null; }
  adapterIds(): string[] { return [...this.adapters.keys()]; }

  /** A draft: described by the route, digested, and shown to the person. Nothing is sent. */
  async draft(input: { worldId: string; goalId?: string | null; stepId?: string | null; adapterId: string; request: ActionRequest }): Promise<{ id: string; description: ActionDescription; reviewDigest: string }> {
    const adapter = this.adapters.get(input.adapterId);
    if (!adapter) throw new Error(`no such route: ${input.adapterId}`);
    const request = ActionRequestSchema.parse(input.request);
    const description = await adapter.describe(request);
    const reviewDigest = digestOf(adapter.id, request);
    const id = newId();
    this.db.prepare(
      `INSERT INTO delegated_actions (id, world_id, goal_id, step_id, route, adapter_id, request, description, review_digest, grant_id, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'draft', ?)`,
    ).run(id, input.worldId, input.goalId ?? null, input.stepId ?? null, adapter.route, adapter.id,
      JSON.stringify(request), JSON.stringify(description), reviewDigest, now());
    return { id, description, reviewDigest };
  }

  /** The person approved this exact plan; the grant the host issued is bound to it here. */
  approve(actionId: string, grantId: string): void {
    const a = this.#action(actionId);
    const grant = this.graph.grants.get(grantId);
    if (!grant) throw new GrantRefused("no_grant", grantId.slice(0, 8));
    if (grant.reviewDigest !== a.reviewDigest) throw new GrantRefused("digest_mismatch");
    this.db.prepare(`UPDATE delegated_actions SET grant_id = ?, state = 'approved' WHERE id = ?`).run(grantId, actionId);
  }

  /**
   * One dispatch, one attempt. The grant and the broker are asked separately; the attempt row
   * exists before the adapter is called, so an interruption leaves `attempted`, which a later
   * run reconciles to `uncertain` rather than guessing.
   */
  async dispatch(actionId: string, guard: (plan: { tool: string; args: Record<string, unknown>; destination: string }) => void = () => {}): Promise<Attempt> {
    const a = this.#action(actionId);
    if (!a.grantId) throw new GrantRefused("no_grant", "this action was not approved");
    const adapter = this.adapters.get(a.adapterId);
    if (!adapter) throw new Error(`no such route: ${a.adapterId}`);
    const open = this.attempts(actionId).find((x) => x.state === "attempted" || x.state === "uncertain");
    if (open) throw new GrantRefused("one_use_spent", `an attempt is ${open.state}; check its status before sending again`);

    // Gate one: what the person allowed, against this class, this digest and this tab.
    this.graph.grants.assert(a.grantId, {
      kind: "action", actionClass: a.request.actionClass, digest: a.reviewDigest,
      tabId: a.request.tabId, amount: a.request.amount,
    });
    // Gate two: the permission broker, over the same plan.
    guard({ tool: `route.${adapter.id}`, args: { actionClass: a.request.actionClass, endpointId: a.request.endpointId }, destination: a.description.destination });

    const attemptId = newId();
    const idempotencyKey = attemptId;
    this.db.prepare(
      `INSERT INTO action_attempts (id, action_id, idempotency_key, state, reference, response_digest, detail, started_at, ended_at)
       VALUES (?, ?, ?, 'attempted', NULL, NULL, '', ?, NULL)`,
    ).run(attemptId, actionId, idempotencyKey, now());
    this.db.prepare(`UPDATE delegated_actions SET state = 'dispatched' WHERE id = ?`).run(actionId);

    let result;
    try {
      result = await adapter.execute(a.request, { grantId: a.grantId, attemptId, idempotencyKey });
    } catch (cause) {
      // The route threw: nothing establishes that it arrived, and nothing that it did not.
      result = { state: "uncertain" as const, reference: null, responseDigest: null, detail: cause instanceof Error ? cause.message : String(cause) };
    }
    this.db.prepare(`UPDATE action_attempts SET state = ?, reference = ?, response_digest = ?, detail = ?, ended_at = ? WHERE id = ?`)
      .run(result.state, result.reference, result.responseDigest, result.detail.slice(0, 500), now(), attemptId);
    this.db.prepare(`UPDATE delegated_actions SET state = 'done' WHERE id = ?`).run(actionId);
    this.#receipt(a, attemptId, result.state, result);
    return this.attempt(attemptId)!;
  }

  /** Ask the destination what became of it. The answer is a row; the attempt is never edited. */
  async checkStatus(attemptId: string): Promise<AttemptCheck> {
    const attempt = this.attempt(attemptId);
    if (!attempt) throw new Error("no such attempt");
    const a = this.#action(attempt.actionId);
    const adapter = this.adapters.get(a.adapterId);
    if (!adapter) throw new Error(`no such route: ${a.adapterId}`);
    let result;
    try { result = await adapter.checkStatus(attempt.reference, { attemptId, endpointId: a.request.endpointId }); }
    catch (cause) { result = { state: "uncertain" as const, detail: cause instanceof Error ? cause.message : String(cause) }; }
    const check: AttemptCheck = { id: newId(), attemptId, result: result.state, detail: result.detail.slice(0, 500), at: now() };
    this.db.prepare(`INSERT INTO attempt_checks (id, attempt_id, result, detail, at) VALUES (?, ?, ?, ?, ?)`)
      .run(check.id, check.attemptId, check.result, check.detail, check.at);
    // A check that establishes something moves the attempt; one that does not leaves it be.
    if (result.state === "confirmed" || result.state === "failed") {
      this.db.prepare(`UPDATE action_attempts SET state = ?, detail = ? WHERE id = ?`).run(result.state, check.detail, attemptId);
      this.#receipt(a, attemptId, result.state, { reference: attempt.reference, responseDigest: attempt.responseDigest, detail: check.detail });
    }
    return check;
  }

  /** On startup: an attempt still `attempted` was interrupted. Uncertain, never assumed either way. */
  reconcileInterrupted(): number {
    const rows = this.db.prepare(`SELECT id FROM action_attempts WHERE state = 'attempted'`).all() as Array<{ id: string }>;
    for (const r of rows) {
      this.db.prepare(`UPDATE action_attempts SET state = 'uncertain', detail = ?, ended_at = ? WHERE id = ?`)
        .run("XENIUR closed while this was in flight. Check its status; do not send it again.", now(), r.id);
    }
    return rows.length;
  }

  attempts(actionId: string): Attempt[] {
    return (this.db.prepare(`SELECT * FROM action_attempts WHERE action_id = ? ORDER BY started_at, rowid`).all(actionId) as AttemptRow[]).map(attemptFromRow);
  }
  attempt(id: string): Attempt | null {
    const r = this.db.prepare(`SELECT * FROM action_attempts WHERE id = ?`).get(id) as AttemptRow | undefined;
    return r ? attemptFromRow(r) : null;
  }
  checksOf(attemptId: string): AttemptCheck[] {
    return (this.db.prepare(`SELECT * FROM attempt_checks WHERE attempt_id = ? ORDER BY at, rowid`).all(attemptId) as Array<{ id: string; attempt_id: string; result: AttemptCheck["result"]; detail: string; at: number }>)
      .map((r) => ({ id: r.id, attemptId: r.attempt_id, result: r.result, detail: r.detail, at: r.at }));
  }

  list(worldId: string): Array<{ id: string; adapterId: string; description: ActionDescription; state: string; createdAt: number; attempts: Attempt[] }> {
    return (this.db.prepare(`SELECT * FROM delegated_actions WHERE world_id = ? ORDER BY created_at DESC`).all(worldId) as Row[])
      .map((r) => ({ id: r.id, adapterId: r.adapter_id, description: JSON.parse(r.description) as ActionDescription, state: r.state, createdAt: r.created_at, attempts: this.attempts(r.id) }));
  }

  get(actionId: string) { return this.#action(actionId); }

  /* -------------------------------------------------------------- internals */

  /** The durable record: digests and a destination, never a field's value and never a token. */
  #receipt(a: ReturnType<DelegatedActionStore["get"]>, attemptId: string, state: AttemptState, r: { reference: string | null; responseDigest: string | null; detail: string }): void {
    const plan = { intent: `${a.request.actionClass} via ${a.adapterId}`, objects: [], tool: "outreach.send" as const, args: { route: a.adapterId }, confirmation: true };
    const action = this.graph.beginAction({
      worldId: a.worldId, intent: plan.intent, tool: plan.tool, plan,
      permissionLevel: a.request.actionClass === "api_post" || a.request.actionClass === "submit" ? "COMMIT" : "MODIFY",
      provenance: "human", provider: a.adapterId,
    });
    if (state === "confirmed") this.graph.completeAction(action.id);
    else if (state === "failed") this.graph.failAction(action.id, r.detail);
    this.graph.actionReceipts.record(action.id, {
      screenshotBlobHash: null, domDigest: r.responseDigest, url: a.description.destination,
      params: { actionClass: a.request.actionClass, attemptId },
      sessionGrantId: a.grantId, attempted: plan.intent, planDigest: a.reviewDigest,
      destination: a.description.destination,
      dataSent: Object.entries(a.request.fields).map(([name, value]) => ({ name, valueDigest: sha256Hex(value), valueType: "string" })),
      quotedPrice: a.request.amount !== null ? { usd: a.request.amount } : null,
      actualPrice: { usd: 0 },
      providerResponse: { status: state, reference: r.reference, digest: r.responseDigest },
      outcome: RECEIPT_OUTCOME_OF[state], at: now(),
    } as never);
  }

  #action(id: string) {
    const r = this.db.prepare(`SELECT * FROM delegated_actions WHERE id = ?`).get(id) as Row | undefined;
    if (!r) throw new Error("no such action");
    return {
      id: r.id, worldId: r.world_id, goalId: r.goal_id, stepId: r.step_id, route: r.route, adapterId: r.adapter_id,
      request: ActionRequestSchema.parse(JSON.parse(r.request)), description: JSON.parse(r.description) as ActionDescription,
      reviewDigest: r.review_digest, grantId: r.grant_id, state: r.state, createdAt: r.created_at,
    };
  }
}

/** The digest consent binds to: the route and the exact request, canonically. */
export function digestOf(adapterId: string, request: ActionRequest): string {
  return planDigest({ tool: `route.${adapterId}`, args: request as unknown as Record<string, unknown> });
}

type Row = { id: string; world_id: string; goal_id: string | null; step_id: string | null; route: string; adapter_id: string;
  request: string; description: string; review_digest: string; grant_id: string | null; state: string; created_at: number };
type AttemptRow = { id: string; action_id: string; idempotency_key: string; state: AttemptState; reference: string | null;
  response_digest: string | null; detail: string; started_at: number; ended_at: number | null };
const attemptFromRow = (r: AttemptRow): Attempt => AttemptSchema.parse({
  id: r.id, actionId: r.action_id, idempotencyKey: r.idempotency_key, state: r.state, reference: r.reference,
  responseDigest: r.response_digest, detail: r.detail, startedAt: r.started_at, endedAt: r.ended_at,
});
