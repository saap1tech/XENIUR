import { describe, expect, it } from "vitest";
import { routerTextModels, routerImageModel, routerCeiling, recommendRouterModels } from "./openrouter.js";
import { ModelRegistry } from "./registry.js";
const date="2026-09-28";
const text={id:"google/gemini-2.5-flash",name:"Flash",architecture:{output_modalities:["text"]},context_length:100000,pricing:{prompt:"0.0000003",completion:"0.0000025"}};
const image={id:"example/drawing",name:"Drawing"};
describe("OpenRouter discovery",()=>{
 it("converts per-token catalogue prices and does not ship preset model claims",()=>{
  const models=routerTextModels({data:[text,{...text,id:"bad",pricing:{prompt:"-1",completion:"x"}},{...text,id:"surcharge",pricing:{...text.pricing,request:".01"}}]},date);
  expect(models).toHaveLength(1);expect(models[0]!.price).toEqual({inputPerMTok:.3,outputPerMTok:2.5,currency:"USD",verifiedOn:date});
  const registry=ModelRegistry.load(process.cwd());expect(registry.providers().map(p=>p.id)).toEqual(["openrouter"]);expect(registry.models()).toEqual([]);
 });
 it("offers only fixed per-image endpoints and keeps images out of text routing",()=>{
  const m=routerImageModel(image,{data:[{provider_tag:"priced",pricing:[{billable:"output_image",unit:"image",cost_usd:.04}],supported_parameters:{n:{type:"range",min:1,max:1}}},{provider_tag:"variable",pricing:[{billable:"output_image",unit:"megapixel",cost_usd:.01}]}]},date)!;
  expect(routerImageModel(image,{id:image.id,endpoints:[{provider_tag:"priced",pricing:[{billable:"output_image",unit:"image",cost_usd:.04}]}]},date)?.imagePriceUsd).toBe(.04);
  expect(m.imagePriceUsd).toBe(.04);expect(m.imageProvider).toBe("priced");
  const registry=new ModelRegistry({providers:[{id:"openrouter",label:"OpenRouter",keyName:"K",verifyUrl:null,auth:"bearer",local:false}],models:[...routerTextModels({data:[text]},date),m]});
  expect(registry.callable(()=>true)).toHaveLength(1);expect(registry.unlocks("openrouter").generation).toEqual(["Drawing"]);expect(recommendRouterModels(registry.models())).toContain(m.id);
  expect(routerImageModel(image,{data:[{provider_tag:"variable",pricing:[{billable:"output_image",unit:"image",cost_usd:.04},{billable:"input_reference",unit:"image",cost_usd:.02}]}]},date)).toBeNull();
 });
});

describe("the model a new key starts with", () => {
  const row = (id: string, prompt: string, completion: string, extra: Record<string, unknown> = {}) => ({ id, name: id, context_length: 131072,
    architecture: { output_modalities: ["text"] }, pricing: { prompt, completion }, ...extra });
  const date = new Date().toISOString().slice(0, 10);
  it("is the verified answer-first model when the catalogue has it, and only one", () => {
    const models = routerTextModels({ data: [row("tiny/model-1b", "0.00000001", "0.00000001"), row("qwen/qwen3-235b-a22b-2507", "0.00000009", "0.00000055"), row("mistralai/mistral-small-3.2-24b-instruct", "0.0000001", "0.0000003")] }, date);
    expect(recommendRouterModels(models)).toEqual(["openrouter:qwen/qwen3-235b-a22b-2507"]);
  });
  it("otherwise skips tiny and thinking models rather than taking the cheapest", () => {
    const models = routerTextModels({ data: [row("tiny/model-1b", "0.00000001", "0.00000001"), row("deep/thinker", "0.00000001", "0.00000002", { supported_parameters: ["reasoning"] }), row("solid/writer-70b", "0.0000002", "0.0000006")] }, date);
    expect(models.find((m) => m.model === "deep/thinker")?.reasoning).toBe(true);
    expect(recommendRouterModels(models)).toEqual(["openrouter:solid/writer-70b"]);
  });
});

describe("the price ceiling of a text model", () => {
  const [entry] = routerTextModels({ data: [{ id: "q/m", name: "M", context_length: 100000, architecture: { output_modalities: ["text"] }, pricing: { prompt: "0.0000000875", completion: "0.00000035" } }] }, new Date().toISOString().slice(0, 10));
  const endpoint = (prompt: string, completion: string, tools = true) => ({ pricing: { prompt, completion }, supported_parameters: tools ? ["tools", "max_tokens"] : ["max_tokens"] });
  it("covers the two cheapest providers, so one provider failing is not the end of the step", () => {
    const widened = routerCeiling(entry!, { data: { endpoints: [endpoint("0.0000000875", "0.00000035"), endpoint("0.00000009", "0.00000055"), endpoint("0.0000002", "0.0000006")] } });
    expect(widened.price.inputPerMTok).toBeCloseTo(0.09); expect(widened.price.outputPerMTok).toBeCloseTo(0.55);
  });
  it("prefers providers that take tools, and leaves a single-provider model as listed", () => {
    const tools = routerCeiling(entry!, { data: { endpoints: [endpoint("0.0000000875", "0.00000035"), endpoint("0.00000005", "0.0000001", false), endpoint("0.0000001", "0.0000007")] } });
    expect(tools.price.outputPerMTok).toBeCloseTo(0.7);
    expect(routerCeiling(entry!, { data: { endpoints: [endpoint("0.0000000875", "0.00000035")] } })).toBe(entry);
  });
});

describe("writing models", () => {
  it("leave out models that also make sound or pictures", () => {
    const row = (id: string, outputs: string[]) => ({ id, name: id, context_length: 100000, architecture: { output_modalities: outputs }, pricing: { prompt: "0.0000001", completion: "0.0000002" } });
    const ids = routerTextModels({ data: [row("a/writer", ["text"]), row("g/music", ["text", "audio"]), row("g/painter", ["text", "image"])] }, new Date().toISOString().slice(0, 10)).map((m) => m.model);
    expect(ids).toEqual(["a/writer"]);
  });
});
