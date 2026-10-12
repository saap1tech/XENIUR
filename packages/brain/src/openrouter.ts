import type { LlmClient, LlmRequest, LlmResponse } from "./llm.js";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export interface RouterCitation { url: string; title: string; content: string; }
export interface RouterResult extends LlmResponse { citations: RouterCitation[]; cost?: number; }
export type RouterFetch = typeof fetch;

/** An HTTP refusal from OpenRouter. The message is safe to show; status and provider are for retrying. */
export class RouterHttpError extends Error {
  constructor(message: string, readonly status: number, readonly provider: string | null) { super(message); this.name = "RouterHttpError"; }
}

/** Providers that refused a model this session (a withdrawn model is still routed to for a while). */
const refused = new Map<string, { providers: Set<string>; until: number }>();
const refusedFor = (model: string): string[] => {
  const entry = refused.get(model);
  if (!entry || entry.until < Date.now()) { refused.delete(model); return []; }
  return [...entry.providers];
};
const remember = (model: string, provider: string) => {
  const entry = refused.get(model);
  const providers = entry && entry.until >= Date.now() ? entry.providers : new Set<string>();
  providers.add(provider); refused.set(model, { providers, until: Date.now() + 60 * 60_000 });
};
/** Exposed for tests only. */
export const forgetRefusedProviders = () => refused.clear();

/** Only the main process constructs this client. No key, arbitrary tools, or endpoint crosses the renderer bridge. */
export class OpenRouterClient implements LlmClient {
  readonly id = "openrouter";
  readonly model: string;
  constructor(private readonly opts: { apiKey?: string; model: string; fetch?: RouterFetch;
    inputPerMTok?: number; outputPerMTok?: number;signal?:AbortSignal; reasoning?: boolean }) { this.model = opts.model; }
  async complete(request: LlmRequest): Promise<RouterResult> { return this.chat(request); }
  async chat(request: LlmRequest, search = false): Promise<RouterResult> {
    // A provider that refuses the request (a withdrawn model, an unsupported field) is skipped and
    // remembered, then the request goes to the next provider under the same price ceiling. A refused
    // request is not charged, so trying again costs time, never money. Three tries, then the truth.
    let body: any;
    for (let attempt = 1; ; attempt++) {
      const ignore = refusedFor(this.model);
      try {
        // A long answer is streamed: text keeps arriving, so only silence (not length) ends it. A
        // search stays whole, because its citations arrive with the finished message.
        body = search ? await routerRequest(this.opts.apiKey, "/chat/completions", this.payload(request, search, ignore), this.opts.fetch, this.opts.signal)
          : await routerStream(this.opts.apiKey, { ...this.payload(request, search, ignore), stream: true, usage: { include: true } }, this.opts.fetch, this.opts.signal);
        break;
      }
      catch (cause) {
        const retry = attempt < 3 && cause instanceof RouterHttpError && [400, 404, 502, 503].includes(cause.status) && this.opts.inputPerMTok !== undefined;
        if (!retry) throw cause;
        if (cause.provider) remember(this.model, cause.provider);
        else if (cause.status === 404) throw cause;
      }
    }
    return this.read(body, search);
  }
  private payload(request: LlmRequest, search: boolean, ignore: string[]) {
    return {
      model: this.model, stream: false, max_tokens: request.maxOutputTokens,
      // A model that thinks first spends its reasoning from the same budget as its answer; keep it
      // short so a whole answer still fits. Only sent where supported, or no provider would qualify.
      ...(this.opts.reasoning ? { reasoning: { effort: "low", exclude: true } } : {}),
      messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
      // A single pinned Exa search avoids native search's different/unbounded tool prices.
      ...(search ? { tools: [{ type: "openrouter:web_search", parameters: {
        engine: "exa", mode: "auto", max_uses: 1, max_results: 6, max_total_results: 6, max_characters: 2500,
      } }] } : {}),
      plugins: [{ id: "web", enabled: false }],
      // With a price ceiling, another provider at or under it is no dearer than the quote, so one
      // provider's outage or unsupported tool must not fail the step. Without a ceiling, stay put.
      // require_parameters keeps the request on providers that honour every field, tools included.
      provider: { allow_fallbacks: this.opts.inputPerMTok !== undefined, require_parameters: true, ...(ignore.length ? { ignore } : {}),
        ...(this.opts.inputPerMTok !== undefined ? { max_price: { prompt: this.opts.inputPerMTok, completion: this.opts.outputPerMTok } } : {}) },
    };
  }
  private read(body: any, search: boolean): RouterResult {
    const message = body.choices?.[0]?.message;
    // A search is read for its returned citations, not its prose: a reply cut short after the
    // citations arrived is still a complete search. Any other truncated text is refused.
    const truncated = body.choices?.[0]?.finish_reason === "length" && !(search && (message?.annotations ?? []).length);
    if (body.error || !message || typeof message.content !== "string" || truncated) {
      throw new Error(body.choices?.[0]?.finish_reason === "length" ? "This draft was too long. Try a smaller scope." : "OpenRouter did not return a complete text response.");
    }
    const usage = body.usage ?? {};
    const citations: RouterCitation[] = (message.annotations ?? []).flatMap((item: any) => {
      const c = item.type === "url_citation" ? item.url_citation : null;
      return c && typeof c.url === "string" && /^https:\/\//.test(c.url)
        ? [{ url: c.url, title: typeof c.title === "string" ? c.title : new URL(c.url).hostname,
          content: typeof c.content === "string" ? c.content : "" }] : [];
    });
    return { text: message.content, model: body.model ?? this.model,
      inputTokens: Number(usage.prompt_tokens ?? 0), outputTokens: Number(usage.completion_tokens ?? 0),
      ...(typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? { cost: usage.cost } : {}), citations };
  }
}

