/// <reference types="vite/client" />
import { useCallback, useEffect, useRef, useState } from "react";
import logo from "../../../../brand/XR_logo_vector.svg?raw";

// The supplied brand asset remains the single source of the silhouette.
const paths=[...logo.matchAll(/<path\s+d="([^"]+)"/g)].map(match=>match[1]!);
const viewBox=logo.match(/viewBox="([^"]+)"/)?.[1]??"269 427 701 385";

export function Splash({ready=false,error=null,onFinish,onRetry}: {
  ready?:boolean;error?:string|null;onFinish():void;onRetry?():void;
}) {
  const started=useRef(performance.now());
  const [leaving,setLeaving]=useState(false);
  const finish=useCallback(()=>{if(ready)setLeaving(true);},[ready]);
  useEffect(()=>{
    if(!ready)return;
    const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer=window.setTimeout(finish,reduced?0:Math.max(0,900-(performance.now()-started.current)));
    return()=>window.clearTimeout(timer);
  },[ready,finish]);
  useEffect(()=>{
    if(!leaving)return;
    const timer=window.setTimeout(onFinish,window.matchMedia("(prefers-reduced-motion: reduce)").matches?0:160);
    return()=>window.clearTimeout(timer);
  },[leaving,onFinish]);
  useEffect(()=>{const skip=(e:KeyboardEvent)=>{if(e.key==="Escape")finish();};window.addEventListener("keydown",skip);return()=>window.removeEventListener("keydown",skip);},[finish]);
  return <main className={`xr-splash${leaving?" is-leaving":""}`} aria-busy={!ready&&!error}>
    <div className="xr-splash__center">
      <div className="xr-splash__stage" aria-hidden="true">
        <svg className="xr-splash__landscape" viewBox="0 0 600 420" fill="none">
          <rect className="xr-splash__island" x="80" y="64" width="440" height="292" rx="36"/>
        </svg>
        <svg className="xr-splash__logo" viewBox={viewBox} fill="none">
          <g className="xr-splash__fill">{paths.map((d,i)=><path key={i} d={d}/>)}</g>
          <g className="xr-splash__trace" strokeWidth="3" strokeLinejoin="round">{paths.map((d,i)=><path key={i} d={d} pathLength="1"/>)}</g>
        </svg>
      </div>
      <h1>XENIUR</h1>
      <p className="xr-splash__status" role="status">{error?"Your workspace couldn’t open.":ready?"Ready for your work.":"Opening your workspace…"}</p>
      {error&&<div className="xr-splash__recovery"><p>{error}</p><button type="button" className="xr-button" onClick={onRetry}>Try again</button></div>}
    </div>
    {ready&&<button type="button" className="xr-splash__skip" onClick={finish}>Skip introduction <span aria-hidden="true">↗</span></button>}
  </main>;
}
