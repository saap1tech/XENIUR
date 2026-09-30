import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, WebContentsView, session as electronSession } from "electron";
import type { BrowserProfile, BrowserState, BrowserTab, HeldDownload, ProfileKind, Rect, TabSnapshot, WebRiskResult } from "@xeniur/core";
import { MAX_DOWNLOAD_BYTES, MAX_SNAPSHOT_CHARS, newId, now } from "@xeniur/core";
import type { ObjectGraph } from "@xeniur/graph";
import { lockDownSession } from "../security.js";
import { checkedDestination, localUrlPolicy } from "./policy.js";
import type { WebRiskChecker } from "./risk.js";
import { PublicWebProxy } from "./proxy.js";
import { cspFor, partitionFor, requestRule, safeFilename } from "./rules.js";

interface Live {
  tab: BrowserTab;
  view: WebContentsView;
  profile: BrowserProfile;
  risk: WebRiskResult | null;
  error: string | null;
  browserState: BrowserState;
  /** Set while a driver acts in this view; requestRule reads it. */
  acting: boolean;
  grantOrigins: string[];
}

/** The isolated-world script a snapshot runs. Fixed, bundled, read-only — never model-written. */
const SNAPSHOT_SCRIPT = `(() => {
  const sel = (window.getSelection && window.getSelection().toString()) || "";
  const main = document.querySelector("article") || document.querySelector("main") || document.body;
  const text = (main && main.innerText) || "";
  return { selectionText: sel.slice(0, 20000), pageText: text.slice(0, ${MAX_SNAPSHOT_CHARS}), title: document.title || "" };
})()`;
/** The isolated world XENIUR reads in. Never world 0: the page's own scripts stay untouched. */
export const XENIUR_ISOLATED_WORLD = 1729;

/**
 * Browsing inside XENIUR: profiles the person creates, tabs that belong to their work, and
 * one visible view per tab.
 *
 * Every session is locked down (no permissions, no devices), proxied to the address the
 * policy checked, and re-checked on every main and sub frame. A signed-in profile may POST —
 * that is how signing in works — and keeps its session between runs; an ephemeral one reads
 * only. Downloads are held in a scratch folder with their hash and offered to the person;
 * nothing enters a project without them saying so.
 */
