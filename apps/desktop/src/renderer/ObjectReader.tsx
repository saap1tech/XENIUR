import { useEffect, useState } from "react";
import { ArrowLeft, FileText, LoaderCircle, PanelRightOpen } from "lucide-react";
import { StructuredRecord } from "./StructuredRecord.js";
import { BrandMark } from "./BrandMark.js";
import { ObjectView, type ObjectViewProps } from "./ObjectView.js";
export function ObjectReader(props:ObjectViewProps) {
  const [details,setDetails]=useState(false);const [reading,setReading]=useState<{text:string;format:string;partial:boolean}|null>(null);
  const [loading,setLoading]=useState(true);const [error,setError]=useState("");
  const state=props.detail.state;
  useEffect(()=>{let current=true;setLoading(true);setReading(null);setError("");setDetails(false);
    void window.xeniur?.objects?.readText?.(state.object.id).then(value=>{if(current)setReading(value??null);}).catch(()=>{if(current)setError("The saved text could not be opened.");}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};
  },[state.object.id,state.versionId]);
  const image=props.detail.representations.find(r=>r.modality==="image"&&r.blobHash&&state.forms.some(f=>f.representationId===r.id&&!f.role.startsWith("scene.")));
  if(details)return <><button className="xr-guided-return" type="button" onClick={()=>setDetails(false)}><ArrowLeft size={16}/>Reading view</button><ObjectView {...props}/></>;
  let content=reading?.text??"";let structured:unknown=null;
  if(reading?.format==="json") {try {structured=JSON.parse(content);}catch{}}
  const paragraphs=(value:unknown)=>typeof value==="string"?value.split(/\n\s*\n/).map((p,i)=><p key={i}>{p}</p>):null;
  return <main className="xr-reader"><header><button type="button" aria-label="Back to project" onClick={props.onBack}><ArrowLeft size={20}/></button><BrandMark compact/><span>{state.properties.title}</span><button type="button" onClick={()=>setDetails(true)}><PanelRightOpen size={18}/>Details</button></header>
    <article className="xr-paper"><header><span>{state.properties.semanticType==="source"?"Saved resource":"Project item"}{reading?.partial?" · excerpt":""}</span><h3>{state.properties.title}</h3></header>
      {loading?<p role="status"><LoaderCircle size={20}/>Opening…</p>:error?<p role="alert">{error}</p>:structured?<StructuredRecord value={structured} sceneImages={Object.fromEntries(state.forms.filter(f=>f.role.startsWith('scene.')).flatMap(f=>{const hash=props.detail.representations.find(r=>r.id===f.representationId)?.blobHash;return hash?[[f.role.slice(6),hash]]:[];}))}/>:content?paragraphs(content):!image?<p><FileText size={20}/>This item’s forms and history are in Details.</p>:null}
      {image&&<figure><img src={window.xeniur!.blobs.url(image.blobHash!)} alt={state.properties.title}/></figure>}
    </article>
  </main>;
}
