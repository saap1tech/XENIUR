import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@xeniur/core";
import type { Provider, ProviderCall, ProviderEnv, ProviderResult, Availability } from "../types.js";
import { noCost, numberArg, requireInput, stringArg } from "../types.js";
import { run } from "./exec.js";
import { probeBlender, probeFfmpeg } from "./probe.js";

export interface BlenderJob {
  op: "generate_mesh" | "process" | "export" | "solidify" | "render" | "turntable";
  input?: string;
  output: string;
  params: Record<string, unknown>;
}

export interface BlenderResult {
  ok: boolean; op: string; output: string; blenderVersion: string;
  vertices: number; polygons: number; dimensions: [number, number, number];
}

/**
 * Runs Blender headlessly against the worker script. Scaling, cleanup, modifiers,
 * materials, cameras and GLB/STL export are exact, local and free — there is no reason
 * to pay a cloud 3D API for any of them. A generative provider should only ever be asked
 * to imagine geometry that does not exist yet.
 */
export async function runBlender(job: BlenderJob, env: ProviderEnv): Promise<BlenderResult> {
  mkdirSync(env.scratchDir, { recursive: true });
  const jobPath = join(env.scratchDir, `job-${newId()}.json`);
  writeFileSync(jobPath, JSON.stringify(job));

  const worker = join(env.rootDir, "blender", "xeniur_worker.py");
  const { code, stdout, stderr } = await run(
    env.binaries.blender, ["--background", "--python", worker, "--", jobPath],
  );

  const line = stdout.split("\n").find((l) => l.startsWith("XENIUR_RESULT:"));
  if (!line) {
    const detail = (stderr || stdout).trim().split("\n").slice(-8).join("\n");
    throw new Error(`Blender produced no result (exit ${code}):\n${detail}`);
  }
  return JSON.parse(line.slice("XENIUR_RESULT:".length)) as BlenderResult;
}

const version = (r: BlenderResult): string => `blender ${r.blenderVersion}`;

export const blenderProvider: Provider = {
  id: "local.blender",
  kind: "deterministic",
  tools: ["3d.process", "3d.export", "3d.solidify", "3d.render", "3d.turntable"],

  async available(env: ProviderEnv): Promise<Availability> {
    return probeBlender(env.binaries.blender);
  },

  async execute(call: ProviderCall, env: ProviderEnv): Promise<ProviderResult> {
    const started = Date.now();
    const source = requireInput(call);
    mkdirSync(env.scratchDir, { recursive: true });
    const inPath = join(env.scratchDir, `in-${newId()}.${source.format}`);
    writeFileSync(inPath, source.data);

    const params: Record<string, unknown> = {};
    for (const key of ["scale", "targetHeight", "mergeDistance", "width", "height", "frames",
                       "cameraDistance", "keyLight", "fillLight", "fps"]) {
      const v = numberArg(call.args, key);
      if (v !== undefined) params[key] = v;
    }
    if (call.args["shadeSmooth"] === true) params["shadeSmooth"] = true;
    if (call.args["transparent"] === true) params["transparent"] = true;
    if (Array.isArray(call.args["color"])) params["color"] = call.args["color"];
    const engine = stringArg(call.args, "engine");
    if (engine) params["engine"] = engine;

    /* A still: Blender renders straight to PNG. */
    if (call.tool === "3d.render") {
      const outPath = join(env.scratchDir, `render-${newId()}.png`);
      const result = await runBlender({ op: "render", input: inPath, output: outPath, params }, env);
      return {
        outputs: [{ data: readFileSync(outPath), mime: "image/png", ext: "png", modality: "image", format: "png" }],
        provenance: "deterministic", model: null, toolVersion: version(result),
        generationParams: { ...params, engine: (result as unknown as { engine?: string }).engine },
        cost: noCost(Date.now() - started),
      };
    }

    /* A turntable: Blender renders the frames, FFmpeg assembles them. Both are recorded
       in the tool version, because either changing would change the output. */
    if (call.tool === "3d.turntable") {
      const frameDir = join(env.scratchDir, `frames-${newId()}`);
      const result = await runBlender({ op: "turntable", input: inPath, output: frameDir, params }, env);
      const outPath = join(env.scratchDir, `turntable-${newId()}.mp4`);
      const fps = numberArg(call.args, "fps") ?? 24;

      const { code, stderr } = await run(env.binaries.ffmpeg, [
        "-y", "-loglevel", "error", "-framerate", String(fps),
        "-i", join(frameDir, "frame_%04d.png"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath,
      ]);
      if (code !== 0) throw new Error(`assembling the turntable failed: ${stderr.trim().split("\n").slice(-3).join("\n")}`);

      return {
        outputs: [{ data: readFileSync(outPath), mime: "video/mp4", ext: "mp4", modality: "video", format: "mp4" }],
        provenance: "deterministic", model: null,
        toolVersion: `${version(result)} + ${await ffmpegVersion(env.binaries.ffmpeg)}`,
        generationParams: { ...params, fps, frames: (result as unknown as { frames?: number }).frames },
        cost: noCost(Date.now() - started),
      };
    }

    /* Geometry out: process, solidify or export. */
    const format = call.tool === "3d.export" ? (stringArg(call.args, "format") ?? "stl") : "glb";
    const outPath = join(env.scratchDir, `out-${newId()}.${format}`);
    const op = call.tool === "3d.export" ? "export" : call.tool === "3d.solidify" ? "solidify" : "process";

    const result = await runBlender({ op, input: inPath, output: outPath, params }, env);
    return {
      outputs: [{
        data: readFileSync(outPath),
        mime: format === "stl" ? "model/stl" : "model/gltf-binary",
        ext: format, modality: "mesh", format,
      }],
      provenance: "deterministic", model: null, toolVersion: version(result),
      generationParams: {
        ...params, vertices: result.vertices, polygons: result.polygons, dimensions: result.dimensions,
      },
      cost: noCost(Date.now() - started),
    };
  },
};

async function ffmpegVersion(bin: string): Promise<string> {
  try {
    const { stdout } = await run(bin, ["-version"], 10_000);
    return stdout.split("\n")[0]?.trim().split(" ").slice(0, 3).join(" ") ?? "ffmpeg";
  } catch { return "ffmpeg"; }
}
