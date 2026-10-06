import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {ObjectGraph,SpendLedger} from "@xeniur/graph";
import {SensemakingStore} from "@xeniur/sensemaking";
import {routerRequest} from "@xeniur/brain";
import {routerTextModels,routerImageModel} from "@xeniur/models";
import {JourneyStore} from "../apps/desktop/src/main/journey/store.js";
import {downloadResource} from "../apps/desktop/src/main/journey/resources.js";
import {WebRiskChecker} from "../apps/desktop/src/main/web/risk.js";
import type {Journey,JourneyCommand} from "@xeniur/core";

if(!process.argv.includes("--run")){
 console.log("Live verification is off. To run: set XENIUR_LIVE_KEY, XENIUR_LIVE_MODEL and XENIUR_LIVE_MAX_USD, then npm run verify:live -- --run. An optional XENIUR_LIVE_IMAGE_MODEL enables one drawing. This sends a public test topic, searches, imports one individually chosen public source, and makes an overview. Review quality manually afterward. No user projects or saved keys are used.");
 process.exit(0);
}
const key=process.env.XENIUR_LIVE_KEY,modelId=process.env.XENIUR_LIVE_MODEL,budget=Number(process.env.XENIUR_LIVE_MAX_USD);
if(!key||!modelId||!Number.isFinite(budget)||budget<=0||budget>10)throw new Error("Provide a live key, a model ID and a budget above zero and at most $10. Keys are never printed.");
const dir=mkdtempSync(join(tmpdir(),"xeniur-live-")),graph=ObjectGraph.open({dbPath:join(dir,"test.db"),blobDir:join(dir,"blobs")});
const report:{date:string;model:string;budget:number;checks:Record<string,unknown>;runs:unknown[];quality:string}={date:new Date().toISOString(),model:modelId,budget,checks:{},runs:[],quality:"Manual review of overview, source interpretation and image is required."};
const output=join(process.cwd(),"live-verification");mkdirSync(output,{recursive:true});
const risk=new WebRiskChecker(()=>({mode:"local_only"}));
try{
 await routerRequest(key,"/key");report.checks.key="verified";
 const date=new Date().toISOString().slice(0,10),catalog=routerTextModels(await routerRequest(key,"/models"),date),model=catalog.find(m=>m.model===modelId);
 if(!model)throw new Error("Choose a currently priced text model from OpenRouter's catalogue.");
 const models=[model],imageId=process.env.XENIUR_LIVE_IMAGE_MODEL;
 if(imageId){const entry=routerImageModel({id:imageId,name:imageId},await routerRequest(key,`/images/models/${imageId}/endpoints`),date);if(!entry)throw new Error("No fixed-price PNG image endpoint is available for this model.");models.push(entry);}
 const world=graph.createWorld({title:"Live verification: CO2 electrolysis",emoji:"R"});graph.goals.create(world.id,"Review recent experimental evidence about catalyst stability in CO2 electrolysis. Find primary research with a public full-text source.");
 const store=new JourneyStore({graph,sense:new SensemakingStore(graph,{frictionThreshold:5}),spend:new SpendLedger(graph.db,{perActionUsdMax:budget,perTaskUsdMax:budget,totalUsdMax:budget}),models:()=>models,key:()=>key,download:url=>downloadResource(url,risk),projectRoot:process.cwd()});
 let j=store.start(world.id,"review");
 const paid=async(action:JourneyCommand["action"])=>{const command={worldId:world.id,versionId:j.versionId,action},quote=store.quote(command);if(quote.maximumUsd>budget)throw new Error("This step exceeds the requested budget.");j=await store.act({...command,maximumUsd:quote.maximumUsd});report.runs=store.insights(world.id).runs;};
 await paid("search");report.checks.searchResults=j.suggestions.map(s=>({id:s.id,title:s.title,url:s.url}));
 // The test explicitly accepts one suggestion at a time; no blanket download operation.
 let imported=false;for(const suggestion of j.suggestions){try{j=await store.act({worldId:world.id,versionId:j.versionId,action:"resource_accept",id:suggestion.id});report.checks.imported={title:suggestion.title,url:suggestion.url};imported=true;break;}catch{report.checks[`import:${suggestion.id}`]="Public import failed; no successful import claimed.";}}
 if(!imported)throw new Error("Search returned no source that could be imported. Inspect the live verification report.");
 await paid("summarize");report.checks.overview={findings:j.report?.findings.length,linkedPassages:j.report?.findings.reduce((n,f)=>n+(f.citations?.length??0),0),coverage:j.coverage};
 writeFileSync(join(output,"overview.json"),JSON.stringify(j.report,null,2));
 if(imageId){await paid("illustrate");if(j.illustration)writeFileSync(join(output,"illustration.png"),graph.readBlob(j.illustration));report.checks.image=j.illustration?"Saved for manual review":"Missing";}
 report.runs=store.insights(world.id).runs;report.checks.completed=true;
}catch(error){report.checks.completed=false;report.checks.failure=error instanceof Error?error.message:"Verification failed";process.exitCode=1;}
finally{writeFileSync(join(output,"report.json"),JSON.stringify(report,null,2));graph.close();rmSync(dir,{recursive:true,force:true});console.log("Verification report saved in live-verification/report.json. It contains no key. Provider-reported charges and unknown charges are distinguished.");}
