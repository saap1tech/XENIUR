import {useEffect,useState} from "react";
import {BookOpen,Check,Download,RefreshCw,X} from "lucide-react";
import type {JourneyRun} from "@xeniur/core";

export function WorkInsights({worldId,onClose}:{worldId:string;onClose():void}){
  const [data,setData]=useState<{runs:JourneyRun[];outcomes:Record<string,number>}|null>(null),[error,setError]=useState("");
  useEffect(()=>{let live=true;void window.xeniur?.journey.insights(worldId).then(d=>{if(live)setData(d);}).catch(()=>{if(live)setError("Could not read this project's checks.");});return()=>{live=false;};},[worldId]);
  return <aside className="xr-work-insights" aria-label="Project checks"><header><h2>Your work, inspected.</h2><button type="button" aria-label="Close project checks" onClick={onClose}><X size={18}/></button></header><p>Local records of useful actions. No grades or engagement score.</p>
    {data&&<><div className="xr-work-insights__counts">{[{kind:"evidence_opened",label:"Sources inspected",icon:BookOpen},{kind:"evidence_reviewed",label:"Basis checks saved",icon:Check},{kind:"decision_revised",label:"Steps reopened",icon:RefreshCw},{kind:"exported",label:"Work bundles saved",icon:Download}].map(v=><article key={v.kind}><v.icon size={20}/><strong>{data.outcomes[v.kind]??0}</strong><span>{v.label}</span></article>)}</div><details><summary>AI steps and charges · {data.runs.length} recent</summary>{data.runs.map(r=><article className="xr-work-insights__run" key={r.id}><span>{r.action.replaceAll("_"," ")}</span><strong>{r.state}</strong><small>{r.usageKnown?`Reported charge: $${(r.actualUsd??0).toFixed(4)}`:`Charge unknown · $${r.maximumUsd.toFixed(4)} allowance accounted conservatively`}{r.removedQuotes?` · ${r.removedQuotes} ${r.removedQuotes===1?"quote":"quotes"} left out: not word for word in the source`:""}</small></article>)}{!data.runs.length&&<p>No paid steps recorded.</p>}</details></>}
    {!data&&!error&&<p role="status">Reading your project…</p>}{error&&<p role="alert">{error}</p>}
  </aside>;
}
