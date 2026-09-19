import type { KeyStore } from "./keys.js";
import type { ModelProvider, ModelRegistry } from "./registry.js";

export interface VerifyResult {
  provider: ModelProvider;
  ok: boolean;
  /** Model ids the provider reported, when it did. */
  models: string[];
  /** Why not, in the words shown to the person. */
  reason: string | null;
  /** True by construction for local providers and for every path in this function. */
  billable: false;
}

/** The narrow slice of `fetch` this needs, so tests never touch a network. */
export type Fetcher = (url: string, init: { headers: Record<string, string> }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Checks that a key works, without spending anything.
 *
 * Every provider exposes a models-list endpoint that costs nothing to call. Verification uses
 * that and only that: no completion, no tokens, no bill. The result says so in its type —
 * `billable: false` is not a claim, it is the only value the field can take.
 *
 * A local provider (Ollama) is verified by asking it what it has loaded; no key is involved.
 */
export async function verifyKey(
  provider: ModelProvider, registry: ModelRegistry, keys: KeyStore, fetcher: Fetcher,
): Promise<VerifyResult> {
  const entry = registry.provider(provider);
  if (!entry) return { provider, ok: false, models: [], reason: "unknown provider", billable: false };

  if (!entry.local && !keys.has(provider)) {
    return { provider, ok: false, models: [], reason: "no key stored for this provider", billable: false };
  }
  if (!entry.verifyUrl) {
    return { provider, ok: false, models: [], reason: "this provider has no free verification endpoint configured", billable: false };
  }

  const key = entry.local ? null : keys.read(provider);
  const headers: Record<string, string> = {};
  let url = entry.verifyUrl;
  if (key) {
    if (entry.auth === "bearer") headers["Authorization"] = `Bearer ${key}`;
    else if (entry.auth === "x-api-key") { headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; }
    else if (entry.auth === "query") url = `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
  }

  try {
    const res = await fetcher(url, { headers });
    if (!res.ok) {
      return {
        provider, ok: false, models: [],
        reason: res.status === 401 || res.status === 403
          ? "the provider rejected this key"
          : `the provider answered ${res.status}`,
        billable: false,
      };
    }
    const body = await res.json() as Record<string, unknown>;
    return { provider, ok: true, models: modelIdsFrom(body), reason: null, billable: false };
  } catch (err) {
    return {
      provider, ok: false, models: [],
      reason: `could not reach the provider (${err instanceof Error ? err.message : String(err)})`,
      billable: false,
    };
  }
}

/** The three shapes a models-list comes back in. Anything else yields an empty list. */
function modelIdsFrom(body: Record<string, unknown>): string[] {
  const data = body["data"] ?? body["models"];
  if (!Array.isArray(data)) return [];
  return data.map((m) => {
    if (typeof m !== "object" || m === null) return null;
    const r = m as Record<string, unknown>;
    return (r["id"] ?? r["name"] ?? r["model"]) as string | null;
  }).filter((id): id is string => typeof id === "string");
}
