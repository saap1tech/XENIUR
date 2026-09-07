import type { LlmClient, LlmRequest, LlmResponse } from "./llm.js";

export interface OpenAiOptions {
  apiKey: string | undefined;
  model: string;
  modelVerified: boolean;
  baseUrl?: string;
}

/**
 * Written against the Responses API shape, and deliberately inert.
 *
 * It refuses to send anything until a key is present *and* the model id in
 * config/providers.json has been marked verified — because the spec's model name and its
 * quoted price could not be confirmed, and an accidental first call is the expensive kind
 * of mistake. Flip `modelVerified` only after checking the live pricing page.
 */
export class OpenAiClient implements LlmClient {
  readonly id = "openai";
  constructor(private readonly opts: OpenAiOptions) {}

  get model(): string { return this.opts.model; }

  private assertUsable(): void {
    if (!this.opts.apiKey || this.opts.apiKey.trim() === "") {
      throw new Error("OpenAiClient: OPENAI_API_KEY is not set");
    }
    if (!this.opts.modelVerified) {
      throw new Error(
        `OpenAiClient: model "${this.opts.model}" is unverified. Confirm the model id and ` +
        `its price against OpenAI's live pricing page, then set modelVerified: true in ` +
        `config/providers.json.`,
      );
    }
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.assertUsable();
    const res = await fetch(`${this.opts.baseUrl ?? "https://api.openai.com/v1"}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({
        model: this.opts.model,
        // Stable block first so the prompt cache has something to hit.
        input: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        max_output_tokens: request.maxOutputTokens,
        text: { format: { type: "json_object" } },
      }),
    });
    if (!res.ok) throw new Error(`OpenAI responded ${res.status}: ${await res.text()}`);

    const body = await res.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = body.output_text
      ?? body.output?.[0]?.content?.[0]?.text
      ?? "";
    return {
      text,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      model: this.opts.model,
    };
  }
}
