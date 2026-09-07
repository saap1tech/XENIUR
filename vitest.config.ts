import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pkgs = [
  "core", "graph", "tasks", "permissions", "sessions", "validators", "sensemaking",
  "providers", "router", "brain", "hands", "ui",
] as const;

const alias = Object.fromEntries(
  pkgs.map((p) => [
    `@xeniur/${p}`,
    fileURLToPath(new URL(`./packages/${p}/src/index.ts`, import.meta.url)),
  ]),
);

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["packages/**/*.test.ts", "packages/**/*.test.tsx", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
    // The desktop tests import from src directly; electron itself is never loaded.
    server: { deps: { inline: [/@xeniur\//] } },
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
  },
});
