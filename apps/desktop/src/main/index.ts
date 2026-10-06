import { app, BrowserWindow, nativeImage, session as electronSession } from "electron";
import { join, dirname, isAbsolute } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TEMPLATES, applyTemplate } from "@xeniur/graph";
import { createServices, type Services } from "./services.js";
import { registerIpc } from "./ipc.js";
import { registerTrustedRenderer } from "./security.js";
import { registerPreviewScheme } from "./preview.js";
import { registerBlobScheme, installBlobProtocol } from "./blobs.js";
import { appPaths } from "./paths.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env["ELECTRON_RENDERER_URL"];

// The app owns one named directory. Without this the userData path falls back to
// "Electron" whenever the entry is run directly rather than from a packaged bundle.
app.setName("Xeniur");
// An explicit local override lets testers and contributors use a disposable profile.
const dataDir=process.env["XENIUR_DATA_DIR"];
if(dataDir){if(!isAbsolute(dataDir))throw new Error("XENIUR_DATA_DIR must be an absolute path.");mkdirSync(dataDir,{recursive:true});app.setPath("userData",dataDir);}

// Custom schemes must be declared privileged before the app is ready.
registerPreviewScheme();
registerBlobScheme();

let services: Services | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360, height: 900, minWidth: 960, minHeight: 640,
    backgroundColor: "#f3f2ec",
    icon: join(appPaths().projectRoot,"brand/icons/icon.png"),
    titleBarStyle: "hiddenInset",
    show: false,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      // XENIUR's own interface is still sandboxed with node integration off. It reaches
      // the main process only through the explicit bridge in the preload.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  window.once("ready-to-show", () => window.show());

  // XENIUR's own renderer never loads remote content, and may not navigate away from
  // itself. If something tries, that is a bug or an attack, not a feature.
  window.webContents.on("will-navigate", (event, url) => {
    const allowed = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (DEV_URL) {
    void window.loadURL(DEV_URL);
    registerTrustedRenderer(window.webContents, (url) => url.startsWith(DEV_URL), DEV_URL);
  } else {
    const file = join(here, "../renderer/index.html");
    const href = pathToFileURL(file).href;
    void window.loadFile(file);
    // Compared as a URL prefix rather than an origin: a file:// URL has the origin
    // "null", so an origin check would refuse XENIUR's own renderer in production.
    registerTrustedRenderer(window.webContents, (url) => url.split("#")[0]?.split("?")[0] === href, href);
  }
  return window;
}

app.whenReady().then(() => {
  app.dock?.setIcon(nativeImage.createFromPath(join(appPaths().projectRoot,"brand/icons/icon.png")));
  // Deny device permissions in the default session too, not only in browsing partitions.
  electronSession.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));

  const window = createWindow();
  services = createServices(window);
  installBlobProtocol(services.graph);
  services.preview.install();
  registerIpc(services);

  seedIfEmpty(services);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  console.error("XENIUR failed to start:", err);
  app.quit();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { void services?.dispose(); });

/**
 * First run sets up the four templates, each with the Object its pipeline is waiting for.
 *
 * Nothing is invented: every World says what it expects you to bring, because a first run
 * full of fabricated content teaches the wrong thing about what XENIUR is for.
 */
function seedIfEmpty(s: Services): void {
  if (s.graph.listWorlds().length > 0) return;
  for (const template of TEMPLATES) {
    applyTemplate(s.graph, template.id);
  }
  // Somewhere to put what you read, which needs no pipeline at all.
  s.graph.createWorld({
    title: "Reading", emoji: "🧠",
    summary: "Everything you consume, kept as connected ideas rather than history.",
  });
}
