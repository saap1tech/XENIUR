import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Provider, ProviderCall, ProviderResult, Availability } from "../types.js";
import { noCost, numberArg, stringArg } from "../types.js";

const PALETTE = ["#f4b73f", "#e2542c", "#3b7dd8", "#48a97a", "#8c5bd8", "#d94f8a"];

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/**
 * Stands in for a generative image API with no key and no cost.
 *
 * It produces a real PNG — deterministic from the prompt, so the same intent yields the
 * same picture and transformations downstream are reproducible. It is also unmistakably
 * synthetic, and every representation it makes is stamped provenance "mock". Nothing it
 * returns is ever presented as model output.
 */
export const mockImageProvider: Provider = {
  id: "mock.image",
  kind: "mock",
  tools: ["image.generate"],

  async available(): Promise<Availability> { return { ok: true }; },

  async execute(call: ProviderCall): Promise<ProviderResult> {
    const started = Date.now();
    const prompt = stringArg(call.args, "prompt") ?? "untitled";
    const width = Math.round(numberArg(call.args, "width") ?? 768);
    const height = Math.round(numberArg(call.args, "height") ?? 768);

    // Deterministic: identical prompts produce identical bytes.
    const digest = createHash("sha256").update(prompt).digest();
    const pick = (i: number) => PALETTE[digest[i]! % PALETTE.length]!;
    const [fg, bg, accent] = [pick(0), pick(1), pick(2)];
    const cx = width / 2, cy = height / 2;
    const r = Math.min(width, height) * (0.18 + (digest[3]! / 255) * 0.14);
    const label = prompt.length > 42 ? `${prompt.slice(0, 41)}…` : prompt;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="${bg}" opacity="0.18"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fg}"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 1.45}" fill="none" stroke="${accent}" stroke-width="${Math.max(2, r * 0.06)}" opacity="0.6"/>
      <text x="${cx}" y="${cy + r * 2.1}" font-family="ui-sans-serif,Helvetica,Arial" font-size="${Math.max(12, width * 0.035)}" fill="#111" text-anchor="middle">${escapeXml(label)}</text>
      <text x="${width - 12}" y="${height - 14}" font-family="ui-monospace,Menlo,monospace" font-size="${Math.max(10, width * 0.022)}" fill="#111" opacity="0.75" text-anchor="end">MOCK · not generated</text>
    </svg>`;

    const data = await sharp(Buffer.from(svg)).png().toBuffer();
    return {
      outputs: [{ data, mime: "image/png", ext: "png", modality: "image", format: "png" }],
      provenance: "mock", model: "mock.image/v1", toolVersion: "xeniur mock 0.1.0",
      generationParams: { prompt, width, height, deterministic: true },
      cost: noCost(Date.now() - started),
    };
  },
};