export async function routerRequest(key: string | undefined, path: string, body?: unknown, fetcher: RouterFetch = fetch,signal?:AbortSignal): Promise<any> {
  if (!key) throw new Error("Connect your OpenRouter key first.");
  let response: Response;
  try { response = await fetcher(`${OPENROUTER_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST", signal:signal?AbortSignal.any([signal,AbortSignal.timeout(body===undefined?30_000:180_000)]):AbortSignal.timeout(body === undefined ? 30_000 : 180_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-OpenRouter-Title": "XENIUR" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }); } catch (cause) {
    // A person's own cancel stays a cancel. Anything else is the network, said in words.
    if (signal?.aborted) throw cause;
    if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) throw new Error("OpenRouter took too long to answer. Nothing was kept; try the step again.");
    throw new Error("XENIUR could not reach OpenRouter. Check your internet connection and try again.");
  }
  if (!response.ok) {
    // Provider bodies may echo prompts or credentials. Return an actionable status only.
    const message = response.status === 401 ? "OpenRouter rejected this key. Replace it in Settings."
      : response.status === 402 ? "Your OpenRouter account needs credits."
      : response.status === 429 ? "OpenRouter is busy. Try again in a moment."
      : `OpenRouter could not finish this request (${response.status}).`;
    // Only the provider's name is read from the body, to route around it. Nothing else is kept.
    let provider: string | null = null;
    try { const name = (await response.json())?.error?.metadata?.provider_name; provider = typeof name === "string" && name.length < 80 ? name : null; } catch { /* no usable body */ }
    throw new RouterHttpError(message, response.status, provider);
  }
  const chunks:Uint8Array[]=[];let size=0;
  const reader=response.body?.getReader();if(!reader)throw new Error("OpenRouter returned an empty response.");
  try {while(true){signal?.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>32_000_000){await reader.cancel();throw new Error("The OpenRouter response was too large.");}chunks.push(part.value);}}finally{reader.releaseLock();}
  const text=Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text);
}

/**
 * A streamed chat completion, assembled into the same shape as a whole one. It ends when the
 * provider finishes, when the person cancels, or after two minutes without a single byte, never
 * because a long answer is long. A provider failure mid-stream is a RouterHttpError like any other.
 */
export async function routerStream(key: string | undefined, body: Record<string, unknown>, fetcher: RouterFetch = fetch, signal?: AbortSignal, idleMs = 120_000): Promise<any> {
  if (!key) throw new Error("Connect your OpenRouter key first.");
  const idle = new AbortController();
  let timer = setTimeout(() => idle.abort(), idleMs);
  const quiet = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(), idleMs); };
  let response: Response;
  try {
    response = await fetcher(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST", signal: signal ? AbortSignal.any([signal, idle.signal]) : idle.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-OpenRouter-Title": "XENIUR" },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    clearTimeout(timer);
    if (signal?.aborted) throw cause;
    if (idle.signal.aborted) throw new Error("OpenRouter took too long to answer. Nothing was kept; try the step again.");
    throw new Error("XENIUR could not reach OpenRouter. Check your internet connection and try again.");
  }
  if (!response.ok) {
    clearTimeout(timer);
    const message = response.status === 401 ? "OpenRouter rejected this key. Replace it in Settings."
      : response.status === 402 ? "Your OpenRouter account needs credits."
      : response.status === 429 ? "OpenRouter is busy. Try again in a moment."
      : `OpenRouter could not finish this request (${response.status}).`;
    let provider: string | null = null;
    try { const name = (await response.json())?.error?.metadata?.provider_name; provider = typeof name === "string" && name.length < 80 ? name : null; } catch { /* no usable body */ }
    throw new RouterHttpError(message, response.status, provider);
  }
  if (!/event-stream/i.test(response.headers.get("content-type") ?? "")) {
    // Not streamed after all (a proxy, or a provider that answered whole): read it whole.
    try { return JSON.parse(await response.text()); } finally { clearTimeout(timer); }
  }
  const reader = response.body?.getReader();
  if (!reader) { clearTimeout(timer); throw new Error("OpenRouter returned an empty response."); }
  const decoder = new TextDecoder();
  let buffer = "", content = "", finish: string | null = null, usage: unknown = undefined, model: string | undefined, size = 0;
  const annotations: unknown[] = [];
  const take = (line: string) => {
    if (!line.startsWith("data:")) return; // ": OPENROUTER PROCESSING" keep-alives and blank lines
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data);
    if (chunk.error) {
      const name = chunk.error?.metadata?.provider_name;
      throw new RouterHttpError(`OpenRouter could not finish this request (${Number(chunk.error.code) || 502}).`, Number(chunk.error.code) || 502, typeof name === "string" && name.length < 80 ? name : null);
    }
    model ??= chunk.model;
    const choice = chunk.choices?.[0];
    if (typeof choice?.delta?.content === "string") content += choice.delta.content;
    if (Array.isArray(choice?.delta?.annotations)) annotations.push(...choice.delta.annotations);
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (chunk.usage) usage = chunk.usage;
  };
  // Silence ends the read itself, whatever the transport does with the aborted request.
  const silence = new Promise<never>((_, reject) => idle.signal.addEventListener("abort", () => reject(new Error("idle")), { once: true }));
  silence.catch(() => { /* observed below */ });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), silence]);
      if (part.done) break;
      quiet(); size += part.value.length;
      if (size > 32_000_000) { await reader.cancel(); throw new Error("The OpenRouter response was too large."); }
      buffer += decoder.decode(part.value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) { take(buffer.slice(0, newline).trim()); buffer = buffer.slice(newline + 1); }
    }
    take(buffer.trim());
  } catch (cause) {
    if (signal?.aborted) throw cause;
    if (idle.signal.aborted) throw new Error("OpenRouter stopped answering. Nothing was kept; try the step again.");
    throw cause;
  } finally { clearTimeout(timer); if (idle.signal.aborted) void reader.cancel().catch(() => {}); else reader.releaseLock(); }
  return { model, usage, choices: [{ finish_reason: finish, message: { content, annotations } }] };
}

/** A dedicated, priced image call. Only fixed per-image endpoints are offered by discovery. */
export async function generateRouterImage(opts: { key: string; model: string; provider: string; prompt: string;
  parameters?: Record<string, unknown>; reference?: string; fetch?: RouterFetch;signal?:AbortSignal }): Promise<{ bytes: Buffer; mime: string; cost?: number }> {
  const supported = opts.parameters ?? {};
  const body = await routerRequest(opts.key, "/images", {
    model: opts.model, prompt: opts.prompt,
    provider: { only: [opts.provider], allow_fallbacks: false },
    ...(supported["n"] ? { n: 1 } : {}),
    ...(supported["output_format"] ? { output_format: "png" } : {}),
    ...(opts.reference && supported["input_references"] ? { input_references: [{ type: "image_url", image_url: { url: opts.reference } }] } : {}),
  }, opts.fetch,opts.signal);
  const data = body.data?.[0];
  if (typeof data?.b64_json !== "string" || !/^[A-Za-z0-9+/=\r\n]+$/.test(data.b64_json)) throw new Error("No usable image was returned.");
  const bytes = Buffer.from(data.b64_json, "base64");
  // Raster only: SVG can contain active content. Host decodes and converts before storing.
  if (bytes.length < 8 || bytes.length > 20_000_000 || data.media_type === "image/svg+xml") throw new Error("This image format is not supported.");
  return { bytes, mime: data.media_type ?? "image/png", ...(typeof body.usage?.cost === "number" && Number.isFinite(body.usage.cost) && body.usage.cost >= 0 ? { cost: body.usage.cost } : {}) };
}
