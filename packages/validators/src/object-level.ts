import { rootOverlap } from "@xeniur/core";
import type { DnaReport } from "@xeniur/core";
import type { CheckResult, ObjectContext, Validator, ValidationSubject } from "./types.js";

/**
 * These validators are about the Object as a whole, so they are excluded from the
 * per-form pass and given a context describing what the whole thing was built from.
 */
const requireContext = (subject: ValidationSubject): ObjectContext => {
  if (!subject.object) throw new Error("this validator needs object context");
  return subject.object;
};

/**
 * Fails while any current form is standing in for real work.
 *
 * This is what turns the honesty rule from a convention into a gate: *Ready for Client
 * Delivery* and *Ready for Publication* both require it, so a mock cannot reach a client
 * or a journal by being forgotten about.
 */
export const provenanceNoMock: Validator = {
  id: "provenance.no-mock",
  version: "1.0.0",
  appliesTo: (s) => s.object !== undefined,
  async run(subject): Promise<CheckResult> {
    const provenances = requireContext(subject).provenances();
    const mocks = provenances.filter((p) => p === "mock").length;
    return {
      status: mocks === 0 ? "pass" : "fail",
      summary: mocks === 0
        ? "nothing here is standing in for real work"
        : `${mocks} form${mocks === 1 ? " is" : "s are"} mock output, not the real thing`,
      detail: { mockForms: mocks, provenances },
    };
  },
};

/**
 * Reports where the material came from, precisely.
 *
 * Deliberately not a score, and deliberately not one flag. It used to fail whenever no
 * human root was found and announce that *nothing came from outside a model* — which is
 * false for material whose origin was simply never recorded, and was the check overclaiming
 * in exactly the way this feature exists to prevent. Now it states only what is decidable,
 * and each statement carries a path you can follow.
 */
export const originStated: Validator = {
  id: "origin.stated",
  version: "2.0.0",
  appliesTo: (s) => s.object !== undefined,
  async run(subject): Promise<CheckResult> {
    const dna = requireContext(subject).dna();
    const nothingHuman = dna.summary.rootIds.length > 0 && !dna.summary.humanSignalPresent;

    return {
      // A warning, not a failure: material of unknown origin is a gap in the record, not
      // proof of anything. Only a readiness profile decides whether that is acceptable.
      status: dna.summary.rootIds.length === 0 ? "skipped" : nothingHuman ? "warn" : "pass",
      summary: dna.statements.length > 0
        ? dna.statements.map((s) => s.text).join(" · ")
        : "nothing recorded about where this came from",
      detail: {
        counts: dna.summary.counts,
        statements: dna.statements,
        modelTouchedSteps: dna.summary.modelTouchedSteps,
        humanMaterialPresent: dna.summary.humanSignalPresent,
      },
    };
  },
};

/**
 * Fails only when every recorded root is generated — the closed loop worth catching.
 *
 * Distinct from `origin.stated`, which describes. This one is the gate a readiness profile
 * can require, and it makes the narrower, decidable claim.
 */
export const humanSignalPresent: Validator = {
  id: "humanSignal.present",
  version: "2.0.0",
  appliesTo: (s) => s.object !== undefined,
  async run(subject): Promise<CheckResult> {
    const dna = requireContext(subject).dna();
    const allGenerated = dna.statements.some((s) => s.kind === "all_roots_generated");
    const unknown = dna.statements.find((s) => s.kind === "origin_unknown");

    if (allGenerated) {
      return {
        status: "fail",
        summary: `every recorded root is generated — ${dna.composition}`,
        detail: { counts: dna.summary.counts, statements: dna.statements },
      };
    }
    if (!dna.summary.humanSignalPresent && unknown) {
      return {
        // Unknown origin is not evidence of generation, so this cannot fail on it.
        status: "warn",
        summary: `${unknown.text} — XENIUR cannot tell whether a person made them`,
        detail: { counts: dna.summary.counts, statements: dna.statements },
      };
    }
    return {
      status: "pass",
      summary: `built from ${dna.composition}`,
      detail: {
        counts: dna.summary.counts, statements: dna.statements,
        modelTouchedSteps: dna.summary.modelTouchedSteps,
      },
    };
  },
};

/**
 * Reports how much of this was built from the same material as earlier work.
 *
 * Never a warning. Repeated roots are exactly what a consistent collection looks like, and
 * XENIUR has no basis for disapproving of one. The number is offered; the judgement is not.
 */
export const repetitionMeasured: Validator = {
  id: "repetition.measured",
  version: "2.0.0",
  appliesTo: (s) => s.object !== undefined,
  async run(subject): Promise<CheckResult> {
    const ctx = requireContext(subject);
    const current = ctx.ingredients().rootIds;
    const overlaps = ctx.previousRootSets().map((previous) => rootOverlap(current, previous));
    const highest = overlaps.length === 0 ? 0 : Math.max(...overlaps);

    return {
      status: "pass",
      summary: overlaps.length === 0
        ? "nothing earlier to compare this against"
        : `${Math.round(highest * 100)}% of its ingredients also appear in earlier work here`,
      detail: {
        highestOverlap: Number(highest.toFixed(3)),
        comparedAgainst: overlaps.length,
        note: "structural overlap of sources; says nothing about meaning",
      },
    };
  },
};

export const objectValidators: readonly Validator[] = [
  provenanceNoMock, originStated, humanSignalPresent, repetitionMeasured,
];
