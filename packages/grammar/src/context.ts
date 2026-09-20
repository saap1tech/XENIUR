import { z } from "zod";
import { UuidSchema, canonicalJson, sha256Hex } from "@xeniur/core";

/**
 * The Context Compiler — memory that keeps *why*.
 *
 * The graph already holds the project. What was missing is the same move M4 made for the
 * interface: a pure compiler from the current situation to what a model receives. Every other
 * memory product remembers what you *said*. This one sends what you *decided*, why, what you
 * rejected, and what would change your mind — because those are rows, not prose.
 *
 * Pure: no clock, no random, no I/O. The host assembles the material; the compiler decides
 * what goes, what stays behind and why, and produces a digest bound to the content. Same
 * material, same policy → same included set, same digest. That is what lets an approval cover
 * *this* context and no other.
 */

export const RightsSchema = z.enum(["unknown", "permitted", "restricted"]);

export const ContextDecisionSchema = z.object({
  objectId: UuidSchema,
  question: z.string().min(1),
  chosenOption: z.string().nullable(),
  rationale: z.string().default(""),
  state: z.enum(["draft", "accepted", "needs_review", "superseded"]),
  acceptedVersionId: UuidSchema.nullable().default(null),
  assumptions: z.array(z.object({
    text: z.string(), reviewTrigger: z.string().default(""),
    kind: z.enum(["assumption", "steelman", "accepted_uncertainty"]).default("assumption"),
  })).default([]),
  rejectedOptions: z.array(z.string()).default([]),
  relatedToFocus: z.boolean().default(true),
  /** The person said "Don't send this to AI". A versioned processing permission, not a rights change. */
  aiAllowed: z.boolean().default(true),
}).strict();

export const ContextPassageSchema = z.object({
  sourceVersionId: UuidSchema,
  sourceTitle: z.string().min(1),
  text: z.string().min(1),
  rights: RightsSchema.default("unknown"),
  /** The claim this passage was cited for, and whether that citation has been reviewed. */
  citedBy: UuidSchema.nullable().default(null),
  supportReviewed: z.boolean().default(false),
  relatedToFocus: z.boolean().default(true),
  aiAllowed: z.boolean().default(true),
}).strict();

export const ContextConstraintSchema = z.object({
  objectId: UuidSchema, title: z.string().min(1), kind: z.string().min(1), value: z.unknown(),
  relatedToFocus: z.boolean().default(true),
  aiAllowed: z.boolean().default(true),
}).strict();

export const ContextChangeSchema = z.object({
  kind: z.enum(["rebuild", "review"]), subject: z.string().min(1), because: z.string().min(1),
}).strict();

/** Everything the host offers the compiler. The compiler chooses; the host never pre-filters. */
export const ContextMaterialSchema = z.object({
  focus: z.object({
    id: UuidSchema, title: z.string().min(1), semanticType: z.string().min(1),
    formRoles: z.array(z.string()).default([]),
    summary: z.string().default(""),
  }).strict(),
  decisions: z.array(ContextDecisionSchema).default([]),
  passages: z.array(ContextPassageSchema).default([]),
  constraints: z.array(ContextConstraintSchema).default([]),
  changes: z.array(ContextChangeSchema).default([]),
}).strict();
export type ContextMaterial = z.infer<typeof ContextMaterialSchema>;
export type ContextMaterialInput = z.input<typeof ContextMaterialSchema>;

/**
 * What a person allows to be sent, as a shape — never "send whatever".
 *
 * `destination` is the one that carries rights: restricted material may reach a local model
 * and never a remote one. That rule is applied here, structurally, not requested in a prompt.
 */
export const ContextPolicySchema = z.object({
  destination: z.enum(["local", "remote"]),
  maxTokens: z.number().int().positive().default(6000),
  includeDecisions: z.boolean().default(true),
  includePassages: z.boolean().default(true),
  includeConstraints: z.boolean().default(true),
  includeChanges: z.boolean().default(true),
  /** Exclude passages whose citation nobody has reviewed. Off by default: material is material. */
  onlyReviewedSupport: z.boolean().default(false),
}).strict();
export type ContextPolicy = z.infer<typeof ContextPolicySchema>;