export class TabManager {
  private readonly live = new Map<string, Live>();
  private readonly sessions = new Map<string, { session: Electron.Session; proxy: PublicWebProxy }>();
  private activeTabId: string | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly risk: WebRiskChecker,
    private readonly graph: ObjectGraph,
    private readonly downloadsDir: string,
    /** Told when something changed, so the renderer can re-read rather than poll. */
    private readonly onChanged: (tabId: string) => void = () => {},
  ) {}

  /* ------------------------------------------------------------------ profiles */

  profiles(): BrowserProfile[] {
    return (this.graph.db.prepare(`SELECT * FROM browser_profiles ORDER BY created_at`).all() as ProfileRow[]).map(profileFromRow);
  }

  createProfile(label: string, kind: ProfileKind): BrowserProfile {
    const id = newId();
    const p: BrowserProfile = { id, label, kind, partition: partitionFor(id, kind), createdAt: now(), lastUsedAt: null };
    this.graph.db.prepare(`INSERT INTO browser_profiles (id, label, kind, partition, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, NULL)`)
      .run(p.id, p.label, p.kind, p.partition, p.createdAt);
    return p;
  }

  /** Forgetting a profile closes its tabs and clears its stored session. */
  async removeProfile(profileId: string): Promise<void> {
    for (const [id, l] of this.live) if (l.profile.id === profileId) this.closeTab(id);
    const held = this.sessions.get(profileId);
    if (held) { await held.session.clearStorageData(); held.proxy.close(); this.sessions.delete(profileId); }
    this.graph.db.prepare(`DELETE FROM browser_profiles WHERE id = ?`).run(profileId);
  }

  #profile(profileId: string): BrowserProfile {
    const r = this.graph.db.prepare(`SELECT * FROM browser_profiles WHERE id = ?`).get(profileId) as ProfileRow | undefined;
    if (!r) throw new Error("That account is not here any more.");
    return profileFromRow(r);
  }

  async #sessionFor(profile: BrowserProfile): Promise<Electron.Session> {
    const held = this.sessions.get(profile.id);
    if (held) return held.session;
    const session = electronSession.fromPartition(profile.partition);
    lockDownSession(session);
    const proxy = new PublicWebProxy();
    const port = await proxy.start();
    await session.setProxy({ proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`, proxyBypassRules: "<-loopback>" });

    session.webRequest.onBeforeRequest((details, callback) => {
      void (async () => {
        localUrlPolicy(details.url);
        const l = [...this.live.values()].find((x) => x.view.webContents.id === details.webContentsId);
        const verdict = requestRule(
          { profileKind: profile.kind, acting: l?.acting ?? false, grantOrigins: l?.grantOrigins ?? [] },
          { method: details.method, url: details.url, resourceType: details.resourceType },
        );
        if (!verdict.allow) throw new Error(verdict.because);
        if (["mainFrame", "subFrame"].includes(details.resourceType)) {
          await checkedDestination(details.url);
          const nextRisk = await this.risk.allow(details.url);
          if (details.resourceType === "mainFrame" && l) { l.risk = nextRisk; l.error = null; }
        }
        callback({ cancel: false });
      })().catch((error: unknown) => {
        const l = [...this.live.values()].find((x) => x.view.webContents.id === details.webContentsId);
        if (l && details.resourceType === "mainFrame") l.error = error instanceof Error ? error.message : "That request was blocked.";
        callback({ cancel: true });
      });
    });

    session.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      const key = Object.keys(headers).find((name) => name.toLowerCase() === "content-security-policy") ?? "Content-Security-Policy";
      headers[key] = [...(headers[key] ?? []), cspFor(profile.kind)];
      callback({ responseHeaders: headers });
    });

    // Held, never taken: the file lands in a scratch folder with its hash, and the person decides.
    session.on("will-download", (_event, item) => {
      const tab = [...this.live.values()].find((x) => x.view.webContents.session === session);
      const dir = join(this.downloadsDir, tab?.tab.id ?? "unassigned");
      mkdirSync(dir, { recursive: true });
      const path = join(dir, safeFilename(item.getFilename()));
      item.setSavePath(path);
      item.on("updated", () => { if (item.getReceivedBytes() > MAX_DOWNLOAD_BYTES) item.cancel(); });
      item.once("done", (_e, state) => {
        if (state !== "completed") return;
        const bytes = statSync(path).size;
        const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
        this.graph.db.prepare(`INSERT INTO held_downloads (id, tab_id, filename, mime, bytes, sha256, path, at, decided) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
          .run(newId(), tab?.tab.id ?? "unassigned", safeFilename(item.getFilename()), item.getMimeType(), bytes, sha256, path, now());
        this.onChanged(tab?.tab.id ?? "");
      });
    });

    this.sessions.set(profile.id, { session, proxy });
    return session;
  }

  /* ---------------------------------------------------------------------- tabs */

  async openTab(input: { profileId: string; url: string; worldId?: string | null; goalId?: string | null; stepId?: string | null }): Promise<BrowserTab> {
    const profile = this.#profile(input.profileId);
    const { url } = await checkedDestination(input.url);
    const risk = await this.risk.allow(url.href);
    const session = await this.#sessionFor(profile);

    const position = (this.graph.db.prepare(`SELECT COUNT(*) c FROM browser_tabs WHERE closed_at IS NULL`).get() as { c: number }).c;
    const tab: BrowserTab = {
      id: newId(), profileId: profile.id, worldId: input.worldId ?? null, goalId: input.goalId ?? null,
      stepId: input.stepId ?? null, url: url.href, title: "", position, openedAt: now(), closedAt: null,
    };
    this.graph.db.prepare(
      `INSERT INTO browser_tabs (id, profile_id, world_id, goal_id, step_id, url, title, position, opened_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(tab.id, tab.profileId, tab.worldId, tab.goalId, tab.stepId, tab.url, tab.title, tab.position, tab.openedAt);
    this.graph.db.prepare(`UPDATE browser_profiles SET last_used_at = ? WHERE id = ?`).run(now(), profile.id);

    const view = new WebContentsView({ webPreferences: {
      session, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false, safeDialogs: true,
    } });
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url: target }) => {
      // A new window becomes a new tab in the same profile — visible, and ours.
      void this.openTab({ profileId: profile.id, url: target, worldId: tab.worldId, goalId: tab.goalId, stepId: tab.stepId }).catch(() => undefined);
      return { action: "deny" };
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    const guard = (event: Electron.Event, target: string): void => {
      try { localUrlPolicy(target); } catch {
        event.preventDefault();
        const l = this.live.get(tab.id); if (l) l.error = "That address is outside what XENIUR will open.";
      }
    };
    contents.on("will-navigate", guard);
    contents.on("will-redirect", guard);
    contents.on("page-title-updated", (_e, title) => {
      const l = this.live.get(tab.id); if (!l) return;
      l.tab = { ...l.tab, title };
      this.graph.db.prepare(`UPDATE browser_tabs SET title = ?, url = ? WHERE id = ?`).run(title, contents.getURL(), tab.id);
      this.onChanged(tab.id);
    });
    // The person touching the keyboard or the pointer takes the tab back from the assistant.
    contents.on("before-input-event", (event,input) => {
      this.takeOver(tab.id);
      if(input.type!=="keyDown")return;
      let command:string|null=null;const key=input.key.toLowerCase();
      if((input.control||input.meta)&&!input.alt){
        command=({l:"address",t:"new_tab",w:"close_tab",r:"reload",f:"find"} as Record<string,string>)[key]??null;
        if(key==="tab")command=input.shift?"previous_tab":"next_tab";
      }
      if(key==="escape"&&this.window.isFullScreen())command="exit_fullscreen";
      if(command){event.preventDefault();this.window.webContents.focus();this.window.webContents.send("xeniur:browser-shortcut",command);}
    });

    this.live.set(tab.id, { tab, view, profile, risk, error: null, browserState: "person", acting: false, grantOrigins: [] });
    this.window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.activate(tab.id);
    try { await contents.loadURL(url.href); } catch (error) {
      const l = this.live.get(tab.id); if (l) l.error ??= error instanceof Error ? error.message : "The site did not load.";
    }
    return tab;
  }

  async navigate(tabId: string, input: string): Promise<void> {
    const l = this.#live(tabId);
    const { url } = await checkedDestination(input);
    l.risk = await this.risk.allow(url.href);
    l.error = null;
    await l.view.webContents.loadURL(url.href);
    this.graph.db.prepare(`UPDATE browser_tabs SET url = ? WHERE id = ?`).run(url.href, tabId);
  }

  back(tabId: string): void { this.#live(tabId).view.webContents.navigationHistory.goBack(); }
  forward(tabId: string): void { this.#live(tabId).view.webContents.navigationHistory.goForward(); }
  reload(tabId: string): void { this.#live(tabId).view.webContents.reload(); }
  find(tabId: string, text: string): void {
    const c = this.#live(tabId).view.webContents;
    if (text.trim() === "") c.stopFindInPage("clearSelection"); else c.findInPage(text);
  }
  stopFind(tabId: string): void { this.#live(tabId).view.webContents.stopFindInPage("clearSelection"); }

  /** One tab is visible at a time; the rest sit at zero size, still loaded. */
  setFullscreen(enabled:boolean):boolean { this.window.setFullScreen(enabled);return enabled; }

  activate(tabId: string): void {
    this.activeTabId = tabId;
    for (const [id, l] of this.live) if (id !== tabId) l.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.onChanged(tabId);
  }

  setBounds(tabId: string, rect: Rect): void {
    if (this.activeTabId !== tabId || !this.live.has(tabId)) return;
    this.#live(tabId).view.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) });
  }

  closeTab(tabId: string): void {
    const l = this.live.get(tabId); if (!l) return;
    this.window.contentView.removeChildView(l.view);
    l.view.webContents.close();
    this.live.delete(tabId);
    this.graph.db.prepare(`UPDATE browser_tabs SET closed_at = ? WHERE id = ?`).run(now(), tabId);
    if (this.activeTabId === tabId) this.activeTabId = [...this.live.keys()][0] ?? null;
    this.onChanged(tabId);
  }

  closeAll(): void { for (const id of [...this.live.keys()]) this.closeTab(id); }

  /** Open tabs, live first; a project's own, or the unassigned ones when no project is given. */
  tabs(worldId?: string | null): BrowserTab[] {
    const rows = (worldId === undefined
      ? this.graph.db.prepare(`SELECT * FROM browser_tabs WHERE closed_at IS NULL ORDER BY position`).all()
      : worldId === null
        ? this.graph.db.prepare(`SELECT * FROM browser_tabs WHERE closed_at IS NULL AND world_id IS NULL ORDER BY position`).all()
        : this.graph.db.prepare(`SELECT * FROM browser_tabs WHERE closed_at IS NULL AND world_id = ? ORDER BY position`).all(worldId)) as TabRow[];
    return rows.map(tabFromRow);
  }

  state(tabId: string) {
    const l = this.live.get(tabId);
    if (!l) return null;
    const c = l.view.webContents;
    return {
      tabId, profileId: l.profile.id, profileLabel: l.profile.label,
      url: c.getURL(), title: c.getTitle(),
      canGoBack: c.navigationHistory.canGoBack(), canGoForward: c.navigationHistory.canGoForward(),
      loading: c.isLoading(), risk: l.risk, error: l.error, browserState: l.browserState,
      webContentsId: c.id,
    };
  }

  /** The visible, authenticated view — what the person is actually looking at. */
  async snapshot(tabId: string): Promise<TabSnapshot> {
    const l = this.#live(tabId);
    const read = await l.view.webContents.executeJavaScriptInIsolatedWorld(XENIUR_ISOLATED_WORLD, [{ code: SNAPSHOT_SCRIPT }]) as
      { selectionText: string; pageText: string; title: string };
    return {
      tabId, url: l.view.webContents.getURL(), title: read.title || l.view.webContents.getTitle(),
      selectionText: read.selectionText, pageText: read.pageText, at: now(), profileLabel: l.profile.label,
    };
  }

  /* ------------------------------------------------------- who is driving */

  /** The assistant begins acting here, inside the origins the person allowed. */
  beginActing(tabId: string, origins: readonly string[]): void {
    const l = this.#live(tabId);
    l.acting = true; l.grantOrigins = [...origins]; l.browserState = "assistant";
    this.onChanged(tabId);
  }
  /** The person takes the tab back. Nothing further is sent; resuming is their act. */
  takeOver(tabId: string): void {
    const l = this.live.get(tabId); if (!l || !l.acting) return;
    l.acting = false; l.grantOrigins = []; l.browserState = "person";
    this.onChanged(tabId);
  }
  waitingForReview(tabId: string, waiting: boolean): void {
    const l = this.live.get(tabId); if (!l) return;
    l.browserState = waiting ? "review" : l.acting ? "assistant" : "person";
    this.onChanged(tabId);
  }
  isActing(tabId: string): boolean { return this.live.get(tabId)?.acting ?? false; }
  webContentsOf(tabId: string): Electron.WebContents | null { return this.live.get(tabId)?.view.webContents ?? null; }
  isVisible(tabId: string): boolean {
    const l = this.live.get(tabId);
    if (!l || this.activeTabId !== tabId) return false;
    const b = l.view.getBounds();
    return b.width > 0 && b.height > 0;
  }

  /* -------------------------------------------------------------- downloads */

  downloads(): HeldDownload[] {
    return (this.graph.db.prepare(`SELECT * FROM held_downloads WHERE decided IS NULL ORDER BY at DESC`).all() as DownloadRow[]).map((r) => ({
      id: r.id, tabId: r.tab_id, filename: r.filename, mime: r.mime, bytes: r.bytes, sha256: r.sha256, path: r.path, at: r.at,
    }));
  }
  decideDownload(id: string, decision: "kept" | "discarded"): void {
    this.graph.db.prepare(`UPDATE held_downloads SET decided = ? WHERE id = ?`).run(decision, id);
  }

  #live(tabId: string): Live {
    const l = this.live.get(tabId);
    if (!l) throw new Error("That tab has closed.");
    return l;
  }
}

type ProfileRow = { id: string; label: string; kind: ProfileKind; partition: string; created_at: number; last_used_at: number | null };
const profileFromRow = (r: ProfileRow): BrowserProfile => ({ id: r.id, label: r.label, kind: r.kind, partition: r.partition, createdAt: r.created_at, lastUsedAt: r.last_used_at });
type TabRow = { id: string; profile_id: string; world_id: string | null; goal_id: string | null; step_id: string | null; url: string; title: string; position: number; opened_at: number; closed_at: number | null };
const tabFromRow = (r: TabRow): BrowserTab => ({ id: r.id, profileId: r.profile_id, worldId: r.world_id, goalId: r.goal_id, stepId: r.step_id, url: r.url, title: r.title, position: r.position, openedAt: r.opened_at, closedAt: r.closed_at });
type DownloadRow = { id: string; tab_id: string; filename: string; mime: string; bytes: number; sha256: string; path: string; at: number };
