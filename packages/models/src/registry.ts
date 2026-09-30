import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * The models a person already pays for, described as data.
 *
 * XENIUR does not sit between a person and the model they chose. It routes across *their*
 * keys, at *their* prices, with no second bill. The registry is configuration rather than
 * code so that a corrected price or a new model is a JSON edit — and so that every price
 * carries the date somebody last checked it against the provider's published pricing.
 *
 * The one rule that is enforced rather than hoped for: **an unverified price is not free.**
 * It is unknown, and XENIUR refuses to call a model whose price nobody has checked.
 */
export const MODEL_PROVIDERS = ["openrouter", "anthropic", "openai", "google", "ollama", "meshy", "runway"] as const;
export const ModelProviderSchema = z.enum(MODEL_PROVIDERS);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export const MODEL_TAGS = ["fast", "strong", "vision", "local", "cheap", "long_context"] as const;
export const ModelTagSchema = z.enum(MODEL_TAGS);
export type ModelTag = z.infer<typeof ModelTagSchema>;

export const ModelPriceSchema = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
  currency: z.literal("USD").default("USD"),
  /** The date somebody checked this against the provider's published pricing. Null = unverified. */
  verifiedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
});
export type ModelPrice = z.infer<typeof ModelPriceSchema>;

export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  provider: ModelProviderSchema,
  /** The provider's own model identifier, sent on the wire. */
  model: z.string().min(1),
  label: z.string().min(1),
  contextWindow: z.number().int().positive(),
  tags: z.array(ModelTagSchema).default([]),
  price: ModelPriceSchema,
  /** Whether the model id itself has been confirmed to exist at the provider. */
  modelVerified: z.boolean().default(false),
  output: z.enum(["text", "image"]).default("text"),
  imagePriceUsd: z.number().nonnegative().optional(),
  imageProvider: z.string().optional(),
  imageParameters: z.record(z.unknown()).optional(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ProviderEntrySchema = z.object({
  id: ModelProviderSchema,
  label: z.string().min(1),
  /** The environment-variable-style name the key is stored under in the keychain. */
  keyName: z.string().min(1).nullable(),
  /** A free endpoint that lists models — verification never makes a billable call. */
  verifyUrl: z.string().url().nullable(),
  /** Which header carries the key, and how. */
  auth: z.enum(["bearer", "x-api-key", "google-key", "query", "none"]).default("bearer"),
  /** Local providers need no key and cost nothing; that is verified by construction. */
  local: z.boolean().default(false),
});
export type ProviderEntry = z.infer<typeof ProviderEntrySchema>;

export const ModelsConfigSchema = z.object({
  $comment: z.array(z.string()).optional(),
  providers: z.array(ProviderEntrySchema),
  models: z.array(ModelEntrySchema),
});
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

/** A price is usable only when somebody has dated their check of it. */
export const isPriceVerified = (m: ModelEntry): boolean =>
  m.price.verifiedOn !== null || (m.price.inputPerMTok === 0 && m.price.outputPerMTok === 0 && m.tags.includes("local"));

export class ModelRegistry {
  constructor(readonly config: ModelsConfig) {}

  static load(rootDir: string): ModelRegistry {
    const raw = JSON.parse(readFileSync(join(rootDir, "config", "models.json"), "utf8"));
    return new ModelRegistry(ModelsConfigSchema.parse(raw));
  }

  providers(): ProviderEntry[] { return this.config.providers; }
  provider(id: ModelProvider): ProviderEntry | undefined { return this.config.providers.find((p) => p.id === id); }
  models(): ModelEntry[] { return this.config.models; }
  model(id: string): ModelEntry | undefined { return this.config.models.find((m) => m.id === id); }

  /** Models whose provider has a key present (or needs none) — the ones that could be called. */
  available(keyPresent: (provider: ModelProvider) => boolean): ModelEntry[] {
    return this.config.models.filter((m) => {
      const p = this.provider(m.provider);
      return p !== undefined && (p.local || keyPresent(m.provider));
    });
  }

  /** Available *and* priced. The set the router may actually choose from. */
  callable(keyPresent: (provider: ModelProvider) => boolean): ModelEntry[] {
    return this.available(keyPresent).filter((m) => m.output !== "image" && isPriceVerified(m));
  }

  /**
   * What a key for this provider unlocks, in the economy's three tiers.
   *
   * Unlimited Local is already lit — it never depended on a key. A key adds Included
   * Intelligence (the bounded Brain) and, for providers that generate, Metered Generation.
   */
  unlocks(provider: ModelProvider): { intelligence: string[]; generation: string[] } {
    const mine = this.config.models.filter((m) => m.provider === provider);
    return { intelligence: mine.filter(m=>m.output!=="image").map(m=>m.label), generation: mine.filter(m=>m.output==="image").map(m=>m.label) };
  }
}
