import { z } from "zod";
import { TimestampSchema, UuidSchema } from "./ids.js";
import type { PackageSignature, PublisherRef } from "./publisher.js";
import type { ProcessActor, ProcessEventKind } from "./process.js";
import type { Provenance } from "./enums.js";
import type { Tool } from "./tools.js";
import { recordDensity, type RecordDensity, type SealFacts } from "./seal.js";

/**
 * Challenges — explicit Worlds with rules, dates, a deliverable, judging, and an AI policy.
 *
 * XENIUR can check an entry against the policy because the process ledger already classifies
 * every event's actor as human, tool or model, and every representation records its
 * provenance. `checkAiPolicy` is pure over those two records and answers one of three ways.
 * The third answer — *the record does not say* — is shown as itself and never rounded to
 * green. Judging is human; there is no platform leaderboard.
 */
export const AI_POLICIES = ["unrestricted", "research_only", "no_generative_geometry", "human_only"] as const;
export const AiPolicySchema = z.enum(AI_POLICIES);
export type AiPolicy = z.infer<typeof AiPolicySchema>;

export const AI_POLICY_WORDS: Record<AiPolicy, { label: string; means: string }> = {
  unrestricted: { label: "any tools", means: "Models and generators may be used for anything." },
  research_only: { label: "research only", means: "Models may search, summarise and propose; nothing they generate may be in the deliverable." },
  no_generative_geometry: { label: "no generative geometry", means: "Images and text may be generated; the 3D form itself must be made by hand or by deterministic tools." },
  human_only: { label: "human only", means: "No model step anywhere in the record; no generated material of any kind." },
};

export const ChallengeRulesSchema = z.object({
  title: z.string().min(1).max(120),
  brief: z.string().min(1).max(2000),
  /** Plain rules a person reads before entering. Shown as a ConstraintStrip. */
  rules: z.array(z.string().min(1).max(200)).max(12).default([]),
  startsAt: TimestampSchema,
  endsAt: TimestampSchema,
  deliverable: z.object({
    /** Form roles an entry must carry, e.g. ["print.stl"]. */
    formRoles: z.array(z.string().min(1)).min(1).max(6),
    description: z.string().min(1).max(500),
  }).strict(),
  judging: z.object({
    criteria: z.array(z.string().min(1).max(200)).min(1).max(8),
    /** Who judges. Never a vote count, never a platform score. */
    by: z.enum(["publisher", "panel"]),
    /** The scale each criterion is marked on. The publisher's choice; XENIUR never sums it. */
    scale: z.enum(["one_to_five", "check"]).default("one_to_five"),
  }).strict(),
  aiPolicy: AiPolicySchema,
  /**
   * How one enters. `ticket`: a signed entry ticket from the organizer, collected on their
   * own channel — a fee, a waiver, an invitation. XENIUR verifies the ticket and marks it
   * used; it never sees a price, a card or a payment status.
   */
  entry: z.enum(["open", "ticket"]).default("open"),
  /** The organizer's words about entering — where to get a ticket, who is waived. Text, never a field XENIUR reads. */
  entryNote: z.string().max(500).default(""),
}).strict().refine((r) => r.endsAt > r.startsAt, { message: "a challenge ends after it starts" });
export type ChallengeRules = z.infer<typeof ChallengeRulesSchema>;
export type ChallengeRulesInput = z.input<typeof ChallengeRulesSchema>;

export interface ChallengeRecord {
  worldId: string;
  publisher: PublisherRef;
  rules: ChallengeRules;
  /** Signature by the publisher over the rules digest. Rules cannot change quietly. */
  signature: PackageSignature;
  /** Constraint Objects that carry the dates and the policy in the World. */
  deadlineConstraintId: string;
  policyConstraintId: string;
  createdAt: number;
  /** When the person dismissed its arrival row. A recorded move, never a lost notification. */
  dismissedAt: number | null;
}

/* ------------------------------------------------------------------------------------------ */
/* Compliance — pure                                                                            */
/* ------------------------------------------------------------------------------------------ */

export const COMPLIANCE_VERDICTS = ["complies", "violates", "insufficient_record"] as const;
export type ComplianceVerdict = (typeof COMPLIANCE_VERDICTS)[number];

export interface Compliance {
  verdict: ComplianceVerdict;
  policy: AiPolicy;
  /** In words. For a violation, names the event or form; for an insufficient record, what is missing. */
  because: string[];
  /** Counts the check was made over, so a reader can see how much record there was. */
  over: { events: number; modelEvents: number; representations: number; generated: number };
  /** When a Sealed Session covered the making: how dense the record is, in words and counts. */
  density?: RecordDensity;
}

export interface EntryRecord {
  id: string;
  challengeWorldId: string;
  objectId: string;
  publisher: PublisherRef;
  packageRoot: string | null;
  compliance: Compliance;
  submittedAt: number;
}

/** What the check reads. Both come straight from the graph; nothing is inferred to fill a gap. */
export interface EntryRecordForCheck {
  events: Array<{ kind: ProcessEventKind; actor: ProcessActor; tool: string | null; model: string | null; label: string }>;
  representations: Array<{ id: string; modality: string; provenance: Provenance; formRole: string | null; tool: string | null }>;
}

