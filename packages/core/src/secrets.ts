/**
 * The rule that no credential leaves the machine in anything XENIUR writes.
 *
 * Applied at every write boundary that leaves the process or the machine — package manifests,
 * metrics exports, delivery reports, Process Share pages. Lives in core because it is a
 * contract, not an implementation: the graph enforces it without knowing what a key store is.
 */

/**
 * The shapes API keys take, so a write boundary can refuse to carry one.
 *
 * Deliberately broad: a false positive costs a person one confusing refusal, a false negative
 * ships a secret in a package. The patterns cover the major providers' prefixes and any long
 * high-entropy token that looks like a bearer credential.
 */
const KEY_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,          // Anthropic
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/,    // OpenAI
  /\bAIza[0-9A-Za-z_-]{30,}/,             // Google
  /\bBearer\s+[A-Za-z0-9._-]{24,}/,       // any bearer token
  /\b(?:api[_-]?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9_-]{24,}/i,
];

/** True when text carries something shaped like a credential. */
export const looksLikeKey = (text: string): boolean => KEY_PATTERNS.some((re) => re.test(text));

/**
 * Walks any JSON-serialisable value and reports where a key-shaped string sits.
 *
 * Used at every write boundary that leaves the machine or the process: package manifests,
 * metrics exports, Process Share pages, delivery reports. Returns paths so a refusal can say
 * exactly what would have leaked.
 */
export function findKeyShaped(value: unknown, path = "$"): string[] {
  if (typeof value === "string") return looksLikeKey(value) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findKeyShaped(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([k, v]) => findKeyShaped(v, `${path}.${k}`));
  }
  return [];
}

/** Thrown by a write boundary that would otherwise have carried a credential. */
export class KeyWouldLeak extends Error {
  readonly code = "key_would_leak" as const;
  constructor(readonly boundary: string, readonly paths: readonly string[]) {
    super(`refusing to write ${boundary}: something shaped like an API key is in it at ${paths.join(", ")}`);
    this.name = "KeyWouldLeak";
  }
}
