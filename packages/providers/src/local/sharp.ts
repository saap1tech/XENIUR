import sharp from "sharp";
import type { Provider, ProviderCall, ProviderEnv, ProviderResult, Availability } from "../types.js";
import { noCost, numberArg, requireInput, stringArg } from "../types.js";

const VERSION = `sharp ${(sharp.versions as { vips?: string }).vips ?? "unknown"}`;

/**
 * Crop, resize, rotate, flip, recolour, composite and format conversion — all of it
 * exact, local and free. A generative image API should only be asked for pixels that
 * genuinely do not exist yet; asking one to resize a picture is the expensive way to
 * get a worse result.
 */
export const sharpProvider: Provider = {
  id: "local.sharp",
  kind: "deterministic",
  tools: ["image.transform"],

  async available(): Promise<Availability> { return { ok: true }; },

  async execute(call: ProviderCall, _env: ProviderEnv): Promise<ProviderResult> {
    const started = Date.now();
    const source = requireInput(call);
    let pipeline = sharp(source.data, { failOn: "none" });
    const applied: Record<string, unknown> = {};

    const crop = call.args["crop"];
    if (crop && typeof crop === "object") {
      const c = crop as Record<string, unknown>;
      const box = {
        left: Math.max(0, Math.round(Number(c["left"] ?? 0))),
        top: Math.max(0, Math.round(Number(c["top"] ?? 0))),
        width: Math.max(1, Math.round(Number(c["width"] ?? 1))),
        height: Math.max(1, Math.round(Number(c["height"] ?? 1))),
      };
      pipeline = pipeline.extract(box);
      applied["crop"] = box;
    }

    const width = numberArg(call.args, "width");
    const height = numberArg(call.args, "height");
    if (width !== undefined || height !== undefined) {
      const fit = stringArg(call.args, "fit") ?? "inside";
      pipeline = pipeline.resize({
        width: width ? Math.round(width) : undefined,
        height: height ? Math.round(height) : undefined,
        fit: fit as keyof sharp.FitEnum,
        withoutEnlargement: call.args["allowUpscale"] !== true,
      });
      applied["resize"] = { width, height, fit };
    }

    const rotate = numberArg(call.args, "rotate");
    if (rotate !== undefined) { pipeline = pipeline.rotate(rotate); applied["rotate"] = rotate; }
    if (call.args["flip"] === true) { pipeline = pipeline.flip(); applied["flip"] = true; }
    if (call.args["flop"] === true) { pipeline = pipeline.flop(); applied["flop"] = true; }
    if (call.args["grayscale"] === true) { pipeline = pipeline.grayscale(); applied["grayscale"] = true; }

    const tint = stringArg(call.args, "tint");
    if (tint) { pipeline = pipeline.tint(tint); applied["tint"] = tint; }

    const brightness = numberArg(call.args, "brightness");
    const saturation = numberArg(call.args, "saturation");
    if (brightness !== undefined || saturation !== undefined) {
      pipeline = pipeline.modulate({ brightness, saturation });
      applied["modulate"] = { brightness, saturation };
    }

    const overlay = call.inputs.find((i) => i.role === "mask" || i.role === "reference");
    if (overlay) {
      pipeline = pipeline.composite([{ input: overlay.data, blend: "over" }]);
      applied["composite"] = overlay.role;
    }

    const format = (stringArg(call.args, "format") ?? source.format).toLowerCase();
    switch (format) {
      case "jpg": case "jpeg": pipeline = pipeline.jpeg({ quality: numberArg(call.args, "quality") ?? 90 }); break;
      case "webp": pipeline = pipeline.webp({ quality: numberArg(call.args, "quality") ?? 90 }); break;
      default: pipeline = pipeline.png(); break;
    }

    const data = await pipeline.toBuffer();
    const ext = format === "jpeg" ? "jpg" : format;
    return {
      outputs: [{ data, mime: `image/${ext === "jpg" ? "jpeg" : ext}`, ext, modality: "image", format: ext }],
      provenance: "deterministic", model: null, toolVersion: VERSION,
      generationParams: applied, cost: noCost(Date.now() - started),
    };
  },
};
