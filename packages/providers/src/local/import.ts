import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { newId } from "@xeniur/core";
import type { Modality } from "@xeniur/core";
import type { Availability, Provider, ProviderCall, ProviderEnv, ProviderOutput, ProviderResult } from "../types.js";
import { noCost, stringArg } from "../types.js";
import { probeBlender } from "./probe.js";
import { run } from "./exec.js";

interface Kind { modality: Modality; mime: string; }

const KINDS: Record<string, Kind> = {
  png: { modality: "image", mime: "image/png" },
  jpg: { modality: "image", mime: "image/jpeg" },
  jpeg: { modality: "image", mime: "image/jpeg" },
  webp: { modality: "image", mime: "image/webp" },
  svg: { modality: "image", mime: "image/svg+xml" },
  gif: { modality: "image", mime: "image/gif" },
  glb: { modality: "mesh", mime: "model/gltf-binary" },
  gltf: { modality: "mesh", mime: "model/gltf+json" },
  stl: { modality: "mesh", mime: "model/stl" },
  obj: { modality: "mesh", mime: "model/obj" },
  blend: { modality: "data", mime: "application/x-blender" },
  mp4: { modality: "video", mime: "video/mp4" },
  mov: { modality: "video", mime: "video/quicktime" },
  webm: { modality: "video", mime: "video/webm" },
  mp3: { modality: "data", mime: "audio/mpeg" },
  wav: { modality: "data", mime: "audio/wav" },
  pdf: { modality: "data", mime: "application/pdf" },
  md: { modality: "text", mime: "text/markdown" },
  txt: { modality: "text", mime: "text/plain" },
  csv: { modality: "data", mime: "text/csv" },
  json: { modality: "data", mime: "application/json" },
  html: { modality: "text", mime: "text/html" },
};

export const kindOf = (path: string): Kind & { ext: string } => {
  const ext = extname(path).replace(/^\./, "").toLowerCase();
  return { ext, ...(KINDS[ext] ?? { modality: "data" as Modality, mime: "application/octet-stream" }) };
};

/**
 * Brings an external file in as forms of an Object.
 *
 * The original is always kept, byte for byte, as the first output — a `.blend` stays a
 * `.blend`. Anything derived from it is an extra output, so re-importing an edited source
 * changes the source form's bytes and everything built from it goes stale on its own.
 * That is the whole "edit it outside XENIUR and bring it back" loop, and it needs no
 * special case: it is ordinary content addressing doing its job.
 */
export const importProvider: Provider = {
  id: "local.import",
  kind: "deterministic",
  tools: ["import.file"],

  async available(): Promise<Availability> { return { ok: true, checkedAt: Date.now() }; },

  async execute(call: ProviderCall, env: ProviderEnv): Promise<ProviderResult> {
    const started = Date.now();
    const path = stringArg(call.args, "path");
    if (!path) throw new Error("import.file needs a `path`");

    const stat = statSync(path);
    if (!stat.isFile()) throw new Error(`not a file: ${path}`);

    const data = readFileSync(path);
    const kind = kindOf(path);
    const outputs: ProviderOutput[] = [{
      data, mime: kind.mime, ext: kind.ext, modality: kind.modality, format: kind.ext,
    }];

    // A .blend is only readable by Blender, so a viewable mesh is extracted alongside it.
    // The original still governs: the GLB is derived, and re-importing replaces the source.
    let toolVersion: string | null = null;
    if (kind.ext === "blend" && call.args["extractMesh"] !== false) {
      const probe = await probeBlender(env.binaries.blender);
      if (probe.ok) {
        toolVersion = probe.detail ?? "blender";
        const glb = await extractFromBlend(path, env);
        if (glb) {
          outputs.push({
            data: glb, mime: "model/gltf-binary", ext: "glb", modality: "mesh", format: "glb",
          });
        }
      }
    }

    // Who put this here matters for Idea DNA. A file a person went and fetched from their
    // own disk is their material — somebody modelled that rocket. Something pulled from a
    // published source is external, and is recorded as such with its attribution.
    const origin = stringArg(call.args, "origin") ?? "mine";
    return {
      outputs,
      provenance: origin === "mine" ? "human" : "imported",
      model: null,
      toolVersion,
      generationParams: {
        path, filename: basename(path), bytes: stat.size,
        sha256: createHash("sha256").update(data).digest("hex"),
        importedAt: Date.now(), extractedMesh: outputs.length > 1, origin,
      },
      cost: noCost(Date.now() - started),
    };
  },
};

async function extractFromBlend(path: string, env: ProviderEnv): Promise<Buffer | null> {
  mkdirSync(env.scratchDir, { recursive: true });
  const out = join(env.scratchDir, `blend-${newId()}.glb`);
  const script = join(env.rootDir, "blender", "xeniur_open.py");

  const { stdout } = await run(env.binaries.blender,
    ["--background", path, "--python", script, "--", out], 300_000);
  const line = stdout.split("\n").find((l) => l.startsWith("XENIUR_OPEN:"));
  if (!line) return null;

  const result = JSON.parse(line.slice("XENIUR_OPEN:".length)) as { ok: boolean; output: string };
  return result.ok ? readFileSync(result.output) : null;
}
