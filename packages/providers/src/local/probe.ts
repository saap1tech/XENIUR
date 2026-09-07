import { existsSync } from "node:fs";
import type { Availability } from "../types.js";
import { run } from "./exec.js";

const TTL_MS = 60_000;

interface Cached { at: number; result: Availability; }
const cache = new Map<string, Cached>();

/** Test seam and a way for the UI to force a re-check after installing something. */
export const clearProbeCache = (key?: string): void => {
  if (key) cache.delete(key); else cache.clear();
};

/**
 * Availability by actually running the thing.
 *
 * A file-exists check is not availability: a Blender that is present but broken, a
 * quarantined binary, or an incompatible build all pass `existsSync` and then fail at the
 * moment work is attempted — which is the worst time to find out. The probe runs the
 * binary, keeps the version string it printed, and caches briefly so a Docker that starts
 * up is noticed rather than written off forever.
 */
export async function probeBinary(
  key: string, path: string, args: string[], opts: { parse?: (stdout: string) => string } = {},
): Promise<Availability> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.result;

  let result: Availability;
  if (!existsSync(path) && !path.match(/^[\w.-]+$/)) {
    result = { ok: false, reason: `not found at ${path}`, checkedAt: Date.now() };
  } else {
    try {
      const { code, stdout, stderr } = await run(path, args, 10_000);
      if (code === 0) {
        const detail = (opts.parse ?? ((s: string) => s.split("\n")[0]?.trim() ?? ""))(stdout);
        result = { ok: true, detail, checkedAt: Date.now() };
      } else {
        const why = (stderr || stdout).trim().split("\n")[0] ?? `exit ${code}`;
        result = { ok: false, reason: `present but not runnable: ${why}`, checkedAt: Date.now() };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = {
        ok: false,
        reason: message.includes("ENOENT") ? `not found at ${path}` : `could not run: ${message}`,
        checkedAt: Date.now(),
      };
    }
  }
  cache.set(key, { at: Date.now(), result });
  return result;
}

export const probeBlender = (path: string): Promise<Availability> =>
  probeBinary(`blender:${path}`, path, ["--version"], {
    parse: (s) => s.split("\n").find((l) => l.startsWith("Blender"))?.trim() ?? "Blender",
  });

export const probeFfmpeg = (path: string): Promise<Availability> =>
  probeBinary(`ffmpeg:${path}`, path, ["-version"]);

export const probeDocker = (): Promise<Availability> =>
  probeBinary("docker", "docker", ["version", "--format", "{{.Server.Version}}"]);
