import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ObjectGraph} from "@xeniur/graph";
import {newId,type JourneyResource} from "@xeniur/core";
import {EvidenceIndex,splitPassages} from "./evidence.js";
let dir:string,graph:ObjectGraph,index:EvidenceIndex;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),"xeniur-evidence-"));graph=ObjectGraph.open({dbPath:join(dir,"work.db"),blobDir:join(dir,"blobs")});index=new EvidenceIndex(graph);});
afterEach(()=>{graph.close();rmSync(dir,{recursive:true,force:true});});
const resource=():JourneyResource=>({id:newId(),sourceId:newId(),sourceVersionId:newId(),objectId:newId(),title:"Long study",url:null,textLength:0,partial:false,rights:"unknown",blobHash:"a".repeat(64),pages:120});
describe("page-aware evidence retrieval",()=>{
 it("retrieves the actual result beyond the old first-100-page limit",()=>{
  const r=resource(),text=Array.from({length:120},(_,i)=>`[Page ${i+1}]\n${i===118?"Catalyst poisoning invalidates the original measurement.":"Operating methods and general background. ".repeat(90)}`).join("\n\n");
  index.ensure(r,text);const result=index.select([r],"catalyst poisoning",5000);
  expect(result.passages[0]?.page).toBe(119);expect(result.passages[0]?.text).toContain("invalidates");
  expect(result.coverage.resources[0]?.capturedPages).toBe(120);expect(result.coverage.resources[0]?.selectedPages).toContain(119);
  expect(result.coverage.selectedCharacters).toBeLessThanOrEqual(5000);
 });
 it("keeps stable identities and cannot cite a changed version, wrong page or invented quotation",()=>{
  const r=resource();index.ensure(r,"[Page 8]\nThe measured result depends on temperature and duration.");
  const offered=index.select([r],"temperature",4000).passages,p=offered[0]!;
  const c={passageId:p.id,sourceId:r.sourceId,sourceVersionId:r.sourceVersionId,page:8,quote:"The measured result depends on temperature and duration."};
  expect(()=>index.validate([c],offered,[r.sourceId])).not.toThrow();
  for(const forged of [{...c,sourceVersionId:newId()},{...c,quote:"Everything is safe and the evidence proves a guarantee."}])expect(()=>index.validate([forged],offered,[r.sourceId])).toThrow("did not match");
  // A real quote with the wrong page is stored with the page it is actually on, never the claimed one.
  const misPaged={...c,page:7};index.validate([misPaged],offered,[r.sourceId]);expect(misPaged.page).toBe(8);
  expect(()=>index.validate([c],[],[r.sourceId])).toThrow();
  expect(splitPassages(r.sourceId,r.sourceVersionId,p.text)[0]?.id).not.toBe(p.id); // Offsets belong to the exact stored copy.
  index.ensure(r,"Ignored changed bytes for immutable version");expect(index.get(p.id)?.text).toBe(p.text);
 });
 it("re-anchors a real quote credited to the neighbouring passage, and reads typography as the same words",()=>{
  const r=resource();const words=Array.from({length:700},(_,i)=>`word${i}`).join(" ");index.ensure(r,`${words} The roof\u2019s cooling lasts \u2014 until the soil dries. ${words}`);
  const offered=index.select([r],"roof cooling soil",96000).passages;expect(offered.length).toBeGreaterThan(1);
  const holder=offered.find(p=>p.text.includes("cooling lasts"))!,other=offered.find(p=>p.id!==holder.id&&!p.text.includes("cooling lasts"))!;
  const c={passageId:other.id,sourceId:r.sourceId,sourceVersionId:r.sourceVersionId,page:null,quote:"The roof's cooling lasts - until the soil dries."};
  index.validate([c],offered,[r.sourceId]);expect(c.passageId).toBe(holder.id);
  expect(()=>index.validate([{...c,quote:"The roof's cooling lasts forever, whatever the soil."}],offered,[r.sourceId])).toThrow("did not match");
 });
 it("keeps each source visible within a bounded selection",()=>{
  const resources=Array.from({length:8},resource);for(const r of resources)index.ensure(r,"Methods and constraints. ".repeat(400));
  const selected=index.select(resources,"constraints",4000);
  expect(new Set(selected.passages.map(p=>p.sourceId)).size).toBe(8);expect(selected.coverage.selectedCharacters).toBeLessThanOrEqual(4000);
  expect(selected.coverage.resources.every(r=>r.selectedPassages<r.capturedPassages)).toBe(true);
 });
});
