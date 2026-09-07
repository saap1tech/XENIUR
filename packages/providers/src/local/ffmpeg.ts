import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@xeniur/core";
import type { Provider, ProviderCall, ProviderEnv, ProviderResult, Availability } from "../types.js";
import { noCost, numberArg, requireInput, stringArg } from "../types.js";
import { run } from "./exec.js";
import { probeBlender, probeFfmpeg } from "./probe.js";

async function ffmpegVersion(bin: string): Promise<string> {
  try {
    const { stdout } = await run(bin, ["-version"], 10_000);
    return stdout.split("\n")[0]?.trim() ?? "ffmpeg";
  } catch { return "ffmpeg"; }
}

/**
 * Trimming, concatenation, scaling, audio mixing, subtitles and export are all exact and
 * local. Generative video credit is scarce rendering capacity, not something to spend on
 * every preview and every cut.
 */
export const ffmpegProvider: Provider = {
  id: "local.ffmpeg",
  kind: "deterministic",
  tools: ["video.edit", "video.export"],

  async available(env: ProviderEnv): Promise<Availability> {
    return probeFfmpeg(env.binaries.ffmpeg);
  },

  async execute(call: ProviderCall, env: ProviderEnv): Promise<ProviderResult> {
    const started = Date.now();
    mkdirSync(env.scratchDir, { recursive: true });
    const source = requireInput(call);
    const inPath = join(env.scratchDir, `in-${newId()}.${source.format}`);
    writeFileSync(inPath, source.data);

    const format = stringArg(call.args, "format") ?? "mp4";
    const outPath = join(env.scratchDir, `out-${newId()}.${format}`);
    const args: string[] = ["-y", "-loglevel", "error"];
    const applied: Record<string, unknown> = {};

    const start = numberArg(call.args, "startSeconds");
    if (start !== undefined) { args.push("-ss", String(start)); applied["startSeconds"] = start; }
    args.push("-i", inPath);

    const duration = numberArg(call.args, "durationSeconds");
    if (duration !== undefined) { args.push("-t", String(duration)); applied["durationSeconds"] = duration; }

    const filters: string[] = [];
    const width = numberArg(call.args, "width");
    const height = numberArg(call.args, "height");
    if (width !== undefined || height !== undefined) {
      filters.push(`scale=${width ?? -2}:${height ?? -2}`);
      applied["scale"] = { width, height };
    }
    const fps = numberArg(call.args, "fps");
    if (fps !== undefined) { filters.push(`fps=${fps}`); applied["fps"] = fps; }
    if (filters.length > 0) args.push("-vf", filters.join(","));

    if (call.args["mute"] === true) { args.push("-an"); applied["mute"] = true; }
    args.push("-pix_fmt", "yuv420p", outPath);

    const { code, stderr } = await run(env.binaries.ffmpeg, args);
    if (code !== 0) throw new Error(`FFmpeg failed (${code}): ${stderr.trim().split("\n").slice(-4).join("\n")}`);

    return {
      outputs: [{ data: readFileSync(outPath), mime: `video/${format}`, ext: format, modality: "video", format }],
      provenance: "deterministic", model: null,
      toolVersion: await ffmpegVersion(env.binaries.ffmpeg),
      generationParams: applied, cost: noCost(Date.now() - started),
    };
  },
};
