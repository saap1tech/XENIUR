import { z } from "zod";

/**
 * Small, domain-independent facts that visual policy may compose.
 *
 * Traits describe what a thing affords. They are deliberately not Object types: a hotel,
 * venue and parcel can all be locatable, while a rocket and sculpture can both be
 * printable. New domains should normally combine these before adding grammar branches.
 */
export const SEMANTIC_TRAITS = [
  "locatable", "temporal", "priced", "composable", "deliverable", "printable",
  "personLike", "versioned", "bookable", "spatial", "renderable", "external",
  "consequential",
] as const;
export const SemanticTraitSchema = z.enum(SEMANTIC_TRAITS);
export type SemanticTrait = z.infer<typeof SemanticTraitSchema>;

export const SemanticTraitsSchema = z.array(SemanticTraitSchema)
  .max(32)
  .transform((traits) => [...new Set(traits)].sort());

