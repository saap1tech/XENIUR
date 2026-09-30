import { describe, expect, it } from "vitest";
import { routerTextModels, routerImageModel, recommendRouterModels } from "./openrouter.js";
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
