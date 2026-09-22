import { useEffect, useState } from "react";
import type { CapturedWebSource, WebSettings, World } from "@xeniur/core";
import { ArrowLeft, Eye, FileText, Globe2, LockKeyhole } from "lucide-react";
import { BrandMark } from "./BrandMark.js";
import { t } from "@xeniur/ui";
import { ArenaFeeds } from "./ArenaFeeds.js";

/**
 * Capture a reference without a session: a page is fetched by the policy-checked path, stored
 * as the copy that was read, and its candidates are proposed. Browsing with an account — and
 * anything the assistant does in a tab — lives in the Browser, which is its own surface.
 */
export function WebLayer({ worlds, onBrowse, onBack }: { worlds: World[]; onBrowse(): void; onBack(): void }) {
  const [url, setUrl] = useState("https://example.com");
  const [worldId, setWorldId] = useState(worlds[0]?.id ?? ""); const [capture, setCapture] = useState<(CapturedWebSource & { sourceId: string; candidateCount: number }) | null>(null);
  const [settings, setSettings] = useState<WebSettings | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void window.xeniur?.web.settings().then(setSettings); }, []);
  const explore = async () => { if (!worldId) { setError("Create a World first so this source has somewhere to live."); return; } setBusy(true); setError(null); try { setCapture(await window.xeniur!.web.explore(worldId, url)); } catch (cause) { setError(cause instanceof Error ? cause.message : "This address could not be captured."); } finally { setBusy(false); } };
  return <main className="xr-web"><nav><button className="xr-back" type="button" onClick={onBack}><ArrowLeft size={15} /> Home</button><BrandMark /><span><LockKeyhole size={14} /> PROTECTED WEB LAYER</span></nav>
    <header><div><small>WEBSITES ARE INPUT, NOT THE INTERFACE</small><h1>Bring the web<br /><em>into your work.</em></h1></div><p>Capture converts useful material into inert Sources — no session, no cookies, nothing sent. To sign in and work with a site, browse with one of your accounts.</p></header>
    <div className="xr-web__controls"><div className="xr-web__modes" role="tablist"><button type="button" role="tab" aria-selected={true}><b>01</b>capture a reference</button><button type="button" role="tab" aria-selected={false} onClick={onBrowse}><b>02</b>browse with an account</button></div>
      <div className="xr-web__address"><Globe2 size={17} /><input aria-label="Web address" value={url} onChange={(event) => setUrl(event.target.value)} /><button type="button" disabled={busy} onClick={explore}>{busy ? "Checking…" : "Capture source"}</button></div></div>
    {error && <p className="xr-inline-warning">{error}</p>}
    <div className="xr-web__stage"><aside><small>DEFAULT</small><h2>Explore</h2><p>No website JavaScript.<br />No forms.<br />No cookies.<br />No site UI clutter.</p><label>Save to<select value={worldId} onChange={(event) => setWorldId(event.target.value)}><option value="">{t("web.chooseproject")}</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.title}</option>)}</select></label></aside><section className="xr-web-result">{capture ? <><span className="xr-risk-label"><Eye size={14} />{capture.risk.label}</span><small>CAPTURED SOURCE / {capture.contentHash.slice(0, 10)}</small><h2>{capture.title}</h2><p>{capture.excerpt}</p><footer>{t("web.explore.proposed", { count: capture.candidateCount })}</footer></> : <div className="xr-web-empty"><FileText /><h2>A webpage becomes visual material.</h2><p>Bring in an article, paper, product page, reference, or discussion. XENIUR keeps the readable copy behind every claim.</p></div>}</section></div>
    <ArenaFeeds />
    <footer className="xr-web-disclosure"><div><strong>{settings?.riskMode === "google_lookup" ? "Google reputation lookup" : "Local-only checks"}</strong><p>{settings?.disclosure}</p></div>{settings?.lookupConfigured && <button type="button" onClick={async () => setSettings(await window.xeniur!.web.setRiskMode(settings.riskMode === "local_only" ? "google_lookup" : "local_only"))}>Switch to {settings.riskMode === "local_only" ? "Google Lookup" : "local-only"}</button>}</footer>
  </main>;
}
