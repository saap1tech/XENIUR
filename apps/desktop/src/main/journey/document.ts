import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { zipSync } from "fflate";
import { JOURNEY_FONTS, type Journey } from "@xeniur/core";
import type { ObjectGraph } from "@xeniur/graph";

import sharp from "sharp";
import { resultMarkdown, validateStep } from "./path-engine.js";
import {findExecutable} from "../binaries.js";

const htmlEscape=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
/** A portable print edition, with no scripts, remote assets or unescaped generated HTML. */
export function renderJourneyHtml(j:Journey,graph:ObjectGraph,projectRoot:string):string {
  if(!j.draft)throw new Error("Create a draft first.");
  const font=JOURNEY_FONTS.find(f=>f.id===j.choices.font)??JOURNEY_FONTS[0];
  const fontData=readFileSync(join(projectRoot,"brand/fonts",font.file)).toString("base64");
  const color=j.report?.palettes.find(p=>p.id===j.choices.palette)?.colors[0]??"#29483D";
  const cite=(ids:string[])=>ids.length?`<sup>${ids.map(id=>`[${j.resources.findIndex(r=>r.sourceId===id)+1}]`).join(" ")}</sup>`:"";
  const quotes=(refs:import("@xeniur/core").PassageCitation[]|undefined)=>(refs??[]).map(c=>`<blockquote>${htmlEscape(c.quote)}<small>Source ${j.resources.findIndex(r=>r.sourceId===c.sourceId)+1}${c.page?` · page ${c.page}`:""} · version ${htmlEscape(c.sourceVersionId)}</small></blockquote>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><title>${htmlEscape(j.draft.title)}</title><style>
    @font-face{font-family:Paper;src:url(data:font/otf;base64,${fontData})}*{box-sizing:border-box}body{font-family:Paper,Georgia,serif;color:#243128;line-height:1.55;max-width:800px;margin:40px auto;padding:24px}h1,h2,h3,h4{color:${/^#[a-f0-9]{6}$/i.test(color)?color:"#29483D"};line-height:1.2}h1{font-size:34px}h2{font-size:24px}h3{font-size:20px}h4{font-size:17px}small{display:block;color:#5a635b}img{max-width:100%;max-height:380px}figure{text-align:center;break-inside:avoid}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:7px;border-bottom:1px solid #ddd;text-align:left}blockquote{font-size:12px;border-left:2px solid #82956e;padding-left:14px;margin-left:0}sup{font-size:10px}section{margin-top:24px}@page{size:A4;margin:22mm}@media print{body{margin:0;padding:0;max-width:none}h2,h3,h4{break-after:avoid}p{orphans:3;widows:3}}
    </style></head><body><h1>${htmlEscape(j.draft.title)}</h1><p>${htmlEscape(j.draft.abstract)}</p>
    ${j.draft.sections.map(s=>`<section><h${s.level+1}>${htmlEscape(s.title)}</h${s.level+1}>${s.paragraphs.map(p=>`<p>${htmlEscape(p)}</p>`).join("")}${cite(s.sourceIds)}${quotes(s.citations)}</section>`).join("")}
    ${j.draft.tables.map(t=>`<section><h2>${htmlEscape(t.title)}${cite(t.sourceIds)}</h2><table><thead><tr>${t.columns.map(c=>`<th>${htmlEscape(c)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map(c=>`<td>${htmlEscape(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>${quotes(t.citations)}</section>`).join("")}
    ${documentFigures(j).map(f=>`<figure><img src="data:image/png;base64,${graph.readBlob(f.blobHash).toString("base64")}" alt="${htmlEscape(f.caption)}"><figcaption>${htmlEscape(f.caption)}<small>${f.origin==="generated"?"AI conceptual illustration; not measured evidence.":`Source crop · page ${f.page}`}${cite(f.sourceIds)}</small></figcaption></figure>`).join("")}
    <h2>Limitations and checks</h2>${j.draft.limitations.map(l=>`<p>${htmlEscape(l)}</p>`).join("")}<h2>Sources</h2><ol>${j.resources.map(r=>`<li>${htmlEscape(r.title)}${r.url?` — ${htmlEscape(r.url)}`:""}${r.partial?" (partial capture)":""}</li>`).join("")}</ol>
    <h2>Process note</h2><p>AI-assisted draft. Passage matching does not establish scientific support. Selected passages are a sample of captured sources; coverage and the person's evidence checks are included in the work bundle.</p></body></html>`;
}
async function printEdition(html:Uint8Array):Promise<Buffer|null>{
  if(!process.versions.electron)return null;
  const {BrowserWindow}=await import("electron");
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  try{await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(Buffer.from(html).toString("utf8"))}`);return await win.webContents.printToPDF({pageSize:"A4",printBackground:true,preferCSSPageSize:true});}finally{win.destroy();}
}

export async function pathFiles(j:Journey,graph:ObjectGraph):Promise<Record<string,Uint8Array>> {
 const f=j.flow!;if(!f.approved||!j.reviewed||f.index!==f.definition?.steps.length)throw new Error("Finish your path and review first.");
 const files:Record<string,Uint8Array>={"project-record.json":Buffer.from(JSON.stringify({path:f,brief:j.brief??null,resources:j.resources,decisions:j.decisions},null,2)),"README.md":Buffer.from(`# ${f.definition.title}\n\n${f.definition.outcome}\n\nEach numbered folder contains an accepted step, its sources and your review. SVG files are editable; PNG files are ready to share. Web projects run locally from index.html and do not include a server or live integrations.\n`)};
 for(const [i,step] of f.definition.steps.entries()){const r=f.results.find(r=>r.stepId===step.id);if(!r?.accepted)throw new Error("Review every step first.");validateStep(r.output,step.operation,new Set(j.resources.map(v=>v.sourceId)));const root=`${String(i+1).padStart(2,"0")}-${step.id}`;files[`${root}/result.md`]=Buffer.from(resultMarkdown(r));files[`${root}/result.json`]=Buffer.from(JSON.stringify(r.output,null,2));
 if(r.svgHash){const svg=graph.readBlob(r.svgHash);files[`${root}/figure.svg`]=svg;files[`${root}/figure.png`]=await sharp(svg).png().toBuffer();}
 if(r.output.storyboard)for(const scene of r.output.storyboard.scenes){const hash=r.sceneImages?.[scene.id];if(hash)files[`${root}/scenes/${scene.id}.png`]=graph.readBlob(hash);}
 if(r.imageHash)files[`${root}/illustration.png`]=graph.readBlob(r.imageHash);
 if(r.output.project)for(const [name,content] of Object.entries(r.output.project.files))files[`${root}/project/${name}`]=Buffer.from(content);
 }return files;
}

const execute = promisify(execFile);
export const texEscape = (text:string) => text.replace(/[\\{}$&#%_^~]/g,c=>({"\\":"\\textbackslash{}","{":"\\{","}":"\\}","$":"\\$","&":"\\&","#":"\\#","%":"\\%","_":"\\_","^":"\\textasciicircum{}","~":"\\textasciitilde{}"}[c]!));
const documentFigures=(j:Journey)=>[
  ...(j.illustration?[{blobHash:j.illustration,caption:"Topic overview",origin:"generated" as const,page:null,sourceIds:j.report?.findings.flatMap(f=>f.sourceIds).filter((id,i,ids)=>ids.indexOf(id)===i)??[]}]:[]),
  ...j.figureIds,
];
export function renderJourneyTex(j:Journey):string {
  if(!j.draft)throw new Error("Create a draft first.");
  const font=JOURNEY_FONTS.find(f=>f.id===j.choices.font)??JOURNEY_FONTS[0];
  const colors=j.report?.palettes.find(p=>p.id===j.choices.palette)?.colors??["#29483D","#93A778","#FBF9F2"];
  if(colors.some(c=>!/^#[0-9a-fA-F]{6}$/.test(c)))throw new Error("Invalid palette.");
  const layout=j.choices.layout;
  const cite=(ids:string[])=>ids.length?` \\cite{${ids.map(id=>`r${j.resources.findIndex(r=>r.sourceId===id)+1}`).join(",")}}`:"";
  const commands=["section","subsection","subsubsection"];
  const sections=j.draft.sections.map(s=>`\\${commands[s.level-1]}{${texEscape(s.title)}}\n${s.paragraphs.map(texEscape).join("\n\n")}${cite(s.sourceIds)}`).join("\n\n");
  const tables=j.draft.tables.map(t=>`\\begin{table*}[htbp]\n\\centering\\small\n\\caption{${texEscape(t.title)}${cite(t.sourceIds)}}\n\\begin{tabularx}{\\textwidth}{${t.columns.map(()=>">{\\raggedright\\arraybackslash}X").join("")}}\n\\toprule\n${t.columns.map(c=>`\\textbf{${texEscape(c)}}`).join(" & ")} \\\\\n\\midrule\n${t.rows.map(r=>r.map(texEscape).join(" & ")+" \\\\").join("\n")}\n\\bottomrule\n\\end{tabularx}\n\\end{table*}`).join("\n");
  const figures=documentFigures(j).map((f,i)=>`\\begin{figure*}[htbp]\n\\centering\\includegraphics[width=${layout==="atlas"?"0.95":"0.78"}\\textwidth,height=0.34\\textheight,keepaspectratio]{figures/figure-${i+1}.png}\n\\caption{${texEscape(f.caption)} ${f.origin==="generated"?"Conceptual illustration generated with AI; not measured evidence.":`Source crop, page ${f.page}. Reuse permission confirmed by the user.`}${cite(f.sourceIds)}}\n\\end{figure*}`).join("\n");
  return `\\documentclass[10pt,a4paper${layout==="journal"?",twocolumn":""}]{${layout==="essay"?"scrartcl":"article"}}
\\usepackage[margin=${layout==="essay"?"28":"22"}mm]{geometry}
\\usepackage{fontspec,xcolor,graphicx,booktabs,tabularx,hyperref,fancyhdr}
\\setmainfont{${font.file}}[Path=fonts/,BoldFont=${font.bold},ItalicFont=${font.italic}]
\\definecolor{topic}{HTML}{${colors[0]!.slice(1)}}
\\definecolor{accent}{HTML}{${colors[1]!.slice(1)}}
\\hypersetup{colorlinks=true,linkcolor=topic,citecolor=topic,urlcolor=topic}
\\setlength{\\headheight}{14pt}
\\pagestyle{fancy}\\fancyhf{}\\fancyhead[L]{\\small\\color{topic}${texEscape(j.draft.title.slice(0,65))}}\\fancyfoot[C]{\\thepage}
\\setlength{\\parindent}{0pt}\\setlength{\\parskip}{0.55em}
\\title{\\color{topic}${texEscape(j.draft.title)}}
\\author{}\\date{}
\\begin{document}
\\maketitle
${layout==="field"?"\\noindent\\textcolor{accent}{\\rule{\\linewidth}{2pt}}":""}
\\begin{abstract}${texEscape(j.draft.abstract)}\\end{abstract}
${layout==="atlas"?"\\tableofcontents\\newpage":""}
${sections}
${tables}
${figures}
\\section*{Limitations and checks}
${j.draft.limitations.map(l=>texEscape(l)).join("\n\n")}
\\section*{Process note}
Prepared with AI assistance from the captured resources below. Generated pictures are conceptual illustrations. Citation and interpretation checks require human review. ${j.reviewed?"The author recorded a review in XENIUR.":"This draft has not yet been reviewed."}
\\begin{thebibliography}{99}
${j.resources.map((r,i)=>`\\bibitem{r${i+1}} ${texEscape(r.title)}. ${r.url?texEscape(r.url):"Material supplied by the author."} ${r.partial?"Captured excerpt; not the full source.":"Stored copy read by XENIUR."}`).join("\n")}
\\end{thebibliography}
\\end{document}\n`;
}

export function documentFiles(j:Journey,graph:ObjectGraph,projectRoot:string):Record<string,Uint8Array> {
  const files:Record<string,Uint8Array>={"main.tex":Buffer.from(renderJourneyTex(j)),"review.html":Buffer.from(renderJourneyHtml(j,graph,projectRoot)),"evidence-coverage.json":Buffer.from(JSON.stringify(j.coverage??null,null,2)),"evidence-reviews.json":Buffer.from(JSON.stringify(j.evidenceReviews??[],null,2)),"project-record.json":Buffer.from(JSON.stringify({goal:j.goalId,resources:j.resources,decisions:j.decisions,choices:j.choices,figures:j.figureIds,overviewIllustration:j.illustration,reviewed:j.reviewed},null,2)),
    "README.txt":Buffer.from("Compile main.tex with XeLaTeX (no shell escape). Fonts and their licenses are included. Review citations, source coverage, tables and figure permissions before publication. The document is an AI-assisted draft, not a guarantee of human authorship or scientific correctness.\n")};
  const font=JOURNEY_FONTS.find(f=>f.id===j.choices.font)??JOURNEY_FONTS[0];
  for(const name of [font.file,font.bold,font.italic])files[`fonts/${name}`]=readFileSync(join(projectRoot,"brand/fonts",name));
  for(const name of ["LICENSE-cochineal.txt","LICENSE-erewhon.txt","LICENSE-tex-gyre.txt"])files[`fonts/${name}`]=readFileSync(join(projectRoot,"brand/fonts",name));
  documentFigures(j).forEach((f,i)=>{files[`figures/figure-${i+1}.png`]=graph.readBlob(f.blobHash);});
  return files;
}
export async function compileFiles(files:Record<string,Uint8Array>,scratch:string):Promise<{pdf:Buffer|null;warning:string|null}> {
  mkdirSync(scratch,{recursive:true});const folder=mkdtempSync(join(scratch,"review-"));
  try {
    for(const [path,bytes] of Object.entries(files)) {const parts=path.split("/");parts.pop();if(parts.length)mkdirSync(join(folder,...parts),{recursive:true});writeFileSync(join(folder,path),bytes);}
    const binary=findExecutable("xelatex",process.env["XENIUR_XELATEX"]);
    try {
      for(let i=0;i<2;i++)await execute(binary,["-no-shell-escape","-interaction=nonstopmode","-halt-on-error","main.tex"],{cwd:folder,timeout:30_000,maxBuffer:2_000_000,
        env:{...process.env,openin_any:"p",openout_any:"p"}});
      return {pdf:readFileSync(join(folder,"main.pdf")),warning:null};
    } catch {return {pdf:null,warning:"The editable LaTeX bundle is ready. PDF compilation needs a working XeLaTeX installation."};}
  } finally {rmSync(folder,{recursive:true,force:true});}
}
export async function exportJourney(j:Journey,graph:ObjectGraph,projectRoot:string,scratch:string,path:string) {
  if(!j.reviewed)throw new Error("Review the draft before exporting.");
  if(j.flow){const files=await pathFiles(j,graph);writeFileSync(path,zipSync(files,{level:6}));return {path,pdf:false,warning:null};}
  const files=documentFiles(j,graph,projectRoot);
  const result=await compileFiles(files,scratch);
  if(!result.pdf&&files["review.html"]){try{result.pdf=await printEdition(files["review.html"]);if(result.pdf)result.warning="PDF saved using the built-in print edition. Editable LaTeX and HTML are also included.";}catch{/* Keep the portable HTML and source even if printing fails. */}}
  if(result.pdf)files["review.pdf"]=result.pdf;
  writeFileSync(path,zipSync(files,{level:6}));
  return {path,pdf:!!result.pdf,warning:result.warning};
}
