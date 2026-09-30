import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JOURNEY_FONTS, JOURNEY_LAYOUTS, type Journey } from "@xeniur/core";
import { documentFiles, compileFiles } from "../apps/desktop/src/main/journey/document.js";
import type { ObjectGraph } from "@xeniur/graph";
const root=process.cwd();const output=join(root,"brand/previews");mkdirSync(output,{recursive:true});
const temp=mkdtempSync(join(tmpdir(),"xeniur-previews-"));
const resource="11111111-1111-4111-8111-111111111111";
const base={resources:[{sourceId:resource,title:"Example material supplied for the specimen",url:null,partial:false}],
 report:{palettes:[{id:"mineral",name:"Mineral",colors:["#264D43","#8EA16C","#FBF9F2"]}]},choices:{palette:"mineral",font:"cochineal",layout:"field"},
 figureIds:[],decisions:[],goalId:resource,reviewed:false,
 draft:{title:"Carbon, currents & possibility",abstract:"A study in reading carefully. How can a promising reaction become a useful process? The answer begins with evidence, a clear comparison, and space for uncertainty.",
 sections:[{title:"The question",level:1,paragraphs:["Carbon dioxide can become a starting material. A review must distinguish the reaction from the complete system: energy, stability, separation, and the source of electricity all affect the result.","The useful question is specific. Which comparisons hold under matching conditions, and which depend on assumptions that deserve another check?"],sourceIds:[resource]},
 {title:"Reading the evidence",level:1,paragraphs:["Each source contributes a different part of the picture. Methods establish what was measured. Results show what happened within those conditions. A discussion connects the observation to a claim, with limits that should remain visible.","This page is a typesetting specimen, not a scientific finding. It demonstrates the actual font and LaTeX layout that XENIUR will apply to a reviewed draft."],sourceIds:[resource]},
 {title:"A stronger comparison",level:2,paragraphs:["Put like beside like. Keep units consistent, disclose missing observations, and revisit the basis when a source changes. A good conclusion can be concise without hiding its uncertainty."],sourceIds:[resource]}],
 tables:[{title:"A comparison to make",columns:["Question","Check"],rows:[["Energy","Compare the full process"],["Stability","State the time measured"],["Selectivity","Keep the same conditions"]],sourceIds:[resource]}],figureIdeas:[],limitations:["This is a visual specimen, not a completed research review."]}} as unknown as Journey;
try {
 for(const [kind,id] of [...JOURNEY_FONTS.map(f=>["font",f.id]),...JOURNEY_LAYOUTS.map(l=>["layout",l.id])] as string[][]) {
  const j={...base,choices:{...base.choices,...(kind==="font"?{font:id!}:{layout:id!})}};
  const files=documentFiles(j,{} as ObjectGraph,root);const result=await compileFiles(files,temp);
  if(!result.pdf)throw new Error(result.warning??"Compilation failed");
  const pdf=join(temp,`${kind}-${id}.pdf`);writeFileSync(pdf,result.pdf);
  await promisify(execFile)(process.env["XENIUR_PDFTOPPM"]??"pdftoppm",["-f","1","-singlefile","-scale-to","1000","-png",pdf,join(output,`${kind}-${id}`)],{timeout:20000,maxBuffer:2000000});
  console.log(`Rendered ${kind}-${id}`);
 }
} finally {rmSync(temp,{recursive:true,force:true});}
