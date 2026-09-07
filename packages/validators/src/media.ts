import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@xeniur/core";
import type { ProviderEnv } from "@xeniur/providers";
import { run } from "@xeniur/providers";
import type { CheckResult, Validator, ValidationSubject } from "./types.js";

interface Probe {
  durationSeconds: number; width: number; height: number;
  fps: number; codec: string; bitrate: number; hasAudio: boolean;
}

/** ffprobe lives beside ffmpeg; deriving the path avoids a second config entry. */
const ffprobeFor = (ffmpeg: string): string => ffmpeg.replace(/ffmpeg$/, "ffprobe");

async function probe(subject: ValidationSubject, env: ProviderEnv): Promise<Probe | null> {
  mkdirSync(env.scratchDir, { recursive: true });
  const path = join(env.scratchDir, `probe-${newId()}.${subject.representation.format}`);
  writeFileSync(path, subject.bytes());

  const { code, stdout } = await run(ffprobeFor(env.binaries.ffmpeg),
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path], 60_000);
  if (code !== 0) return null;

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{
      codec_type?: string; codec_name?: string; width?: number; height?: number;
      avg_frame_rate?: string;
    }>;
  };
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  const [num, den] = (video?.avg_frame_rate ?? "0/1").split("/").map(Number);

  return {
    durationSeconds: Number(parsed.format?.duration ?? 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: den && den !== 0 ? Number(((num ?? 0) / den).toFixed(3)) : 0,
    codec: video?.codec_name ?? "unknown",
    bitrate: Number(parsed.format?.bit_rate ?? 0),
    hasAudio: (parsed.streams ?? []).some((s) => s.codec_type === "audio"),
  };
}

const cache = new WeakMap<object, Promise<Probe | null>>();
const probeFor = (subject: ValidationSubject, env: ProviderEnv): Promise<Probe | null> => {
  const key = subject.representation as unknown as object;
  let pending = cache.get(key);
  if (!pending) { pending = probe(subject, env); cache.set(key, pending); }
  return pending;
};

const videoValidator = (id: string, decide: (p: Probe) => CheckResult): Validator => ({
  id,
  appliesTo: (s) => s.representation.modality === "video",
  async run(subject, env) {
    const p = await probeFor(subject, env);
    if (!p) return { status: "fail", summary: "ffprobe could not read this file", detail: {} };
    return decide(p);
  },
});

export const videoDuration = videoValidator("video.duration", (p) => ({
  status: p.durationSeconds > 0 ? "pass" : "fail",
  summary: p.durationSeconds > 0 ? `${p.durationSeconds.toFixed(2)}s` : "zero-length video",
  detail: { seconds: Number(p.durationSeconds.toFixed(3)) },
}));

export const videoResolution = videoValidator("video.resolution", (p) => ({
  status: p.width > 0 && p.height > 0 ? "pass" : "fail",
  summary: p.width > 0 ? `${p.width} x ${p.height} at ${p.fps} fps` : "no video stream",
  detail: { width: p.width, height: p.height, fps: p.fps },
}));

export const videoEncoding = videoValidator("video.encoding", (p) => ({
  // h264 in mp4 is what plays everywhere; anything else is worth knowing about, not failing.
  status: p.codec === "h264" ? "pass" : "warn",
  summary: `${p.codec}${p.codec === "h264" ? "" : " — this will not play everywhere"}`,
  detail: { codec: p.codec, bitrate: p.bitrate, hasAudio: p.hasAudio },
}));

export const mediaValidators: readonly Validator[] = [
  videoDuration, videoResolution, videoEncoding,
];
