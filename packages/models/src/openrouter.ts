import { ModelEntrySchema, type ModelEntry } from "./registry.js";

/** Public catalogue is discovery, not key verification. /key must succeed separately. */
export function routerTextModels(body: unknown, date: string): ModelEntry[] {
  const rows = (body as any)?.data;
  if (!Array.isArray(rows)) throw new Error("OpenRouter's model list could not be read.");
  return rows.flatMap((row: any) => {
    const prompt = Number(row.pricing?.prompt), completion = Number(row.pricing?.completion);
    // A writing model answers in text only; one that also makes sound or pictures belongs elsewhere.
    const outputs: unknown[] = row.architecture?.output_modalities ?? [];
    if (outputs.some((o) => o === "audio" || o === "image")) return [];
    if (!outputs.includes("text") || !Number.isFinite(prompt) || prompt < 0 ||
      !Number.isFinite(completion) || completion < 0 || !row.context_length || !row.id) return [];
    // Auxiliary request, image and mandatory tool prices cannot masquerade as token-only pricing.
    if (Object.entries(row.pricing ?? {}).some(([k,v]) => !["prompt","completion","input_cache_read","input_cache_write","discount"].includes(k) && Number(v) > 0)) return [];
    const entry = ModelEntrySchema.safeParse({ id: `openrouter:${row.id}`, provider: "openrouter", model: row.id,
      label: row.name ?? row.id, contextWindow: row.context_length, output: "text", modelVerified: true,
      ...(Array.isArray(row.supported_parameters) && row.supported_parameters.includes("reasoning") ? { reasoning: true } : {}),
      tags: [/sonnet|pro|gpt-5|gpt-4\.1$|deepseek.*v3/i.test(row.id) ? "strong" : "fast"],
      price: { inputPerMTok: prompt * 1_000_000, outputPerMTok: completion * 1_000_000, currency: "USD", verifiedOn: date } });
    return entry.success ? [entry.data] : [];
  });
}
/**
 * The price a text model is quoted and capped at. OpenRouter lists a model at its cheapest
 * provider's price, and a ceiling at that price leaves nowhere to go when that one provider fails or
 * withdraws the model. The ceiling is raised to cover the two cheapest providers (those that accept
 * tools, when two do, since a search needs them), so a refused request can be served by the next one.
 * Quotes are made from this same price, so the person never pays above what they approved.
 */
export function routerCeiling(entry: ModelEntry, body: unknown): ModelEntry {
  const rows = (body as any)?.data?.endpoints;
  if (entry.output === "image" || !Array.isArray(rows)) return entry;
  const priced = rows.flatMap((e: any) => {
    const p = Number(e?.pricing?.prompt), c = Number(e?.pricing?.completion);
    if (!Number.isFinite(p) || !Number.isFinite(c) || p < 0 || c < 0) return [];
    if (Object.entries(e.pricing ?? {}).some(([k, v]) => !["prompt","completion","input_cache_read","input_cache_write","discount"].includes(k) && Number(v) > 0)) return [];
    return [{ p: p * 1_000_000, c: c * 1_000_000, tools: Array.isArray(e.supported_parameters) && e.supported_parameters.includes("tools") }];
  });
  const withTools = priced.filter((e: { tools: boolean }) => e.tools);
  const pool = withTools.length >= 2 ? withTools : priced;
  if (pool.length < 2) return entry;
  // A typical step reads far more than it writes: rank by ten parts input to two parts output.
  const two = [...pool].sort((a, b) => (a.p * 10 + a.c * 2) - (b.p * 10 + b.c * 2)).slice(0, 2);
  const inputPerMTok = Math.max(entry.price.inputPerMTok, ...two.map((e) => e.p));
  const outputPerMTok = Math.max(entry.price.outputPerMTok, ...two.map((e) => e.c));
  return { ...entry, price: { ...entry.price, inputPerMTok, outputPerMTok } };
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
  // Verified end to end against XENIUR's steps (search, cited overview, outline, exact-quote draft):
  // strong, cheap, answers without a hidden reasoning pass. Each must also pass routerTextModels'
  // token-only pricing rule to appear here at all. One text model, so every step uses the same one.
  const preferred = ["qwen/qwen3-235b-a22b-2507", "mistralai/mistral-small-3.2-24b-instruct", "meta-llama/llama-4-maverick", "openai/gpt-4o-mini"];
  const chosen = preferred.map(id=>text.find(m=>m.model === id)).filter((m): m is ModelEntry => !!m).slice(0,1);
  // Otherwise: a capable, answer-first model with room for a whole draft, cheapest first; never a tiny one.
  const fallback = text.filter(m=>!m.reasoning && m.contextWindow >= 100_000 && !/\b(?:[1-9]|1[0-9])b\b|nano|tiny|mini-?\d/i.test(m.model))
    .sort((a,b)=>a.price.outputPerMTok-b.price.outputPerMTok)[0] ?? [...text].sort((a,b)=>a.price.outputPerMTok-b.price.outputPerMTok)[0];
  if (!chosen.length && fallback) chosen.push(fallback);
  const image = models.filter(m=>m.output === "image").sort((a,b)=>a.imagePriceUsd!-b.imagePriceUsd!)[0];
  return [...chosen.map(m=>m.id), ...(image ? [image.id] : [])];
}