/** Tools whose output is model-made material rather than research. */
const GENERATIVE_TOOLS: ReadonlySet<string> = new Set<Tool>([
  "image.generate", "image.transform", "3d.generate", "video.generate", "video.edit", "code.scaffold", "doc.write",
]);
const GEOMETRY_TOOLS: ReadonlySet<string> = new Set<Tool>(["3d.generate"]);
const GEOMETRY_MODALITIES: ReadonlySet<string> = new Set(["mesh", "model", "3d"]);

export function checkAiPolicy(entry: EntryRecordForCheck, policy: AiPolicy, seal?: SealFacts | null): Compliance {
  const verdict = checkRecord(entry, policy);
  if (!seal) return verdict;
  return withSeal(verdict, seal);
}

/**
 * The seal can only lower. A gap across a version change or an unexplained paste means the
 * record does not say how that span's material was made, so `complies` becomes
 * `insufficient_record` with the span named. `violates` stays `violates`, from the model
 * event or generated form that earned it — a paste is never that event.
 */
function withSeal(c: Compliance, seal: SealFacts): Compliance {
  const density = recordDensity(seal);
  if (c.verdict === "violates") return { ...c, density };
  const because: string[] = [];
  for (const g of seal.gaps) {
    if (!g.versionChanged) continue;
    because.push(`the record does not say: ${g.minutes} min with no heartbeat (${new Date(g.from).toISOString().slice(11, 16)}–${new Date(g.to).toISOString().slice(11, 16)}) across a version change`);
  }
  for (const p of seal.unexplainedPastes) {
    because.push(`the record does not say: ${p.chars} characters pasted with no Source Object behind them`);
  }
  if (because.length === 0) return { ...c, density };
  return { ...c, verdict: "insufficient_record", because: [...because, ...c.because], density };
}

function checkRecord(entry: EntryRecordForCheck, policy: AiPolicy): Compliance {
  const modelEvents = entry.events.filter((e) => e.actor === "model");
  // A mock stands in for a generator and is judged as one; the M1 rule that nothing mock may
  // pass for real holds in the other direction too.
  const generated = entry.representations.filter((r) => r.provenance === "generated" || r.provenance === "mock");
  const over = {
    events: entry.events.length, modelEvents: modelEvents.length,
    representations: entry.representations.length, generated: generated.length,
  };
  const because: string[] = [];

  // Nothing at all: the check has nothing to read. Never rounded to complies.
  if (entry.events.length === 0 && entry.representations.length === 0) {
    return { verdict: "insufficient_record", policy, over,
      because: ["the record does not say: no process events and no forms were recorded for this entry"] };
  }

  const name = (e: EntryRecordForCheck["events"][number]) =>
    `${e.kind.replaceAll("_", " ")}${e.tool ? ` (${e.tool})` : ""}${e.model ? ` by ${e.model}` : ""}`;

  switch (policy) {
    case "unrestricted":
      break;
    case "human_only":
      for (const e of modelEvents) because.push(`a model step is in the record: ${name(e)}`);
      for (const r of generated) because.push(`a generated form is in the record: ${r.formRole ?? r.modality}`);
      break;
    case "research_only":
      for (const e of modelEvents) if (e.tool && GENERATIVE_TOOLS.has(e.tool)) because.push(`a model generated material: ${name(e)}`);
      for (const r of generated) because.push(`a generated form is in the deliverable: ${r.formRole ?? r.modality}`);
      break;
    case "no_generative_geometry":
      for (const e of modelEvents) if (e.tool && GEOMETRY_TOOLS.has(e.tool)) because.push(`geometry was generated: ${name(e)}`);
      for (const r of generated) {
        if (GEOMETRY_MODALITIES.has(r.modality) || (r.tool && GEOMETRY_TOOLS.has(r.tool))) {
          because.push(`a generated 3D form is in the deliverable: ${r.formRole ?? r.modality}`);
        }
      }
      break;
  }
  if (because.length > 0) return { verdict: "violates", policy, over, because };

  // No violation found — but was there enough record to have found one? A policy about the
  // deliverable's making needs the deliverable's forms; a policy about steps needs steps.
  if (policy !== "unrestricted" && entry.representations.length === 0) {
    return { verdict: "insufficient_record", policy, over,
      because: ["the record does not say: no forms are recorded, so what the deliverable is made of cannot be read"] };
  }
  if (policy !== "unrestricted" && entry.events.length === 0) {
    return { verdict: "insufficient_record", policy, over,
      because: ["the record does not say: no process events are recorded, so how the forms were made cannot be read"] };
  }
  return { verdict: "complies", policy, over,
    because: [`${AI_POLICY_WORDS[policy].label}: ${over.events} event${over.events === 1 ? "" : "s"}, ${over.modelEvents} by a model; ${over.representations} form${over.representations === 1 ? "" : "s"}, ${over.generated} generated`] };
}

export const COMPLIANCE_GLYPHS: Record<ComplianceVerdict, { glyph: string; word: string }> = {
  complies: { glyph: "●", word: "complies" },
  violates: { glyph: "◌", word: "violates" },
  insufficient_record: { glyph: "○", word: "the record does not say" },
};

export const ChallengeWorldIdSchema = UuidSchema;
