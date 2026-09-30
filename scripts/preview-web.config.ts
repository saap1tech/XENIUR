import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// This preview runs the real renderer with explicitly selected localhost sample data.
// Open /?visual-preview=home, /?visual-preview=world, or /?visual-preview=firstrun.
const root = fileURLToPath(new URL("../", import.meta.url));
const packages = ["core", "graph", "tasks", "permissions", "sessions", "validators", "sensemaking", "providers", "router", "brain", "hands", "ui", "grammar", "models", "capabilities"];
export default defineConfig({
  root: `${root}apps/desktop/src/renderer`,
  plugins: [react()],
  resolve: { alias: Object.fromEntries(packages.map((p) => [`@xeniur/${p}`, `${root}packages/${p}/src/index.ts`])) },
  server: { host: "localhost", port: 5180, strictPort: true, fs: { allow: [root] } },
});
