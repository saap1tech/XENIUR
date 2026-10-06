import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { mkdtempSync,rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ObjectGraph, SpendLedger } from "@xeniur/graph";
import { SensemakingStore } from "@xeniur/sensemaking";
import sharp from "sharp";
import { ModelEntrySchema } from "@xeniur/models";
import { builtInPath, type StepOutput, type Journey, type JourneyCommand } from "@xeniur/core";
import { JourneyStore } from "./store.js";
import { texEscape,renderJourneyTex,documentFiles,compileFiles,pathFiles } from "./document.js";
import { readResource,cropPdfFigure } from "./resources.js";
let graph:ObjectGraph,sense:SensemakingStore,store:JourneyStore,dir:string,worldId:string;
let reply:any,calls:any[],downloaded:string[];
const reading={title:"Real notes",text:"The measured cell operated under a stated current and duration. Those conditions do not establish the full process energy requirement.",raw:Buffer.from("notes"),pdf:false,partial:false,pages:0};
const model=ModelEntrySchema.parse({id:"router",model:"example/llm",provider:"openrouter",label:"LLM",contextWindow:100000,price:{inputPerMTok:.3,outputPerMTok:2.5,verifiedOn:"2026-09-28"},modelVerified:true});
beforeEach(()=>{
 dir=mkdtempSync(join(tmpdir(),"xeniur-journey-"));graph=ObjectGraph.open({dbPath:join(dir,"work.db"),blobDir:join(dir,"blobs")});sense=new SensemakingStore(graph,{frictionThreshold:5});
 worldId=graph.createWorld({title:"Electrolysis review",emoji:"R"}).id;graph.goals.create(worldId,"Review electrolysis evidence");calls=[];downloaded=[];reply={};
 store=new JourneyStore({graph,sense,spend:new SpendLedger(graph.db,{perActionUsdMax:1,perTaskUsdMax:5,totalUsdMax:100}),models:()=>[model],key:()=>"test-key",
 download:async(url)=>{downloaded.push(url);return {...reading,url};},fetch:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(reply),annotations:reply.annotations??[]}}],usage:{prompt_tokens:10,completion_tokens:10,cost:.001}}));}});
});
afterEach(()=>{graph.close();rmSync(dir,{recursive:true,force:true});});
function report(j:Journey){return {title:"Electrolysis evidence",summary:"Conditions matter.",findings:[{text:"The measurement applies to these conditions.",sourceIds:j.resources.map(r=>r.sourceId)}],gaps:["Whole-process energy is missing."],illustration:"A conceptual cell",palettes:[{id:"moss",name:"Moss",colors:["#234530","#88AA77","#FAF8F1"]},{id:"sea",name:"Sea",colors:["#223344","#99AAAA","#FAF8F1"]}]};}
function c(j:Journey,action:JourneyCommand["action"],extra:Partial<JourneyCommand>={}):JourneyCommand{return {worldId,versionId:j.versionId,action,...extra};}
async function paid(j:Journey,action:JourneyCommand["action"],extra:Partial<JourneyCommand>={}){const command=c(j,action,extra);return store.act({...command,maximumUsd:store.quote(command).maximumUsd});}
function start(){const j=store.start(worldId,"review");return store.addResource(worldId,j.versionId,reading);}
describe("real-work journey",()=>{
 it("adopts the exact browser source and preserves privacy, rights and invalidation",async()=>{
  let j=store.start(worldId,"review");const source=sense.recordSource({worldId,kind:"clip",title:"Visible authenticated copy",text:reading.text,url:"https://example.org/actual",rights:"unknown",metadata:{capturedFrom:"visible_session"}});
  j=store.attachSource(worldId,j.versionId,source.id);expect(j.resources[0]!.sourceVersionId).toBe(sense.latestVersionOf(source.id)!.id);expect(sense.listSources(worldId)).toHaveLength(1);
  const unchanged=store.attachSource(worldId,j.versionId,source.id);expect(unchanged.versionId).toBe(j.versionId);
  const privateSource=sense.recordSource({worldId,kind:"clip",title:"Private source",text:reading.text,metadata:{aiProcessing:"never"}});
  expect(()=>store.attachSource(worldId,j.versionId,privateSource.id)).toThrow("private");
 });
 it("stores a human evidence check as real claim support and reopens accepted work",async()=>{
  let j=start();const {EvidenceIndex}=await import("./evidence.js");const index=new EvidenceIndex(graph),resource=j.resources[0]!,version=sense.getSourceVersion(resource.sourceVersionId)!;index.ensure(resource,graph.readBlob(version.textBlobHash).toString("utf8"));const p=index.select([resource],"measurement").passages[0]!;
  reply=report(j);reply.findings[0].citations=[{passageId:p.id,sourceId:p.sourceId,sourceVersionId:p.sourceVersionId,page:p.page,quote:"Those conditions do not establish the full process energy requirement."}];
  j=await paid(j,"summarize");j=await store.act(c(j,"approve_summary"));const accepted=j.decisions.find(d=>d.stage==="summary")!;
  j=await store.act(c(j,"review_evidence",{id:"finding:0",evidenceState:"contradicts",text:"This passage qualifies the claim; it does not establish the full process result."}));
  const check=j.evidenceReviews![0]!;expect(graph.support.of(check.objectId!)[0]).toMatchObject({status:"contradicted",checkedBy:"human"});expect(graph.decisions.get(accepted.objectId)!.state).toBe("needs_review");expect(graph.support.of(j.reportObjectId!)).toEqual([]);
  expect(store.insights(worldId).outcomes.evidence_reviewed).toBe(1);
 });
 it("cancels dispatched work without replacing the previous project and distinguishes unknown costs",async()=>{
  const j=start();let dispatched!:()=>void;const ready=new Promise<void>(resolve=>dispatched=resolve);
  store=new JourneyStore({graph,sense,spend:new SpendLedger(graph.db,{perActionUsdMax:1,perTaskUsdMax:5,totalUsdMax:100}),models:()=>[model],key:()=>"test-key",download:async()=>({...reading,url:""}),fetch:async(_url,init)=>{dispatched();return new Promise((_resolve,reject)=>init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true}));}});
  const pending=paid(j,"summarize");await ready;expect(store.cancel(worldId)).toBe(true);await expect(pending).rejects.toThrow("Stopped");expect(store.get(worldId)!.versionId).toBe(j.versionId);expect(store.get(worldId)!.report).toBeNull();expect(store.insights(worldId).runs[0]).toMatchObject({state:"cancelled",actualUsd:null,usageKnown:false});expect(store.cancel(worldId)).toBe(false);
 });
 it("records provider-reported charges and marks abandoned runs interrupted on restart",async()=>{
  const j=start();reply=report(j);await paid(j,"summarize");const success=store.insights(worldId).runs[0]!;expect(success).toMatchObject({state:"succeeded",actualUsd:.001,usageKnown:true});
  graph.db.prepare("INSERT INTO journey_runs VALUES (?,?,NULL,?)").run("abandoned",worldId,JSON.stringify({...success,id:"abandoned",state:"running",finishedAt:null,actualUsd:null,usageKnown:false}));
  const recovered=new JourneyStore({graph,sense,spend:new SpendLedger(graph.db,{perActionUsdMax:1,perTaskUsdMax:5,totalUsdMax:100}),models:()=>[model],key:()=>null,download:async()=>({...reading,url:""})});expect(recovered.insights(worldId).runs[0]!.state).toBe("interrupted");
 });

 it("runs the reviewed path, records decisions and persists the actual draft",async()=>{
  let j=start();reply=report(j);j=await paid(j,"summarize");
  expect(graph.currentState(j.reportObjectId!)!.forms[0]!.role).toBe("doc.primary");expect(graph.process.events(j.reportObjectId!).some(e=>e.actor==="model")).toBe(true);
  j=await store.act(c(j,"approve_summary"));reply={title:"Structure",sections:[{id:"scope",title:"Scope",purpose:"Define scope",children:[{title:"Conditions",children:["Duration"]}]}]};j=await paid(j,"outline");j=await store.act(c(j,"approve_outline"));
  for(const [action,id] of [["choose_palette","moss"],["choose_font","erewhon"],["choose_layout","journal"]] as const)j=await store.act(c(j,action,{id}));
  reply={title:"Review",abstract:"A narrow review.",sections:[{title:"Scope",level:1,paragraphs:["The sample measurement applies to the stated operating conditions."],sourceIds:j.resources.map(r=>r.sourceId)}],tables:[{title:"Checks",columns:["Aspect","Available"],rows:[["Duration","Stated"]],sourceIds:[]}],figureIdeas:[],limitations:["No complete system comparison."]};j=await paid(j,"draft");
  expect(j.stage).toBe("review");expect(j.reviewed).toBe(false);j=await store.act(c(j,"review",{text:"I checked the narrow scope and the source conditions."}));
  expect(j.decisions).toHaveLength(6);expect(j.decisions.every(d=>graph.decisions.get(d.objectId)!.state==="accepted")).toBe(true);
  expect(graph.support.of(j.reportObjectId!)).toEqual([]); // No automatic truth certification.
  graph.close();graph=ObjectGraph.open({dbPath:join(dir,"work.db"),blobDir:join(dir,"blobs")});
  const reopened=new JourneyStore({graph,sense:new SensemakingStore(graph,{frictionThreshold:5}),spend:new SpendLedger(graph.db,{perActionUsdMax:1,perTaskUsdMax:5,totalUsdMax:100}),models:()=>[],key:()=>null,download:async()=>({...reading,url:""})});
  expect(reopened.get(worldId)!.draft?.title).toBe("Review");expect(reopened.get(worldId)!.reviewed).toBe(true);
 });
 it("downloads only an individually accepted citation and records rejection separately",async()=>{
  let j=store.start(worldId,"review");reply={annotations:[{type:"url_citation",url_citation:{url:"https://example.org/a",title:"A",content:"a"}},{type:"url_citation",url_citation:{url:"https://example.org/b",title:"B",content:"b"}}]};j=await paid(j,"search");expect(downloaded).toEqual([]);
  j=await store.act(c(j,"resource_reject",{id:j.suggestions[0]!.id}));expect(downloaded).toEqual([]);
  j=await store.act(c(j,"resource_accept",{id:j.suggestions[1]!.id}));expect(downloaded).toEqual(["https://example.org/b"]);expect(j.resources).toHaveLength(1);expect(j.suggestions.map(s=>s.state)).toEqual(["rejected","accepted"]);
 });
 it("refuses unreviewed costs, stale versions, unknown citations and incorrect stage order",async()=>{
  const j=start();reply=report(j);
  await expect(store.act(c(j,"summarize"))).rejects.toThrow("cost");expect(calls).toHaveLength(0);
  await expect(store.act(c(j,"choose_font",{id:"erewhon"}))).rejects.toThrow("colors");
  reply={...report(j),findings:[{text:"Invented basis",sourceIds:["11111111-1111-4111-8111-111111111111"]}]};
  await expect(paid(j,"summarize")).rejects.toThrow("outside this project");expect(store.get(worldId)!.report).toBeNull();
  store.addResource(worldId,j.versionId,reading);expect(()=>store.quote(c(j,"summarize"))).toThrow("changed");
 });
 it("blocks private material, changed source copies and credentials before a model call",async()=>{
  let j=start();graph.setProperties(j.resources[0]!.objectId,{settings:{aiProcessing:"never"}});
  expect(()=>store.quote(c(j,"summarize"))).toThrow("private");expect(calls).toHaveLength(0);
  expect(()=>store.addResource(worldId,j.versionId,{...reading,text:"sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789"})).toThrow("credentials");
  graph.setProperties(j.resources[0]!.objectId,{settings:{}});sense.addSourceVersion({sourceId:j.resources[0]!.sourceId,text:"Changed source"});
  expect(()=>store.quote(c(j,"summarize"))).toThrow("newer copy");
 });
 it("caps discussion and resets dependent work when material is added",async()=>{
  let j=start();reply=report(j);j=await paid(j,"summarize");
  for(let i=0;i<3;i++)j=await paid(j,"feedback",{text:"Keep the scope explicit."});
  await expect(paid(j,"feedback",{text:"One more edit."})).rejects.toThrow("Three");
  j=await store.act(c(j,"approve_summary"));const decision=j.decisions[0]!.objectId;
  j=store.addResource(worldId,j.versionId,reading);expect(j.report).toBeNull();expect(j.stage).toBe("materials");expect(graph.decisions.get(decision)!.state).toBe("needs_review");
 });
 it("pins and refreshes a priced image endpoint, stores a real raster and releases unused holds",async()=>{
  let j=start();reply=report(j);j=await paid(j,"summarize");
  const image=ModelEntrySchema.parse({...model,id:"drawing",model:"example/drawing",output:"image",imagePriceUsd:.04,imageProvider:"priced",imageParameters:{output_format:{type:"enum",values:["png"]}}});
  const bytes=await sharp({create:{width:40,height:30,channels:3,background:"#29483D"}}).png().toBuffer();
  const spend=new SpendLedger(graph.db,{perActionUsdMax:1,perTaskUsdMax:5,totalUsdMax:100});let price=.04;const imageCalls:any[]=[];
  store=new JourneyStore({graph,sense,spend,models:()=>[model,image],key:()=>"test-key",download:async()=>({...reading,url:""}),fetch:async(url,init)=>{
    imageCalls.push({url,init});
    if(init?.method==="GET")return new Response(JSON.stringify({id:image.model,endpoints:[{provider_tag:"priced",pricing:[{billable:"output_image",unit:"image",cost_usd:price}],supported_parameters:image.imageParameters}]}));
    const body=JSON.parse(init!.body as string);expect(body.provider).toEqual({only:["priced"],allow_fallbacks:false});expect(body.output_format).toBe("png");expect(body.prompt).toContain("XENIUR editorial illustration");expect(body.prompt).toContain("no eyes");
    return new Response(JSON.stringify({data:[{b64_json:bytes.toString("base64"),media_type:"image/png"}],usage:{cost:.035}}));
  }});
  const before=spend.summary().settledUsd;
  j=await paid(j,"illustrate");expect(imageCalls.map(c=>c.init.method)).toEqual(["GET","POST"]);expect(imageCalls[1].url).toBe("https://openrouter.ai/api/v1/images");
  expect(await sharp(graph.readBlob(j.illustration!)).metadata()).toMatchObject({format:"png",width:40,height:30});
  expect(spend.summary().settledUsd-before).toBeCloseTo(.035);
  const spent=spend.summary();price=.05;
  await expect(paid(j,"illustrate")).rejects.toThrow("price changed");expect(imageCalls.map(c=>c.init.method)).toEqual(["GET","POST","GET"]);expect(spend.summary()).toEqual(spent);
 });
 it("exports escaped TeX and reads the compiled PDF and its original source crop",async()=>{
  const j=start();j.draft={title:"A & B",abstract:"Evidence",sections:[{title:"Limits",level:1,paragraphs:["Never execute \\input{/private/file}."],sourceIds:[j.resources[0]!.sourceId]}],tables:[],figureIdeas:[],sourceFigureIdeas:[],limitations:["Narrow scope."]};j.choices={palette:null,font:"cochineal",layout:"field"};j.reviewed=true;
  expect(texEscape("\\write18{cmd}")).toBe("\\textbackslash{}write18\\{cmd\\}");expect(renderJourneyTex(j)).not.toContain("\\input{/private/file}");
  const result=await compileFiles(documentFiles(j,graph,process.cwd()),dir);
  if(!result.pdf){expect(result.warning).toBeTruthy();expect(documentFiles(j,graph,process.cwd())["review.html"]).toBeDefined();return;}
  const parsed=await readResource(result.pdf!,"review.pdf","application/pdf");expect(parsed.text).toContain("Limits");expect(parsed.pages).toBeGreaterThan(0);
  const crop=await cropPdfFigure(result.pdf!,1,{x:0,y:0,width:1,height:.5});expect(crop.subarray(1,4).toString()).toBe("PNG");
 },70000);
});

