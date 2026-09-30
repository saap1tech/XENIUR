import type { LlmClient, LlmRequest, LlmResponse } from "./llm.js";

export interface GoogleOptions { apiKey: string | undefined; model: string; baseUrl?: string }

/** A bounded Gemini text call. The main process supplies a key only after selection and verification. */
export class GoogleClient implements LlmClient {
  readonly id = "google";
  constructor(private readonly options: GoogleOptions) {}
  get model(): string { return this.options.model; }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!this.options.apiKey) throw new Error("Gemini API key is not set");
    const root = this.options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    const response = await fetch(`${root}/models/${encodeURIComponent(this.options.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: { maxOutputTokens: request.maxOutputTokens, responseMimeType: "application/json" },
      }),
    });
    if (!response.ok) throw new Error(`Gemini responded ${response.status}`);
    const body = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    return {
      text: body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "",
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0),
      model: this.model,
    };
  }
}
