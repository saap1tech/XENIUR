import { z } from "zod";
import { PermissionLevelSchema } from "./permissions.js";
import { SemanticTraitsSchema } from "./traits.js";
import { ToolSchema } from "./tools.js";

export const VISUAL_PRIMITIVES = [
  "map", "calendar", "people", "cost", "quantity", "priority", "timeline",
  "relationships", "choices", "constraints", "evidence", "review",
] as const;
export const VisualPrimitiveSchema = z.enum(VISUAL_PRIMITIVES);
export type VisualPrimitive = z.infer<typeof VisualPrimitiveSchema>;

export const CapabilityValueSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), required: z.boolean().default(true), secret: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal("number"), required: z.boolean().default(true), min: z.number().optional(), max: z.number().optional(), unit: z.string().optional() }).strict(),
  z.object({ type: z.literal("boolean"), required: z.boolean().default(true) }).strict(),
  z.object({ type: z.literal("enum"), required: z.boolean().default(true), values: z.array(z.string().min(1)).min(1).max(64) }).strict(),
  z.object({ type: z.literal("object_ref"), required: z.boolean().default(true), traits: SemanticTraitsSchema }).strict(),
]);

/**
 * XCDL v1: a closed, data-only capability definition language.
 *
 * It binds semantic inputs and visual concepts to one already trusted router operation.
 * There is intentionally no code, selector, URL, command, HTML, CSS or React field.
 */
export const CapabilityManifestSchema = z.object({
  format: z.literal("xeniur-capability/1"),
  capability: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/),
  title: z.string().min(1).max(120),
  description: z.string().max(800),
  accepts: z.array(z.object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
    traits: SemanticTraitsSchema,
    optional: z.boolean().default(false),
  }).strict()).min(1).max(24),
  traits: z.array(z.enum(["external", "priced", "consequential", "deterministic", "generative"])).max(8),
  permission: PermissionLevelSchema,
  inputSchema: z.record(CapabilityValueSchema).default({}),
  visualSemantics: z.object({
    where: VisualPrimitiveSchema.optional(), when: VisualPrimitiveSchema.optional(),
    who: VisualPrimitiveSchema.optional(), cost: VisualPrimitiveSchema.optional(),
    quantity: VisualPrimitiveSchema.optional(), priority: VisualPrimitiveSchema.optional(),
    sequence: VisualPrimitiveSchema.optional(), relationship: VisualPrimitiveSchema.optional(),
  }).strict(),
  execution: z.object({
    adapter: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
    operation: ToolSchema,
    version: z.string().min(1).max(80),
  }).strict(),
  produces: z.object({ semanticType: z.string().min(1).max(80), traits: SemanticTraitsSchema }).strict(),
}).strict();
export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
