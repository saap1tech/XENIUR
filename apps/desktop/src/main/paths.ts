import { app } from "electron";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

/** Everything XENIUR owns lives under one directory, so it can be inspected or deleted. */
export function appPaths() {
  // app.setName("Xeniur") runs before this, so userData is .../Xeniur.
  const root = app.getPath("userData");
  const paths = {
    root,
    dbPath: join(root, "xeniur.db"),
    blobDir: join(root, "blobs"),
    scratchDir: join(root, "scratch"),
    // Where config/providers.json and the Blender worker live. app.getAppPath() points
    // at the built output when the entry is run directly, so search upward for the
    // marker rather than assuming a fixed depth.
    projectRoot: findProjectRoot(),
  };
  for (const dir of [paths.root, paths.blobDir, paths.scratchDir]) mkdirSync(dir, { recursive: true });
  return paths;
}

export const BINARIES = {
  ffmpeg: process.env["XENIUR_FFMPEG"] ?? "/opt/homebrew/bin/ffmpeg",
  blender: process.env["XENIUR_BLENDER"] ?? "/Applications/Blender.app/Contents/MacOS/Blender",
};

const MARKER = join("config", "providers.json");

/** Walks up from the app path looking for config/providers.json. */
function findProjectRoot(): string {
  if (app.isPackaged) return process.resourcesPath;
  const override = process.env["XENIUR_ROOT"];
  if (override && existsSync(join(override, MARKER))) return override;

  let dir = app.getAppPath();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `could not find ${MARKER} above ${app.getAppPath()} — set XENIUR_ROOT to the repo root`,
  );
}
