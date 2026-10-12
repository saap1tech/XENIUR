import { useCallback, useEffect, useState } from "react";
import type { ModelProviderView } from "@xeniur/core";
import { ArrowLeft, ArrowRight, Check, Image, KeyRound, LockKeyhole, Settings2, Sparkles } from "lucide-react";
import { BrandMark } from "./BrandMark.js";
import { ProjectIllustration } from "./ProjectIllustration.js";
import { FitBadge } from "./ProjectModels.js";

/** Better fits first in the list, as in a project's own model choice. */
const FIT_ORDER={best:0,good:1,limited:2,untested:3,care:4} as const;

export function Models({ reason, firstRun = false, onBack }: { reason?: string | null; firstRun?: boolean; onBack(): void }) {
  const bridge = window.xeniur!;
  const [provider,setProvider]=useState<ModelProviderView|null>(null);
  const [key,setKey]=useState("");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
  const [caps,setCaps]=useState({perActionUsdMax:1,monthlyUsdMax:100,monthlySpentUsd:0});
  const refresh=useCallback(async()=>{setProvider((await bridge?.models.list())?.find(p=>p.id==="openrouter")??null);},[bridge]);
  useEffect(()=>{void refresh();void bridge?.models.budget().then(setCaps);},[bridge,refresh]);
  const textReady=provider?.models.some(m=>m.output!=="image"&&m.callable)??false;
  const imageReady=provider?.models.some(m=>m.output==="image"&&m.callable)??false;
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setMessage("");try{await work();await refresh();}catch(e){setMessage(e instanceof Error?e.message:"Try again.");}finally{setBusy(false);}};
  const connect=()=>run(async()=>{
    if(key.trim()){await bridge.models.add("openrouter",key.trim());setKey("");}
    const checked=await bridge.models.verify("openrouter");
    setMessage(checked.ok?(checked.reason??"Connected. Your tools are ready."):(checked.reason??"Check your key and try again."));
  });
  return <main className="xr-connect" aria-labelledby="setup-title">
    <header><BrandMark compact/>{!firstRun&&<button type="button" className="xr-text-action" onClick={onBack}><ArrowLeft size={18}/>Back</button>}</header>
    <div className="xr-connect__layout">
      <section className="xr-connect__scene"><ProjectIllustration kind="sharpen"/><h1 id="setup-title">One key.<br/><em>Your workspace.</em></h1></section>
      <section className="xr-connect__form" aria-label="OpenRouter connection">
        <span className="xr-connect__symbol"><KeyRound size={32}/></span><h2>Connect OpenRouter</h2>
        <p>Think, search, and draw in one place.</p>
        <form onSubmit={e=>{e.preventDefault();void connect();}}>
          <label htmlFor="openrouter-key">OpenRouter API key</label>
          <input id="openrouter-key" type="password" value={key} autoComplete="off" spellCheck={false} placeholder={provider?.keyPresent?"Replace your saved key":"Paste your key"} onChange={e=>setKey(e.target.value)} disabled={busy||provider?.canStore===false}/>
          <button className="xr-button xr-button--primary" type="submit" disabled={busy||provider?.canStore===false||(!provider?.keyPresent&&key.trim().length<8)}>{busy?"Connecting…":textReady?"Check connection":"Connect"}<ArrowRight size={18}/></button>
        </form>
        {!provider?.keyPresent&&<a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Get an OpenRouter key ↗</a>}
        <div className="xr-connect__tools"><span className={textReady?"is-ready":""}><Sparkles size={19}/>Thinking {textReady&&<Check size={15}/>}</span><span className={imageReady?"is-ready":""}><Image size={19}/>Drawing {imageReady&&<Check size={15}/>}</span></div>
        <small className="xr-connect__privacy"><LockKeyhole size={14}/>Key encrypted on this computer.</small>
        {provider?.canStore===false&&<p role="status">The keychain is unavailable. You can work locally.</p>}
        {message&&<p className="xr-connect__message" role="status">{message}</p>}{reason&&<p role="status">{reason}</p>}
        <details className="xr-connect__settings"><summary><Settings2 size={16}/>Spending limits and models</summary>
          <div><label>Per step ($)<input type="number" min="0.01" max="5" step="0.01" value={caps.perActionUsdMax} onChange={e=>setCaps({...caps,perActionUsdMax:Number(e.target.value)})}/></label>
          <label>Per month ($)<input type="number" min="0.01" max="10000" step="1" value={caps.monthlyUsdMax} onChange={e=>setCaps({...caps,monthlyUsdMax:Number(e.target.value)})}/></label>
          <button type="button" disabled={busy} onClick={()=>void run(async()=>{setCaps(await bridge.models.setBudget(caps.perActionUsdMax,caps.monthlyUsdMax));setMessage("Limits saved.");})}>Save limits</button></div>
          <small>${caps.monthlySpentUsd.toFixed(2)} this month</small>
          {provider?.models.length?<details><summary>Choose models</summary>{["text","image"].map(kind=><div key={kind}><h3>{kind==="text"?"Thinking":"Drawing"}</h3>{provider.models.filter(m=>(m.output??"text")===kind).sort((a,b)=>FIT_ORDER[a.fit??"untested"]-FIT_ORDER[b.fit??"untested"]||Number(!!b.selected)-Number(!!a.selected)).map(m=><label className="xr-connect__model" key={m.id}><input type="checkbox" checked={m.selected??false} disabled={busy||!m.accessible} onChange={e=>void run(async()=>{await bridge.models.select(m.id,e.target.checked);})}/>{m.label}{m.fit&&<FitBadge fit={m.fit}/>}{m.fitNote&&m.fit!=="untested"&&<small>{m.fitNote}</small>}<small>{kind==="image"?`$${m.imagePriceUsd} / image`:`$${m.inputPerMTok} / $${m.outputPerMTok} per million tokens`}</small></label>)}</div>)}</details>:null}
          {provider?.keyPresent&&<button type="button" disabled={busy} onClick={()=>void run(async()=>{await bridge.models.remove("openrouter");setMessage("Key removed.");})}>Remove key</button>}
        </details>
        <button type="button" className="xr-connect__enter xr-button" onClick={onBack}>{textReady?"Start working":"Use without AI"}<ArrowRight size={18}/></button>
        {!textReady&&<p className="xr-connect__later">Everything local works without a key: files, notes, sources and your own writing. You can connect later from Settings.</p>}
      </section>
    </div>
  </main>;
}
