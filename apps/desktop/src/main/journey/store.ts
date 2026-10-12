import { ObjectGraph, type SpendLedger } from "@xeniur/graph";
import { SensemakingStore } from "@xeniur/sensemaking";
import { JourneyBriefSchema, DraftSchema, ReportSchema, OutlineSchema, JOURNEY_FONTS, JOURNEY_LAYOUTS, findKeyShaped, newId,
  builtInPath, type PathResult, type StepOutput,
  type Journey, type JourneyCommand, type JourneyKind, type JourneyResource, type JourneyQuote, type PlanStepInput } from "@xeniur/core";
import { OpenRouterClient, routerRequest, generateRouterImage } from "@xeniur/brain";
import { routerImageModel, type ModelEntry } from "@xeniur/models";
import sharp from "sharp";
import { PATH_PLANNER_PROMPT, pathInput, parsePath, validateStep } from "./path-engine.js";
import { renderBrandVisual } from "./brand-visual.js";
import { renderPathVisual } from "./path-visuals.js";
import type { ReadResource } from "./resources.js";
import {EvidenceIndex} from "./evidence.js";
import type {EvidencePassage,JourneyRun} from "@xeniur/core";
import { EDITOR_SYSTEM, ILLUSTRATION_STYLE, REPORT_SHAPE, OUTLINE_SHAPE, DRAFT_SHAPE, KIND_PURPOSE } from "./prompts.js";

const PATH_STEPS = [
  {stage:"materials",kind:"gather",purpose:"Gather material",rule:{kind:"form_exists",role:"source.primary"}},
  {stage:"summary",kind:"understand",purpose:"Review the overview",rule:{kind:"decision_accepted"}},
  {stage:"outline",kind:"decide",purpose:"Choose the structure",rule:{kind:"decision_accepted"}},
  {stage:"palette",kind:"decide",purpose:"Choose colors",rule:{kind:"decision_accepted"}},
  {stage:"font",kind:"decide",purpose:"Choose type",rule:{kind:"decision_accepted"}},
  {stage:"layout",kind:"decide",purpose:"Choose a layout",rule:{kind:"decision_accepted"}},
  {stage:"make",kind:"make",purpose:"Create the draft",rule:{kind:"form_exists",role:"doc.primary"}},
  {stage:"review",kind:"check",purpose:"Review the document",rule:{kind:"decision_accepted"}},
] as const;
const PAID = new Set(["search","summarize","feedback","outline","edit_outline","draft","illustrate","figure","design_path","run_step","scene_image"]);
/** Colours a report can always offer, when a model returned fewer than the two a choice needs. */
const FALLBACK_PALETTES=[{id:"mineral",name:"Mineral",colors:["#1F3A33","#6E8F6A","#F7F5EE"]},{id:"ink",name:"Ink & paper",colors:["#1B1F2A","#7A8597","#F8F6F0"]}];
/**
 * Mends only the shape slips that change no claim: a report longer than one page keeps its first
 * five findings and three gaps, missing gaps are none, and too few palettes are topped up from the
 * built-in pair. Findings, citations and sources are untouched and are still checked strictly, so a
 * paid answer is not thrown away for being one finding too generous.
 */
export function tidyReport(value:unknown):unknown {
  if(!value||typeof value!=="object"||Array.isArray(value))return value;
  const v={...(value as Record<string,unknown>)};
  if(Array.isArray(v.findings))v.findings=v.findings.slice(0,5);
  v.gaps=Array.isArray(v.gaps)?v.gaps.slice(0,3):v.gaps===undefined?[]:v.gaps;
  if(Array.isArray(v.palettes)){const own=v.palettes.slice(0,3);const ids=new Set(own.map(p=>(p as {id?:unknown})?.id));v.palettes=[...own,...FALLBACK_PALETTES.filter(p=>!ids.has(p.id))].slice(0,Math.max(2,own.length));}
  else if(v.palettes===undefined)v.palettes=FALLBACK_PALETTES;
  return v;
}
/** An outline's deepest level is plain titles; a model that nests one more object there keeps its titles. */
export function tidyOutline(value:unknown):unknown {
  if(!value||typeof value!=="object"||Array.isArray(value))return value;
  const v={...(value as Record<string,unknown>)};
  const title=(x:unknown)=>typeof x==="string"?x:x&&typeof x==="object"&&typeof (x as {title?:unknown}).title==="string"?(x as {title:string}).title:x;
  if(Array.isArray(v.sections))v.sections=v.sections.slice(0,12).map((section)=>{
    if(!section||typeof section!=="object")return section;
    const s={...(section as Record<string,unknown>)};
    if(Array.isArray(s.children))s.children=s.children.slice(0,8).map((child)=>{
      if(!child||typeof child!=="object")return child;
      const c={...(child as Record<string,unknown>)};
      c.children=Array.isArray(c.children)?c.children.slice(0,6).map(title):c.children===undefined?[]:c.children;
      return c;
    });
    return s;
  });
  return v;
}
/**
 * A draft keeps every word and citation it was written with. Only optional suggestions that cannot
 * be acted on are dropped (a source figure with no page, which a web page never has), and lists
 * longer than the page allows are cut at their limit. Evidence is still checked strictly afterwards.
 */
