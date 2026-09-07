import sharp from "sharp";
import type { CheckResult, Validator, ValidationSubject } from "./types.js";

const imageSubject = (s: ValidationSubject): boolean => s.representation.modality === "image";

const metadataFor = async (subject: ValidationSubject) => sharp(subject.bytes()).metadata();

export const imageDimensions: Validator = {
  id: "image.dimensions",
  appliesTo: imageSubject,
  async run(subject): Promise<CheckResult> {
    const m = await metadataFor(subject);
    const width = m.width ?? 0, height = m.height ?? 0;
    return {
      status: width > 0 && height > 0 ? "pass" : "fail",
      summary: width > 0 ? `${width} x ${height}` : "no readable dimensions",
      detail: { width, height, megapixels: Number(((width * height) / 1e6).toFixed(2)) },
    };
  },
};

/**
 * DPI matters for anything printed, and an image that never declared it is not the same
 * as one that declared 72 — so the density is reported alongside whether it was stated.
 */
export const imageDensity: Validator = {
  id: "image.density",
  appliesTo: imageSubject,
  async run(subject): Promise<CheckResult> {
    const m = await metadataFor(subject);
    const density = m.density ?? null;
    return {
      status: "pass",
      summary: density ? `${density} dpi` : "no density recorded in the file",
      detail: { density, stated: density !== null },
    };
  },
};

export const imageFilesize: Validator = {
  id: "image.filesize",
  appliesTo: imageSubject,
  async run(subject): Promise<CheckResult> {
    const bytes = subject.bytes().byteLength;
    return {
      status: "pass",
      summary: `${(bytes / 1024).toFixed(0)} KB`,
      detail: { bytes, kilobytes: Number((bytes / 1024).toFixed(1)) },
    };
  },
};

export const imageAlpha: Validator = {
  id: "image.alpha",
  appliesTo: imageSubject,
  async run(subject): Promise<CheckResult> {
    const m = await metadataFor(subject);
    return {
      status: "pass",
      summary: m.hasAlpha ? "has transparency" : "fully opaque",
      detail: { hasAlpha: Boolean(m.hasAlpha), channels: m.channels ?? 0, space: m.space ?? "unknown" },
    };
  },
};

const relativeLuminance = (r: number, g: number, b: number): number => {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

/**
 * Contrast between the image's darkest and lightest regions, as the WCAG ratio.
 *
 * This is a real measurement of the picture, not a claim about legibility — text drawn
 * over it could still be unreadable. It answers "is this flat?", which is the failure a
 * retail or presentation asset actually suffers from.
 */
export const imageContrast: Validator = {
  id: "image.contrast",
  appliesTo: imageSubject,
  async run(subject): Promise<CheckResult> {
    const { data, info } = await sharp(subject.bytes())
      .removeAlpha().resize(64, 64, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });

    let min = 1, max = 0;
    for (let i = 0; i + info.channels - 1 < data.length; i += info.channels) {
      const l = relativeLuminance(data[i]!, data[i + 1] ?? data[i]!, data[i + 2] ?? data[i]!);
      if (l < min) min = l;
      if (l > max) max = l;
    }
    const ratio = (max + 0.05) / (min + 0.05);
    return {
      status: ratio >= 3 ? "pass" : "warn",
      summary: `contrast ratio ${ratio.toFixed(1)}:1${ratio < 3 ? " — this will look flat" : ""}`,
      detail: { ratio: Number(ratio.toFixed(2)), minLuminance: Number(min.toFixed(4)), maxLuminance: Number(max.toFixed(4)) },
    };
  },
};

export const imageValidators: readonly Validator[] = [
  imageDimensions, imageDensity, imageFilesize, imageAlpha, imageContrast,
];
