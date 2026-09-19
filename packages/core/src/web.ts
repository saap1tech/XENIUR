export type WebRiskMode = "local_only" | "google_lookup";
export interface WebRiskResult {
  status: "not_checked" | "no_listed_threat" | "listed_threat" | "unavailable";
  provider: "none" | "google_web_risk";
  checkedAt: number | null;
  label: string;
}
export interface WebSettings {
  riskMode: WebRiskMode;
  lookupConfigured: boolean;
  disclosure: string;
}
export interface CapturedWebSource {
  objectId: string; title: string; url: string; excerpt: string;
  contentHash: string; risk: WebRiskResult;
}
export interface LiveSiteState {
  viewId: string; url: string; risk: WebRiskResult; error: string | null;
}
