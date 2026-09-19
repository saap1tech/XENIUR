import { z } from "zod";

export const DisclosureLayerSchema = z.number().int().min(1).max(4);
export type DisclosureLayer = 1 | 2 | 3 | 4;

export const DISCLOSURE = {
  1: { name: "outcome", shows: ["thing"] },
  2: { name: "manipulate", shows: ["thing", "controls"] },
  3: { name: "explain", shows: ["thing", "controls", "why", "evidence", "impact"] },
  4: { name: "machinery", shows: ["thing", "controls", "why", "evidence", "impact", "graph", "recipe", "provider", "file", "model", "cost"] },
} as const;

export const disclosureShows = (layer: DisclosureLayer, item: string): boolean =>
  (DISCLOSURE[layer].shows as readonly string[]).includes(item);