const result=(extra:Partial<StepOutput>={}):StepOutput=>({title:"Working result",summary:"Specific content",sections:[{heading:"Brief",text:"A usable result with explicit constraints."}],options:[],checks:["Check the actual result."],uncertainties:[],sourceIds:[],...extra});
describe("general work paths",()=>{
 it("uses the human brief and reopens dependent work when it changes",async()=>{
  let j=store.start(worldId,"software");
  const brief={topic:"A repair booking prototype",audience:"Our front desk",notes:"Work offline",language:"English"};
  j=await store.act(c(j,"save_brief",{brief}));expect(calls).toHaveLength(0);expect(graph.goals.get(j.goalId)!.outcome).toBe(brief.topic);
  j=await store.act(c(j,"begin_path"));reply=result();j=await paid(j,"run_step");
  expect(calls[0].init.body).toContain("A repair booking prototype");expect(calls[0].init.body).toContain("Work offline");
  j=await store.act(c(j,"approve_step"));const accepted=j.flow!.results[0]!.decisionId!;
  j=await store.act(c(j,"save_brief",{brief:{...brief,topic:"An inventory prototype"}}));
  expect(j.stage).toBe("materials");expect(j.flow!.results).toEqual([]);expect(j.flow!.index).toBe(0);expect(graph.decisions.get(accepted)!.state).toBe("needs_review");
  await expect(store.act(c(j,"save_brief",{brief:{...brief,notes:"sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789"}}))).rejects.toThrow("credentials");
  expect(calls).toHaveLength(1);
 });
 it("keeps scene art only for unchanged scenes and exports the actual storyboard assets",async()=>{
  let j=store.start(worldId,"script");j=await store.act(c(j,"begin_path"));
  for(let i=0;i<3;i++){reply=result(i===1?{options:[{id:"a",title:"A",reason:"Simple",tradeoff:"Short"},{id:"b",title:"B",reason:"Broader",tradeoff:"Long"}]}:{});j=await paid(j,"run_step");j=await store.act(c(j,"approve_step",{id:i===1?"a":undefined}));}
  const scene={id:"opening",title:"Opening",seconds:20,visual:"A man repairs a wooden chair in a calm workshop.",narration:"A second life.",sourceIds:[]};
  reply=result({storyboard:{aspect:"16:9",scenes:[scene,{...scene,id:"closing",title:"Closing"}]}});j=await paid(j,"run_step");
  expect(()=>store.quote(c(j,"scene_image",{id:"not-a-scene"}))).toThrow("Choose a scene");
  const image=ModelEntrySchema.parse({...model,id:"drawing",model:"example/drawing",output:"image",imagePriceUsd:.04,imageProvider:"priced",imageParameters:{output_format:{type:"enum",values:["png"]}}});
  const bytes=await sharp({create:{width:40,height:30,channels:3,background:"#29483D"}}).png().toBuffer();let dispatches=0;
  store=new JourneyStore({graph,sense,spend:new SpendLedger(graph.db,{perActionUsdMax:1,perTaskUsdMax:5,totalUsdMax:100}),models:()=>[model,image],key:()=>"test-key",download:async()=>({...reading,url:""}),fetch:async(url,init)=>{
   if(init?.method==="GET")return new Response(JSON.stringify({id:image.model,endpoints:[{provider_tag:"priced",pricing:[{billable:"output_image",unit:"image",cost_usd:.04}],supported_parameters:image.imageParameters}]}));
   if(String(url).endsWith("/chat/completions"))return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(reply)}}],usage:{prompt_tokens:10,completion_tokens:10,cost:.001}}));
   dispatches++;expect(JSON.parse(init!.body as string).prompt).toContain("wooden chair");return new Response(JSON.stringify({data:[{b64_json:bytes.toString("base64"),media_type:"image/png"}],usage:{cost:.035}}));
  }});
  await expect(store.act(c(j,"scene_image",{id:"opening"}))).rejects.toThrow("cost");expect(dispatches).toBe(0);
  j=await paid(j,"scene_image",{id:"opening"});j=await paid(j,"scene_image",{id:"closing"});const original=j.flow!.results.at(-1)!;
  expect(original.sceneImages?.opening).toBeTruthy();expect(graph.currentState(original.objectId)!.forms.some(f=>f.role==="scene.opening")).toBe(true);
  const edited=structuredClone(original.output);edited.storyboard!.scenes[0]!.narration="Repair what matters.";
  j=await store.act(c(j,"edit_step",{stepOutput:edited}));const candidate=j.flow!.results.at(-1)!;
  expect(candidate.sceneImages?.opening).toBeUndefined();expect(candidate.sceneImages?.closing).toBe(original.sceneImages?.closing);
  expect(graph.currentState(candidate.objectId)!.forms.some(f=>f.role==="scene.closing")).toBe(true);
  j=await store.act(c(j,"approve_step"));expect(()=>store.quote(c(j,"scene_image",{id:"closing"}))).toThrow("Choose a scene");
  for(let i=0;i<2;i++){reply=result();j=await paid(j,"run_step");j=await store.act(c(j,"approve_step",{text:i===1?"I checked the script, scene order and estimated timing.":undefined}));}
  const files=await pathFiles(j,graph);expect(files["04-scenes/scenes/closing.png"]).toEqual(graph.readBlob(original.sceneImages!.closing!));expect(files["04-scenes/scenes/opening.png"]).toBeUndefined();expect(Buffer.from(files["04-scenes/result.md"]!).toString()).toContain("Repair what matters.");
 });
 it("keeps document workflows and defines real experiment and script paths",()=>{
  const j=store.start(worldId,"experiment");expect(j.flow).toBeUndefined();expect(j.stage).toBe("materials");
  expect(builtInPath("software")!.steps.map(s=>s.operation)).toEqual(["brief","compare","plan","code","check"]);
 });
 it("requires approval of a custom proposal and refuses invented capabilities",async()=>{
  let j=store.start(worldId,"custom");expect(j.stage).toBe("path");expect(()=>store.quote(c(j,"run_step"))).toThrow("Approve your path");
  reply={...builtInPath("marketing_page"),steps:[{id:"bad",title:"Deploy",operation:"shell",instruction:"Execute arbitrary commands",check:"Work completed"}]};
  await expect(paid(j,"design_path",{text:"Make a launch plan."})).rejects.toThrow();expect(store.get(worldId)!.flow!.definition).toBeNull();
  reply=builtInPath("marketing_page");j=await paid(j,"design_path",{text:"Make a launch plan."});expect(j.flow!.approved).toBe(false);
  j=await store.act(c(j,"approve_path"));expect(j.flow!.approved).toBe(true);expect(graph.decisions.get(j.decisions[0]!.objectId)!.state).toBe("accepted");
 });
 it("makes and exports a real single-page result after choices and human review",async()=>{
  let j=store.start(worldId,"marketing_page");j=await store.act(c(j,"begin_path"));reply=result();j=await paid(j,"run_step");
  j=await store.act(c(j,"approve_step"));reply=result({options:[{id:"a",title:"One audience",reason:"Focus",tradeoff:"Limited reach"},{id:"b",title:"Two audiences",reason:"Explore",tradeoff:"More cost"}]});j=await paid(j,"run_step");
  await expect(store.act(c(j,"approve_step"))).rejects.toThrow("Choose an option");j=await store.act(c(j,"approve_step",{id:"a",text:"Focus on one audience first."}));
  reply=result({onePage:Array.from({length:6},(_,i)=>({heading:`Panel ${i+1}`,text:"One concrete action with an explicit assumption."}))});j=await paid(j,"run_step");
  const page=j.flow!.results.at(-1)!;expect(graph.readBlob(page.svgHash!).toString()).toContain('width="794" height="1123"');
  j=await store.act(c(j,"edit_step",{stepOutput:{...reply,title:"My actual launch plan"}}));j=await store.act(c(j,"approve_step"));reply=result();j=await paid(j,"run_step");
  await expect(store.act(c(j,"approve_step"))).rejects.toThrow("personally checked");j=await store.act(c(j,"approve_step",{text:"I checked the audience, budget and actions."}));
  expect(store.validateExport(worldId,j.versionId).reviewed).toBe(true);const files=await pathFiles(j,graph);expect(files['03-page/figure.svg']).toBeDefined();expect((await sharp(files['03-page/figure.png']).metadata()).width).toBe(794);
  const old=j.flow!.results[1]!.decisionId!;j=await store.act(c(j,"reopen_step",{id:"direction"}));expect(j.flow!.index).toBe(1);expect(j.flow!.results).toHaveLength(1);expect(graph.decisions.get(old)!.state).toBe("needs_review");expect(()=>store.validateExport(worldId,j.versionId)).toThrow();
 });
 it("requires sources for figures and invalidates accepted work on resource changes",async()=>{
  let j=store.start(worldId,"scientific_figure");await expect(store.act(c(j,"begin_path"))).rejects.toThrow("Add a source");
  j=store.addResource(worldId,j.versionId,reading);j=await store.act(c(j,"begin_path"));reply=result({sourceIds:j.resources.map(r=>r.sourceId)});j=await paid(j,"run_step");j=await store.act(c(j,"approve_step"));const accepted=j.flow!.results[0]!.decisionId!;
  j=store.addResource(worldId,j.versionId,reading);expect(j.flow!.results).toEqual([]);expect(j.flow!.index).toBe(0);expect(graph.decisions.get(accepted)!.state).toBe("needs_review");
 });
 it("records manual work as human observations without invoking an LLM",async()=>{
  let j=store.start(worldId,"custom");const def=builtInPath("marketing_page")!;reply={...def,steps:[def.steps[0],{id:"observe",title:"Try the prototype",operation:"manual",instruction:"Try your prototype and record what actually happened.",check:"Separate observation from interpretation."},def.steps.at(-1)]};j=await paid(j,"design_path",{text:"Test my real prototype"});j=await store.act(c(j,"approve_path"));j=await store.act(c(j,"begin_path"));reply=result();j=await paid(j,"run_step");j=await store.act(c(j,"approve_step"));
  expect(()=>store.quote(c(j,"run_step"))).toThrow("real observations");const n=calls.length;j=await store.act(c(j,"record_step",{text:"The hinge jammed after five openings."}));expect(calls).toHaveLength(n);expect(j.flow!.results.at(-1)!.output.sections[0]!.text).toContain("hinge jammed");
 });
 it("stores runnable code and exports the actual files, with later review",async()=>{
  let j=store.start(worldId,"software");j=await store.act(c(j,"begin_path"));for(const step of j.flow!.definition!.steps){reply=result(step.operation==="compare"?{options:[{id:"a",title:"A",reason:"Simple",tradeoff:"Limited"},{id:"b",title:"B",reason:"Flexible",tradeoff:"Complex"}]}:step.operation==="code"?{project:{entry:"index.html",files:{"index.html":"<!doctype html><button onclick=\"this.textContent='Done'\">Try</button>","README.md":"Click the button."}}}:{});j=await paid(j,"run_step");j=await store.act(c(j,"approve_step",{id:step.operation==="compare"?"a":undefined,text:step.operation==="check"?"I tried the button and checked the result.":undefined}));}
  const code=j.flow!.results.find(r=>r.codeObjectId)!;expect(graph.currentState(code.objectId)!.forms.some(f=>f.role==="code.project")).toBe(true);expect((await pathFiles(j,graph))['04-build/project/index.html']).toBeDefined();
  graph.setProperties(code.objectId,{title:"Changed externally"}); // Property edits are not content revisions.
  const state=graph.currentState(code.objectId)!;graph.commitVersion({objectId:code.objectId,forms:state.forms,label:"Changed code"});expect(()=>store.validateExport(worldId,j.versionId)).toThrow("changed");
 });
});
