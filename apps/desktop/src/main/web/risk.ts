import type { WebRiskMode, WebRiskResult } from "@xeniur/core";
import { localUrlPolicy } from "./policy.js";

/** Lookup is opt-in: it discloses the full URL to Google. No cached result is called safe. */
export class WebRiskChecker {
  private readonly cache = new Map<string, { expires: number; result: WebRiskResult }>();
  constructor(
    private readonly settings: () => { mode: WebRiskMode; key?: string },
    private readonly request: typeof fetch = fetch,
  ) {}

  async check(input: string): Promise<WebRiskResult> {
    const url = localUrlPolicy(input).href;
    const { mode, key } = this.settings();
    if (mode === "local_only") return {
      status: "not_checked", provider: "none", checkedAt: null,
      label: "Reputation not checked. Local address policy applied.",
    };
    if (!key) return { status: "unavailable", provider: "google_web_risk", checkedAt: null,
      label: "Web Risk is not configured." };
    const cached = this.cache.get(url);
    if (cached && cached.expires > Date.now()) return cached.result;
    try {
      const endpoint = new URL("https://webrisk.googleapis.com/v1/uris:search");
      endpoint.searchParams.set("uri", url);
      for (const type of ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"]) endpoint.searchParams.append("threatTypes", type);
      const response = await this.request(endpoint, { headers: { "X-Goog-Api-Key": key }, signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error("lookup unavailable");
      const body = await response.json() as { threat?: { threatTypes?: string[]; expireTime?: string } };
      const listed = (body.threat?.threatTypes?.length ?? 0) > 0;
      const result: WebRiskResult = {
        status: listed ? "listed_threat" : "no_listed_threat", provider: "google_web_risk", checkedAt: Date.now(),
        label: listed ? "Listed threat detected. This destination is blocked." : "No listed threat detected",
      };
      const expires = listed ? Date.parse(body.threat?.expireTime ?? "") : Date.now() + 5 * 60_000;
      if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(url, { expires: Number.isFinite(expires) ? expires : Date.now(), result });
      return result;
    } catch { return { status: "unavailable", provider: "google_web_risk", checkedAt: null,
      label: "Reputation check unavailable. Try again before opening this destination." }; }
  }

  async allow(url: string): Promise<WebRiskResult> {
    const result = await this.check(url);
    if (result.status === "listed_threat" || result.status === "unavailable") throw new Error(result.label);
    return result;
  }
}
