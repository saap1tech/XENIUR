import { useEffect, useRef, useState } from "react";
import type { AvailabilityReport, CapturedWebSource, LiveSiteState, WebSettings, World } from "@xeniur/core";
import { AVAILABILITY_WORDS } from "@xeniur/core";
import { ArrowLeft, Eye, FileText, Globe2, LockKeyhole } from "lucide-react";
import { BrandMark } from "./BrandMark.js";
import { t } from "@xeniur/ui";
import { ArenaFeeds } from "./ArenaFeeds.js";

type Mode = "explore" | "live" | "act";
export function WebLayer({ worlds, onBack }: { worlds: World[]; onBack(): void }) {
  const [mode, setMode] = useState<Mode>("explore"); const [url, setUrl] = useState("https://example.com");
  const [worldId, setWorldId] = useState(worlds[0]?.id ?? ""); const [capture, setCapture] = useState<(CapturedWebSource & { sourceId: string; candidateCount: number }) | null>(null);
  const [viewId, setViewId] = useState<string | null>(null); const [status, setStatus] = useState<LiveSiteState | null>(null);
  const [settings, setSettings] = useState<WebSettings | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const host = useRef<HTMLDivElement>(null);
  useEffect(() => { void window.xeniur?.web.settings().then(setSettings); }, []);
  const [avail, setAvail] = useState<AvailabilityReport | null>(null);
  useEffect(() => { if (mode === "act") void window.xeniur?.system?.availability?.().then((r) => setAvail(r ?? null)); }, [mode]);
  useEffect(() => { if (!viewId || !host.current) return; const box = host.current; const sync = () => { const rect = box.getBoundingClientRect(); window.xeniur?.browser.setBounds(viewId, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }); }; const resize = new ResizeObserver(sync); resize.observe(box); window.addEventListener("scroll", sync, true); sync(); const timer = window.setInterval(() => { void window.xeniur?.browser.status(viewId).then(setStatus); }, 900); return () => { resize.disconnect(); window.removeEventListener("scroll", sync, true); window.clearInterval(timer); void window.xeniur?.browser.close(viewId); }; }, [viewId]);
  const switchMode = (next: Mode) => { if (next !== "live" && viewId) { void window.xeniur?.browser.close(viewId); setViewId(null); } setMode(next); setError(null); };
  const explore = async () => { if (!worldId) { setError("Create a World first so this source has somewhere to live."); return; } setBusy(true); setError(null); try { setCapture(await window.xeniur!.web.explore(worldId, url)); } catch (cause) { setError(cause instanceof Error ? cause.message : "This address could not be captured."); } finally { setBusy(false); } };
  const openLive = async () => { setBusy(true); setError(null); try { if (viewId) await window.xeniur!.browser.navigate(viewId, url); else setViewId((await window.xeniur!.browser.open(url)).viewId); } catch (cause) { setError(cause instanceof Error ? cause.message : "This address was blocked."); } finally { setBusy(false); } };
  return <main className="xr-web"><nav><button className="xr-back" type="button" onClick={onBack}><ArrowLeft size={15} /> Home</button><BrandMark /><span><LockKeyhole size={14} /> PROTECTED WEB LAYER</span></nav>
    <header><div><small>WEBSITES ARE INPUT, NOT THE INTERFACE</small><h1>Bring the web<br /><em>into your work.</em></h1></div><p>Explore converts useful material into inert Sources. Live Site shows the real page in isolation. Act pauses before anything is sent.</p></header>
    <div className="xr-web__controls"><div className="xr-web__modes" role="tablist">{(["explore", "live", "act"] as Mode[]).map((value, i) => <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => switchMode(value)}><b>0{i + 1}</b>{value}</button>)}</div>
      <div className="xr-web__address"><Globe2 size={17} /><input aria-label="Web address" value={url} onChange={(event) => setUrl(event.target.value)} /><button type="button" disabled={busy} onClick={mode === "explore" ? explore : mode === "live" ? openLive : undefined}>{busy ? "Checking…" : mode === "explore" ? "Capture source" : mode === "live" ? "Open isolated" : "Actions start from Hands"}</button></div></div>
    {error && <p className="xr-inline-warning">{error}</p>}
    {mode === "explore" && <div className="xr-web__stage"><aside><small>DEFAULT</small><h2>Explore</h2><p>No website JavaScript.<br />No forms.<br />No cookies.<br />No site UI clutter.</p><label>Save to<select value={worldId} onChange={(event) => setWorldId(event.target.value)}><option value="">{t("web.chooseproject")}</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.title}</option>)}</select></label></aside><section className="xr-web-result">{capture ? <><span className="xr-risk-label"><Eye size={14} />{capture.risk.label}</span><small>CAPTURED SOURCE / {capture.contentHash.slice(0, 10)}</small><h2>{capture.title}</h2><p>{capture.excerpt}</p><footer>{t("web.explore.proposed", { count: capture.candidateCount })}</footer></> : <div className="xr-web-empty"><FileText /><h2>A webpage becomes visual material.</h2><p>Bring in an article, paper, product page, reference, or discussion. XENIUR keeps the readable copy behind every claim.</p></div>}</section></div>}
    {mode === "live" && <div className="xr-web-live"><div className="xr-web-live__status"><b>{status?.risk.label ?? "Local address policy ready"}</b><span>{status?.error ?? "GET / HEAD only · permissions and downloads denied"}</span></div><div className="xr-live-host" ref={host}>{!viewId && <div className="xr-web-empty"><Globe2 /><h2>The actual webpage, isolated.</h2><p>HTTPS only. No privileged preload. No XENIUR bridge. Redirects are checked again.</p></div>}</div></div>}
    {mode === "act" && <section className="xr-act-review"><header><small>ACT / FINAL CHECKPOINT</small><strong>Page text is untrusted</strong></header>
      <h2>{avail ? t("web.act.unavailable", { state: AVAILABILITY_WORDS[avail.features["browser.delegated"].state].label, because: avail.features["browser.delegated"].because }) : t("avail.reading")}</h2>
      <p className="xr-act-review__note">An action would appear here only as its exact plan — destination, account, what is sent — bound to your approval. Until the assistant can act in a tab you can see, this checkpoint stays empty rather than promising one.</p>
      <footer><button type="button" className="xr-button" onClick={() => switchMode("explore")}>Back to Explore</button></footer></section>}
    {mode === "explore" && <ArenaFeeds />}
    <footer className="xr-web-disclosure"><div><strong>{settings?.riskMode === "google_lookup" ? "Google reputation lookup" : "Local-only checks"}</strong><p>{settings?.disclosure}</p></div>{settings?.lookupConfigured && <button type="button" onClick={async () => setSettings(await window.xeniur!.web.setRiskMode(settings.riskMode === "local_only" ? "google_lookup" : "local_only"))}>Switch to {settings.riskMode === "local_only" ? "Google Lookup" : "local-only"}</button>}</footer>
  </main>;
}
