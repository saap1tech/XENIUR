import { z } from "zod";
import { ConstraintSchema } from "./constraints.js";
import { RecipeStepDraftSchema } from "./recipe.js";

export const WorkflowManifestSchema = z.object({
  format: z.literal("xeniur-workflow/1"),
  name: z.string().min(1).max(120), author: z.string().min(1).max(120),
  summary: z.string().max(800), instructions: z.string().max(4000),
  scene: z.object({ meaning: z.enum(["where", "when", "who", "cost", "quantity", "priority", "sequence", "relationship"]),
    interaction: z.enum(["choose", "compare", "adjust", "connect", "review", "commit"]), layer: z.number().int().min(1).max(4) }).strict(),
  constraints: z.array(ConstraintSchema).max(24),
  recipe: z.object({ name: z.string().max(120), steps: z.array(RecipeStepDraftSchema).max(32) }).strict(),
  readinessProfiles: z.array(z.string().min(1).max(100)).max(12),
  decisionTemplate: z.object({ question: z.string().max(500), options: z.array(z.string().max(200)).max(12) }).strict(),
  deliveryRoles: z.array(z.string().max(100)).max(16),
  sampleObjects: z.array(z.object({ title: z.string().max(120), semanticType: z.string().max(80) }).strict()).max(16),
}).strict();
export type WorkflowManifest = z.infer<typeof WorkflowManifestSchema>;
export interface WorkflowListing {
  id: string; name: string; author: string; summary: string; steps: number; source: "bundled" | "installed";
  /** A mark for the card; bundled workflows carry the World's own emoji. */
  emoji?: string;
  /** What the person is expected to bring, in their words. A workflow never invents the source. */
  expects?: string;
  /** What comes out the other end, as plain names ("3D-print file"), in pipeline order. */
  delivers?: string[];
}

const DELIVERY_NAMES: Record<string, string> = {
  "delivery.godot": "Game-ready model", "print.stl": "3D-print file", "preview.thumbnail": "Preview image",
  "preview.turntable": "Turntable video", "delivery.web": "Web logo", "delivery.icon": "App icon",
  "delivery.mono": "One-colour logo", "delivery.retail": "Print-ready logo", "delivery.figure": "Journal-ready figure",
  "doc.primary": "Finished document",
};

/** A form role, said the way a person would say it; unknown roles fall back to their last word. */
export function deliveryName(role: string): string {
  const known = DELIVERY_NAMES[role];
  if (known) return known;
  const last = role.split(".").at(-1) ?? role;
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/[_-]+/g, " ");
}
