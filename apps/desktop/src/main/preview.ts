import { protocol, session as electronSession, WebContentsView, BrowserWindow } from "electron";
import { newId, type Rect } from "@xeniur/core";
import { parseProject, type VirtualProject } from "@xeniur/providers";
import { lockDownSession } from "./security.js";

export const PREVIEW_SCHEME = "xeniur-preview";
const PARTITION = "persist:web:preview";

/** Registered before app ready: a standard, secure scheme with its own origin. */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: PREVIEW_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false },
  }]);
}

const MIME: Record<string, string> = {
  html: "text/html", css: "text/css", js: "text/javascript", json: "application/json",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", txt: "text/plain",
};

/**
 * Runs model-generated code.
 *
 * Generated code never executes in a privileged process. It is served from the Object's
 * virtual filesystem over its own scheme into a sandboxed view with no preload, no node,
 * no bridge and no network — so the worst a generated app can do is be a bad web page.
 */
export class PreviewRuntime {
  private readonly projects = new Map<string, VirtualProject>();
  private readonly views = new Map<string, { viewId: string; objectId: string; view: WebContentsView }>();

  constructor(private readonly window: BrowserWindow) {}

  /** Called once the app is ready, after the scheme has been registered as privileged. */
  install(): void {
    const session = electronSession.fromPartition(PARTITION);
    lockDownSession(session);

    session.protocol.handle(PREVIEW_SCHEME, (request) => {
      const url = new URL(request.url);
      const objectId = url.hostname;
      const project = this.projects.get(objectId);
      if (!project) return new Response("not found", { status: 404 });

      const path = decodeURIComponent(url.pathname.replace(/^\//, "")) || project.entry;
      const contents = project.files[path];
      if (contents === undefined) return new Response("not found", { status: 404 });

      const ext = path.split(".").pop()?.toLowerCase() ?? "txt";
      return new Response(contents, {
        status: 200,
        headers: {
          "content-type": `${MIME[ext] ?? "text/plain"}; charset=utf-8`,
          // Generated code gets no network of its own. It renders; it does not phone out.
          "content-security-policy":
            "default-src 'self' 'unsafe-inline'; connect-src 'none'; " +
            "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'",
        },
      });
    });

    // Nothing else may reach this scheme.
    }

  load(objectId: string, projectJson: Buffer): void {
    this.projects.set(objectId, parseProject(projectJson));
  }

  run(objectId: string): { viewId: string } {
    this.stop(objectId);
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        webSecurity: true, webviewTag: false, partition: PARTITION,
      },
    });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(`${PREVIEW_SCHEME}://${objectId}`)) event.preventDefault();
    });

    const viewId = newId();
    this.views.set(objectId, { viewId, objectId, view });
    this.window.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    void view.webContents.loadURL(`${PREVIEW_SCHEME}://${objectId}/`);
    return { viewId };
  }

  setBounds(objectId: string, rect: Rect): void {
    this.views.get(objectId)?.view.setBounds({
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)),
    });
  }

  stop(objectId: string): void {
    const entry = this.views.get(objectId);
    if (!entry) return;
    this.window.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    this.views.delete(objectId);
  }

  files(objectId: string): Record<string, string> {
    return this.projects.get(objectId)?.files ?? {};
  }

  stopAll(): void { for (const id of [...this.views.keys()]) this.stop(id); }
}
