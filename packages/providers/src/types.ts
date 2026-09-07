import type { Cost, InputRole, Modality, Provenance, Tool } from "@xeniur/core";

export interface ProviderInput {
  representationId: string;
  role: InputRole;
  modality: Modality;
  format: string;
  data: Buffer;
}

export interface ProviderCall {
  tool: Tool;
  args: Record<string, unknown>;
  inputs: readonly ProviderInput[];
}

export interface ProviderOutput {
  data: Buffer;
  mime: string;
  ext: string;
  modality: Modality;
  format: string;
}

export interface ProviderResult {
  outputs: readonly ProviderOutput[];
  provenance: Provenance;
  model: string | null;
  toolVersion: string | null;
  generationParams: Record<string, unknown>;
  cost: Cost;
}

/**
 * Availability always carries when it was checked, and an unavailable one always says
 * why. The interface prints `reason` verbatim rather than inventing an explanation.
 */
export type Availability =
  | { ok: true; detail?: string; checkedAt?: number }
  | { ok: false; reason: string; detail?: string; checkedAt?: number };

export interface ProviderEnv {
  /** Somewhere to put temporary files. Never the user's project directory. */
  scratchDir: string;
  /** Repo root, used to locate the Blender worker script. */
  rootDir: string;
  binaries: { ffmpeg: string; blender: string };
}

/**
 * Every capability implementation looks like this, whether it is a local binary, a mock,
 * or a paid API. Nothing above this interface knows which — which is the whole point:
 * providers can be swapped on price or quality without any UI or project data changing.
 */
export interface Provider {
  readonly id: string;
  readonly kind: "deterministic" | "mock" | "generative";
  readonly tools: readonly Tool[];
  available(env: ProviderEnv): Promise<Availability>;
  execute(call: ProviderCall, env: ProviderEnv): Promise<ProviderResult>;
}

export const noCost = (ms: number): Cost =>
  ({ inputTokens: 0, outputTokens: 0, credits: 0, usd: 0, ms });

export const requireInput = (call: ProviderCall, role: InputRole = "source"): ProviderInput => {
  const found = call.inputs.find((i) => i.role === role) ?? call.inputs[0];
  if (!found) throw new Error(`${call.tool} needs a ${role} input and was given none`);
  return found;
};

export const numberArg = (args: Record<string, unknown>, key: string): number | undefined => {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};

export const stringArg = (args: Record<string, unknown>, key: string): string | undefined => {
  const v = args[key];
  return typeof v === "string" && v !== "" ? v : undefined;
};
