import type { ActionPlan } from "./action.js";
export interface ComputeQuote {
  id: string; worldId: string; title: string; plan: ActionPlan; fingerprint: string;
  provider: string; kind: "local" | "mock" | "cloud";
  compute: number; estimatedUsd: number; balance: number; expiresAt: number;
  provenance: string; localAlternative: string | null;
}
export interface EconomySnapshot {
  local: { metered: false; label: string };
  intelligence: { configured: boolean; rollingRemaining: number; rollingLimit: number; reserveRemaining: number; reserveLimit: number; resetsAt: number };
  compute: { configured: boolean; balance: number; usdPerCompute: number | null; held: number };
}
