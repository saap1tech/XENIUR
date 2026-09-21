import type { SensemakingStore } from "@xeniur/sensemaking";
import { extractCandidates } from "@xeniur/sensemaking";
import { sha256Hex } from "@xeniur/core";

/**
 * Explore brings a page in as a Source and *proposes* what it might contain. Nothing here
 * becomes knowledge: the extractor's guesses are candidates until a person reviews them in the
 * tray. A capture used to accept its own candidates in one go, which attributed a regular
 * expression's reading to the person; the sentence on the screen said otherwise. Now the
 * sentence is true.
 */
export function exploreIntoProposals(
  sense: SensemakingStore,
  worldId: string,
  captured: { title: string; text: string; url: string; risk: { status: string } },
): { sourceId: string; candidateCount: number; contentHash: string } {
  const contentHash = sha256Hex(captured.text);
  const source = sense.recordSource({
    worldId, kind: "article", title: captured.title, url: captured.url, text: captured.text,
    hash: contentHash, extractor: "xeniur-explore/1", metadata: { risk: captured.risk.status },
  });
  const version = sense.latestVersionOf(source.id);
  const proposed = version ? sense.propose(worldId, version.id, extractCandidates(captured.text), "xeniur-explore/1") : [];
  return { sourceId: source.id, candidateCount: proposed.length, contentHash };
}
