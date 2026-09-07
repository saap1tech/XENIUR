import type {
  CheckStatus, DnaReport, IngredientSummary, ObjectProperties, Provenance, Representation,
} from "@xeniur/core";
import type { ProviderEnv } from "@xeniur/providers";

/**
 * What an Object was built from. Object-level validators speak about the whole thing, so
 * they are given this rather than one blob.
 */
export interface ObjectContext {
  ingredients(): IngredientSummary;
  /** The full origin report, including statements and model-touched steps. */
  dna(): DnaReport;
  /** Root sets of previously released work, for measuring structural repetition. */
  previousRootSets(): string[][];
  provenances(): Provenance[];
}

export interface ValidationSubject {
  representation: Representation;
  /** The form role it currently occupies, when it occupies one. */
  formRole: string | null;
  /** Read lazily: most validators need the bytes, a few only need the row. */
  bytes(): Buffer;
  /** The Object's properties at the current version — units, dimensions, tags. */
  properties: ObjectProperties;
  /** Present only for object-level validators; form validators never need it. */
  object?: ObjectContext;
}

export interface CheckResult {
  status: CheckStatus;
  summary: string;
  /** Measured values. A readiness `min`/`max` requirement reads a field from here. */
  detail: Record<string, unknown>;
}

/**
 * A validator measures one thing and reports what it found.
 *
 * It never decides whether that is acceptable — a readiness profile does, from the numbers
 * in `detail`. Keeping measurement and judgement apart is what lets the same validator
 * serve "Ready for Web" and "Ready for Publication" with different thresholds, and what
 * makes a failing profile explainable rather than merely red.
 */
export interface Validator {
  readonly id: string;
  /** Recorded on every check, so a validator change invalidates old measurements. */
  readonly version?: string;
  /** Only run where it makes sense; anything else is reported as skipped, not failed. */
  appliesTo(subject: ValidationSubject): boolean;
  run(subject: ValidationSubject, env: ProviderEnv): Promise<CheckResult>;
}

export const skipped = (summary: string): CheckResult => ({ status: "skipped", summary, detail: {} });

export const MOCK_PROVENANCE: readonly Provenance[] = ["mock"];
