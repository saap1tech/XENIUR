import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const pkgs = [
  "core", "graph", "tasks", "permissions", "sessions", "validators", "sensemaking",
  "providers", "router", "brain", "hands", "ui",
] as const;

// Absolute, so it does not shift with each target's `root`. Passing --outDir on the
// CLI instead resolves it relative to the renderer root and buries the build inside src/.
const outDir = (target: string) =>
  fileURLToPath(new URL(`./out/${target}`, import.meta.url));

const alias = Object.fromEntries(
  pkgs.map((p) => [
    `@xeniur/${p}`,
    fileURLToPath(new URL(`../../packages/${p}/src/index.ts`, import.meta.url)),
  ]),
);

export default defineConfig({
  main: {
    // better-sqlite3, sharp and playwright are native or spawn binaries; they must stay
    // external and load from node_modules rather than be bundled into the main process.
    plugins: [externalizeDepsPlugin({ exclude: [] })],
    resolve: { alias },
    build: {
      outDir: outDir("main"),
      rollupOptions: { input: fileURLToPath(new URL("./src/main/index.ts", import.meta.url)) },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: {
      outDir: outDir("preload"),
      rollupOptions: {
        input: fileURLToPath(new URL("./src/preload/index.ts", import.meta.url)),
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: fileURLToPath(new URL("./src/renderer", import.meta.url)),
    plugins: [react()],
    resolve: { alias },
    build: {
      outDir: outDir("renderer"),
      emptyOutDir: true,
      rollupOptions: { input: fileURLToPath(new URL("./src/renderer/index.html", import.meta.url)) },
    },
  },
});
