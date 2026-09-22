import type { ActionDescription, ActionRequest, AttemptResult, RouteAdapter, StatusResult } from "@xeniur/core";

/**
 * A route that does exactly what a test tells it to, including throwing. Used to prove that
 * the store answers the same way whether a destination says yes, says no, or says nothing.
 */
export class MockRouteAdapter implements RouteAdapter {
  readonly id = "mock.route";
  readonly route = "service_api" as const;
  readonly executed: ActionRequest[] = [];
  readonly keys: string[] = [];
  constructor(private readonly script: {
    execute?: AttemptResult | (() => never);
    status?: StatusResult;
    destination?: string;
  } = {}) {}

  availability() { return { state: "available" as const, because: "a route used by tests" }; }

  async describe(request: ActionRequest): Promise<ActionDescription> {
    return {
      destination: this.script.destination ?? "https://receiver.example/hook",
      accountLabel: "you@example.org", effect: "Sends the fields you reviewed to the endpoint you configured.",
      actionClass: request.actionClass, route: this.route, items: request.items,
      fields: Object.entries(request.fields).map(([name, value]) => ({ name, chars: value.length })),
      amount: request.amount, currency: request.currency,
      verification: "The endpoint answers with an id; anything else leaves the outcome uncertain.",
    };
  }

  async execute(request: ActionRequest, ctx: { idempotencyKey: string }): Promise<AttemptResult> {
    this.executed.push(request);
    this.keys.push(ctx.idempotencyKey);
    const scripted = this.script.execute;
    if (typeof scripted === "function") { scripted(); }
    return (typeof scripted === "function" ? undefined : scripted) ?? { state: "confirmed", reference: "ref-1", responseDigest: null, detail: "the endpoint acknowledged it" };
  }

  async checkStatus(): Promise<StatusResult> {
    return this.script.status ?? { state: "unsupported", detail: "this route cannot be asked afterwards" };
  }
}
