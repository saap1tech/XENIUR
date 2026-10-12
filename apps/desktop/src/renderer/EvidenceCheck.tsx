import {useState} from "react";
import {BookOpen,Check,ChevronDown,ExternalLink,ScanEye,Split} from "lucide-react";
import type {Journey,JourneyCommand,PassageCitation,EvidenceCoverage} from "@xeniur/core";

export function Coverage({coverage}:{coverage?:EvidenceCoverage}){
  if(!coverage?.resources.length)return null;
  const selected=coverage.resources.reduce((n,r)=>n+r.selectedPassages,0),captured=coverage.resources.reduce((n,r)=>n+r.capturedPassages,0);
  return <details className="xr-coverage"><summary><ScanEye size={16}/><span>{selected} selected {selected===1?"passage":"passages"} · {coverage.resources.length} {coverage.resources.length===1?"source":"sources"}</span><ChevronDown size={15}/></summary><div><p>Retrieved from {captured} captured passages. Selection is a sample, not a complete review.</p>{coverage.resources.map(r=><article key={r.sourceId}><strong>{r.title}</strong><span>{r.selectedPassages} / {r.capturedPassages} passages{r.partial?" · partial capture":""}</span>{r.capturedPages>0&&<small>Pages selected: {r.selectedPages.slice(0,24).join(", ")}{r.selectedPages.length>24?"…":""} · {r.capturedPages} readable pages</small>}</article>)}</div></details>;
}

/** Located quotations and a person's support judgment are intentionally separate facts. */
export function EvidenceCheck({journey,target,citations,busy,onReview,onOpen}:{journey:Journey;target:string;citations?:PassageCitation[];busy:boolean;onReview(action:JourneyCommand):void;onOpen(id:string):void}){
  const [expanded,setExpanded]=useState(false),[note,setNote]=useState(""),[state,setState]=useState<"supports"|"uncertain"|"contradicts">("uncertain"),[error,setError]=useState("");
  const [page,setPage]=useState<string|null>(null);
  const review=journey.evidenceReviews?.find(r=>r.target===target);
  const inspect=async(c:PassageCitation)=>{
    setError("");try{const p=await window.xeniur!.journey.passage(journey.worldId,journey.versionId,c.passageId);const r=journey.resources.find(r=>r.sourceId===p.sourceId)!;
      if(p.page&&r.blobHash){const hash=await window.xeniur!.journey.sourcePage({worldId:journey.worldId,versionId:journey.versionId,resourceId:r.id,page:p.page});setPage(window.xeniur!.blobs.url(hash));}else onOpen(r.objectId);
    }catch(e){setError(e instanceof Error?e.message:"Could not open this passage.");}
  };
  return <div className="xr-evidence-check"><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><BookOpen size={14}/>{review?<><Check size={13}/>{review.state==="supports"?"Basis checked":review.state==="contradicts"?"Evidence disagrees":"Uncertainty recorded"}</>:citations?.length?`${citations.length} passage${citations.length===1?"":"s"} · inspect basis`:"No linked passage · check basis"}<ChevronDown size={13}/></button>
    {expanded&&<div className="xr-evidence-check__body">{citations?.map(c=>{const r=journey.resources.find(r=>r.sourceId===c.sourceId);return <blockquote key={c.passageId+c.quote}>{c.quote}<footer><button type="button" onClick={()=>void inspect(c)}>{r?.title??"Source"}{c.page?` · p. ${c.page}`:""}<ExternalLink size={13}/></button><small>Quoted basis · support needs your judgment</small></footer></blockquote>;})}
      {!citations?.length&&<p>This text has no exact linked quote. Inspect its sources before relying on it.</p>}
      {page&&<div className="xr-evidence-check__page"><button type="button" onClick={()=>setPage(null)}>Close page</button><img src={page} alt="Original source page for your inspection"/></div>}
      {review?<p className="xr-evidence-check__saved">Your check: {review.note}</p>:<form onSubmit={e=>{e.preventDefault();onReview({worldId:journey.worldId,versionId:journey.versionId,action:"review_evidence",id:target,evidenceState:state,text:note});}}><fieldset><legend>Does the basis support this?</legend>{(["supports","uncertain","contradicts"] as const).map(s=><label key={s}><input type="radio" name={`evidence-${target}`} checked={state===s} onChange={()=>setState(s)}/>{s==="supports"?"Supports it":s==="uncertain"?"Still unsure":"Disagrees"}</label>)}</fieldset><textarea aria-label="Evidence check note" placeholder="What did you check? What could make this wrong?" value={note} minLength={8} maxLength={2000} required onChange={e=>setNote(e.target.value)}/><button type="submit" className="xr-button--primary" disabled={busy||note.trim().length<8}><Check size={15}/>Save check</button></form>}
      {error&&<p role="alert">{error}</p>}
    </div>}
  </div>;
}
