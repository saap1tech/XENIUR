import { planDigest, type ActionPlan } from "@xeniur/core";
import type { ObjectGraph } from "@xeniur/graph";
import type { Provider, ProvidersConfig } from "@xeniur/providers";

export function verifiedGenerationPrice(provider: Provider, config: ProvidersConfig): number {
  if (provider.kind !== "generative") return 0;
  const price = config.providers[provider.id]?.price;
  if (!price || price["unverified"] !== false) throw new Error("This generation has no verified price. Local work is available.");
  const usd = typeof price["perImageUsd"] === "number" ? price["perImageUsd"]
    : typeof price["usdPerCredit"] === "number" && typeof price["creditsPerGeneration"] === "number"
      ? price["usdPerCredit"] * price["creditsPerGeneration"] : NaN;
  if (!Number.isFinite(usd) || usd < 0) throw new Error("This generation has no verified price.");
  return usd;
}
export function generationFingerprint(graph: ObjectGraph, plan: ActionPlan, provider: string, price: number): string {
  return planDigest({ tool: plan.tool, objectId: plan.objects[0] ?? null, estimatedUsd: price, destination: provider,
    args: { request: plan.args, objects: plan.objects.map((id) => ({ id, version: graph.currentState(id)?.versionId ?? null })) } });
}
