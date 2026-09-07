import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProviderEntry {
  enabled: boolean;
  kind?: string;
  requiresKey?: string;
  model?: string;
  modelVerified?: boolean;
  binary?: string;
  worker?: string;
  unavailableReason?: string;
  price?: Record<string, unknown>;
  cost?: { usd?: number };
}

export interface ProvidersConfig {
  brain: { default: string; escalateAfterFailures: number; providers: Record<string, ProviderEntry & { maxOutputTokens?: number; escalationModel?: string | null }> };
  capabilities: Record<string, { order: string[] }>;
  providers: Record<string, ProviderEntry>;
  budget: { perActionUsdMax: number; perTaskUsdMax: number; totalUsdMax: number };
}

/**
 * Model ids, prices and credit costs are configuration, never code. Nothing here is read
 * at import time, so correcting an unverified price or swapping a model is a JSON edit.
 */
export function loadProvidersConfig(rootDir: string): ProvidersConfig {
  const path = join(rootDir, "config", "providers.json");
  return JSON.parse(readFileSync(path, "utf8")) as ProvidersConfig;
}

/** A cloud provider is usable only when it is enabled *and* its key is actually present. */
export function keyPresent(entry: ProviderEntry, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!entry.requiresKey) return true;
  const value = env[entry.requiresKey];
  return typeof value === "string" && value.trim() !== "";
}
