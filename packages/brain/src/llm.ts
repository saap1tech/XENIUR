export interface LlmRequest {
  /** Stable across calls, so a provider's prompt cache can actually hit. Never varies. */
  system: string;
  /** The variable part: selected object state, then the utterance. */
  user: string;
  maxOutputTokens: number;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string | null;
}

/**
 * Nothing above this interface knows which model answered, or whether one did at all.
 * That is what lets the Brain run on a deterministic classifier with no key, and on a
 * paid model later, without a line changing anywhere else.
 */
export interface LlmClient {
  readonly id: string;
  readonly model: string | null;
  complete(request: LlmRequest): Promise<LlmResponse>;
}
