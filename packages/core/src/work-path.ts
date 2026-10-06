import { z } from "zod";
import { UuidSchema } from "./ids.js";

export const PathOperationSchema=z.enum(["brief","compare","plan","write","image","diagram","identity","one_page","code","check","manual","storyboard"]);
export type PathOperation=z.infer<typeof PathOperationSchema>;
export const PathDefinitionSchema=z.object({
  title:z.string().trim().min(1).max(80), outcome:z.string().trim().min(8).max(400),
  requiresSources:z.boolean(), limitations:z.array(z.string().max(240)).max(4),
  steps:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{0,29}$/),title:z.string().trim().min(1).max(45),
    operation:PathOperationSchema,instruction:z.string().trim().min(12).max(1600),
    check:z.string().trim().min(8).max(240)}).strict()).min(3).max(9),
}).strict().superRefine((p,ctx)=>{
  if(new Set(p.steps.map(s=>s.id)).size!==p.steps.length)ctx.addIssue({code:"custom",message:"Each step needs a unique name."});
  if(p.steps[0]?.operation!=="brief"||p.steps.at(-1)?.operation!=="check")ctx.addIssue({code:"custom",message:"Begin with a brief and end with a human review."});
  if(p.steps.filter(s=>s.operation==="image").length>3)ctx.addIssue({code:"custom",message:"Use at most three image steps."});
});
export type PathDefinition=z.infer<typeof PathDefinitionSchema>;
const sourceIds=z.array(UuidSchema).max(16);
export const DiagramSchema=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("schematic"),title:z.string().max(100),caption:z.string().max(400),
    nodes:z.array(z.object({id:z.string().regex(/^[a-z0-9_-]+$/).max(30),label:z.string().max(70)}).strict()).min(2).max(9),
    edges:z.array(z.object({from:z.string().max(30),to:z.string().max(30)}).strict()).max(16),sourceIds}).strict(),
  z.object({kind:z.enum(["bar","line"]),title:z.string().max(100),caption:z.string().max(400),unit:z.string().max(40),
    points:z.array(z.object({label:z.string().max(40),value:z.number().finite().min(-1e15).max(1e15),sourceId:UuidSchema}).strict()).min(2).max(12),sourceIds}).strict(),
]);
export const StoryboardSchema=z.object({aspect:z.enum(["16:9","9:16","1:1"]),scenes:z.array(z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{0,29}$/),title:z.string().trim().min(1).max(80),seconds:z.number().finite().min(1).max(180),visual:z.string().min(8).max(1000),narration:z.string().max(1500),sourceIds}).strict()).min(2).max(12)}).strict().superRefine((v,ctx)=>{if(new Set(v.scenes.map(s=>s.id)).size!==v.scenes.length)ctx.addIssue({code:"custom",message:"Each scene needs a unique ID."});if(v.scenes.reduce((n,s)=>n+s.seconds,0)>1800)ctx.addIssue({code:"custom",message:"Keep a storyboard under 30 minutes."});});
const hex=z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const StepOutputSchema=z.object({title:z.string().trim().min(1).max(120),summary:z.string().max(500),
  sections:z.array(z.object({heading:z.string().max(80),text:z.string().max(3000)}).strict()).max(8),
  options:z.array(z.object({id:z.string().regex(/^[a-z0-9_-]+$/).max(30),title:z.string().max(80),reason:z.string().max(600),tradeoff:z.string().max(400)}).strict()).max(4).default([]),
  checks:z.array(z.string().max(240)).max(6),uncertainties:z.array(z.string().max(300)).max(6),sourceIds,
  storyboard:StoryboardSchema.optional(),
  diagram:DiagramSchema.optional(),
  identity:z.object({name:z.string().max(60),tagline:z.string().max(120),colors:z.array(hex).min(2).max(5),font:z.enum(["cochineal","erewhon","pagella","schola"]),voice:z.array(z.string().max(100)).min(1).max(4)}).strict().optional(),
  onePage:z.array(z.object({heading:z.string().max(50),text:z.string().max(300)}).strict()).length(6).optional(),
  project:z.object({entry:z.literal("index.html"),files:z.record(z.string().max(50000))}).strict().optional(),
}).strict();
export type StepOutput=z.infer<typeof StepOutputSchema>;
export interface PathResult {stepId:string;objectId:string;versionId:string;output:StepOutput;imageHash?:string;sceneImages?:Record<string,string>;svgHash?:string;codeObjectId?:string;selected?:string;note?:string;accepted:boolean;decisionId?:string;}
export interface WorkPath {definition:PathDefinition|null;approved:boolean;index:number;results:PathResult[];request:string;}
export interface PathCard {id:string;name:string;group:"Research"|"Create"|"Business"|"Everyday";description:string;inputs:string;output:string;icon:string;}
export const PATH_CATALOG:PathCard[]=[
  {id:"review",name:"Research review",group:"Research",description:"Read, compare, and argue from evidence.",inputs:"Papers, sources, and a clear question",output:"A cited review, figures and editable LaTeX",icon:"research"},
  {id:"experiment",name:"Experiment report",group:"Research",description:"Describe what you actually did and observed.",inputs:"Lab notes, methods, measurements and limitations",output:"A report separating observations from interpretation",icon:"experiment"},
  {id:"prototype",name:"Prototype report",group:"Research",description:"Show what was built, tested, and learned.",inputs:"Design notes, requirements and real test records",output:"A prototype report with evidence and next changes",icon:"prototype"},
  {id:"scientific_figure",name:"Scientific figure",group:"Research",description:"Turn a clear explanation or data into one figure.",inputs:"Sources, an explanation or a table of real values",output:"Editable SVG, PNG, caption and source record",icon:"figure"},
  {id:"document",name:"Written piece",group:"Create",description:"Make a clear document in your voice.",inputs:"Your brief, notes and references",output:"An editable illustrated document",icon:"document"},
  {id:"script",name:"Film or video script",group:"Create",description:"Shape a story and imagine its key scenes.",inputs:"Premise, audience, duration and references",output:"A script, timed storyboard, scene illustrations and production notes",icon:"film"},
  {id:"brand",name:"Brand identity",group:"Create",description:"Find a position, a voice, and a visual direction.",inputs:"Business, audience, values and references",output:"Brand board, wordmark direction, imagery and guidelines",icon:"brand"},
  {id:"software",name:"Web app",group:"Create",description:"Choose a plan, build it, and try it.",inputs:"The problem, users and acceptance criteria",output:"HTML, CSS and JavaScript files with a local preview",icon:"code"},
  {id:"campaign",name:"Campaign plan",group:"Business",description:"Connect an audience, a message, and a launch.",inputs:"Offer, audience evidence, budget and timeline",output:"A detailed campaign plan and creative concepts",icon:"campaign"},
  {id:"marketing_page",name:"One-page marketing plan",group:"Business",description:"Put the next campaign on one useful page.",inputs:"Offer, audience, available budget and goal",output:"A single-page visual plan, SVG and PNG",icon:"page"},
  {id:"product_listing",name:"Product listing",group:"Business",description:"Explain a product using claims you can support.",inputs:"Verified specifications, photos and customer needs",output:"Listing copy, feature comparison and launch checks",icon:"product"},
  {id:"storefront",name:"Shop launch",group:"Business",description:"Plan the offer and build a storefront prototype.",inputs:"Products, prices, fulfillment and audience",output:"Launch plan and a local storefront; payments need setup",icon:"shop"},
  {id:"business",name:"Business offer",group:"Business",description:"Test an offer before investing more.",inputs:"Customer problem, costs, capacity and assumptions",output:"Options, a value proposition and a small test plan",icon:"business"},
  {id:"lesson",name:"Lesson",group:"Everyday",description:"Explain, practice, and check understanding.",inputs:"Topic, learners and learning goal",output:"Lesson, examples, activities and understanding checks",icon:"lesson"},
  {id:"decision",name:"Choose well",group:"Everyday",description:"Compare a purchase or an important choice.",inputs:"Options, constraints, priorities and sources",output:"A comparison and your recorded reason for choosing",icon:"decision"},
  {id:"travel",name:"Trip or event",group:"Everyday",description:"Make a practical plan with room for change.",inputs:"Dates, people, budget and preferences",output:"Itinerary, budget assumptions and booking checklist",icon:"travel"},
  {id:"plan",name:"Practical plan",group:"Everyday",description:"Turn a goal into work you can begin.",inputs:"Goal, constraints and what you already know",output:"An actionable document with choices and checks",icon:"plan"},
];
const step=(id:string,title:string,operation:PathOperation,instruction:string,check:string)=>({id,title,operation,instruction,check});
const brief=step("brief","Set the brief","brief","Clarify the goal, audience, available evidence, constraints and definition of done. State unknowns. Do not silently fill missing measurements, prices or dates.","Does this match what you want to make?");
const review=step("review","Your final check","check","Compare the accepted artifacts with the brief. List concrete checks for the person, unresolved assumptions and next actions. Never claim tests, publication, payment or real-world work occurred without recorded evidence.","Review the actual result and record what you checked.");
export function builtInPath(kind:string):PathDefinition|null {
  const card=PATH_CATALOG.find(c=>c.id===kind);if(!card)return null;
  const compare=step("direction","Choose a direction","compare","Offer 2–3 concrete options, each with its basis, tradeoff and what would make it wrong. Respect the person's constraints.","Which option fits, and what tradeoff are you accepting?");
  const write=step("deliverable","Make the result","write",`Create the actual deliverable: ${card.output}. Use specific, editable content. Ground factual claims in supplied source IDs. Mark missing facts; no invented stock, certifications, reviews, conversion rates or bookings.`,"Can someone use this, and are its claims supported?");
  const specialized:Record<string,PathDefinition["steps"]>={
    script:[brief,compare,step("script","Write the script","write","Write the actual script in the requested language and voice, with scene actions, dialogue or narration, and production notes. Respect the audience and duration in the brief. Documentary facts need supplied sources; fictional scenes must remain clearly imagined.","Does the script say what you want, in your voice?"),step("scenes","Shape the scenes","storyboard","Turn the accepted script into 2–12 ordered scenes with stable IDs, titles, duration in seconds, visual descriptions and exact narration. Use the requested aspect ratio. Keep total timing close to the brief and flag assumptions. Illustrations are optional concept art; this path does not film, synthesize voices or render video.","Check timing, narration and what each scene communicates."),step("production","Plan the production","plan","Create a practical shot list, asset search phrases for each scene, sound and caption notes, and a recording checklist. Match assets to the accepted scene order. Mark source permissions, unknown costs and remaining real-world work.","Could you hand this to someone and begin production?"),review],
    brand:[brief,compare,step("identity","Build the identity","identity","Create a coherent identity: name from the brief, optional tagline, 2–5 hex colors, one of cochineal/erewhon/pagella/schola, and 1–4 voice principles. Explain use and contrast. The wordmark is a typographic direction; do not claim trademark clearance.","Do the colors, typography and voice fit the audience?"),step("imagery","Create brand imagery","image","Create one original editorial image expressing the accepted brand position and palette. No fabricated logo lettering, UI, mock endorsements or trademark claims.","Does this picture communicate the chosen direction?"),write,review],
    scientific_figure:[brief,step("basis","Check the basis","plan","Identify the exact relationship or numerical values to communicate. For measurements identify source IDs, units and missing uncertainty. Choose schematic, bar or line. Never invent points or infer missing values.","Are the relationships or transcribed values correct?"),step("figure","Draw the figure","diagram","Produce exactly one scientific diagram specification. Use a schematic for relationships; bar/line only for explicitly supplied numerical values. Every numerical point needs its real sourceId and unit. Preserve limitations in the caption.","Compare every label, value and unit with the source."),review],
    marketing_page:[brief,compare,step("page","Make one page","one_page","Create exactly six concise panels: Audience, Offer, Message, Channels, Budget & timing, Measure & learn. Each text must be at most 300 characters. Mark unknown costs and do not invent performance evidence.","Is every panel specific enough to act on?"),review],
    software:[brief,compare,step("plan","Plan the build","plan","Specify a small self-contained browser app: user flow, data handling, file structure and observable acceptance criteria. Local HTML/CSS/JS only; no server, installed dependencies, secrets or external API. Identify features requiring future integration.","Approve the behavior and acceptance criteria before coding."),step("build","Build the app","code","Implement the accepted plan as complete HTML/CSS/JS files. Entry index.html, relative assets, no external dependencies or network. Include accessible controls, meaningful working behavior and a README.md with manual test steps. No fake success states or invented backend. Output the project field.","Open the preview and try the main task, an edge case and keyboard use."),review],
    product_listing:[brief,compare,write,review],
    storefront:[brief,compare,step("operations","Plan fulfillment","plan","Define catalog, price assumptions, stock source, fulfillment, returns and launch checks. Clearly mark unknowns. No legal guarantees or invented inventory.","Can you fulfill the offer, and which facts still need checking?"),step("store","Build a shop preview","code","Build a local HTML/CSS/JS storefront prototype from accepted product facts. Browse products and edit a local cart. State checkout is not connected; do not accept payment details or simulate a paid order. Include README setup and testing instructions.","Try the product and cart flows; identify the live integrations still needed."),review],
    business:[brief,compare,step("test","Design a small test","plan","Create a low-cost test of the selected offer, with customer questions, effort/cost assumptions, observable success criteria and a stop rule. Do not send or publish anything.","Would this test actually change your decision?"),write,review],
    decision:[brief,compare,step("basis","Challenge the choice","write","Compare the accepted option against the rejected alternatives. State what evidence would change it, switching costs and what must be personally checked before purchase. No purchases are executed.","What would make you reopen this choice?"),review],
    travel:[brief,compare,step("route","Build the itinerary","write","Create a practical schedule with travel buffers, accessibility needs, budget assumptions and alternatives. Supplied dated sources are needed for price/availability claims; otherwise label them unverified. Never claim a booking exists.","Check current opening times, prices and availability before booking."),review],
  };
  const steps=specialized[kind];return steps?PathDefinitionSchema.parse({title:card.name,outcome:card.output,requiresSources:kind==="scientific_figure",limitations:[],steps}):null;
}
