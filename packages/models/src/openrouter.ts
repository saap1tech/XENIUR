import { ModelEntrySchema, type ModelEntry } from "./registry.js";

/** Public catalogue is discovery, not key verification. /key must succeed separately. */
export function routerTextModels(body: unknown, date: string): ModelEntry[] {
  const rows = (body as any)?.data;
  if (!Array.isArray(rows)) throw new Error("OpenRouter's model list could not be read.");
  return rows.flatMap((row: any) => {
    const prompt = Number(row.pricing?.prompt), completion = Number(row.pricing?.completion);
    if (!row.architecture?.output_modalities?.includes("text") || !Number.isFinite(prompt) || prompt < 0 ||
      !Number.isFinite(completion) || completion < 0 || !row.context_length || !row.id) return [];
    // Auxiliary request, image and mandatory tool prices cannot masquerade as token-only pricing.
    if (Object.entries(row.pricing ?? {}).some(([k,v]) => !["prompt","completion","input_cache_read","input_cache_write","discount"].includes(k) && Number(v) > 0)) return [];
    const entry = ModelEntrySchema.safeParse({ id: `openrouter:${row.id}`, provider: "openrouter", model: row.id,
      label: row.name ?? row.id, contextWindow: row.context_length, output: "text", modelVerified: true,
      tags: [/sonnet|pro|gpt-5|gpt-4\.1$|deepseek.*v3/i.test(row.id) ? "strong" : "fast"],
      price: { inputPerMTok: prompt * 1_000_000, outputPerMTok: completion * 1_000_000, currency: "USD", verifiedOn: date } });
    return entry.success ? [entry.data] : [];
  });
}
export function routerImageModel(model: any, body: unknown, date: string): ModelEntry | null {
  const root = (body as any)?.data ?? body;
  const endpoints = Array.isArray(root) ? root : root?.endpoints;
  if (!Array.isArray(endpoints)) return null;
  const options = endpoints.flatMap((endpoint: any) => {
    const lines = endpoint.pricing;
    if (!Array.isArray(lines) || !endpoint.provider_tag) return [];
    const formats=endpoint.supported_parameters?.output_format;
    if(formats?.type==="enum" && (!Array.isArray(formats.values) || !formats.values.includes("png")))return [];
    const count=endpoint.supported_parameters?.n;
    if(count?.type==="range" && (count.min>1 || count.max<1))return [];
    const output = lines.find((line: any) => line.billable === "output_image" && line.unit === "image" && !line.variant);
    if (!output || !Number.isFinite(Number(output.cost_usd)) || Number(output.cost_usd) < 0) return [];
    if (lines.some((line: any) => line !== output && Number(line.cost_usd) > 0)) return [];
    return [{ endpoint, price: Number(output.cost_usd) }];
  }).sort((a,b)=>a.price-b.price);
  const option = options[0]; if (!option) return null;
  const result = ModelEntrySchema.safeParse({ id: `openrouter:image:${model.id}`, provider: "openrouter", model: model.id,
    label: model.name ?? model.id, contextWindow: 8192, tags: ["vision"], output: "image", modelVerified: true,
    imagePriceUsd: option.price, imageProvider: option.endpoint.provider_tag,
    imageParameters: option.endpoint.supported_parameters ?? {},
    price: { inputPerMTok: 0, outputPerMTok: 0, currency: "USD", verifiedOn: date } });
  return result.success ? result.data : null;
}
export function recommendRouterModels(models: ModelEntry[]): string[] {
  const text = models.filter(m=>m.output !== "image");
  const preferred = ["google/gemini-2.5-flash", "openai/gpt-4.1-mini", "anthropic/claude-sonnet-4.5", "anthropic/claude-sonnet-4"];
  const chosen = preferred.map(id=>text.find(m=>m.model === id)).filter((m): m is ModelEntry => !!m).slice(0,2);
  if (!chosen.length && text[0]) chosen.push([...text].sort((a,b)=>a.price.outputPerMTok-b.price.outputPerMTok)[0]!);
  const image = models.filter(m=>m.output === "image").sort((a,b)=>a.imagePriceUsd!-b.imagePriceUsd!)[0];
  return [...chosen.map(m=>m.id), ...(image ? [image.id] : [])];
}
