import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@xeniur/core";
import type { Provider, ProviderCall, ProviderEnv, ProviderResult, Availability } from "../types.js";
import { probeFfmpeg } from "../local/probe.js";
import { noCost, numberArg, stringArg } from "../types.js";
import { run } from "../local/exec.js";

/** Stands in for a generative video API using an FFmpeg test source. Always stamped mock. */
export const mockVideoProvider: Provider = {
  id: "mock.video",
  kind: "mock",
  tools: ["video.generate"],

  async available(env: ProviderEnv): Promise<Availability> {
    const state = await probeFfmpeg(env.binaries.ffmpeg);
    return state.ok ? state : { ...state, reason: `mock video needs FFmpeg — ${state.reason}` };
  },

  async execute(call: ProviderCall, env: ProviderEnv): Promise<ProviderResult> {
    const started = Date.now();
    mkdirSync(env.scratchDir, { recursive: true });
    const prompt = stringArg(call.args, "prompt") ?? "clip";
    const seconds = numberArg(call.args, "durationSeconds") ?? 3;
    const width = Math.round(numberArg(call.args, "width") ?? 640);
    const height = Math.round(numberArg(call.args, "height") ?? 360);
    const outPath = join(env.scratchDir, `video-${newId()}.mp4`);

    const { code, stderr } = await run(env.binaries.ffmpeg, [
      "-y", "-loglevel", "error",
      "-f", "lavfi", "-i", `testsrc=size=${width}x${height}:rate=24:duration=${seconds}`,
      "-pix_fmt", "yuv420p", outPath,
    ]);
    if (code !== 0) throw new Error(`mock video generation failed: ${stderr.trim()}`);

    return {
      outputs: [{ data: readFileSync(outPath), mime: "video/mp4", ext: "mp4", modality: "video", format: "mp4" }],
      provenance: "mock", model: "mock.video/v1", toolVersion: "xeniur mock 0.1.0",
      generationParams: { prompt, seconds, width, height },
      cost: noCost(Date.now() - started),
    };
  },
};
