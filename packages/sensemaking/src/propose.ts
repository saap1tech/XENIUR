import type { Atom, CandidateRecord, Locator, ProposedCitation } from "@xeniur/core";
import { textLocator } from "@xeniur/core";
import type { Candidate } from "./extract.js";
import { contextAround } from "./locator.js";
import type { SensemakingStore } from "./store.js";

/** The bound proposal, as the Brain's binder produces it. Structural, so this package need not import the Brain. */
export interface BoundProposalInput {
  headline: string;
  claims: Array<{
    text: string;
    stance: "assertion" | "opinion" | "hypothesis" | "observation" | "synthesis" | "direction";
    citations: Array<{ sourceVersionId: string; exact: string; start: number | null;
                       proposedStatus: "supported" | "contradicted" | "ambiguous" | "unresolved" }>;
    unsupported: boolean;
  }>;
  steps: Array<{ order: number; text: string; restsOn: number[] }>;
  uncertain: string[];
  droppedCitations: number;
}

export interface ProposalOutcome {
  /** Every claim, as a candidate. Nothing is an atom yet. */
  claimCandidates: CandidateRecord[];
  /** Steps as candidates too — a step is a claim about what to do. */
  stepCandidates: CandidateRecord[];
  /** Which claim candidates arrived with no resolvable citation. */
  unsupportedClaimIds: string[];
  droppedCitations: number;
}

/**
 * Turns a bound proposal into candidates — exactly like captured text.
 *
 * The model proposed; the person decides. Every claim and every step lands in
 * `capture_candidates`, each claim carrying the citations that resolved, each citation's
 * status the model's opinion (`proposedStatus`) and nothing more. Accepting an assertion with
 * unreviewed citations is refused by the store (Stage 1) until a person reviews them, or
 * accepts deliberately with the chips left visibly empty.
 *
 * A claim with no resolvable citation is not dropped: it is filed with none, so it shows as
 * "not supported by the sources given". The model said it; the sources did not.
 */
export function proposeFromBound(
  store: SensemakingStore, worldId: string, bound: BoundProposalInput,
  opts: { extractor?: string; sourceTexts?: ReadonlyMap<string, string> } = {},
): ProposalOutcome {
  const extractor = opts.extractor ?? "model/research_plan";

  // A proposal is filed against the copy its first resolved citation points into; a proposal
  // with no resolved citation at all is filed against the first source the model was shown.
  const anchor = bound.claims.flatMap((c) => c.citations).find((c) => c.start !== null)?.sourceVersionId
    ?? [...(opts.sourceTexts?.keys() ?? [])][0];
  if (!anchor) throw new Error("a proposal needs at least one source copy to be filed against");

  const claimCandidates: Candidate[] = bound.claims.map((c) => ({
    atomType: "claim", text: c.text, because: `proposed by a model as ${c.stance === "assertion" ? "an assertion" : c.stance}`,
    locator: locatorFor(c.citations[0], opts.sourceTexts),
    stance: c.stance,
    citations: c.citations.map((cite): ProposedCitation => ({
      sourceVersionId: cite.sourceVersionId,
      locator: locatorFor(cite, opts.sourceTexts),
      proposedStatus: cite.proposedStatus,
    })),
  }));
  const filedClaims = store.propose(worldId, anchor, claimCandidates, extractor);

  const stepCandidates: Candidate[] = bound.steps.map((s) => ({
    atomType: "claim", text: `Step ${s.order}: ${s.text}`,
    because: s.restsOn.length > 0
      ? `proposed step, resting on claim${s.restsOn.length === 1 ? "" : "s"} ${s.restsOn.map((i) => i + 1).join(", ")}`
      : "proposed step, resting on no particular claim",
    locator: { selectors: [] },
    // A step is a direction, not an assertion about the world; it needs no source to stand on.
    stance: "direction",
    citations: [],
  }));
  const filedSteps = store.propose(worldId, anchor, stepCandidates, extractor);

  return {
    claimCandidates: filedClaims, stepCandidates: filedSteps,
    unsupportedClaimIds: filedClaims.filter((_, i) => bound.claims[i]!.unsupported).map((c) => c.id),
    droppedCitations: bound.droppedCitations,
  };
}

function locatorFor(
  cite: { sourceVersionId: string; exact: string; start: number | null } | undefined,
  texts: ReadonlyMap<string, string> | undefined,
): Locator {
  if (!cite || cite.start === null) return { selectors: [] };
  const text = texts?.get(cite.sourceVersionId) ?? "";
  const end = cite.start + cite.exact.length;
  return textLocator(cite.exact, cite.start, end, text ? contextAround(text, cite.start, end) : {});
}

/** Accepts a step candidate as an atom in the Build lane, ready to become a task or a constraint. */
export function acceptStep(store: SensemakingStore, candidateId: string): Atom | null {
  const atom = store.accept(candidateId, { stance: "direction" });
  if (!atom) return null;
  // Return what is stored after the sort, not the pre-sort snapshot.
  return store.sort(atom.objectId, "build");
}
