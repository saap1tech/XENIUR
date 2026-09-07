import { z } from "zod";

/**
 * Content XENIUR read from somewhere it does not control — a web page, a file it was
 * handed, a model's echo of either. It is carried in this wrapper all the way to the
 * Brain so that no layer can lose track of the fact that it is *data*.
 *
 * The rule this type exists to enforce: text found inside untrusted content can never
 * raise a permission level, approve an action, mint a session grant, or authorise a
 * side effect. The Permission Broker enforces that; this marker is how it knows.
 */
export const UntrustedSourceSchema = z.object({
  kind: z.enum(["web_page", "file", "model_echo", "clipboard"]),
  origin: z.string(),
  fetchedAt: z.number().int().nonnegative(),
});
export type UntrustedSource = z.infer<typeof UntrustedSourceSchema>;

export const UntrustedContentSchema = z.object({
  __untrusted: z.literal(true),
  source: UntrustedSourceSchema,
  content: z.string(),
});
export type UntrustedContent = z.infer<typeof UntrustedContentSchema>;

export const untrusted = (source: UntrustedSource, content: string): UntrustedContent => ({
  __untrusted: true, source, content,
});

export const isUntrusted = (v: unknown): v is UntrustedContent =>
  typeof v === "object" && v !== null && (v as { __untrusted?: unknown }).__untrusted === true;

/**
 * Render untrusted content for a prompt with an explicit, unmistakable fence.
 * The Brain's system prompt states that anything inside this fence is quoted material
 * to be reasoned *about*, never instructions to follow.
 */
export const fenceUntrusted = (u: UntrustedContent): string =>
  [
    `<untrusted-content source="${u.source.kind}" origin="${u.source.origin}">`,
    u.content,
    `</untrusted-content>`,
  ].join("\n");
