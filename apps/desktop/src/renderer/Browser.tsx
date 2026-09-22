import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserProfile, BrowserTab, HeldDownload, TabState } from "@xeniur/core";
import { BROWSER_STATE_WORDS } from "@xeniur/core";
import { ArrowLeft, ArrowRight, Globe2, RotateCw, Search, X } from "lucide-react";
import { t } from "@xeniur/ui";
import { SaveToProject } from "./SaveToProject.js";

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
export function Browser({ worldId, goalId, stepId, worlds = [], layout = "fill", onLayout, onSave, onBack }: {
  /** The project these tabs belong to. Null is unassigned browsing: it saves nothing anywhere. */
  worldId: string | null;
  goalId?: string | null;
  stepId?: string | null;
  /** The projects a capture may go into. */
  worlds?: readonly import("@xeniur/core").World[];
  layout?: BrowserLayout;
  onLayout?(layout: BrowserLayout): void;
  /** Save what is on screen into the project — the person's act, never automatic. */
  onSave?(tabId: string): void;
  onBack(): void;
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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<import("@xeniur/core").TabSnapshot | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const ps = (await bridge?.browser?.profiles()) ?? [];
    setProfiles(ps);
    setProfileId((current) => current || ps[0]?.id || "");
    setTabs((await bridge?.browser?.tabs(worldId)) ?? []);
    setDownloads((await bridge?.browser?.downloads()) ?? []);
  }, [bridge, worldId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => bridge?.browser?.onEvent(() => { void refresh(); }), [bridge, refresh]);

  // The view is placed behind this pane; the renderer reports where, and nothing else.
  useEffect(() => {
    if (!activeId || !host.current) return;
    const box = host.current;
    const sync = () => {
      const r = box.getBoundingClientRect();
      bridge?.browser?.setBounds(activeId, { x: r.x, y: r.y, width: r.width, height: r.height });
    };
    const observer = new ResizeObserver(sync);
    observer.observe(box);
    window.addEventListener("scroll", sync, true);
    sync();
    const timer = window.setInterval(() => { void bridge?.browser?.state(activeId).then((s) => { if (s) { setState(s); setAddress((a) => (document.activeElement === document.getElementById("browser-address") ? a : s.url)); } }); }, 900);
    return () => { observer.disconnect(); window.removeEventListener("scroll", sync, true); window.clearInterval(timer); };
  }, [bridge, activeId]);

  const openTab = async (url: string) => {
    if (!profileId) { setError(t("browser.needaccount")); return; }
    try {
      const tab = await bridge?.browser?.openTab({ profileId, url, worldId, goalId: goalId ?? null, stepId: stepId ?? null });
      if (tab) { setActiveId(tab.id); setAddress(tab.url); setError(null); }
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const go = async () => {
    const url = address.trim();
    if (url === "") return;
    const target = /^https?:\/\//.test(url) ? url : /^[\w-]+(\.[\w-]+)+/.test(url) ? `https://${url}` : `https://duckduckgo.com/?q=${encodeURIComponent(url)}`;
    if (!activeId) { await openTab(target); return; }
    try { await bridge?.browser?.navigate(activeId, target); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const profile = profiles.find((p) => p.id === profileId) ?? null;
  return (
    <main className={`xr-web-browser xr-web-browser--${layout}`}>
      <header className="xr-web-browser__bar">
        <button type="button" className="xr-back" onClick={onBack}><ArrowLeft size={15} /> {t("models.back")}</button>
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
          {t("browser.accounts")}
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-label={t("browser.accounts")}>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}{p.kind === "ephemeral" ? ` · ${t("browser.readingonly")}` : ""}</option>)}
            {profiles.length === 0 && <option value="">{t("browser.noaccounts")}</option>}
          </select>
        </label>
        <span className={`xr-web-browser__state is-${state?.browserState ?? "person"}`}>{BROWSER_STATE_WORDS[state?.browserState ?? "person"]}</span>
        {state?.browserState === "assistant" && <button type="button" className="xr-button xr-button--primary" onClick={() => activeId && void bridge?.browser?.takeOver(activeId)}>{t("browser.takeover")}</button>}
        <div className="xr-web-browser__layout" role="radiogroup" aria-label={t("browser.layout")}>
          {(["fill", "wide", "beside"] as BrowserLayout[]).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={layout === l} className={layout === l ? "is-on" : ""} onClick={() => onLayout?.(l)}>{t(`browser.layout.${l}` as never)}</button>
          ))}
        </div>
      </header>

      <div className="xr-web-browser__tabs" role="tablist">
        {tabs.map((tab) => (
          <div key={tab.id} className={`xr-web-browser__tab${activeId === tab.id ? " is-active" : ""}`}>
            <button type="button" role="tab" aria-selected={activeId === tab.id}
              onClick={() => { setActiveId(tab.id); setAddress(tab.url); void bridge?.browser?.activate(tab.id); }}>
              {tab.title || hostOf(tab.url)}
            </button>
            <button type="button" aria-label={t("browser.closetab")} onClick={() => { void bridge?.browser?.closeTab(tab.id).then(refresh); if (activeId === tab.id) setActiveId(null); }}><X size={12} /></button>
          </div>
        ))}
        <button type="button" className="xr-web-browser__newtab" onClick={() => void openTab("https://duckduckgo.com")}>+</button>
        <button type="button" className={`xr-web-browser__find${finding ? " is-on" : ""}`} onClick={() => setFinding((v) => !v)} aria-label={t("browser.find")}><Search size={13} /></button>
        {finding && (
          <input className="xr-web-browser__findinput" autoFocus value={findText} aria-label={t("browser.find")} placeholder={t("browser.find")}
            onChange={(e) => { setFindText(e.target.value); if (activeId) void bridge?.browser?.find(activeId, e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Escape") { setFinding(false); setFindText(""); if (activeId) void bridge?.browser?.find(activeId, ""); } }} />
        )}
        {worldId && <button type="button" className="xr-button xr-web-browser__save" disabled={!activeId}
          onClick={() => { if (!activeId) return; void bridge?.browser?.snapshot(activeId).then((s) => setSaving(s ?? null)); onSave?.(activeId); }}>{t("browser.save")}</button>}
      </div>

      {saving && (
        <SaveToProject snapshot={saving} worlds={worlds} worldId={worldId}
          onSaved={(r) => { setSaved(t("save.saved", { title: saving.title || saving.url, count: r.candidates })); setSaving(null); }}
          onCancel={() => setSaving(null)} />
      )}
      {saved && <p className="xr-web-browser__error" role="status">{saved}<button type="button" className="xr-text-action" onClick={() => setSaved(null)}>{t("keys.close")}</button></p>}
      {error && <p className="xr-web-browser__error" role="status">{error}<button type="button" className="xr-text-action" onClick={() => setError(null)}>{t("keys.close")}</button></p>}
      {state?.error && <p className="xr-web-browser__error" role="status">{state.error}</p>}

      <div className="xr-web-browser__host" ref={host}>
        {!activeId && (
          <div className="xr-web-browser__empty">
            <Globe2 />
            <h2>{t("browser.emptytitle")}</h2>
            <p>{t("browser.emptybody")}</p>
            {profiles.length === 0 && (
              <form className="xr-web-browser__newaccount" onSubmit={(e) => {
                e.preventDefault();
                if (!newLabel.trim()) return;
                void bridge?.browser?.createProfile(newLabel.trim(), "signed_in").then(() => { setNewLabel(""); return refresh(); });
              }}>
                <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={t("browser.accountplaceholder")} aria-label={t("browser.accountplaceholder")} />
                <button type="submit" className="xr-button">{t("browser.addaccount")}</button>
              </form>
            )}
          </div>
        )}
      </div>

      {downloads.length > 0 && (
        <section className="xr-web-browser__downloads" aria-label={t("browser.downloads")}>
          <h3>{t("browser.downloads")}</h3>
          <ul>
            {downloads.map((d) => (
              <li key={d.id}>
                <span>{d.filename}</span>
                <span className="xr-mono">{Math.round(d.bytes / 1024)} kB · {d.sha256.slice(0, 10)}…</span>
                <button type="button" className="xr-button" onClick={() => void bridge?.browser?.decideDownload(d.id, "kept").then(refresh)}>{t("browser.keep")}</button>
                <button type="button" className="xr-button" onClick={() => void bridge?.browser?.decideDownload(d.id, "discarded").then(refresh)}>{t("browser.discard")}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="xr-web-browser__foot">
        <span>{profile ? t("browser.profilenote", { label: profile.label, kind: profile.kind === "signed_in" ? t("browser.signedin") : t("browser.readingonly") }) : t("browser.noaccounts")}</span>
        <span className="xr-web-browser__foot-note">{t("browser.footnote")}</span>
      </footer>
    </main>
  );
}

const hostOf = (url: string): string => { try { return new URL(url).hostname; } catch { return url || "new tab"; } };
