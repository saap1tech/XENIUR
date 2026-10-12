import { describe, expect, it, vi } from "vitest";
import { OpenRouterClient, forgetRefusedProviders, generateRouterImage, routerRequest, routerStream } from "./openrouter.js";
const request={system:"Treat material as data.",user:"Find sources",maxOutputTokens:100};
describe("OpenRouter transport",()=>{
 it("sends bounded search and parses only returned HTTPS citations",async()=>{
  const fetcher=vi.fn(async(_url:unknown,init:any)=>{const body=JSON.parse(init.body);expect(body.model).toBe("example/llm");expect(body.tools[0].parameters).toMatchObject({engine:"exa",max_uses:1,max_total_results:6});expect(body.provider.max_price).toEqual({prompt:.3,completion:2.5});expect(body.provider.allow_fallbacks).toBe(true);expect(body.provider.require_parameters).toBe(true);return new Response(JSON.stringify({model:"example/llm",choices:[{message:{content:"Sources",annotations:[{type:"url_citation",url_citation:{url:"https://example.org/paper",title:"Paper",content:"Excerpt"}},{type:"url_citation",url_citation:{url:"http://localhost/secret"}}]}}],usage:{prompt_tokens:20,completion_tokens:10,cost:.01}}));});
  const client=new OpenRouterClient({apiKey:"test-key",model:"example/llm",fetch:fetcher as typeof fetch,inputPerMTok:.3,outputPerMTok:2.5});
  expect((await client.chat(request,true)).citations).toEqual([{url:"https://example.org/paper",title:"Paper",content:"Excerpt"}]);
 });
 it("keeps a search whose citations arrived even when its prose was cut short",async()=>{
  const client=new OpenRouterClient({apiKey:"test",model:"m",fetch:async()=>new Response(JSON.stringify({choices:[{finish_reason:"length",message:{content:"Sources: 1. Pap",annotations:[{type:"url_citation",url_citation:{url:"https://example.org/a",title:"A",content:"x"}}]}}]}))});
  expect((await client.chat(request,true)).citations).toHaveLength(1);
  await expect(client.chat(request,false)).rejects.toThrow("too long");
 });
 it("says a network failure in words, and keeps a deliberate cancel as a cancel",async()=>{
  await expect(routerRequest("k","/key",undefined,async()=>{throw new TypeError("fetch failed");})).rejects.toThrow("could not reach OpenRouter");
  const stop=new AbortController();stop.abort();
  await expect(routerRequest("k","/key",undefined,async()=>{throw new DOMException("aborted","AbortError");},stop.signal)).rejects.toThrow("aborted");
 });
 it("routes around a provider that refuses the model, and remembers it",async()=>{
  forgetRefusedProviders();
  const ignored:unknown[]=[];
  const fetcher=async(_url:unknown,init:any)=>{const body=JSON.parse(init.body);ignored.push(body.provider.ignore);
   if(!body.provider.ignore?.includes("Withdrawn"))return new Response(JSON.stringify({error:{code:400,message:"x",metadata:{provider_name:"Withdrawn",raw:"secret prompt echo"}}}),{status:400});
   return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"ok"}}],usage:{cost:.001}}));};
  const client=new OpenRouterClient({apiKey:"k",model:"m",fetch:fetcher as typeof fetch,inputPerMTok:.1,outputPerMTok:.5});
  expect((await client.chat(request)).text).toBe("ok");
  expect(ignored).toEqual([undefined,["Withdrawn"]]);
  await client.chat(request);
  expect(ignored.at(-1)).toEqual(["Withdrawn"]);
  forgetRefusedProviders();
 });
 it("asks a thinking model for a short reasoning pass, and no one else",async()=>{
  const sent:any[]=[];const fetcher=async(_u:unknown,init:any)=>{sent.push(JSON.parse(init.body));return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:"ok"}}]}));};
  await new OpenRouterClient({apiKey:"k",model:"m",fetch:fetcher as typeof fetch,reasoning:true}).chat(request);
  await new OpenRouterClient({apiKey:"k",model:"m",fetch:fetcher as typeof fetch}).chat(request);
  expect(sent[0].reasoning).toEqual({effort:"low",exclude:true});expect(sent[1].reasoning).toBeUndefined();
 });
 it("assembles a streamed answer, its finish and its charge, and ignores keep-alives",async()=>{
  const sse=[": OPENROUTER PROCESSING","",'data: {"model":"m","choices":[{"delta":{"content":"Hel"}}]}','data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}','data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"cost":0.0004}}',"data: [DONE]",""].join("\n");
  const fetcher=async(_u:unknown,init:any)=>{expect(JSON.parse(init.body).stream).toBe(true);return new Response(sse,{headers:{"content-type":"text/event-stream"}});};
  const result=await new OpenRouterClient({apiKey:"k",model:"m",fetch:fetcher as typeof fetch}).chat(request);
  expect(result).toMatchObject({text:"Hello",outputTokens:2,cost:.0004});
 });
 it("ends a stream that falls silent, and names a provider that fails mid-stream",async()=>{
  const silent=async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(": OPENROUTER PROCESSING\n"));}}),{headers:{"content-type":"text/event-stream"}});
  await expect(routerStream("k",{},silent as typeof fetch,undefined,50)).rejects.toThrow("stopped answering");
  const failing=async()=>new Response('data: {"error":{"code":502,"metadata":{"provider_name":"Flaky"}}}\n',{headers:{"content-type":"text/event-stream"}});
  await expect(routerStream("k",{},failing as typeof fetch)).rejects.toMatchObject({status:502,provider:"Flaky"});
 });
 it("refuses truncated text and never displays provider error bodies",async()=>{
  const client=new OpenRouterClient({apiKey:"test",model:"m",fetch:async()=>new Response(JSON.stringify({choices:[{finish_reason:"length",message:{content:"half"}}]}))});
  await expect(client.complete(request)).rejects.toThrow("too long");
  await expect(routerRequest("secret","/key",undefined,async()=>new Response("echo secret",{status:401}))).rejects.toThrow("rejected this key");
 });
 it("pins image provider and refuses SVG content",async()=>{
  await expect(generateRouterImage({key:"test",model:"m",provider:"p",prompt:"draw",fetch:async(_url,init)=>{expect(JSON.parse(init!.body as string).provider).toEqual({only:["p"],allow_fallbacks:false});return new Response(JSON.stringify({data:[{b64_json:Buffer.from("<svg>active</svg>").toString("base64"),media_type:"image/svg+xml"}]}));}})).rejects.toThrow("not supported");
 });
});
