import { z } from "zod";
import { canonicalJson } from "./authorization.js";
import { COMPLIANCE_VERDICTS } from "./challenges.js";
import { TimestampSchema, UuidSchema } from "./ids.js";
import { PackageSignatureSchema, PublisherRefSchema, type PackageSignature } from "./publisher.js";
import { sha256Hex } from "./sha256.js";

/**
 * Judging — a human judgment, recorded and signed; never a computed rank.
 *
 * A judge sees one surface: the deliverable, how it came together, the recorded AI activity,
 * the observation status, and — always — what the record cannot establish. They mark each
 * criterion on the scale the publisher defined, write a note, and move on. Each assessment
 * is the judge's own signed document, sent back like a critique. No aggregate exists until
 * the publisher writes the placings, in their words and their order, and signs those.
 */
export const JUDGING_SCALES = ["one_to_five", "check"] as const;
export const JudgingScaleSchema = z.enum(JUDGING_SCALES);
export type JudgingScale = z.infer<typeof JudgingScaleSchema>;

export const JUDGING_SCALE_WORDS: Record<JudgingScale, { label: string; marks: ReadonlyArray<string | number> }> = {
  one_to_five: { label: "1 to 5", marks: [1, 2, 3, 4, 5] },
  check: { label: "met or not", marks: ["yes", "no"] },
};

/** One criterion, one mark, one note. `null` mark: the judge chose not to mark it, and said so. */
export const CriterionMarkSchema = z.object({
  criterion: z.string().min(1).max(200),
  mark: z.union([z.number().int().min(1).max(5), z.enum(["yes", "no"])]).nullable(),
  note: z.string().max(2000).default(""),
}).strict();
export type CriterionMark = z.infer<typeof CriterionMarkSchema>;

/** What the judge had in front of them when they marked — facts, recorded with the marks. */
export const InspectedSchema = z.object({
  proofRoot: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  verdict: z.enum(COMPLIANCE_VERDICTS),
  density: z.string().max(400).nullable(),
  modelEvents: z.number().int().nonnegative(),
}).strict();

export const AssessmentSchema = z.object({
  id: UuidSchema,
  challengeWorldId: UuidSchema,
  entryId: UuidSchema,
  entryObjectId: UuidSchema,
  judge: PublisherRefSchema,
  criteria: z.array(CriterionMarkSchema).min(1).max(8),
  note: z.string().max(4000).default(""),
  inspected: InspectedSchema,
  recordedAt: TimestampSchema,
}).strict();
export type Assessment = z.infer<typeof AssessmentSchema>;
export type AssessmentInput = z.input<typeof AssessmentSchema>;

/** A placing as the publisher wrote it: a word, an entry, a reason. Order is the publisher's. */
export const PlacingSchema = z.object({
  place: z.string().min(1).max(60),
  entryId: UuidSchema,
  objectId: UuidSchema,
  reason: z.string().min(1).max(1000),
}).strict();
export type Placing = z.infer<typeof PlacingSchema>;

export const FinalistSchema = z.object({
  entryId: UuidSchema,
  objectId: UuidSchema,
  title: z.string().max(200),
  participant: PublisherRefSchema,
  proofRoot: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  verdict: z.enum(COMPLIANCE_VERDICTS),
  density: z.string().max(400).nullable(),
}).strict();
export type Finalist = z.infer<typeof FinalistSchema>;

export const ResultsSchema = z.object({
  challengeWorldId: UuidSchema,
  /** As written. XENIUR never sorts, sums or ranks these. */
  placings: z.array(PlacingSchema).max(50),
  /** Every placed entry's process proof link and verdict, so the results are inspectable. */
  finalists: z.array(FinalistSchema).max(50),
  note: z.string().max(4000).default(""),
  /** How many assessments the publisher had read when they wrote this. A count, not an average. */
  assessmentsRead: z.number().int().nonnegative(),
  publishedAt: TimestampSchema,
}).strict();
export type Results = z.infer<typeof ResultsSchema>;

/**
 * A signed document: the body, and a publisher's signature over its canonical digest. The
 * three kinds the Arena sends between machines. A signature establishes the integrity and
 * origin of the record, not the truth of every claim in it.
 */
export const SIGNED_DOCUMENT_KINDS = ["xeniur.challenge/1", "xeniur.judging/1", "xeniur.results/1", "xeniur.ticket/1"] as const;
export type SignedDocumentKind = (typeof SIGNED_DOCUMENT_KINDS)[number];
export interface SignedDocument<T> {
  kind: SignedDocumentKind;
  body: T;
  signature: PackageSignature;
}
export const SignedDocumentEnvelopeSchema = z.object({
  kind: z.enum(SIGNED_DOCUMENT_KINDS),
  body: z.unknown().refine((b) => b !== undefined, "a signed document has a body"),
  signature: PackageSignatureSchema,
}).strict().transform((d) => d as SignedDocument<unknown>);

export function documentDigest(body: unknown): string {
  return sha256Hex(canonicalJson(body));
}

/**
 * Three things a record can and cannot establish — on every judging surface and in every
 * rules template. Marketing says *process-aware judging*; it never says AI-proof.
 */
export const RECORD_LIMITS: ReadonlyArray<{ what: string; is: string; goesAsFar: string }> = [
  { what: "Recorded provenance", is: "actions, versions, tools, model calls and edits XENIUR observed", goesAsFar: "directly inspectable" },
  { what: "Record integrity", is: "the disclosed records match one signed history; where it has gaps", goesAsFar: "cryptographically checkable, with limits" },
  { what: "Independent human contribution", is: "whether the participant did the work without unrecorded tools or outside help", goesAsFar: "needs additional evidence and human judgment" },
];

/** What a judge sees for one entry. Read from the graph by the host; rendered by `JudgingSheet`. */
export interface JudgingSheetData {
  challengeWorldId: string;
  entryId: string;
  entryObjectId: string;
  /** Position in the arrival order — a label, not a rank. */
  entryNumber: number;
  entryCount: number;
  title: string;
  participant: { publicKey: string; displayName: string };
  criteria: string[];
  scale: JudgingScale;
  forms: Array<{ role: string; provenance: string; modality: string }>;
  research: { sources: number; claims: number; supported: number; contradicted: number; unresolved: number };
  decisions: { accepted: number; withSteelman: number; chosenDespite: number };
  build: { versions: number; human: number; tool: number; model: number };
  delivery: { released: boolean; verdict: Assessment["inspected"]["verdict"]; because: string[] };
  aiActivity: Array<{ at: number; kind: string; tool: string | null; model: string | null; label: string }>;
  observation: { verdict: Assessment["inspected"]["verdict"]; density: string | null; gaps: number; unexplainedPastes: number; exitReason: string | null };
  proofRoot: string | null;
  /** This judge's own assessment of this entry, if recorded. */
  own: Assessment | null;
}
