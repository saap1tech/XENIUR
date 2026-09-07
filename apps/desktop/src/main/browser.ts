import { BrowserWindow, WebContentsView, session as electronSession, shell } from "electron";
import { newId, type Rect } from "@xeniur/core";
import { lockDownSession } from "./security.js";

const PARTITION = "persist:web:default";

/**
 * Hosts remote pages in isolated views.
 *
 * Every website XENIUR shows runs with node integration off, context isolation on, the
 * process sandbox on, its own browsing partition, no preload at all, and every device
 * permission denied. A page cannot reach XENIUR's filesystem, models, credentials or
 * tools, because there is nothing bridged into it to reach them through.
 */
export class BrowserShell {
  private readonly views = new Map<string, WebContentsView>();

  constructor(private readonly window: BrowserWindow) {
    lockDownSession(electronSession.fromPartition(PARTITION));
  }

  open(url: string): { viewId: string } {
    const view = new WebContentsView({
      webPreferences: {
        // No preload: the page has no bridge, so window.xeniur does not exist there.
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        partition: PARTITION,
      },
    });

    const contents = view.webContents;

    // A page may not spawn XENIUR windows. Genuinely wanted links go to the real browser,
    // which is the person's own environment rather than ours.
    contents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:$/.test(safeProtocol(target))) void shell.openExternal(target);
      return { action: "deny" };
    });

    // Keep the view on the web. A file:// or custom-scheme navigation is how an isolated
    // view stops being isolated.
    contents.on("will-navigate", (event, target) => {
      if (!/^https?:$/.test(safeProtocol(target))) event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());

    const viewId = newId();
    this.views.set(viewId, view);
    this.window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    void contents.loadURL(url);
    return { viewId };
  }

  navigate(viewId: string, url: string): void {
    if (/^https?:$/.test(safeProtocol(url))) void this.views.get(viewId)?.webContents.loadURL(url);
  }

  /** The renderer reports where the slot is; the view is positioned over it. */
  setBounds(viewId: string, rect: Rect): void {
    this.views.get(viewId)?.setBounds({
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)),
    });
  }

  close(viewId: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.window.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(viewId);
  }

  closeAll(): void { for (const id of [...this.views.keys()]) this.close(id); }
}

function safeProtocol(url: string): string {
  try { return new URL(url).protocol; } catch { return ""; }
}
