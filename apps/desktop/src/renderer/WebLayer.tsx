import { useEffect, useState } from "react";
import type { CapturedWebSource, WebSettings, World } from "@xeniur/core";
import { ArrowLeft, ArrowRight, Eye, FileText, FolderOpen, Globe2, LockKeyhole } from "lucide-react";
import { BrandMark } from "./BrandMark.js";
import { t } from "@xeniur/ui";
import { ArenaFeeds } from "./ArenaFeeds.js";
import { ProjectIllustration } from "./ProjectIllustration.js";

/**
 * Capture a reference without a session: a page is fetched by the policy-checked path, stored
 * as the copy that was read, and its candidates are proposed. Browsing with an account — and
 * anything the assistant does in a tab — lives in the Browser, which is its own surface.
 */
export function WebLayer({ worlds, onBrowse, onBack, backLabel = "Home" }: { worlds: World[]; onBrowse(): void; onBack(): void; backLabel?: string }) {
  const [url, setUrl] = useState("");
  const [worldId, setWorldId] = useState(worlds[0]?.id ?? ""); const [capture, setCapture] = useState<(CapturedWebSource & { sourceId: string; candidateCount: number }) | null>(null);
  const [settings, setSettings] = useState<WebSettings | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { void window.xeniur?.web.settings().then(setSettings); }, []);
  const explore = async () => { if (!url.trim()) { setError("Enter a page address."); return; } if (!worldId) { setError("Choose a project for this source."); return; } setBusy(true); setError(null); try { setCapture(await window.xeniur!.web.explore(worldId, url)); } catch (cause) { setError(cause instanceof Error ? cause.message : "This address could not be captured."); } finally { setBusy(false); } };
  return <main className="xr-web"><nav><button className="xr-back" type="button" onClick={onBack}><ArrowLeft size={15} /> {backLabel}</button><BrandMark /><span><LockKeyhole size={14} /> Web</span></nav>
    <header><div><small>Find · Save · Use</small><h1>Keep what<br /><em>helps.</em></h1></div><p>Save a page, or open the browser.</p></header>
    <div className="xr-web__path" aria-label="How a page becomes part of your project"><span><Globe2 aria-hidden="true" /><b>Find a page</b></span><ArrowRight aria-hidden="true" /><span><FileText aria-hidden="true" /><b>Keep a source</b></span><ArrowRight aria-hidden="true" /><span><FolderOpen aria-hidden="true" /><b>Use in project</b></span></div>
    <div className="xr-web__controls"><div className="xr-web__modes"><span><FileText size={18} aria-hidden="true" /> Save a source</span><button type="button" onClick={onBrowse}><Globe2 size={18} aria-hidden="true" /> Open browser <ArrowRight size={15} aria-hidden="true" /></button></div>
      <div className="xr-web__address"><Globe2 size={17} /><input aria-label="Web address" placeholder="https://…" value={url} onChange={(event) => { setUrl(event.target.value); setCapture(null); }} onKeyDown={(event) => { if (event.key === "Enter") void explore(); }} /><button type="button" disabled={busy} onClick={explore}>{busy ? "Checking…" : "Save source"}</button></div></div>
    {error && <p className="xr-inline-warning">{error}</p>}
    <div className="xr-web__stage"><aside><small>DESTINATION</small><h2>Your project</h2><p>Saved pages stay with this project.</p><label>Save to<select value={worldId} onChange={(event) => { setWorldId(event.target.value); setCapture(null); }}><option value="">{t("web.chooseproject")}</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.title}</option>)}</select></label></aside><section className="xr-web-result">{capture ? <><span className="xr-risk-label"><Eye size={14} />{capture.risk.label}</span><small>SAVED SOURCE / {capture.contentHash.slice(0, 10)}</small><h2>{capture.title}</h2><p>{capture.excerpt}</p><footer>{t("web.explore.proposed", { count: capture.candidateCount })}</footer></> : <div className="xr-web-empty"><ProjectIllustration kind="source" /><h2>Choose a page to keep.</h2><p>A useful page becomes a project source.</p></div>}</section></div>
    <ArenaFeeds />
    <footer className="xr-web-disclosure"><details><summary><LockKeyhole size={16} /> How source capture works</summary><p>The page is fetched without your browser session, cookies, or site scripts. {settings?.disclosure}</p></details>{settings?.lookupConfigured && <button type="button" onClick={async () => setSettings(await window.xeniur!.web.setRiskMode(settings.riskMode === "local_only" ? "google_lookup" : "local_only"))}>Risk check: {settings.riskMode === "local_only" ? "local" : "Google"}</button>}</footer>
  </main>;
}
