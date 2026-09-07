/**
 * better-sqlite3 and sharp are native. Node and Electron have different ABIs, so a build
 * for one cannot be loaded by the other: rebuilding for Electron breaks `vitest`, and
 * rebuilding for Node breaks the app. Both are correct; they just cannot both be current.
 *
 * This records which ABI the tree is currently built for and rebuilds only when the
 * target actually changes, so neither the test loop nor the dev loop pays for it twice.
 *
 *   node scripts/ensure-abi.mjs node|electron
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Every npm script routes through here, so this is where the engine requirement gets
// enforced. package.json declares node >=22, but a declaration nothing checks is just a
// comment: under Node 18 the first failure is "globalThis.crypto.randomUUID is
// unavailable" from six frames deep, which tells you nothing about the actual problem.
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(
    `\n[xeniur] Node ${process.versions.node} is too old — XENIUR needs Node 22 or newer.\n` +
    `         Run:  source ~/.nvm/nvm.sh && nvm use 22\n`,
  );
  process.exit(1);
}

const MARKER = join(process.cwd(), "node_modules", ".xeniur-abi");
const MODULES = ["better-sqlite3", "sharp"];

/**
 * The marker records the *ABI*, not just "node" or "electron". Recording only the target
 * meant a rebuild under one Node version satisfied the check under another, and the next
 * run failed with NODE_MODULE_VERSION mismatch — the exact error the marker exists to
 * prevent. Node reports its ABI directly; Electron's is pinned by its version.
 */
function abiFor(target) {
  if (target === "node") return `node-${process.versions.modules}`;
  try {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), "node_modules", "electron", "package.json"), "utf8"),
    );
    return `electron-${pkg.version}`;
  } catch {
    return "electron-unknown";
  }
}

const target = process.argv[2];
if (target !== "node" && target !== "electron") {
  console.error("usage: ensure-abi.mjs node|electron");
  process.exit(1);
}

const wanted = abiFor(target);
const current = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : "";
if (current === wanted) process.exit(0);

console.log(`[xeniur] native modules are built for ${current || "an unknown ABI"}; rebuilding for ${wanted}…`);
try {
  if (target === "electron") {
    execFileSync("npx", ["electron-rebuild", "-f", "-w", MODULES.join(",")], { stdio: "inherit" });
  } else {
    execFileSync("npm", ["rebuild", ...MODULES], { stdio: "inherit" });
  }
  writeFileSync(MARKER, wanted);
  console.log(`[xeniur] native modules now built for ${wanted}.`);
} catch (err) {
  console.error(`[xeniur] rebuild for ${target} failed.`, err instanceof Error ? err.message : err);
  process.exit(1);
}
