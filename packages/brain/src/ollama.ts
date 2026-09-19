import type { LlmClient, LlmRequest, LlmResponse } from "./llm.js";

export interface OllamaOptions {
  model: string;
  /** Loopback only. Ollama is a local process; XENIUR does not reach a remote one here. */
  baseUrl?: string;
}

/**
 * A local model through Ollama: no key, no bill, no bytes leaving the machine.
 *
 * This is the route the policy prefers for cheap intents and the only route it allows when a
 * restricted source is in view. It is deliberately the simplest possible client — one POST to
 * a loopback address — so that "local" means something a person can verify by reading forty
 * lines rather than by trusting a label.
 */
export class OllamaClient implements LlmClient {
  readonly id = "ollama";
  constructor(private readonly opts: OllamaOptions) {}

  get model(): string { return this.opts.model; }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const base = this.opts.baseUrl ?? "http://127.0.0.1:11434";
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
      throw new Error(`OllamaClient: refusing a non-loopback address (${base}); local means local`);
    }
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.opts.model, stream: false, format: "json",
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        options: { num_predict: request.maxOutputTokens },
      }),
    });
    if (!res.ok) throw new Error(`Ollama responded ${res.status}: ${await res.text()}`);
    const body = await res.json() as {
      message?: { content?: string }; prompt_eval_count?: number; eval_count?: number;
    };
    return {
      text: body.message?.content ?? "",
      inputTokens: body.prompt_eval_count ?? 0,
      outputTokens: body.eval_count ?? 0,
      model: this.opts.model,
    };
  }
}
