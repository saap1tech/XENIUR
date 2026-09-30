import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, RotateCcw } from "lucide-react";
import type { Journey, XeniurBridge } from "@xeniur/core";
type FigureInput=Parameters<XeniurBridge["journey"]["sourceFigure"]>[0];
type Region=FigureInput["crop"];
const full:Region={x:0,y:0,width:1,height:1};
export function SourceFigurePicker({journey,busy,onSave,onCancel}:{journey:Journey;busy:boolean;onSave(input:FigureInput):void;onCancel():void}) {
  const pdfs=journey.resources.filter(r=>r.pages>0);
  const [resourceId,setResourceId]=useState(pdfs[0]?.id??"");const [page,setPage]=useState(1);
  const [region,setRegion]=useState<Region>(full);const [caption,setCaption]=useState("");const [permission,setPermission]=useState(false);
  const [preview,setPreview]=useState("");const [loading,setLoading]=useState(false);const [error,setError]=useState("");
  const origin=useRef<{x:number;y:number}|null>(null);
  const resource=pdfs.find(r=>r.id===resourceId);
  useEffect(()=>{let current=true;setPreview("");setRegion(full);setError("");if(!resourceId)return;setLoading(true);
    void window.xeniur!.journey.sourcePage({worldId:journey.worldId,versionId:journey.versionId,resourceId,page})
      .then(hash=>{if(current)setPreview(window.xeniur!.blobs.url(hash));}).catch(e=>{if(current)setError(e instanceof Error?e.message:"Could not open this page.");}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[resourceId,page,journey.versionId,journey.worldId]);
  const point=(e:React.PointerEvent<HTMLDivElement>)=>{const box=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(1,(e.clientX-box.x)/box.width)),y:Math.max(0,Math.min(1,(e.clientY-box.y)/box.height))};};
  return <form className="xr-figure-picker" onSubmit={e=>{e.preventDefault();onSave({worldId:journey.worldId,versionId:journey.versionId,resourceId,page,crop:region,caption,permission});}}>
    {!pdfs.length?<p>Add a PDF to use one of its figures.</p>:<>
      {!!journey.draft?.sourceFigureIdeas.length&&<div className="xr-figure-picker__suggestions">{journey.draft.sourceFigureIdeas.map((idea,i)=><button key={i} type="button" onClick={()=>{const r=pdfs.find(r=>r.sourceId===idea.sourceId);if(r){setResourceId(r.id);setPage(idea.page);setCaption(idea.caption);}}}>{idea.caption} · p. {idea.page}</button>)}</div>}
      <div className="xr-figure-picker__toolbar"><select aria-label="PDF source" value={resourceId} disabled={busy} onChange={e=>{setResourceId(e.target.value);setPage(1);}}>{pdfs.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select><button type="button" aria-label="Previous page" disabled={busy||page===1} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={18}/></button><label>Page <input aria-label="Page" type="number" min={1} max={resource?.pages??1} value={page} onChange={e=>setPage(Math.max(1,Math.min(resource?.pages??1,Number(e.target.value)||1)))}/></label><button type="button" aria-label="Next page" disabled={busy||page===(resource?.pages??1)} onClick={()=>setPage(p=>p+1)}><ChevronRight size={18}/></button></div>
      {loading&&<p role="status"><LoaderCircle size={18}/>Opening page…</p>}{error&&<p role="alert">{error}</p>}
      {preview&&<><small>Drag around the figure you want to keep.</small><div className="xr-figure-picker__page" aria-label="Source page selection" onPointerDown={e=>{if(busy)return;origin.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!origin.current)return;const p=point(e);const x=Math.min(p.x,origin.current.x),y=Math.min(p.y,origin.current.y);setRegion({x,y,width:Math.max(.001,Math.abs(p.x-origin.current.x)),height:Math.max(.001,Math.abs(p.y-origin.current.y))});}} onPointerUp={()=>{origin.current=null;}} onPointerCancel={()=>{origin.current=null;}}><img src={preview} alt={`Original PDF page ${page}`} draggable={false}/><span style={{insetInlineStart:`${region.x*100}%`,insetBlockStart:`${region.y*100}%`,width:`${region.width*100}%`,height:`${region.height*100}%`}}/></div>
      <div className="xr-figure-picker__tools"><button type="button" onClick={()=>setRegion(full)}><RotateCcw size={15}/>Whole page</button><details><summary>Adjust selection</summary>{(["x","y","width","height"] as const).map(k=><label key={k}>{({x:"From start",y:"From top",width:"Width",height:"Height"})[k]}<input type="range" aria-label={k} min={k==="width"||k==="height"?.01:0} max="1" step=".01" value={region[k]} onChange={e=>{const next={...region,[k]:Number(e.target.value)};next.x=Math.min(next.x,.99);next.y=Math.min(next.y,.99);next.width=Math.min(next.width,1-next.x);next.height=Math.min(next.height,1-next.y);setRegion(next);}}/></label>)}</details></div></>}
      <input aria-label="Figure caption" placeholder="A short caption" value={caption} maxLength={400} onChange={e=>setCaption(e.target.value)}/><label><input type="checkbox" checked={permission} onChange={e=>setPermission(e.target.checked)}/>I have permission to reuse this figure.</label>
    </>}
    <footer><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={busy||loading||!preview||!permission||!caption.trim()}>Add figure</button></footer>
  </form>;
}
