import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserProfile, BrowserTab, HeldDownload, TabState } from "@xeniur/core";
import { BROWSER_STATE_WORDS } from "@xeniur/core";
import { ArrowLeft, ArrowRight, FolderOpen, BookmarkPlus, Check, Compass, CornerUpLeft, Globe2, Columns2, Maximize, PanelRight, UserRound, LockKeyhole, Plus, Scan, Minimize, RotateCw, Search, X, BookOpen, ArrowLeftRight, PencilLine } from "lucide-react";
import { t } from "@xeniur/ui";
import { SaveToProject } from "./SaveToProject.js";
import { BrandMark } from "./BrandMark.js";
import { ProjectIllustration } from "./ProjectIllustration.js";

export type BrowserLayout = "fill" | "wide" | "beside";

/**
 * Browsing, inside the work.
 *
 * Tabs belong to the project and step they were opened from; an account is one of the person's
 * own, and signing into it stays signed in. The view itself is a separate, locked-down process
 * the main process places behind this pane — the renderer only ever says where it should sit.
 *
 * The state word is a fact about who is driving: *You are browsing* until the person allows
 * the assistant to act, and back the moment they touch the keyboard or press Take over.
 */
export function Browser({ worldId, goalId, goalTitle, stepId, stepTitle, worlds = [], layout = "fill", onLayout, onSave, onBack, onSources }: {
  /** The project these tabs belong to. Null is unassigned browsing: it saves nothing anywhere. */
  worldId: string | null;
  goalId?: string | null;
  goalTitle?: string | null;
  stepId?: string | null;
  stepTitle?: string | null;
  /** The projects a capture may go into. */
  worlds?: readonly import("@xeniur/core").World[];
  layout?: BrowserLayout;
  onLayout?(layout: BrowserLayout): void;
  /** Save what is on screen into the project — the person's act, never automatic. */
  onSave?(tabId: string): void;
  onBack(): void;
  onSources?(): void;
}) {
  const bridge = typeof window === "undefined" ? undefined : window.xeniur;
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<TabState | null>(null);
  const [address, setAddress] = useState("");
  const [finding, setFinding] = useState(false);
  const [findText, setFindText] = useState("");
  const [downloads, setDownloads] = useState<HeldDownload[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newProfile,setNewProfile]=useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<import("@xeniur/core").TabSnapshot | null>(null);
  const [captureBusy,setCaptureBusy]=useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null),otherHost=useRef<HTMLDivElement>(null);
  const [compareId,setCompareId]=useState<string|null>(null),[otherState,setOtherState]=useState<TabState|null>(null);
  const [shelfOpen,setShelfOpen]=useState(false),[shelf,setShelf]=useState<Awaited<ReturnType<import("@xeniur/core").XeniurBridge["browser"]["shelf"]>>>([]);
  const [shelfFilter,setShelfFilter]=useState(""),[comparisonNote,setComparisonNote]=useState(""),[noteBusy,setNoteBusy]=useState(false);
  const refreshShelf=useCallback(async()=>{if(worldId&&bridge?.browser?.shelf)setShelf(await bridge.browser.shelf(worldId));else setShelf([]);},[bridge,worldId]);
  useEffect(()=>{void refreshShelf().catch(c=>setError(String(c)));},[refreshShelf]);
  useEffect(()=>{if(compareId&&!tabs.some(t=>t.id===compareId&&t.id!==activeId))setCompareId(null);},[tabs,activeId,compareId]);
  const [fullscreen,setFullscreen]=useState(false);const fullscreenOwned=useRef(false);

  const refresh = useCallback(async () => {
    const ps = (await bridge?.browser?.profiles()) ?? [];
    setProfiles(ps);
    setProfileId((current) => current || ps.find(p=>p.kind==="ephemeral")?.id || ps[0]?.id || "");
    const openTabs = (await bridge?.browser?.tabs(worldId)) ?? [];
    setTabs(openTabs);
    setActiveId((current) => openTabs.some((tab) => tab.id === current) ? current : openTabs[0]?.id ?? null);
    setDownloads((await bridge?.browser?.downloads(worldId)) ?? []);
  }, [bridge, worldId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => bridge?.browser?.onEvent(() => { void refresh(); }), [bridge, refresh]);

  // The view is placed behind this pane; the renderer reports where, and nothing else.
  useEffect(() => {
    if (!activeId || !host.current) return;
    const box = host.current;
    let mounted=true;
    const sync = () => {
      if(saving){bridge?.browser?.setBounds(activeId,{x:0,y:0,width:0,height:0});if(compareId)bridge?.browser?.setBounds(compareId,{x:0,y:0,width:0,height:0});return;}
      const r = box.getBoundingClientRect();
      bridge?.browser?.setBounds(activeId, { x: r.x, y: r.y, width: r.width, height: r.height });
      if(compareId&&otherHost.current){const other=otherHost.current.getBoundingClientRect();bridge?.browser?.setBounds(compareId,{x:other.x,y:other.y,width:other.width,height:other.height});}
    };
    const observer = new ResizeObserver(sync);
    observer.observe(box);if(otherHost.current)observer.observe(otherHost.current);window.addEventListener("resize",sync);
    window.addEventListener("scroll", sync, true);
    void (bridge?.browser?.compare?bridge.browser.compare(activeId,compareId):bridge?.browser?.activate(activeId))?.then(()=>{if(mounted)sync();}).catch(c=>{if(mounted)setError(c instanceof Error?c.message:String(c));});
    setState(null);setOtherState(null);
    sync();
    const timer = window.setInterval(() => { void bridge?.browser?.state(activeId).then((s) => { if (s) { if(!mounted)return;setState(s); setAddress((a) => (document.activeElement === document.getElementById("browser-address") ? a : s.url)); } }); if(compareId)void bridge?.browser?.state(compareId).then(s=>{if(mounted)setOtherState(s??null);}); }, 900);
    return () => { mounted=false;bridge?.browser?.setBounds(activeId,{x:0,y:0,width:0,height:0});if(compareId)bridge?.browser?.setBounds(compareId,{x:0,y:0,width:0,height:0});observer.disconnect();window.removeEventListener("resize",sync); window.removeEventListener("scroll", sync, true); window.clearInterval(timer); };
  }, [bridge, activeId,saving,compareId]);

  const openTab = async (url: string) => {
    if (!profileId) { setError(t("browser.needaccount")); return; }
    try {
      setSaved(null);
      const tab = await bridge?.browser?.openTab({ profileId, url, worldId, goalId: goalId ?? null, stepId: stepId ?? null });
      if (tab) { setActiveId(tab.id); setAddress(tab.url); setError(null); }
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const go = async () => {
    const url = address.trim();
    if (url === "") return;
    setSaved(null);
    const target = /^https?:\/\//.test(url) ? url : /^[\w-]+(\.[\w-]+)+/.test(url) ? `https://${url}` : `https://duckduckgo.com/?q=${encodeURIComponent(url)}`;
    if (!activeId) { await openTab(target); return; }
    try { await bridge?.browser?.navigate(activeId, target); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const toggleFullscreen=async(enabled:boolean)=>{
    try {onLayout?.("fill");const value=await bridge?.browser?.setFullscreen(enabled);fullscreenOwned.current=value??false;setFullscreen(value??false);}catch(c){setError(c instanceof Error?c.message:"Full screen is available in the desktop app.");}
  };
  useEffect(()=>()=>{if(fullscreenOwned.current)void bridge?.browser?.setFullscreen(false).catch(()=>undefined);},[bridge]);
  const shortcut=useRef<(command:string)=>void>(()=>{});
  shortcut.current=command=>{
    if(command==="address"){document.getElementById("browser-address")?.focus();(document.getElementById("browser-address") as HTMLInputElement|null)?.select();}
    if(command==="new_tab")void openTab("https://duckduckgo.com");
    if(command==="close_tab"&&activeId)void bridge?.browser?.closeTab(activeId).then(()=>{setActiveId(null);void refresh();});
    if(command==="reload"&&activeId)void bridge?.browser?.reload(activeId);
    if(command==="find"){setFinding(true);}
    if(command==="exit_fullscreen")void toggleFullscreen(false);
    if((command==="next_tab"||command==="previous_tab")&&tabs.length){const i=tabs.findIndex(t=>t.id===activeId);const tab=tabs[(i+(command==="next_tab"?1:tabs.length-1))%tabs.length]!;setActiveId(tab.id);setAddress(tab.url);}
  };
  useEffect(()=>{const cancel=bridge?.browser?.onShortcut?.(command=>shortcut.current(command));const handler=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&!e.altKey){const command=({l:"address",t:"new_tab",w:"close_tab",r:"reload",f:"find"} as Record<string,string>)[e.key.toLowerCase()];if(command){e.preventDefault();shortcut.current(command);}}if(e.key==="Escape"&&fullscreenOwned.current)shortcut.current("exit_fullscreen");};window.addEventListener("keydown",handler);return()=>{cancel?.();window.removeEventListener("keydown",handler);};},[bridge]);
  const profile = profiles.find((p) => p.id === profileId) ?? null;
  const project = worlds.find((item) => item.id === worldId) ?? null;
  const capture = (tabId=activeId) => {
    if (!tabId||captureBusy) return;setError(null);setCaptureBusy(true);
    void bridge?.browser?.snapshot(tabId).then((snapshot) => setSaving(snapshot ?? null)).catch(c=>setError(c instanceof Error?c.message:"This page cannot be saved. Import a downloaded PDF in your project.")).finally(()=>setCaptureBusy(false));
    onSave?.(tabId);
  };
  return (
    <main className={`xr-web-browser xr-web-browser--${layout}`}>
      <header className="xr-web-browser__bar">
        <button type="button" className="xr-back" aria-label="Back to work" title="Back to work" onClick={onBack}><ArrowLeft size={19}/><BrandMark compact/></button>
        <div className="xr-web-browser__nav">
          <button type="button" aria-label={t("browser.back")} disabled={!state?.canGoBack} onClick={() => activeId && void bridge?.browser?.back(activeId)}><ArrowLeft size={15} /></button>
          <button type="button" aria-label={t("browser.forward")} disabled={!state?.canGoForward} onClick={() => activeId && void bridge?.browser?.forward(activeId)}><ArrowRight size={15} /></button>
          <button type="button" aria-label={t("browser.reload")} disabled={!activeId} onClick={() => activeId && void bridge?.browser?.reload(activeId)}><RotateCw size={14} /></button>
        </div>
        <div className="xr-web-browser__address">
          <Globe2 size={15} />
          <input id="browser-address" value={address} aria-label={t("browser.address")} placeholder={t("browser.addressplaceholder")}
            onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void go(); }} />
          <button type="button" className="xr-button" onClick={() => void go()}>{t("browser.go")}</button>
        </div>
        <label className="xr-web-browser__account">
          <UserRound size={17} aria-hidden="true"/>
          <select value={profileId} onChange={(e) => {if(e.target.value==="__new")setNewProfile(true);else setProfileId(e.target.value);}} title="Profile for new tabs" aria-label={t("browser.accounts")}>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}{p.kind === "ephemeral" ? ` · ${t("browser.readingonly")}` : ""}</option>)}
            {profiles.length === 0 && <option value="">{t("browser.noaccounts")}</option>}<option value="__new">Add a profile…</option>
          </select>
        </label>
        <span className={`xr-web-browser__state is-${state?.browserState ?? "person"}`} aria-label={BROWSER_STATE_WORDS[state?.browserState ?? "person"]} title={BROWSER_STATE_WORDS[state?.browserState ?? "person"]}>{state?.browserState&&state.browserState!=="person"?BROWSER_STATE_WORDS[state.browserState]:<UserRound size={16}/>}</span>
        {state?.browserState === "assistant" && <button type="button" className="xr-button xr-button--primary" onClick={() => activeId && void bridge?.browser?.takeOver(activeId)}>{t("browser.takeover")}</button>}
        <div className="xr-web-browser__layout" role="radiogroup" aria-label={t("browser.layout")}>
          {(["fill", "wide", "beside"] as BrowserLayout[]).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={layout === l} className={layout === l ? "is-on" : ""} aria-label={t(`browser.layout.${l}` as never)} title={t(`browser.layout.${l}` as never)} onClick={() => onLayout?.(l)}>{l==="fill"?<Maximize size={16}/>:l==="wide"?<Columns2 size={16}/>:<PanelRight size={16}/>}</button>
          ))}
        </div>
        <button type="button" className="xr-web-browser__fullscreen" aria-label={fullscreen?"Exit full screen":"Full screen"} title={fullscreen?"Exit full screen":"Full screen"} onClick={()=>void toggleFullscreen(!fullscreen)}>{fullscreen?<Minimize size={18}/>:<Scan size={18}/>}</button>
      </header>

      <div className="xr-web-browser__tabs" role="tablist" aria-label="Browser tabs">
        {!tabs.length&&<span className="xr-web-browser__tab is-active"><span>New tab</span></span>}
        {tabs.map((tab) => (
          <div key={tab.id} className={`xr-web-browser__tab${activeId === tab.id ? " is-active" : ""}`}>
            <button type="button" role="tab" aria-selected={activeId === tab.id}
              onClick={() => { setActiveId(tab.id); setAddress(tab.url); setSaved(null);  }}>
              {tab.title || hostOf(tab.url)}
            </button>
            <button type="button" aria-label={t("browser.closetab")} onClick={() => { void bridge?.browser?.closeTab(tab.id).then(refresh); if (activeId === tab.id) setActiveId(null); }}><X size={12} /></button>
          </div>
        ))}
        <button type="button" className="xr-web-browser__newtab" aria-label="New tab" title="New tab" onClick={() => void openTab("https://duckduckgo.com")}><Plus size={17}/></button>
        <button type="button" className={`xr-web-browser__find${finding ? " is-on" : ""}`} onClick={() => {if(finding){setFindText("");if(activeId)void bridge?.browser?.find(activeId,"");}setFinding((v) => !v);}} aria-label={t("browser.find")}><Search size={13} /></button>
        {finding && (
          <input className="xr-web-browser__findinput" autoFocus value={findText} aria-label={t("browser.find")} placeholder={t("browser.find")}
            onChange={(e) => { setFindText(e.target.value); if (activeId) void bridge?.browser?.find(activeId, e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Escape") { setFinding(false); setFindText(""); if (activeId) void bridge?.browser?.find(activeId, ""); } }} />
        )}
        {worldId && layout !== "beside" && <button type="button" className="xr-button xr-web-browser__save" disabled={!activeId||captureBusy}
          onClick={()=>capture()}>{t("browser.save")}</button>}
      </div>

      {(newProfile||profiles.length===0)&&<form className="xr-web-browser__newaccount" onSubmit={e=>{
        e.preventDefault();if(!newLabel.trim())return;
        void bridge?.browser?.createProfile(newLabel.trim(),"signed_in").then(p=>{setProfileId(p.id);setNewLabel("");setNewProfile(false);return refresh();}).catch(c=>setError(c instanceof Error?c.message:"Could not create this profile."));
      }}><input value={newLabel} maxLength={60} onChange={e=>setNewLabel(e.target.value)} autoFocus placeholder="Work, personal…" aria-label="Profile name"/><button type="submit" disabled={!newLabel.trim()} className="xr-button">Create profile</button><button type="button" className="xr-text-action" onClick={()=>setNewProfile(false)}>Cancel</button></form>}
      {saving && (
        <SaveToProject snapshot={saving} worlds={worlds} worldId={worldId}
          onSaved={(r) => { setSaved(t("save.saved", { title: saving.title || saving.url, count: r.candidates })); setSaving(null);void refreshShelf(); }}
          onCancel={() => setSaving(null)} />
      )}
      {saved && <p className="xr-web-browser__error" role="status">{saved}<button type="button" className="xr-text-action" onClick={() => setSaved(null)}>{t("keys.close")}</button></p>}
      {error && <p className="xr-web-browser__error" role="status">{error}<button type="button" className="xr-text-action" onClick={() => setError(null)}>{t("keys.close")}</button></p>}
      {otherState?.error&&<p className="xr-web-browser__error" role="status">Comparison page: {otherState.error}</p>}
      {state?.error && <p className="xr-web-browser__error" role="status">{state.error}</p>}

      {worldId&&<div className="xr-browser-projectbar"><span><Compass size={16}/><strong>{project?.title??"Your project"}</strong>{stepTitle&&<small>{stepTitle}</small>}</span><button type="button" aria-pressed={shelfOpen} onClick={()=>setShelfOpen(v=>!v)}><BookOpen size={16}/>Sources <small>{shelf.length}</small></button><button type="button" disabled={tabs.length<2||!activeId} aria-pressed={!!compareId} onClick={()=>setCompareId(compareId?null:tabs.find(t=>t.id!==activeId)?.id??null)}><Columns2 size={16}/>Compare</button><button type="button" onClick={onBack}><CornerUpLeft size={16}/>Return to work</button></div>}
      <div className={`xr-web-browser__workspace${shelfOpen?" has-shelf":""}`}>
      {shelfOpen&&worldId&&<aside className="xr-browser-shelf" aria-label="Project sources"><header><h2>Kept for this work</h2><button type="button" aria-label="Close project sources" onClick={()=>setShelfOpen(false)}><X size={17}/></button></header><label className="xr-browser-shelf__search"><Search size={15}/><input value={shelfFilter} onChange={e=>setShelfFilter(e.target.value)} placeholder="Find a source" aria-label="Find a project source"/></label>{!shelf.length&&<div className="xr-browser-shelf__empty"><BookmarkPlus size={28}/><p>Keep a page or a selected passage.</p></div>}
        {shelf.filter(r=>`${r.title} ${r.excerpt}`.toLowerCase().includes(shelfFilter.toLowerCase())).map(r=><article key={r.sourceId}><span className="xr-browser-shelf__status">{r.private?<><LockKeyhole size={13}/>Private</>:r.inPath?<><Check size={13}/>In work path</>:<><BookOpen size={13}/>Saved source</>}</span><h3>{r.title}</h3><p>{r.excerpt}</p><footer><small>{new Date(r.at).toLocaleDateString()}</small>{r.url&&<button type="button" className="xr-text-action" onClick={()=>void openTab(r.url!)}>Revisit <ArrowRight size={13}/></button>}</footer></article>)}
        {!!compareId&&<form className="xr-browser-comparison-note" onSubmit={async e=>{e.preventDefault();if(comparisonNote.trim().length<8||noteBusy)return;setNoteBusy(true);try{await bridge?.sense.observe(worldId,`Compared ${state?.url.slice(0,700)??"first tab"} with ${otherState?.url.slice(0,700)??"second tab"}.\nMy observation: ${comparisonNote.trim()}`);setComparisonNote("");setSaved("Comparison note saved to your project.");}catch(c){setError(c instanceof Error?c.message:String(c));}finally{setNoteBusy(false);}}}><label><PencilLine size={15}/>What matters for your work?<textarea value={comparisonNote} onChange={e=>setComparisonNote(e.target.value)} minLength={8} maxLength={2000} rows={3} placeholder="Your observation, in your words…"/></label><button type="submit" className="xr-button" disabled={comparisonNote.trim().length<8||noteBusy}>Save my note</button></form>}
      </aside>}
      <div className={`xr-browser-pages${compareId?" is-comparing":""}`}>
      {compareId&&<div className="xr-browser-comparebar"><span>{state?.title||tabs.find(t=>t.id===activeId)?.title||"First page"}</span><button type="button" title="Swap pages" aria-label="Swap comparison pages" onClick={()=>{const first=activeId;setActiveId(compareId);setCompareId(first);}}><ArrowLeftRight size={16}/></button><select aria-label="Compare with tab" value={compareId} onChange={e=>setCompareId(e.target.value)}>{tabs.filter(t=>t.id!==activeId).map(t=><option key={t.id} value={t.id}>{t.title||hostOf(t.url)}</option>)}</select><button type="button" onClick={()=>capture(compareId)}><BookmarkPlus size={15}/>Keep this source</button><button type="button" aria-label="Close comparison" onClick={()=>setCompareId(null)}><X size={16}/></button></div>}
      <div className="xr-browser-page-panes">
      {worldId && layout === "beside" && !shelfOpen && !compareId && <aside className="xr-web-browser__path" aria-label="Browsing for this project">
        <small>Your project</small><h2>{project?.title ?? "This project"}</h2>
        {goalTitle && <p className="xr-web-browser__purpose"><Compass size={15} /> {goalTitle}</p>}
        {stepTitle && <p className="xr-web-browser__step">For this step <strong>{stepTitle}</strong></p>}
        <ol className="xr-web-browser__route">
          <li className="is-current"><span><Globe2 size={17} /></span><div><strong>Explore</strong><small>{activeId ? hostOf(state?.url ?? address) : "Open a page"}</small></div></li>
          <li className={saved ? "is-done" : ""}><span>{saved ? <Check size={17} /> : <BookmarkPlus size={17} />}</span><div><strong>Keep a source</strong><small>{saved ? "Saved to your project" : "Choose what matters on the page"}</small></div></li>
          <li><span><CornerUpLeft size={17} /></span><div><strong>Return to work</strong></div></li>
        </ol>
        <button type="button" className="xr-web-browser__capture" disabled={!activeId} onClick={()=>capture()}><BookmarkPlus size={17} /> Save to project</button>
        <button type="button" className="xr-web-browser__return" onClick={onBack}><CornerUpLeft size={16} /> Back to project</button>
      </aside>}
      <div className="xr-web-browser__host" ref={host}>
        {!activeId && (
          <div className="xr-web-browser__empty">
            <ProjectIllustration kind="browser" />
            <h2>Explore. Bring something back.</h2>
            <form className="xr-web-browser__start-search" onSubmit={e=>{e.preventDefault();void go();}}><Search size={19}/><input aria-label="Search the web" placeholder="Search or paste a link" value={address} onChange={e=>setAddress(e.target.value)}/><button type="submit" aria-label="Search"><ArrowRight size={20}/></button></form>

          </div>
        )}
      </div>
      {compareId&&<div className="xr-web-browser__host xr-browser-other-host" ref={otherHost}/>}
      </div></div>
      </div>

      {downloads.length > 0 && (
        <section className="xr-web-browser__downloads" aria-label={t("browser.downloads")}>
          <h3>{t("browser.downloads")}</h3>
          <ul>
            {downloads.map((d) => (
              <li key={d.id}>
                <span>{d.filename}</span>
                <span className="xr-mono">{Math.round(d.bytes / 1024)} kB · {d.sha256.slice(0, 10)}…</span>
                <button type="button" className="xr-button" onClick={() => void bridge?.browser?.decideDownload(d.id, "kept").then(refresh).catch(c=>setError(c instanceof Error?c.message:String(c)))}>{t("browser.keep")}</button>
                <button type="button" className="xr-button" onClick={() => void bridge?.browser?.decideDownload(d.id, "discarded").then(refresh).catch(c=>setError(c instanceof Error?c.message:String(c)))}>{t("browser.discard")}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="xr-web-browser__foot">{onSources&&<button type="button" className="xr-text-action" onClick={onSources}><FolderOpen size={14}/>Save a page to a project</button>}
        <span>{profile ? t("browser.profilenote", { label: profile.label, kind: profile.kind === "signed_in" ? t("browser.signedin") : t("browser.readingonly") }) : t("browser.noaccounts")}</span>
        <details className="xr-web-browser__foot-note"><summary><LockKeyhole size={13}/>Browser protections</summary><p>{t("browser.footnote")}</p></details>
      </footer>
    </main>
  );
}

const hostOf = (url: string): string => { try { return new URL(url).hostname; } catch { return url || "new tab"; } };
