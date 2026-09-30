import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { sampleBridge } from "./preview/sampleWorld.js";
import "./tailwind.css";
import "./styles.css";

const root = document.getElementById("root");
// `?visual-preview=world` on localhost: the Studio against a realistic sample, without Electron.
// `?visual-preview=firstrun`: the first run, the same way.
const preview = window.location.hostname === "localhost" ? new URLSearchParams(window.location.search).get("visual-preview") : null;
if ((preview === "home" || preview === "world" || preview === "firstrun" || preview === "research") && !window.xeniur) {
  window.xeniur = sampleBridge({ firstRun: preview === "firstrun", research:preview === "research" });
}
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
