import { BrowserWindow, WebContentsView, session as electronSession } from "electron";
import { newId, type Rect, type LiveSiteState } from "@xeniur/core";
import { lockDownSession } from "./security.js";
import { checkedDestination, localUrlPolicy } from "./web/policy.js";
import { WebRiskChecker } from "./web/risk.js";
import { PublicWebProxy } from "./web/proxy.js";

/** Live Site is an isolated, ephemeral read surface. Actions belong to Hands. */
export class BrowserShell {
  private readonly views = new Map<string, { view: WebContentsView; state: LiveSiteState; proxy: PublicWebProxy }>();
  constructor(private readonly window: BrowserWindow, private readonly risk: WebRiskChecker) {}

  async open(input: string): Promise<{ viewId: string }> {
    const { url } = await checkedDestination(input);
    const risk = await this.risk.allow(url.href);
    const viewId = newId();
    const siteSession = electronSession.fromPartition(`web:${viewId}`);
    lockDownSession(siteSession);
    const proxy = new PublicWebProxy();
    const port = await proxy.start();
    await siteSession.setProxy({ proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`, proxyBypassRules: "<-loopback>" });
    siteSession.on("will-download", (event) => event.preventDefault());
    const state: LiveSiteState = { viewId, url: url.href, risk, error: null };
    siteSession.webRequest.onBeforeRequest((details, callback) => {
      void (async () => {
        localUrlPolicy(details.url);
        if (!["GET", "HEAD"].includes(details.method)) throw new Error("Sending data requires an Act review.");
        // The proxy independently validates and pins every connection. Recheck every redirect/frame here.
        if (["mainFrame", "subFrame"].includes(details.resourceType)) {
          await checkedDestination(details.url);
          const nextRisk = await this.risk.allow(details.url);
          if (details.resourceType === "mainFrame") { state.risk = nextRisk; state.url = details.url; state.error = null; }
        }
        callback({ cancel: false });
      })().catch((error: unknown) => {
        if (details.resourceType === "mainFrame") state.error = error instanceof Error ? error.message : "Navigation blocked.";
        callback({ cancel: true });
      });
    });
    siteSession.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      // Chromium intersects this with the site's own policy.
      const key = Object.keys(headers).find((name) => name.toLowerCase() === "content-security-policy") ?? "Content-Security-Policy";
      headers[key] = [...(headers[key] ?? []), "form-action 'none'; object-src 'none'; base-uri 'self'"];
      callback({ responseHeaders: headers });
    });
    const view = new WebContentsView({ webPreferences: {
      session: siteSession, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, navigateOnDragDrop: false, safeDialogs: true,
    } });
    const contents = view.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-attach-webview", (event) => event.preventDefault());
    const guardNavigation = (event: Electron.Event, target: string): void => {
      try { localUrlPolicy(target); } catch {
        event.preventDefault();
        state.error = "This navigation was blocked by the local URL policy.";
      }
    };
    contents.on("will-navigate", guardNavigation);
    contents.on("will-redirect", guardNavigation);
    this.views.set(viewId, { view, state, proxy });
    this.window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    try { await contents.loadURL(url.href); } catch (error) { state.error ??= error instanceof Error ? error.message : "The site did not load."; }
    return { viewId };
  }

  async navigate(viewId: string, input: string): Promise<void> {
    const entry = this.views.get(viewId); if (!entry) throw new Error("This live view has closed.");
    const { url } = await checkedDestination(input);
    entry.state.risk = await this.risk.allow(url.href);
    await entry.view.webContents.loadURL(url.href);
  }
  status(viewId: string): LiveSiteState | null { return this.views.get(viewId)?.state ?? null; }
  setBounds(viewId: string, rect: Rect): void {
    this.views.get(viewId)?.view.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) });
  }
  close(viewId: string): void {
    const entry = this.views.get(viewId); if (!entry) return;
    this.window.contentView.removeChildView(entry.view);
    entry.view.webContents.close(); entry.proxy.close(); this.views.delete(viewId);
  }
  closeAll(): void { for (const id of [...this.views.keys()]) this.close(id); }
}
