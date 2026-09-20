import type { ArenaFeed } from "@xeniur/core";
import { ArenaFeedSchema } from "@xeniur/core";
import { fetchPinned, type PinnedFetch } from "./capture.js";
import { checkedDestination, type Resolver } from "./policy.js";
import type { WebRiskChecker } from "./risk.js";

/**
 * An Arena feed is a static JSON file at a URL the person added: signed challenge documents,
 * nothing else. It is fetched exactly the way a captured page is — HTTPS only, the address
 * policy, the risk check, a pinned connection, no cookies, no scripts, no automatic
 * redirects past four, two megabytes — and parsed as data. Verification of each document
 * happens in the graph, where the publisher's trust lives; this file only brings bytes home.
 */
export async function fetchArenaFeed(input: string, risk: Pick<WebRiskChecker, "allow">,
  resolve?: Resolver, get: PinnedFetch = fetchPinned): Promise<{ url: string; feed: ArenaFeed }> {
  let target = input;
  for (let redirect = 0; redirect <= 4; redirect++) {
    const checked = await checkedDestination(target, resolve);
    await risk.allow(checked.url.href);
    const response = await get(checked.url, checked.addresses[0]!);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      target = new URL(response.location, checked.url).href; continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`The feed returned HTTP ${response.status}.`);
    if (!/^(application\/json|text\/plain|application\/octet-stream)(;|$)/i.test(response.type)) throw new Error("An Arena feed is a JSON file.");
    let parsed: unknown;
    try { parsed = JSON.parse(response.body); } catch { throw new Error("The feed is not valid JSON."); }
    return { url: checked.url.href, feed: ArenaFeedSchema.parse(parsed) };
  }
  throw new Error("Too many redirects.");
}
