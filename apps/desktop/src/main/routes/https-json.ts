import { request as httpsRequest } from "node:https";
import type { ActionDescription, ActionRequest, AttemptResult, Availability, RouteAdapter, StatusResult } from "@xeniur/core";
import { sha256Hex } from "@xeniur/core";
import { checkedDestination, type Resolver } from "../web/policy.js";

/**
 * A route to an endpoint the person configured — their own receiver, not a service XENIUR
 * chose. The token is theirs, held by the operating system's keychain and read only here; the
 * renderer learns whether one exists and never what it is.
 *
 * What this route can establish: a 2xx with an id means the endpoint took it. A 4xx means it
 * refused, and says why. A 5xx, a timeout or a dropped connection establishes nothing at all,
 * so the attempt stays uncertain and is answered by asking the endpoint again — with the same
 * idempotency key, so asking twice cannot do the thing twice.
 */
export interface RouteEndpoint {
  id: string;
  label: string;
  endpoint: string;
  origins: string[];
  statusEndpoint: string | null;
  /** The fields this endpoint expects, for the review card. Names only; values are the person's. */
  fields: string[];
}

export interface RouteTokenStore {
  has(routeId: string): boolean;
  read(routeId: string): string | null;
}

export interface HttpsJsonOptions {
  endpoints: readonly RouteEndpoint[];
  tokens: RouteTokenStore;
  /** Injected in tests; the real one pins the connection to the checked address. */
  send?: (input: { url: URL; address: string; body: string; token: string; idempotencyKey: string; method: "POST" | "GET" }) => Promise<{ status: number; body: string }>;
  /** Injected in tests; the real one is DNS, and the address policy still applies to it. */
  resolve?: Resolver;
}

export class HttpsJsonAdapter implements RouteAdapter {
  readonly id = "service.https_json";
  readonly route = "service_api" as const;
  constructor(private readonly opts: HttpsJsonOptions) {}

  availability(): { state: Availability; because: string } {
    if (this.opts.endpoints.length === 0) return { state: "needs_setup", because: "no endpoint is configured in config/routes.json" };
    const ready = this.opts.endpoints.filter((e) => this.opts.tokens.has(e.id));
    if (ready.length === 0) return { state: "needs_setup", because: `${this.opts.endpoints.length} endpoint${this.opts.endpoints.length === 1 ? "" : "s"} configured, none with a token` };
    return { state: "available", because: `${ready.length} endpoint${ready.length === 1 ? "" : "s"} with a token in your keychain` };
  }

  #endpoint(id: string | null): RouteEndpoint {
    const e = this.opts.endpoints.find((x) => x.id === id);
    if (!e) throw new Error(`no endpoint called "${id ?? ""}" is configured`);
    return e;
  }

  async describe(request: ActionRequest): Promise<ActionDescription> {
    const e = this.#endpoint(request.endpointId);
    return {
      destination: e.endpoint,
      accountLabel: e.label,
      effect: `Sends these fields to ${new URL(e.endpoint).host}, as one request you approved.`,
      actionClass: request.actionClass, route: this.route, items: request.items,
      fields: Object.entries(request.fields).map(([name, value]) => ({ name, chars: value.length })),
      amount: request.amount, currency: request.currency,
      verification: e.statusEndpoint
        ? "The endpoint answers with an id, and can be asked again afterwards what became of it."
        : "The endpoint answers with an id. It cannot be asked again afterwards, so an interrupted request stays uncertain.",
    };
  }

  async execute(request: ActionRequest, ctx: { attemptId: string; idempotencyKey: string }): Promise<AttemptResult> {
    const e = this.#endpoint(request.endpointId);
    const token = this.opts.tokens.read(e.id);
    if (!token) return { state: "failed", reference: null, responseDigest: null, detail: "no token is stored for this endpoint" };
    const checked = await checkedDestination(e.endpoint, this.opts.resolve);
    const body = JSON.stringify({ fields: request.fields, items: request.items, amount: request.amount, currency: request.currency });
    const send = this.opts.send ?? pinnedSend;
    const res = await send({ url: checked.url, address: checked.addresses[0]!.address, body, token, idempotencyKey: ctx.idempotencyKey, method: "POST" });
    return readAnswer(res);
  }

  async checkStatus(reference: string | null, ctx: { endpointId: string | null }): Promise<StatusResult> {
    const e = this.#endpoint(ctx.endpointId);
    if (!e.statusEndpoint || !reference) return { state: "unsupported", detail: "this endpoint cannot be asked afterwards" };
    const token = this.opts.tokens.read(e.id);
    if (!token) return { state: "unsupported", detail: "no token is stored for this endpoint" };
    const checked = await checkedDestination(`${e.statusEndpoint.replace(/\/$/, "")}/${encodeURIComponent(reference)}`, this.opts.resolve);
    const send = this.opts.send ?? pinnedSend;
    try {
      const res = await send({ url: checked.url, address: checked.addresses[0]!.address, body: "", token, idempotencyKey: reference, method: "GET" });
      const answer = readAnswer(res);
      return { state: answer.state, detail: answer.detail };
    } catch (cause) {
      return { state: "uncertain", detail: cause instanceof Error ? cause.message : String(cause) };
    }
  }
}

/** What an HTTP answer establishes, and no more. */
export function readAnswer(res: { status: number; body: string }): AttemptResult {
  const digest = res.body ? sha256Hex(res.body) : null;
  if (res.status >= 200 && res.status < 300) {
    let reference: string | null = null;
    try { const parsed = JSON.parse(res.body) as { id?: unknown; reference?: unknown }; reference = typeof parsed.id === "string" ? parsed.id : typeof parsed.reference === "string" ? parsed.reference : null; }
    catch { reference = null; }
    return { state: "confirmed", reference, responseDigest: digest, detail: `the endpoint answered ${res.status}` };
  }
  if (res.status >= 400 && res.status < 500) {
    return { state: "failed", reference: null, responseDigest: digest, detail: `the endpoint refused it: ${res.status}${res.body ? ` — ${res.body.slice(0, 160)}` : ""}` };
  }
  return { state: "uncertain", reference: null, responseDigest: digest, detail: `the endpoint answered ${res.status}, which establishes nothing` };
}

/** The real send: to the address the policy checked, with TLS verified against the name. */
const pinnedSend: NonNullable<HttpsJsonOptions["send"]> = ({ url, address, body, token, idempotencyKey, method }) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: address, servername: url.hostname, port: 443, path: url.pathname + url.search, method, agent: false,
      headers: {
        Host: url.host, Accept: "application/json", "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body), Authorization: `Bearer ${token}`,
        "Idempotency-Key": idempotencyKey, "User-Agent": "XENIUR-Route/1.0",
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("error", reject);
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, 20_000) }));
    });
    const deadline = setTimeout(() => req.destroy(new Error("the endpoint did not answer in time")), 20_000);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    if (method === "POST") req.write(body);
    req.end();
  });