export function tidyDraft(value:unknown):unknown {
  if(!value||typeof value!=="object"||Array.isArray(value))return value;
  const v={...(value as Record<string,unknown>)};
  const cut=(key:string,max:number)=>{if(Array.isArray(v[key]))v[key]=(v[key] as unknown[]).slice(0,max);};
  if(Array.isArray(v.sourceFigureIdeas))v.sourceFigureIdeas=v.sourceFigureIdeas.filter((idea)=>idea&&typeof idea==="object"&&Number.isInteger((idea as {page?:unknown}).page)&&((idea as {page:number}).page>=1));
  else if(v.sourceFigureIdeas===null)v.sourceFigureIdeas=[];
  for(const key of ["figureIdeas","sourceFigureIdeas"])if(v[key]===undefined||v[key]===null)v[key]=[];
  if(v.tables===undefined||v.tables===null)v.tables=[];
  if(v.limitations===undefined||v.limitations===null)v.limitations=[];
  cut("sections",40);cut("tables",5);cut("figureIdeas",3);cut("sourceFigureIdeas",3);cut("limitations",8);
  if(Array.isArray(v.sections))v.sections=v.sections.map((section)=>section&&typeof section==="object"&&Array.isArray((section as {paragraphs?:unknown}).paragraphs)?{...section,paragraphs:(section as {paragraphs:unknown[]}).paragraphs.slice(0,15)}:section);
  if(Array.isArray(v.tables))v.tables=v.tables.map((table)=>{if(!table||typeof table!=="object")return table;const t={...(table as Record<string,unknown>)};if(Array.isArray(t.columns))t.columns=t.columns.slice(0,6);if(Array.isArray(t.rows))t.rows=t.rows.slice(0,20).map((row)=>Array.isArray(row)?row.slice(0,6):row);return t;});
  return v;
}
/** A model that thinks first spends its reasoning from the same allowance, so it gets three times the room; quotes include it. */
const outputTokens=(action:string,m:ModelEntry)=>(OUT_TOKENS[action]??2000)*(m.reasoning?3:1);
const OUT_TOKENS:Record<string,number> = { search:1800,summarize:2300,feedback:2300,outline:3000,edit_outline:3000,draft:11000,design_path:4000,run_step:12000 };
export interface JourneyDependencies {
  graph:ObjectGraph; sense:SensemakingStore; spend:SpendLedger;
  models():ModelEntry[]; key():string|null;
  /** Every model this machine can call (verified, freshly priced, keyed), chosen app-wide or not. */
  catalog?():ModelEntry[];
  download(url:string):Promise<ReadResource & {url:string}>;
  reference?:()=>string; fetch?:typeof fetch; projectRoot?:string;
}
export class JourneyStore {
  private active = new Set<string>();
  private controllers=new Map<string,AbortController>();
  private evidenceIndex:EvidenceIndex;
  constructor(private readonly deps:JourneyDependencies) {
    this.evidenceIndex=new EvidenceIndex(deps.graph);
    deps.graph.db.exec(`CREATE TABLE IF NOT EXISTS journey_runs (id TEXT PRIMARY KEY,world_id TEXT NOT NULL,hold_id TEXT,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS journey_outcomes (id TEXT PRIMARY KEY,world_id TEXT NOT NULL,kind TEXT NOT NULL,at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS journey_models (world_id TEXT PRIMARY KEY,text_model TEXT,image_model TEXT);`);
    for(const row of deps.graph.db.prepare("SELECT * FROM journey_runs").all() as Array<{id:string;hold_id:string;record:string}>){
      const run=JSON.parse(row.record) as JourneyRun;if(run.state!=="running")continue;
      run.state="interrupted";run.finishedAt=Date.now();
      const hold=deps.graph.db.prepare("SELECT status FROM spend WHERE id=?").get(row.hold_id) as {status:string}|undefined;
      if(hold?.status==="held")deps.spend.settle(row.hold_id,{usd:run.maximumUsd,outcome:"error"});
      this.saveRun(run);
    }
  }
  cancel(worldId:string):boolean {const c=this.controllers.get(worldId);if(!c)return false;c.abort(new Error("Stopped. Any provider charge may still apply; your previous work is saved."));return true;}
  private saveRun(run:JourneyRun){this.deps.graph.db.prepare("UPDATE journey_runs SET record=? WHERE id=?").run(JSON.stringify(run),run.id);}
  recordOutcome(worldId:string,kind:string){this.deps.graph.db.prepare("INSERT INTO journey_outcomes VALUES (?,?,?,?)").run(newId(),worldId,kind,Date.now());}
  insights(worldId:string){
    if(!this.deps.graph.getWorld(worldId))throw new Error("Choose a project.");
    const rows=this.deps.graph.db.prepare("SELECT record FROM journey_runs WHERE world_id=? ORDER BY rowid DESC LIMIT 12").all(worldId) as Array<{record:string}>;
    const outcomes=this.deps.graph.db.prepare("SELECT kind,COUNT(*) AS count FROM journey_outcomes WHERE world_id=? GROUP BY kind").all(worldId) as Array<{kind:string;count:number}>;
    return {runs:rows.map(r=>JSON.parse(r.record) as JourneyRun),outcomes:Object.fromEntries(outcomes.map(r=>[r.kind,r.count]))};
  }
  passage(worldId:string,versionId:string,id:string){
    const j=this.read(worldId,versionId);this.selection(j);
    const p=this.evidenceIndex.get(id);if(!p||!j.resources.some(r=>r.sourceId===p.sourceId&&r.sourceVersionId===p.sourceVersionId))throw new Error("This passage is outside your current resources.");
    this.recordOutcome(worldId,"evidence_opened");return p;
  }
  get(worldId:string):Journey|null {
    const state=this.deps.graph.listStates(worldId).find(s=>s.properties.tags.includes("xeniur.journey"));
    const data=state?.properties.settings["journey"] as Journey|undefined;
    return state && data ? {...data,id:state.object.id,versionId:state.versionId} : null;
  }
  start(worldId:string,kind:JourneyKind):Journey {
    const graph=this.deps.graph;
    const world=graph.getWorld(worldId);
    if (!world || world.kind !== "work") throw new Error("Open your own project to start a work path.");
    const existing=this.get(worldId);if(existing)return existing;
    return graph.db.transaction(()=>{
    let goal=graph.goals.current(worldId);
    if(!goal)goal=graph.goals.create(worldId,world.title);
    const state=graph.createObject({worldId,title:"Work path",semanticType:"journey",properties:{tags:["xeniur.journey"]}});
    const journey:Journey={id:state.object.id,versionId:state.versionId,worldId,goalId:goal.id,kind,stage:"materials",
      resources:[],suggestions:[],report:null,outline:null,draft:null,figureIds:[],reportObjectId:null,outlineObjectId:null,draftObjectId:null,
      illustration:null,choices:{palette:null,font:null,layout:null},decisions:[],feedbackCount:0,reviewed:false,updatedAt:Date.now()};
    const definition=builtInPath(kind);
    if(definition||kind==="custom")journey.flow={definition,approved:!!definition,index:0,results:[],request:""};
    if(kind==="custom")journey.stage="path";
    const previous=graph.plans.current(goal.id);
    const steps:PlanStepInput[]=journey.flow?[]:PATH_STEPS.map((s,i)=>({id:`journey.${s.stage}`,kind:s.kind,purpose:s.purpose,completionRule:s.rule,
      disposition:"adopted",dependsOn:i?[`journey.${PATH_STEPS[i-1]!.stage}`]:[]}));
    graph.plans.revise(goal.id,[...(previous?.steps??[]),...steps],"person");
    if(journey.flow?.approved)this.installPath(journey);
    this.save(journey,state.versionId);return this.get(worldId)!;
    })();
  }
  private read(worldId:string,versionId:string):Journey {
    const j=this.get(worldId);if(!j)throw new Error("Start a work path first.");
    if(j.versionId!==versionId)throw new Error("Your project changed. Refresh before continuing.");
    if(this.deps.graph.getWorld(worldId)?.kind!=="work")throw new Error("This project is read-only.");
    this.deps.graph.assertWritable(j.id);
    return j;
  }
  private save(j:Journey,versionId:string) {
    if(findKeyShaped(j).length)throw new Error("Remove credentials from the project material.");
    const current=this.deps.graph.currentState(j.id)!;
    this.deps.graph.commitVersion({objectId:j.id,expectedBaseVersionId:versionId,
      properties:{settings:{...current.properties.settings,journey:{...j,updatedAt:Date.now()}}},label:`Work path: ${j.stage}`});
    this.deps.graph.goals.touch(j.worldId);
  }
  /** This project's own model choice; null follows the app-wide setting. */
  projectModels(worldId:string):{text:string|null;image:string|null} {
    const row=this.deps.graph.db.prepare("SELECT text_model,image_model FROM journey_models WHERE world_id=?").get(worldId) as {text_model:string|null;image_model:string|null}|undefined;
    return {text:row?.text_model??null,image:row?.image_model??null};
  }
  setProjectModels(worldId:string,text:string|null,image:string|null) {
    const world=this.deps.graph.getWorld(worldId);if(!world||world.kind!=="work")throw new Error("Open your own project to choose its models.");
    if(this.active.has(worldId))throw new Error("Wait for the current step to finish before changing models.");
    const callable=this.deps.catalog?.()??this.deps.models();
    if(text!==null&&!callable.some(m=>m.id===text&&m.output!=="image"))throw new Error("That writing model is not available. Check your OpenRouter connection.");
    if(image!==null&&!callable.some(m=>m.id===image&&m.output==="image"))throw new Error("That picture model is not available. Check your OpenRouter connection.");
    this.deps.graph.db.prepare("INSERT INTO journey_models(world_id,text_model,image_model) VALUES(?,?,?) ON CONFLICT(world_id) DO UPDATE SET text_model=excluded.text_model,image_model=excluded.image_model").run(worldId,text,image);
  }
  /** The model a project's next step of this kind will use, or null when none can run. */
  currentModel(worldId:string,image:boolean):ModelEntry|null {try{return this.model(image,worldId);}catch{return null;}}
  private model(image=false,worldId?:string):ModelEntry {
    if(!this.deps.key())throw new Error("Connect OpenRouter in Settings first.");
    const fresh=(m:ModelEntry)=>!!m.price.verifiedOn&&Date.now()-Date.parse(m.price.verifiedOn)<=7*86400_000;
    const own=worldId?this.projectModels(worldId)[image?"image":"text"]:null;
    const chosen=own?(this.deps.catalog?.()??this.deps.models()).find(m=>m.id===own&&m.provider==="openrouter"):undefined;
    if(chosen&&fresh(chosen))return chosen;
    const available=this.deps.models().filter(m=>m.provider==="openrouter" && (image ? m.output==="image" : m.output!=="image"));
    const m=available[0];if(!m || !m.price.verifiedOn || Date.now()-Date.parse(m.price.verifiedOn)>7*86400_000)throw new Error(image ? "Check OpenRouter to enable a priced image model." : "Check your OpenRouter connection first.");
    return m;
  }
  private assertMaterial(j:Journey) {
    for(const r of j.resources) {
      const current=this.deps.graph.currentState(r.objectId);
      const latest=this.deps.sense.latestVersionOf(r.sourceId);
      if(!current || current.object.archivedAt || current.properties.settings["aiProcessing"] === "never" || r.rights==="restricted" || latest?.rights==="restricted")throw new Error(`“${r.title}” is private or unavailable. Remove it from this work path before using AI.`);
      if(latest?.id!==r.sourceVersionId)throw new Error(`“${r.title}” has a newer copy. Add the updated source before continuing.`);
    }
    if(this.deps.graph.listStates(j.worldId).some(s=>s.properties.settings["remoteModels"]===false))throw new Error("This project is set to local work.");
    const modes=this.deps.graph.modes.active().filter(m=>m.worldId===j.worldId);
    if(modes.some(m=>m.envelope.remoteModels===false))throw new Error("This session is set to local work.");
  }
  private selection(j:Journey,edit?:string){
    for(const r of j.resources){const v=this.deps.sense.getSourceVersion(r.sourceVersionId)!;this.evidenceIndex.ensure(r,this.deps.graph.readBlob(v.textBlobHash).toString("utf8"));}
    const query=[j.brief?.topic,this.deps.graph.goals.get(j.goalId)?.outcome,j.brief?.notes,edit,...(j.outline?.sections.map(s=>`${s.title} ${s.purpose}`)??[]),j.flow?.definition?.steps[j.flow.index]?.instruction].filter(Boolean).join(" ");
    const m=this.deps.models().find(m=>m.provider==="openrouter"&&m.output!=="image");
    const budget=Math.min(96000,Math.max(2000,Math.floor(((m?.contextWindow??100000)-20000)/4)));
    return this.evidenceIndex.select(j.resources,query,budget);
  }
  private material(j:Journey,edit?:string) {
    const selected=this.selection(j,edit);
    return j.resources.map(r=>({id:r.sourceId,title:r.title,url:r.url,partial:r.partial,pages:r.pages,
      coverage:selected.coverage.resources.find(c=>c.sourceId===r.sourceId),
      passages:selected.passages.filter(p=>p.sourceId===r.sourceId).map(p=>({passageId:p.id,sourceId:p.sourceId,sourceVersionId:p.sourceVersionId,page:p.page,text:p.text}))}));
  }
  /**
   * A quote is shown only if it is word for word in the source. One the model paraphrased is left out
   * rather than costing the person the whole paid answer; the count is recorded on the run. If the
   * answer quoted and none of its quotes hold, it is refused.
   */
  private validateEvidence(items:Array<{sourceIds:string[];citations?:import("@xeniur/core").PassageCitation[]}>,offered:EvidencePassage[]):number{
    let removed=0,kept=0,quoted=0;
    for(const item of items){
      if(!item.citations?.length)continue;
      quoted+=item.citations.length;
      const result=this.evidenceIndex.verified(item.citations,offered,item.sourceIds);
      item.citations=result.kept;removed+=result.removed;kept+=result.kept.length;
    }
    if(quoted&&!kept)throw new Error("A quoted passage did not match the supplied source, version and page. Create a corrected draft.");
    return removed;
  }
  private input(j:Journey,c:JourneyCommand):string {
    const goal=this.deps.graph.goals.get(j.goalId);
    const material=this.material(j,c.text);
    if(c.action==="design_path")return JSON.stringify({goal:goal?.outcome,request:c.text,brief:j.brief??null,materials:material,previousProposal:j.flow?.definition});
    if(c.action==="scene_image") {const r=j.flow!.results.find(r=>r.stepId===j.flow!.definition!.steps[j.flow!.index]!.id)!;const scene=r.output.storyboard!.scenes.find(s=>s.id===c.id)!;return JSON.stringify({brief:j.brief,scene,style:ILLUSTRATION_STYLE});}
    if(c.action==="run_step")return pathInput(j,goal?.outcome??"",material,c.text);
    if(c.action==="search")return `Search the web once for recent primary resources for this goal: ${j.brief?.topic??goal?.outcome}. Prefer papers, official data and open full texts. Mention each resource separately with a title and citation, one short line each, at most six. Never suggest a download without a returned web citation. No invented links.`;
    const base=JSON.stringify({goal:goal?.outcome,result:KIND_PURPOSE[j.kind],brief:j.brief??null,materials:material,
      userEdit:c.text||null,scope:"Only the supplied captured text; do not imply a comprehensive literature search."});
    if(c.action==="summarize"||c.action==="feedback")return `${base}\n${c.action==="feedback"?`Revise this report after the person's edit: ${JSON.stringify(j.report)}. Keep it one short page.`:"Produce a short one-page report, at most 5 findings and 3 gaps. Use strong contrast palettes with a light paper color, connected to this topic."}\nRequired JSON: ${REPORT_SHAPE}`;
    if(c.action==="outline"||c.action==="edit_outline")return `${base}\nApproved report: ${JSON.stringify(j.report)}\n${c.action==="edit_outline"?`Revise this outline: ${JSON.stringify(j.outline)}`:"Create the document's sections, subsections and subsubsections. Keep scope proportional to the available evidence."}\nRequired JSON: ${OUTLINE_SHAPE}`;
    return `${base}\nApproved outline: ${JSON.stringify(j.outline)}\nWrite a carefully argued draft following this exact structure. Citation sourceIds are required on every evidence-bearing section and table. Use a table only when it helps this type of work: evidence comparison for research, actual measurements for experiments, requirements and tests for prototypes, scenes for scripts, timing and budget for campaigns. Never invent numeric cells. Mark missing evidence explicitly. Use subheadings at levels 1, 2 and 3. Include 1-3 topic-specific conceptual figure ideas. Where a PDF excerpt names an actual figure and page, propose its sourceId and page in sourceFigureIdeas for the person to inspect and crop; do not guess page locations. Tables must have exactly one cell per column. End with concrete limitations.\nRequired JSON: ${DRAFT_SHAPE}`;
  }
  quote(command:JourneyCommand):JourneyQuote {
    const j=this.read(command.worldId,command.versionId);this.assertMaterial(j);this.assertAction(j,command);
    const image=this.imageAction(j,command);
    const m=this.model(image,command.worldId);
    const input=this.input(j,command);
    // One byte per token is conservative for supplied UTF-8 text. Search includes a
    // second model pass, bounded returned snippets and framing, plus the Exa charge.
    const searching=command.action==="search";
    const inputBound=Buffer.byteLength(input+(command.action==="design_path"?PATH_PLANNER_PROMPT:EDITOR_SYSTEM))*(searching?2:1)+(searching?120000:4000);
    const outputBound=outputTokens(command.action,m)*(searching?2:1);
    if(!image&&!searching&&inputBound+outputBound>m.contextWindow)throw new Error("This scope exceeds the selected model’s context. Choose a larger-context model or narrow this work path.");
    const cost=image?m.imagePriceUsd!:(inputBound/1_000_000*m.price.inputPerMTok+outputBound/1_000_000*m.price.outputPerMTok+(searching?.007:0));
    return {action:command.action,maximumUsd:Math.ceil(cost*10000)/10000,model:m.label,coverage:this.selection(j,command.text).coverage,
      sends:command.action==="search"?"Your project goal":image?"Illustration brief and XENIUR style":`${j.resources.length} ${j.resources.length===1?"source":"sources"}: selected page passages and your instructions`};
  }
  private imageAction(j:Journey,c:JourneyCommand) {return c.action==="illustrate"||c.action==="figure"||c.action==="scene_image"||(c.action==="run_step"&&j.flow?.definition?.steps[j.flow.index]?.operation==="image");}
  private installPath(j:Journey) {
    const plan=this.deps.graph.plans.current(j.goalId);
    const steps:PlanStepInput[]=j.flow!.definition!.steps.map((s,i)=>({id:`path.${s.id}`,kind:s.operation==="compare"?"compare":s.operation==="check"?"check":s.operation==="brief"?"understand":"make",purpose:s.title,expectedResult:s.check,completionRule:{kind:"decision_accepted"},disposition:"adopted",dependsOn:i?[`path.${j.flow!.definition!.steps[i-1]!.id}`]:[]}));
    this.deps.graph.plans.revise(j.goalId,[...(plan?.steps??[]).filter(s=>!s.id.startsWith("path.")),...steps],"person");
  }
  private assertPath(j:Journey,c:JourneyCommand) {
    const f=j.flow!;
    if(c.action==="design_path") {if(j.kind!=="custom"||f.results.length||!c.text?.trim())throw new Error("Describe your custom path before work begins.");return;}
    if(c.action==="approve_path") {if(!f.definition||f.results.length)throw new Error("Propose a path before approving it.");return;}
    if(!f.approved||!f.definition)throw new Error("Approve your path first.");
    if(f.definition.requiresSources&&!j.resources.length)throw new Error("Add a source before following this path.");
    if(c.action==="begin_path")return;
    if(c.action==="reopen_step") {if(!f.results.some(r=>r.stepId===c.id))throw new Error("Choose a step with saved work.");return;}
    const step=f.definition.steps[f.index];if(!step)throw new Error("This path is complete. Reopen a step to make changes.");
    const previous=f.definition.steps.slice(0,f.index);
    for(const p of previous){const r=f.results.find(r=>r.stepId===p.id);if(!r?.accepted||!r.decisionId||this.deps.graph.decisions.get(r.decisionId)?.state!=="accepted"||this.deps.graph.currentState(r.objectId)?.versionId!==r.versionId)throw new Error("Earlier work changed. Reopen that step before continuing.");}
    if(c.action==="run_step"&&step.operation==="manual")throw new Error("This step needs your real observations. Record them to continue.");
    if(c.action==="record_step"&&(step.operation!=="manual"||!c.text||c.text.trim().length<8))throw new Error("Describe what you actually did or observed.");
    if(c.action==="scene_image") {const r=f.results.find(r=>r.stepId===step.id);if(step.operation!=="storyboard"||!r?.output.storyboard?.scenes.some(s=>s.id===c.id)||r.accepted)throw new Error("Choose a scene in the current storyboard.");if(this.deps.graph.currentState(r.objectId)?.versionId!==r.versionId)throw new Error("This storyboard changed. Refresh it first.");}
    if(c.action==="approve_step"||c.action==="edit_step") {
      this.assertMaterial(j);
      const r=f.results.find(r=>r.stepId===step.id);if(!r||r.accepted)throw new Error("Create a result before accepting or editing it.");
      if(this.deps.graph.currentState(r.objectId)?.versionId!==r.versionId)throw new Error("This result changed outside the path. Create an updated result.");
      if(c.action==="approve_step"&&step.operation==="compare"&&!r.output.options.some(o=>o.id===c.id))throw new Error("Choose an option before continuing.");
      if(c.action==="approve_step"&&step.operation==="check"&&(!c.text||c.text.trim().length<8))throw new Error("Record what you personally checked.");
      if(c.action==="edit_step"&&!c.stepOutput)throw new Error("Provide the edited result.");
    }
  }
  private assertAction(j:Journey,c:JourneyCommand) {
    if(c.action==="save_brief") {const brief=JourneyBriefSchema.parse(c.brief);if(findKeyShaped(brief).length)throw new Error("Remove credentials from your brief.");return;}
    const pathActions=["design_path","approve_path","begin_path","run_step","approve_step","reopen_step","record_step","edit_step","scene_image"];
    if(pathActions.includes(c.action)){if(!j.flow)throw new Error("This is a document path.");this.assertPath(j,c);return;}
    if(j.flow&&!["search","resource_accept","resource_reject","remove_resource"].includes(c.action))throw new Error("Use the current step in this path.");
    if(["summarize","feedback","outline","edit_outline","draft","illustrate","figure"].includes(c.action)&&!j.resources.length)throw new Error("Add at least one readable resource first.");
    if(["feedback","approve_summary","outline","illustrate"].includes(c.action)&&!j.report)throw new Error("Create the resource report first.");
    if(c.action==="feedback" && (j.feedbackCount>=3 || !c.text?.trim()))throw new Error(j.feedbackCount>=3?"Three focused edits are saved. You can edit the material or start a new summary.":"Write the change you want.");
    if(["edit_outline","approve_outline"].includes(c.action)&&!j.outline)throw new Error("Create the structure first.");
    if(c.action==="outline"&&!j.decisions.some(d=>d.stage==="summary"))throw new Error("Review the report before shaping the structure.");
    if(["choose_palette","use_design_defaults"].includes(c.action)&&!j.decisions.some(d=>d.stage==="outline"))throw new Error("Review the structure first.");
    if(c.action==="choose_font"&&!j.choices.palette)throw new Error("Choose your colors first.");
    if(c.action==="choose_layout"&&!j.choices.font)throw new Error("Choose your type first.");
    if(c.action==="draft"&&(!j.outline||!j.choices.layout||!j.decisions.some(d=>d.stage==="outline")))throw new Error("Approve a structure and choose its style first.");
    if(["figure","edit_draft","review"].includes(c.action)&&!j.draft)throw new Error("Create your draft first.");
    if(j.draftObjectId && j.draft && ["review","figure","edit_draft"].includes(c.action)) {
      const current=this.deps.graph.currentState(j.draftObjectId);
      const primary=current?.forms.find(f=>f.role==="doc.primary");
      const hash=primary?this.deps.graph.getRepresentation(primary.representationId)?.blobHash:null;
      if(!hash || JSON.stringify(JSON.parse(this.deps.graph.readBlob(hash).toString()))!==JSON.stringify(j.draft))throw new Error("The draft record changed outside this path. Generate an updated draft before continuing.");
    }
    if(c.action==="review_evidence"&&(!c.id||!c.evidenceState||!c.text?.trim()||c.text.trim().length<8))throw new Error("Record what the evidence supports or leaves uncertain.");
    if(c.action==="review"&&(!c.text?.trim()||c.text.trim().length<8))throw new Error("Record what you reviewed before exporting.");
    if(c.action==="figure"&&!j.draft?.figureIdeas[Number(c.id)])throw new Error("Choose a figure from this draft.");
  }
  private artifact(j:Journey,title:string,value:unknown,kind="document",model:string|null=null):string {
    const g=this.deps.graph;
    const state=g.createObject({worldId:j.worldId,title,semanticType:kind,properties:{tags:["journey.output"],traits:["versioned","deliverable"]}});
    const hash=g.putBlob(Buffer.from(JSON.stringify(value,null,2)),"application/json","json");
    const rep=g.addRepresentation({objectId:state.object.id,modality:"text",format:"json",blobHash:hash,
      provenance:model?"generated":"deterministic",provider:model?"openrouter":"local.journey",model});
    const saved=g.commitVersion({objectId:state.object.id,forms:[{role:"doc.primary",representationId:rep.id}],label:title});
    for(const r of j.resources)g.decisions.link({fromObjectId:r.objectId,fromVersionId:g.currentState(r.objectId)!.versionId,toObjectId:state.object.id,relation:"informed_by",note:"Captured material; support not automatically reviewed."});
    g.process.record({objectId:state.object.id,versionId:saved.versionId,kind:model?"model_step":"note_written",actor:model?"model":"human",label:title,model,tool:null,
      inputHashes:j.resources.map(r=>g.currentState(r.objectId)?.forms[0]).flatMap(f=>f?[g.getRepresentation(f.representationId)?.blobHash].filter((h):h is string=>!!h):[]),outputHashes:[hash],durationMs:0});
    return state.object.id;
  }
  private completeStage(j:Journey,stage:string,objectIds:string[]) {
    const plans=this.deps.graph.plans;
    if(!plans.current(j.goalId)?.steps.some(s=>s.id===`journey.${stage}`))return;
    plans.setInputs(j.goalId,`journey.${stage}`,objectIds);
    plans.setExecution(j.goalId,`journey.${stage}`,"complete");
  }
  private resetAfter(j:Journey,stage:string) {
    const index=PATH_STEPS.findIndex(s=>s.stage===stage);
    const later=new Set<string>(PATH_STEPS.slice(index).map(s=>s.stage));
    for(const d of j.decisions.filter(d=>later.has(d.stage)))this.deps.graph.decisions.flagForReview(d.objectId);
    j.decisions=j.decisions.filter(d=>!later.has(d.stage));
    for(const step of this.deps.graph.plans.current(j.goalId)?.steps??[])if(later.has(step.id.replace("journey.",""))){
      const work=this.deps.graph.plans.workOf(j.goalId,step.id);if(work)this.deps.graph.plans.setExecution(j.goalId,step.id,"needs_review",{note:"An earlier choice changed."});
    }
    j.draft=null;j.reviewed=false;j.figureIds=[];
    for(const r of j.evidenceReviews??[])if(!r.target.startsWith("finding:")&&r.objectId)this.deps.sense.sort(r.objectId,"ignore");j.evidenceReviews=(j.evidenceReviews??[]).filter(r=>r.target.startsWith("finding:"));
    if(index<=3)j.choices.font=null;
    if(index<=4)j.choices.layout=null;
  }
  validateExport(worldId:string,versionId:string):Journey {
    const path=this.read(worldId,versionId);
    if(path.flow){this.assertMaterial(path);const f=path.flow;if(!f.approved||!f.definition||f.index!==f.definition.steps.length)throw new Error("Finish and review each step before exporting.");for(const step of f.definition.steps){const r=f.results.find(r=>r.stepId===step.id);if(!r?.accepted||!r.decisionId||this.deps.graph.decisions.get(r.decisionId)?.state!=="accepted"||this.deps.graph.currentState(r.objectId)?.versionId!==r.versionId)throw new Error("Some work changed and needs review.");}return path;}
    const j=this.read(worldId,versionId);this.assertMaterial(j);this.assertAction(j,{worldId,versionId,action:"review",text:"Validate the current saved review."});
    if(!j.reviewed)throw new Error("Review the draft before exporting.");
    for(const d of j.decisions)if(this.deps.graph.decisions.get(d.objectId)?.state!=="accepted")throw new Error("A decision needs review before exporting.");
    return j;
  }
  private choose(j:Journey,stage:string,label:string,options:{key:string;label:string}[],chosen:string,note?:string,target?:string|null) {
    const g=this.deps.graph;
    const d=g.decisions.create({worldId:j.worldId,question:label,options:options.map(o=>({...o,note:""})),rationale:note?.trim()||`I selected “${options.find(o=>o.key===chosen)?.label??chosen}” in the preview.`,chosenOption:chosen});
    // The person is presented an optional challenge at every approval; skipping is explicit in the UI.
    g.decisions.accept(d.objectId,"you",note?.trim()?{steelman:note.trim()}:{skipSteelman:true});
    if(target)g.decisions.link({fromObjectId:d.objectId,fromVersionId:g.currentState(d.objectId)!.versionId,toObjectId:target,relation:"informed_by",note:`${stage} preview approved by the person`});
    j.decisions.push({stage,objectId:d.objectId,versionId:g.currentState(d.objectId)!.versionId});
    if(PATH_STEPS.some(s=>s.stage===stage))this.completeStage(j,stage,[d.objectId]);
  }
  private invalidate(j:Journey) {
    for(const r of j.evidenceReviews??[])if(r.objectId)this.deps.sense.sort(r.objectId,"ignore");
    j.coverage=undefined;j.evidenceReviews=[];
    for(const step of this.deps.graph.plans.current(j.goalId)?.steps??[])if(step.id.startsWith("journey.")&&this.deps.graph.plans.workOf(j.goalId,step.id))this.deps.graph.plans.setExecution(j.goalId,step.id,"needs_review",{note:"Project material changed."});
    for(const d of j.decisions)this.deps.graph.decisions.flagForReview(d.objectId);
    if(j.flow){for(const r of j.flow.results)if(r.decisionId)this.deps.graph.decisions.flagForReview(r.decisionId);j.flow.results=[];j.flow.index=0;for(const step of this.deps.graph.plans.current(j.goalId)?.steps??[])if(step.id.startsWith("path.")&&this.deps.graph.plans.workOf(j.goalId,step.id))this.deps.graph.plans.setExecution(j.goalId,step.id,"needs_review",{note:"Material changed."});}
    j.report=null;j.outline=null;j.draft=null;j.illustration=null;j.figureIds=[];j.decisions=[];
    j.choices={palette:null,font:null,layout:null};j.reviewed=false;j.feedbackCount=0;j.stage="materials";
  }
  addResource(worldId:string,versionId:string,reading:ReadResource,url:string|null=null):Journey {
    if(this.active.has(worldId))throw new Error("Wait for the current step to finish.");
    const j=this.read(worldId,versionId);
    return this.deps.graph.db.transaction(()=>{
      if(j.resources.length>=128)throw new Error("This project supports 128 resources. Group larger collections into separate reviews.");
      if(findKeyShaped(reading.text).length)throw new Error("Remove credentials before importing this text.");
      const source=this.deps.sense.recordSource({worldId,kind:reading.pdf?"paper":"article",title:reading.title,text:reading.text,raw:reading.raw,url,partial:reading.partial,extractor:"xeniur.journey/pdfjs-1"});
      const sourceVersion=this.deps.sense.latestVersionOf(source.id)!;
      const g=this.deps.graph;
      const obj=g.createObject({worldId,title:reading.title,semanticType:"source",properties:{tags:["journey.resource"],settings:{sourceId:source.id,sourceVersionId:sourceVersion.id}}});
      const blob=g.putBlob(reading.raw,reading.pdf?"application/pdf":"text/plain",reading.pdf?"pdf":"txt");
      const rep=g.addRepresentation({objectId:obj.object.id,modality:"text",format:reading.pdf?"pdf":"txt",blobHash:blob,provenance:"human",provider:"local.import"});
      const saved=g.commitVersion({objectId:obj.object.id,forms:[{role:"source.primary",representationId:rep.id}],label:"Material added"});
      const resource:JourneyResource={id:newId(),sourceId:source.id,sourceVersionId:sourceVersion.id,objectId:obj.object.id,title:reading.title,url,
        textLength:reading.text.length,partial:reading.partial,rights:"unknown",blobHash:blob,pages:reading.pages,extraction:reading.extraction};
      j.resources.push(resource);this.invalidate(j);this.save(j,versionId);
      g.process.record({objectId:obj.object.id,versionId:saved.versionId,kind:"source_collected",actor:"human",label:"Added resource",tool:null,model:null,inputHashes:[],outputHashes:[blob],durationMs:0});
      return this.get(worldId)!;
    })();
  }
  /** Adopt the exact saved browser copy; never re-fetch or duplicate its Source. */
  attachSource(worldId:string,versionId:string,sourceId:string):Journey {
    if(this.active.has(worldId))throw new Error("Wait for the current step to finish.");
    const j=this.read(worldId,versionId),source=this.deps.sense.getSource(sourceId),version=this.deps.sense.latestVersionOf(sourceId);
    if(!source||source.worldId!==worldId||!version)throw new Error("Choose a source in this project.");
    if(source.metadata["aiProcessing"]==="never"||version.rights==="restricted")throw new Error("Keep this source private; it cannot enter the AI work path.");
    if(j.resources.some(r=>r.sourceVersionId===version.id))return j;
    const text=this.deps.graph.readBlob(version.textBlobHash).toString("utf8");
    if(findKeyShaped(text).length)throw new Error("Remove credentials before adding this source to the work path.");
    if(j.resources.length>=128)throw new Error("This work path supports 128 resources.");
    return this.deps.graph.db.transaction(()=>{
      const g=this.deps.graph,obj=g.createObject({worldId,title:source.title,semanticType:"source",properties:{tags:["journey.resource"],settings:{sourceId,sourceVersionId:version.id}}});
      const rep=g.addRepresentation({objectId:obj.object.id,modality:"text",format:"txt",blobHash:version.textBlobHash,provenance:"imported",provider:"browser.capture"});
      g.commitVersion({objectId:obj.object.id,forms:[{role:"source.primary",representationId:rep.id}],label:"Browser source added to work path"});
      j.resources.push({id:newId(),sourceId,sourceVersionId:version.id,objectId:obj.object.id,title:source.title,url:source.url,textLength:text.length,partial:version.partial,rights:version.rights,blobHash:version.textBlobHash,pages:0});
      this.invalidate(j);this.save(j,versionId);return this.get(worldId)!;
    })();
  }
  async addUrl(worldId:string,versionId:string,url:string):Promise<Journey> {
    this.read(worldId,versionId);
    const reading=await this.deps.download(url);return this.addResource(worldId,versionId,reading,reading.url);
  }
  async act(command:JourneyCommand):Promise<Journey> {
    const {worldId,versionId}=command;
    if(this.active.has(worldId))throw new Error("Wait for the current step to finish.");
    const j=this.read(worldId,versionId);this.assertAction(j,command);
    this.active.add(worldId);const controller=new AbortController();this.controllers.set(worldId,controller);let completedRun:JourneyRun|null=null;
    try {
      if(command.action==="resource_accept"||command.action==="resource_reject") {
        const suggestion=j.suggestions.find(s=>s.id===command.id);
        if(!suggestion||suggestion.state!=="pending")throw new Error("This source has already been considered.");
        const accepted=command.action==="resource_accept";
        const reading=accepted?await this.deps.download(suggestion.url):null;
        this.read(worldId,versionId);
        this.active.delete(worldId);
        const updated=reading?this.addResource(worldId,versionId,reading,reading.url):j;
        return this.deps.graph.db.transaction(()=>{
          const s=updated.suggestions.find(s=>s.id===command.id)!;
          s.state=accepted?"accepted":"rejected";
          this.choose(updated,`resource:${s.id}`,`Use “${s.title}”?`,[{key:"keep",label:"Add source"},{key:"skip",label:"Skip source"}],accepted?"keep":"skip",command.text);
          s.decisionId=updated.decisions.at(-1)!.objectId;this.save(updated,updated.versionId);return this.get(worldId)!;
        })();
      }
      let model:string|null=null;
      if(PAID.has(command.action)) {
        this.assertMaterial(j);
        const quote=this.quote(command);
        if(command.maximumUsd===undefined||quote.maximumUsd>command.maximumUsd+1e-9)throw new Error("Review this step's current cost before running it.");
        const image=this.imageAction(j,command);
        const m=this.model(image,command.worldId);model=m.model;
        const hold=this.deps.spend.reserve({estimateUsd:quote.maximumUsd,provider:"openrouter",model:m.model,taskId:null,attempt:1});
        let accounted=false;let dispatched=false;
        const run:JourneyRun={id:newId(),action:command.action,state:"running",startedAt:Date.now(),finishedAt:null,maximumUsd:quote.maximumUsd,actualUsd:null,usageKnown:false};
        this.deps.graph.db.prepare("INSERT INTO journey_runs VALUES (?,?,?,?)").run(run.id,worldId,hold.id,JSON.stringify(run));
        const offered=this.selection(j,command.text);j.coverage=offered.coverage;
        try {
          if(image) {
            // Refresh the exact endpoint before dispatch; a price rise requires a new review.
            const fresh=routerImageModel({id:m.model,name:m.label},await routerRequest(this.deps.key()!,`/images/models/${m.model}/endpoints`,undefined,this.deps.fetch,controller.signal),new Date().toISOString().slice(0,10));
            if(!fresh||fresh.imageProvider!==m.imageProvider||fresh.imagePriceUsd!>quote.maximumUsd)throw new Error("The image price changed. Check your connection and review it again.");
            const pathStep=command.action==="run_step"?j.flow!.definition!.steps[j.flow!.index]!:null;
            const sceneResult=command.action==="scene_image"?j.flow!.results.find(r=>r.stepId===j.flow!.definition!.steps[j.flow!.index]!.id)!:null;
            const scene=sceneResult?.output.storyboard!.scenes.find(s=>s.id===command.id);
            const idea=scene?{prompt:JSON.stringify({brief:j.brief,scene,acceptedScript:j.flow!.results.filter(r=>r.accepted).map(r=>r.output)}),caption:scene.title,sourceIds:scene.sourceIds}:pathStep?{prompt:JSON.stringify({goal:this.deps.graph.goals.get(j.goalId)?.outcome,brief:j.brief??null,step:pathStep.instruction,acceptedWork:j.flow!.results.filter(r=>r.accepted).map(r=>({output:r.output,chosen:r.selected,note:r.note})),materials:this.material(j),requestedChange:command.text}),caption:pathStep.title,sourceIds:j.resources.map(r=>r.sourceId)}:command.action==="figure"?j.draft!.figureIdeas[Number(command.id)]!:null;
            const topic=idea?.prompt??j.report!.illustration;
            const prompt=`${ILLUSTRATION_STYLE}\nTopic and grounded brief: ${topic}\n${idea?`Scientific basis: ${JSON.stringify(idea.sourceIds)}`:j.report!.findings.map(f=>f.text).join("\n")}`;
            dispatched=true;
            const output=await generateRouterImage({key:this.deps.key()!,model:m.model,provider:m.imageProvider!,prompt,parameters:fresh.imageParameters,
              reference:this.deps.reference?.(),fetch:this.deps.fetch,signal:controller.signal});
            this.deps.spend.settle(hold.id,{usd:output.cost??quote.maximumUsd,outcome:"ok"});accounted=true;run.actualUsd=output.cost??null;run.usageKnown=output.cost!==undefined;controller.signal.throwIfAborted();
            this.read(worldId,versionId);this.assertMaterial(j);this.assertAction(j,command);
            const bytes=await sharp(output.bytes,{limitInputPixels:25_000_000}).resize({width:1600,height:1200,fit:"inside",withoutEnlargement:true}).png().toBuffer();
            const hash=this.deps.graph.putBlob(bytes,"image/png","png");
            const obj=this.deps.graph.createObject({worldId,title:idea?.caption??"Topic illustration",semanticType:"image",properties:{tags:["journey.illustration"]}});
            const rep=this.deps.graph.addRepresentation({objectId:obj.object.id,modality:"image",format:"png",blobHash:hash,provenance:"generated",provider:"openrouter",model:m.model,generationParams:{prompt}});
            const saved=this.deps.graph.commitVersion({objectId:obj.object.id,forms:[{role:"art.primary",representationId:rep.id}],label:"Conceptual illustration"});
            this.deps.graph.process.record({objectId:obj.object.id,versionId:saved.versionId,kind:"model_step",actor:"model",label:"Generated conceptual illustration",model:m.model,tool:null,inputHashes:[],outputHashes:[hash],durationMs:0});
            if(sceneResult&&scene){sceneResult.sceneImages={...sceneResult.sceneImages,[scene.id]:hash};const state=this.deps.graph.currentState(sceneResult.objectId)!;const rep=this.deps.graph.addRepresentation({objectId:state.object.id,modality:"image",format:"png",blobHash:hash,provenance:"generated",provider:"openrouter",model:m.model});const updated=this.deps.graph.commitVersion({objectId:state.object.id,forms:[...state.forms.filter(f=>f.role!==`scene.${scene.id}`),{role:`scene.${scene.id}`,representationId:rep.id}],label:`Scene: ${scene.title}`});sceneResult.versionId=updated.versionId;}
            else if(pathStep){const output:StepOutput={title:pathStep.title,summary:"Conceptual image for your review.",sections:[],options:[],checks:[pathStep.check],uncertainties:["An illustration is not measured evidence."],sourceIds:idea!.sourceIds};this.pathResult(j,output,model,hash);}
            else if(idea)j.figureIds.push({id:newId(),blobHash:hash,caption:idea.caption,origin:"generated",sourceId:null,page:null,objectId:obj.object.id,sourceIds:idea.sourceIds});
            else j.illustration=hash;
          } else {
            const client=new OpenRouterClient({apiKey:this.deps.key()!,model:m.model,fetch:this.deps.fetch,inputPerMTok:m.price.inputPerMTok,outputPerMTok:m.price.outputPerMTok,signal:controller.signal,reasoning:m.reasoning});
            dispatched=true;
            const result=await client.chat({system:command.action==="design_path"?PATH_PLANNER_PROMPT:EDITOR_SYSTEM,user:this.input(j,command),maxOutputTokens:outputTokens(command.action,m)},command.action==="search");
            this.deps.spend.settle(hold.id,{usd:result.cost??quote.maximumUsd,inputTokens:result.inputTokens,outputTokens:result.outputTokens,outcome:"ok"});accounted=true;run.actualUsd=result.cost??null;run.usageKnown=result.cost!==undefined;controller.signal.throwIfAborted();
            this.read(worldId,versionId);this.assertMaterial(j);this.assertAction(j,command);
            if(command.action==="search") {
              const citations=[...new Map(result.citations.map(c=>[c.url,c])).values()].slice(0,6);
              if(!citations.length)throw new Error("No cited resources were returned. Try a more specific topic or add your own sources.");
              for(const citation of citations)if(!j.suggestions.some(s=>s.url===citation.url))j.suggestions.push({id:newId(),title:citation.title,url:citation.url,excerpt:citation.content.slice(0,600),state:"pending",decisionId:null});
            } else {
              let value:unknown;try{value=JSON.parse(result.text.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim());}
              catch{throw new Error("The AI's answer was not in a form XENIUR can read, so nothing from it was kept. Run the step again, or choose a better-rated model for this project.");}
              const allowed=new Set(j.resources.map(r=>r.sourceId));
              if(command.action==="design_path") {j.flow!.definition=parsePath(value);j.flow!.approved=false;j.flow!.request=command.text!;j.stage="path";}
              else if(command.action==="run_step") {const step=j.flow!.definition!.steps[j.flow!.index]!;const output=validateStep(value,step.operation,allowed);this.pathResult(j,output,model);j.stage="steps";}
              else if(command.action==="summarize"||command.action==="feedback") {
                const report=ReportSchema.parse(tidyReport(value));this.checkCitations(report.findings.flatMap(f=>f.sourceIds),allowed);run.removedQuotes=this.validateEvidence(report.findings,offered.passages)||undefined;
                if(command.action==="feedback"||j.report) {if(command.action==="feedback")j.feedbackCount++;for(const d of j.decisions)this.deps.graph.decisions.flagForReview(d.objectId);j.decisions=[];j.outline=null;j.draft=null;j.reviewed=false;j.choices={palette:null,font:null,layout:null};}
                this.completeStage(j,"materials",j.resources.map(r=>r.objectId));
                for(const r of j.evidenceReviews??[])if(r.objectId)this.deps.sense.sort(r.objectId,"ignore");j.evidenceReviews=[];j.report=report;j.reportObjectId=this.artifact(j,report.title,report,"document",model);j.illustration=null;j.stage="summary";
              } else if(command.action==="outline"||command.action==="edit_outline") {
                j.outline=OutlineSchema.parse(tidyOutline(value));
                for(const d of j.decisions.filter(d=>d.stage!=="summary"))this.deps.graph.decisions.flagForReview(d.objectId);
                j.decisions=j.decisions.filter(d=>d.stage==="summary");j.draft=null;j.reviewed=false;j.choices={palette:null,font:null,layout:null};
                j.outlineObjectId=this.artifact(j,j.outline.title,j.outline,"document",model);j.stage="outline";
              } else {
                const draft=DraftSchema.parse(tidyDraft(value));run.removedQuotes=this.validateEvidence([...draft.sections,...draft.tables],offered.passages)||undefined;
                this.checkCitations([...draft.sections.flatMap(s=>s.sourceIds),...draft.tables.flatMap(t=>t.sourceIds),...draft.figureIdeas.flatMap(f=>f.sourceIds)],allowed);
                if(draft.tables.some(t=>t.rows.some(r=>r.length!==t.columns.length)))throw new Error("The draft returned an incomplete table. Try again.");
                if(draft.sourceFigureIdeas.some(f=>!j.resources.some(r=>r.sourceId===f.sourceId&&r.pages>=f.page)))throw new Error("A suggested figure did not identify an available PDF page.");
                for(const r of j.evidenceReviews??[])if(!r.target.startsWith("finding:")&&r.objectId)this.deps.sense.sort(r.objectId,"ignore");j.evidenceReviews=(j.evidenceReviews??[]).filter(r=>r.target.startsWith("finding:"));j.draft=draft;j.draftObjectId=this.artifact(j,draft.title,draft,"document",model);j.stage="review";j.reviewed=false;
                this.completeStage(j,"make",[j.draftObjectId]);
                this.deps.graph.goals.setRequiredOutputs(j.goalId,[j.draftObjectId]);this.deps.graph.goals.setFocus(j.goalId,j.draftObjectId);
              }
            }
          }
          completedRun=run;
        } catch(error) {
          run.state=controller.signal.aborted?"cancelled":"failed";if(!dispatched){run.actualUsd=0;run.usageKnown=true;}
          if(!accounted){if(dispatched)this.deps.spend.settle(hold.id,{usd:quote.maximumUsd,outcome:"error"});else this.deps.spend.release(hold.id);}
          throw error;
        } finally {run.finishedAt=Date.now();this.saveRun(run);}
      } else {
        const g=this.deps.graph;
        if(command.action==="save_brief"){const brief=JourneyBriefSchema.parse(command.brief);if(JSON.stringify(j.brief)!==JSON.stringify(brief)){this.invalidate(j);if(j.flow&&!j.flow.approved)j.stage="path";j.brief=brief;g.goals.setOutcome(j.goalId,brief.topic);this.artifact(j,"Your project brief",brief,"document",null);}}
        if(command.action==="approve_path"){this.choose(j,"path","Use this work path?",[{key:"use",label:j.flow!.definition!.title}],"use",command.text,j.id);j.flow!.approved=true;this.installPath(j);j.stage="materials";}
        if(command.action==="begin_path")j.stage="steps";
        if(command.action==="record_step"){const step=j.flow!.definition!.steps[j.flow!.index]!;this.pathResult(j,{title:step.title,summary:"Recorded by you",sections:[{heading:"What happened",text:command.text!}],options:[],checks:[step.check],uncertainties:[],sourceIds:[]},null);}
        if(command.action==="edit_step"){const step=j.flow!.definition!.steps[j.flow!.index]!;this.pathResult(j,validateStep(command.stepOutput,step.operation,new Set(j.resources.map(r=>r.sourceId))),null,j.flow!.results.find(r=>r.stepId===step.id)?.imageHash);}
        if(command.action==="reopen_step"){const f=j.flow!,index=f.definition!.steps.findIndex(s=>s.id===command.id);const removed=f.results.filter(r=>f.definition!.steps.findIndex(s=>s.id===r.stepId)>=index);for(const r of removed){if(r.decisionId)g.decisions.flagForReview(r.decisionId);if(g.plans.workOf(j.goalId,`path.${r.stepId}`))g.plans.setExecution(j.goalId,`path.${r.stepId}`,"needs_review",{note:"An earlier step was reopened."});}f.results=f.results.filter(r=>!removed.includes(r));f.index=index;j.reviewed=false;j.stage="steps";}
        if(command.action==="approve_step"){
          const f=j.flow!,step=f.definition!.steps[f.index]!,r=f.results.find(r=>r.stepId===step.id)!;
          this.choose(j,`path.${step.id}`,`Accept ${step.title}?`,step.operation==="compare"?r.output.options.map(o=>({key:o.id,label:o.title})):[{key:"use",label:"Use this result"}],step.operation==="compare"?command.id!:"use",command.text,r.objectId);
          r.accepted=true;r.selected=step.operation==="compare"?command.id:undefined;r.note=command.text;r.decisionId=j.decisions.at(-1)!.objectId;
          g.plans.setInputs(j.goalId,`path.${step.id}`,[r.objectId,r.decisionId]);g.plans.setExecution(j.goalId,`path.${step.id}`,"complete");f.index++;j.stage="steps";j.reviewed=f.index===f.definition!.steps.length;
          if(j.reviewed){g.goals.setRequiredOutputs(j.goalId,f.results.map(r=>r.objectId));g.goals.setStatus(j.goalId,"reviewing");}
        }
        if(command.action==="remove_resource") {
          if(!j.resources.some(r=>r.id===command.id))throw new Error("Choose a resource in this path.");
          j.resources=j.resources.filter(r=>r.id!==command.id);this.invalidate(j);
        }
        if(command.action==="approve_summary") {this.choose(j,"summary","Use this resource report?",[{key:"keep",label:"Use report"},{key:"change",label:"Change report"}],"keep",command.text,j.reportObjectId);j.stage="outline";}
        if(command.action==="review_evidence") {
          const match=/^(finding|section|table):(\d+)$/.exec(command.id!);const item=match?.[1]==="finding"?j.report?.findings[Number(match[2])]:match?.[1]==="section"?j.draft?.sections[Number(match[2])]:match?.[1]==="table"?j.draft?.tables[Number(match[2])]:null;
          if(!item)throw new Error("Choose current evidence to review.");
          const previous=j.evidenceReviews?.find(r=>r.target===command.id);if(previous?.objectId)this.deps.sense.sort(previous.objectId,"ignore");
          const claimText="text" in item?item.text:"paragraphs" in item?item.paragraphs.join("\n\n"):item.title;
          const atom=this.deps.sense.createAtom({worldId,atomType:"claim",text:claimText,provenance:"human",lane:"keep"});
          for(const citation of item.citations??[])g.support.record({claimObjectId:atom.objectId,sourceVersionId:citation.sourceVersionId,
            locator:{selectors:[{type:"TextQuoteSelector",exact:citation.quote,prefix:"",suffix:""},...(citation.page?[{type:"PageSelector" as const,page:citation.page}]:[])]},
            status:command.evidenceState==="supports"?"supported":command.evidenceState==="contradicts"?"contradicted":"ambiguous",checkedBy:"human",note:command.text});
          this.artifact(j,"Your evidence check",{target:command.id,state:command.evidenceState,note:command.text,basis:item,claimObjectId:atom.objectId},"document",null);
          if(command.evidenceState!=="supports"){for(const d of j.decisions.filter(d=>d.stage==="review"||d.stage==="summary"))g.decisions.flagForReview(d.objectId);j.reviewed=false;}

          j.evidenceReviews=[...(j.evidenceReviews??[]).filter(r=>r.target!==command.id),{target:command.id!,state:command.evidenceState!,note:command.text!,at:Date.now(),objectId:atom.objectId}];
          this.recordOutcome(worldId,"evidence_reviewed");
        }
        if(command.action==="use_design_defaults") {
          const palette=j.report!.palettes[0]!;this.resetAfter(j,"palette");
          this.choose(j,"palette","Use suggested colors",[{key:palette.id,label:palette.name}],palette.id,"Suggested design accepted by the person.");
          this.choose(j,"font","Use suggested type",[{key:"erewhon",label:"Erewhon"}],"erewhon","Suggested design accepted by the person.");
          this.choose(j,"layout","Use suggested layout",[{key:"field",label:"Field notes"}],"field","Suggested design accepted by the person.");
          j.choices={palette:palette.id,font:"erewhon",layout:"field"};j.stage="make";
        }
        if(command.action==="approve_outline") {this.choose(j,"outline","Use this structure?",[{key:"keep",label:"Use structure"},{key:"change",label:"Change structure"}],"keep",command.text,j.outlineObjectId);j.stage="palette";}
        if(command.action==="choose_palette") {
          const palette=j.report!.palettes.find(p=>p.id===command.id);if(!palette)throw new Error("Choose one of these palettes.");
          this.resetAfter(j,"palette");this.choose(j,"palette","Choose colors",j.report!.palettes.map(p=>({key:p.id,label:p.name})),palette.id,command.text);j.choices.palette=palette.id;j.stage="font";
        }
        if(command.action==="choose_font") {const font=JOURNEY_FONTS.find(f=>f.id===command.id);if(!font)throw new Error("Choose one of these fonts.");this.resetAfter(j,"font");this.choose(j,"font","Choose type",JOURNEY_FONTS.map(f=>({key:f.id,label:f.name})),font.id,command.text);j.choices.font=font.id;j.stage="layout";}
        if(command.action==="choose_layout") {const layout=JOURNEY_LAYOUTS.find(l=>l.id===command.id);if(!layout)throw new Error("Choose one of these layouts.");this.resetAfter(j,"layout");this.choose(j,"layout","Choose layout",JOURNEY_LAYOUTS.map(l=>({key:l.id,label:l.name})),layout.id,command.text);j.choices.layout=layout.id;j.stage="make";}
        if(command.action==="edit_draft") {
          const section = j.draft!.sections[Number(command.id)];
          if(!section || !command.text?.trim())throw new Error("Choose a section and write your revision.");
          const previousCheck=j.evidenceReviews?.find(r=>r.target===`section:${command.id}`);if(previousCheck?.objectId)this.deps.sense.sort(previousCheck.objectId,"ignore");section.citations=[];j.evidenceReviews=(j.evidenceReviews??[]).filter(r=>r.target!==`section:${command.id}`);section.paragraphs=command.text.trim().split(/\n\s*\n/).slice(0,15);
          const current=g.currentState(j.draftObjectId!)!;
          const blob=g.putBlob(Buffer.from(JSON.stringify(j.draft,null,2)),"application/json","json");
          const rep=g.addRepresentation({objectId:j.draftObjectId!,modality:"text",format:"json",blobHash:blob,provenance:"human",provider:"local.editor"});
          const saved=g.commitVersion({objectId:j.draftObjectId!,expectedBaseVersionId:current.versionId,forms:[{role:"doc.primary",representationId:rep.id}],label:"Author revised a section"});
          g.process.record({objectId:j.draftObjectId!,versionId:saved.versionId,kind:"manual_edit",actor:"human",label:"Revised a section",tool:null,model:null,inputHashes:[],outputHashes:[blob],durationMs:0});
          for(const d of j.decisions.filter(d=>d.stage==="review"))g.decisions.flagForReview(d.objectId);
          j.decisions=j.decisions.filter(d=>d.stage!=="review");j.reviewed=false;
        }
        if(command.action==="review") {this.choose(j,"review","Ready to use this draft?",[{key:"keep",label:"Reviewed draft"},{key:"change",label:"Needs changes"}],"keep",command.text,j.draftObjectId);j.reviewed=true;g.goals.setStatus(j.goalId,"reviewing");}
      }
      if(command.action==="review")this.recordOutcome(worldId,"review_completed");
      if(command.action==="reopen_step")this.recordOutcome(worldId,"decision_revised");
      this.read(worldId,versionId);
      controller.signal.throwIfAborted();
      this.deps.graph.db.transaction(()=>{this.save(j,versionId);if(completedRun){completedRun.state="succeeded";this.saveRun(completedRun);}})();return this.get(worldId)!;
    } catch(error){if(completedRun){completedRun.state=controller.signal.aborted?"cancelled":"failed";this.saveRun(completedRun);}throw error;} finally {this.active.delete(worldId);this.controllers.delete(worldId);}
  }
  private pathResult(j:Journey,output:StepOutput,model:string|null,imageHash?:string) {
    if(findKeyShaped(output).length)throw new Error("Remove credentials from this result.");
    const f=j.flow!,step=f.definition!.steps[f.index]!;
    const objectId=this.artifact(j,output.title,output,"document",model);
    let state=this.deps.graph.currentState(objectId)!;
    const result:PathResult={stepId:step.id,objectId,versionId:state.versionId,output,accepted:false,...(imageHash?{imageHash}:{})};
    const svg=output.identity?renderBrandVisual(output,this.deps.projectRoot??process.cwd()):renderPathVisual(output);
    if(svg){const hash=this.deps.graph.putBlob(Buffer.from(svg),"image/svg+xml","svg");const rep=this.deps.graph.addRepresentation({objectId,modality:"image",format:"svg",blobHash:hash,provenance:"deterministic",provider:"local.path-visual"});state=this.deps.graph.commitVersion({objectId,forms:[...state.forms,{role:"art.primary",representationId:rep.id}],label:"Rendered visual"});result.svgHash=hash;}
    if(imageHash){const rep=this.deps.graph.addRepresentation({objectId,modality:"image",format:"png",blobHash:imageHash,provenance:model?"generated":"human",provider:model?"openrouter":"local.editor",model});state=this.deps.graph.commitVersion({objectId,forms:[...state.forms,{role:"art.primary",representationId:rep.id}],label:"Conceptual image"});}
    if(output.project){const hash=this.deps.graph.putBlob(Buffer.from(JSON.stringify(output.project)),"application/json","json");const rep=this.deps.graph.addRepresentation({objectId,modality:"code",format:"json",blobHash:hash,provenance:model?"generated":"human",provider:model?"openrouter":"local.editor",model});state=this.deps.graph.commitVersion({objectId,forms:[...state.forms,{role:"code.project",representationId:rep.id}],label:"Project files"});result.codeObjectId=objectId;}
    this.deps.graph.goals.setFocus(j.goalId,objectId);
    const previous=f.results.find(r=>r.stepId===step.id);
    if(output.storyboard&&previous?.output.storyboard){const unchanged=output.storyboard.scenes.filter(s=>JSON.stringify(previous.output.storyboard!.scenes.find(v=>v.id===s.id))===JSON.stringify(s));result.sceneImages=Object.fromEntries(unchanged.flatMap(s=>previous.sceneImages?.[s.id]?[[s.id,previous.sceneImages[s.id]!]]:[]));for(const [id,hash] of Object.entries(result.sceneImages)){const rep=this.deps.graph.addRepresentation({objectId,modality:"image",format:"png",blobHash:hash,provenance:"generated",provider:"openrouter"});state=this.deps.graph.commitVersion({objectId,forms:[...state.forms,{role:`scene.${id}`,representationId:rep.id}],label:"Retained scene illustration"});}}
    result.versionId=state.versionId;f.results=f.results.filter(r=>r.stepId!==step.id);f.results.push(result);j.reviewed=false;
  }
  private checkCitations(ids:string[],allowed:Set<string>) {if(ids.some(id=>!allowed.has(id)))throw new Error("The draft cited material outside this project. It was not saved.");}
  saveSourceFigure(worldId:string,versionId:string,resourceId:string,page:number,bytes:Buffer,caption:string):Journey {
    const j=this.read(worldId,versionId);if(this.active.has(worldId))throw new Error("Wait for the current step.");
    const source=j.resources.find(r=>r.id===resourceId);if(!source)throw new Error("Choose a source from this project.");
    if(!j.draft)throw new Error("Create the draft first.");
    const hash=this.deps.graph.putBlob(bytes,"image/png","png");
    const objectId=this.artifact(j,caption,{sourceId:source.sourceId,page,caption},"image");
    const rep=this.deps.graph.addRepresentation({objectId,modality:"image",format:"png",blobHash:hash,provenance:"deterministic",provider:"local.pdf-crop",generationParams:{sourceVersionId:source.sourceVersionId,page}});
    this.deps.graph.commitVersion({objectId,forms:[{role:"art.primary",representationId:rep.id}],label:"Source figure crop"});
    j.figureIds.push({id:newId(),blobHash:hash,caption,origin:"source",sourceId:source.sourceId,page,objectId,sourceIds:[source.sourceId]});
    j.reviewed=false;this.save(j,versionId);return this.get(worldId)!;
  }
}
