import type { LlmClient, LlmRequest, LlmResponse } from "./llm.js";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export interface RouterCitation { url: string; title: string; content: string; }
export interface RouterResult extends LlmResponse { citations: RouterCitation[]; cost?: number; }
export type RouterFetch = typeof fetch;

/** Only the main process constructs this client. No key, arbitrary tools, or endpoint crosses the renderer bridge. */
export class OpenRouterClient implements LlmClient {
  readonly id = "openrouter";
  readonly model: string;
  constructor(private readonly opts: { apiKey?: string; model: string; fetch?: RouterFetch;
    inputPerMTok?: number; outputPerMTok?: number }) { this.model = opts.model; }
  async complete(request: LlmRequest): Promise<RouterResult> { return this.chat(request); }
  async chat(request: LlmRequest, search = false): Promise<RouterResult> {
    const body = await routerRequest(this.opts.apiKey, "/chat/completions", {
      model: this.model, stream: false, max_tokens: request.maxOutputTokens,
      messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
      // A single pinned Exa search avoids native search's different/unbounded tool prices.
      ...(search ? { tools: [{ type: "openrouter:web_search", parameters: {
        engine: "exa", mode: "auto", max_uses: 1, max_results: 6, max_total_results: 6, max_characters: 2500,
      } }] } : {}),
      plugins: [{ id: "web", enabled: false }],
      provider: { allow_fallbacks: false, ...(this.opts.inputPerMTok !== undefined ? { max_price: {
        prompt: this.opts.inputPerMTok, completion: this.opts.outputPerMTok,
      } } : {}) },
    }, this.opts.fetch);
    const message = body.choices?.[0]?.message;
    if (body.error || !message || typeof message.content !== "string" || body.choices[0].finish_reason === "length") {
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

export async function routerRequest(key: string | undefined, path: string, body?: unknown, fetcher: RouterFetch = fetch): Promise<any> {
  if (!key) throw new Error("Connect your OpenRouter key first.");
  const response = await fetcher(`${OPENROUTER_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(body === undefined ? 30_000 : 180_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-OpenRouter-Title": "XENIUR" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    // Provider bodies may echo prompts or credentials. Return an actionable status only.
    const message = response.status === 401 ? "OpenRouter rejected this key. Replace it in Settings."
      : response.status === 402 ? "Your OpenRouter account needs credits."
      : response.status === 429 ? "OpenRouter is busy. Try again in a moment."
      : `OpenRouter could not finish this request (${response.status}).`;
    throw new Error(message);
  }
  const text = await response.text();
  if (text.length > 32_000_000) throw new Error("The OpenRouter response was too large.");
  return JSON.parse(text);
}

/** A dedicated, priced image call. Only fixed per-image endpoints are offered by discovery. */
export async function generateRouterImage(opts: { key: string; model: string; provider: string; prompt: string;
  parameters?: Record<string, unknown>; reference?: string; fetch?: RouterFetch }): Promise<{ bytes: Buffer; mime: string; cost?: number }> {
  const supported = opts.parameters ?? {};
  const body = await routerRequest(opts.key, "/images", {
    model: opts.model, prompt: opts.prompt,
    provider: { only: [opts.provider], allow_fallbacks: false },
    ...(supported["n"] ? { n: 1 } : {}),
    ...(supported["output_format"] ? { output_format: "png" } : {}),
    ...(opts.reference && supported["input_references"] ? { input_references: [{ type: "image_url", image_url: { url: opts.reference } }] } : {}),
  }, opts.fetch);
  const data = body.data?.[0];
  if (typeof data?.b64_json !== "string" || !/^[A-Za-z0-9+/=\r\n]+$/.test(data.b64_json)) throw new Error("No usable image was returned.");
  const bytes = Buffer.from(data.b64_json, "base64");
  // Raster only: SVG can contain active content. Host decodes and converts before storing.
  if (bytes.length < 8 || bytes.length > 20_000_000 || data.media_type === "image/svg+xml") throw new Error("This image format is not supported.");
  return { bytes, mime: data.media_type ?? "image/png", ...(typeof body.usage?.cost === "number" && Number.isFinite(body.usage.cost) && body.usage.cost >= 0 ? { cost: body.usage.cost } : {}) };
}