export const EXCLUSION_REASONS = [
  "restricted_rights", "over_budget", "outside_focus", "unresolved_support", "not_requested", "not_allowed_by_person",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface ContextItem {
  kind: "focus" | "decision" | "constraint" | "change" | "passage";
  id: string;
  label: string;
  tokens: number;
  /** The exact text the model receives for this item. */
  text: string;
}

export interface ContextExclusion {
  kind: ContextItem["kind"];
  id: string;
  label: string;
  why: ExclusionReason;
}

export interface ContextPlan {
  included: ContextItem[];
  excluded: ContextExclusion[];
  tokens: number;
  /** Bound to the included content: changing what is sent changes this. */
  contextDigest: string;
  /** The block the model receives, assembled in a fixed order. Deterministic. */
  rendered: string;
  /** True only when restricted material is included — which only a local destination allows. */
  includesRestricted: boolean;
}

/** Four characters a token, rounded up. Deterministic and slightly generous. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export function compileContext(materialInput: unknown, policyInput: unknown): ContextPlan {
  const material = ContextMaterialSchema.parse(materialInput);
  const policy = ContextPolicySchema.parse(policyInput);

  const included: ContextItem[] = [];
  const excluded: ContextExclusion[] = [];
  let tokens = 0;

  const admit = (item: ContextItem): boolean => {
    if (tokens + item.tokens > policy.maxTokens) {
      excluded.push({ kind: item.kind, id: item.id, label: item.label, why: "over_budget" });
      return false;
    }
    included.push(item);
    tokens += item.tokens;
    return true;
  };

  /* 1 — the focus, always first and never excluded: a context with no focus is not a context. */
  const f = material.focus;
  const focusText = [
    `FOCUS: ${f.title} (${f.semanticType})`,
    f.formRoles.length ? `forms: ${f.formRoles.join(", ")}` : "",
    f.summary,
  ].filter(Boolean).join("\n");
  included.push({ kind: "focus", id: f.id, label: f.title, tokens: estimateTokens(focusText), text: focusText });
  tokens += estimateTokens(focusText);

  /* 2 — decisions, with their reasons. Accepted and under-review travel; drafts do not. */
  const decisions = [...material.decisions].sort((a, b) => a.question.localeCompare(b.question));
  for (const d of decisions) {
    const label = d.question;
    if (!policy.includeDecisions) { excluded.push({ kind: "decision", id: d.objectId, label, why: "not_requested" }); continue; }
    if (!d.relatedToFocus) { excluded.push({ kind: "decision", id: d.objectId, label, why: "outside_focus" }); continue; }
    if (!d.aiAllowed) { excluded.push({ kind: "decision", id: d.objectId, label, why: "not_allowed_by_person" }); continue; }
    if (d.state === "draft" || d.state === "superseded") {
      excluded.push({ kind: "decision", id: d.objectId, label, why: "not_requested" }); continue;
    }
    const steel = d.assumptions.filter((a) => a.kind === "steelman");
    const assumed = d.assumptions.filter((a) => a.kind !== "steelman");
    const text = [
      `DECISION: ${d.question}`,
      `  chosen: ${d.chosenOption ?? "—"}${d.state === "needs_review" ? " (under review)" : ""}`,
      d.rationale ? `  why: ${d.rationale}` : "",
      d.rejectedOptions.length ? `  rejected: ${d.rejectedOptions.join("; ")}` : "",
      ...assumed.map((a) => `  assumes: ${a.text}${a.reviewTrigger ? ` — revisit if ${a.reviewTrigger}` : ""}`),
      ...steel.map((a) => `  could be wrong because: ${a.text}${a.reviewTrigger ? ` — revisit if ${a.reviewTrigger}` : ""}`),
    ].filter(Boolean).join("\n");
    admit({ kind: "decision", id: d.objectId, label, tokens: estimateTokens(text), text });
  }

  /* 3 — constraints in force. */
  const constraints = [...material.constraints].sort((a, b) => a.title.localeCompare(b.title));
  for (const c of constraints) {
    if (!policy.includeConstraints) { excluded.push({ kind: "constraint", id: c.objectId, label: c.title, why: "not_requested" }); continue; }
    if (!c.relatedToFocus) { excluded.push({ kind: "constraint", id: c.objectId, label: c.title, why: "outside_focus" }); continue; }
    if (!c.aiAllowed) { excluded.push({ kind: "constraint", id: c.objectId, label: c.title, why: "not_allowed_by_person" }); continue; }
    const text = `CONSTRAINT: ${c.title} (${c.kind}) = ${canonicalJson(c.value ?? null)}`;
    admit({ kind: "constraint", id: c.objectId, label: c.title, tokens: estimateTokens(text), text });
  }

  /* 4 — what changed since the last delivery, split as the person sees it. */
  const changes = [...material.changes].sort((a, b) => a.kind.localeCompare(b.kind) || a.subject.localeCompare(b.subject));
  changes.forEach((ch, i) => {
    const id = `change-${i}`;
    const label = `${ch.kind}: ${ch.subject}`;
    if (!policy.includeChanges) { excluded.push({ kind: "change", id, label, why: "not_requested" }); return; }
    const text = `CHANGED (${ch.kind}): ${ch.subject} — ${ch.because}`;
    admit({ kind: "change", id, label, tokens: estimateTokens(text), text });
  });

  /* 5 — passages: stored words, never URLs. Rights are applied here, structurally. */
  let includesRestricted = false;
  const passages = [...material.passages].sort((a, b) =>
    a.sourceTitle.localeCompare(b.sourceTitle) || sha256Hex(a.text).localeCompare(sha256Hex(b.text)));
  for (const p of passages) {
    const id = `${p.sourceVersionId}:${sha256Hex(p.text).slice(0, 12)}`;
    const label = p.sourceTitle;
    if (!policy.includePassages) { excluded.push({ kind: "passage", id, label, why: "not_requested" }); continue; }
    if (!p.relatedToFocus) { excluded.push({ kind: "passage", id, label, why: "outside_focus" }); continue; }
    if (!p.aiAllowed) { excluded.push({ kind: "passage", id, label, why: "not_allowed_by_person" }); continue; }
    if (p.rights === "restricted" && policy.destination === "remote") {
      excluded.push({ kind: "passage", id, label, why: "restricted_rights" }); continue;
    }
    if (policy.onlyReviewedSupport && p.citedBy && !p.supportReviewed) {
      excluded.push({ kind: "passage", id, label, why: "unresolved_support" }); continue;
    }
    const text = `PASSAGE from "${p.sourceTitle}"${p.citedBy ? (p.supportReviewed ? " (support reviewed)" : " (support not yet reviewed)") : ""}:\n${p.text}`;
    if (admit({ kind: "passage", id, label, tokens: estimateTokens(text), text }) && p.rights === "restricted") {
      includesRestricted = true;
    }
  }

  const rendered = included.map((i) => i.text).join("\n\n");
  const contextDigest = sha256Hex(canonicalJson(
    included.map((i) => ({ kind: i.kind, id: i.id, hash: sha256Hex(i.text) })),
  ));

  return { included, excluded, tokens, contextDigest, rendered, includesRestricted };
}

/** The words a person reads for each exclusion reason. */
export const EXCLUSION_WORDS: Record<ExclusionReason, string> = {
  restricted_rights: "marked restricted — stays on this machine",
  over_budget: "would not fit in what this call can carry",
  outside_focus: "not connected to what you are working on",
  not_allowed_by_person: "you said not to send this to AI",
  unresolved_support: "its citation has not been reviewed",
  not_requested: "not part of what you allowed",
};
