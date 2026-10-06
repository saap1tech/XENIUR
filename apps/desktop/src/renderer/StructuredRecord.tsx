import { StepOutputSchema } from '@xeniur/core';
import { Storyboard } from './Storyboard.js';

const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const text=(v:unknown)=>typeof v==='string'?v:'';
const paragraphs=(v:unknown)=>text(v).split(/\n\s*\n/).filter(Boolean).map((p,i)=><p key={i}>{p}</p>);
function Outline({items}:{items:unknown[]}) {return <ul>{items.map((v,i)=>{const s=record(v);return <li key={i}>{text(v)||text(s.title)}{list(s.children).length>0&&<Outline items={list(s.children)}/>}</li>;})}</ul>;}

/** Saved records use two contracts: document sections and work-path outputs. */
export function StructuredRecord({value,sceneImages={}}:{value:unknown;sceneImages?:Record<string,string>}) {
 const result=StepOutputSchema.safeParse(value);
 if(result.success){const o=result.data;return <>{paragraphs(o.summary)}{o.sections.map((s,i)=><section key={i}><h4>{s.heading}</h4>{paragraphs(s.text)}</section>)}{o.storyboard&&<Storyboard result={{stepId:'saved',objectId:'saved',versionId:'saved',output:o,accepted:true,sceneImages}} busy={false} readOnly/>}{o.options.length>0&&<details><summary>Options considered</summary>{o.options.map(option=><section key={option.id}><h4>{option.title}</h4>{paragraphs(option.reason)}{paragraphs(option.tradeoff)}</section>)}</details>}{o.project&&<details><summary>Project files</summary>{Object.entries(o.project.files).map(([name,content])=><details key={name}><summary>{name}</summary><pre>{content}</pre></details>)}</details>}<details><summary>Checks & open questions</summary>{[...o.checks,...o.uncertainties].map((v,i)=><p key={i}>{v}</p>)}</details></>;}
 const o=record(value);
 const readable=typeof o.abstract==='string'||typeof o.summary==='string'||typeof o.topic==='string'||Array.isArray(o.sections);
 if(!readable)return <p>Open Details to inspect this project record.</p>;
 return <>{paragraphs(o.abstract??o.summary??o.topic)}{paragraphs(o.audience)}{paragraphs(o.notes)}{list(o.sections).map((v,i)=>{const s=record(v);return <section key={i}><h4>{text(s.title)||text(s.heading)}</h4>{paragraphs(s.purpose??s.text)}{list(s.paragraphs).map((p,k)=><p key={k}>{text(p)}</p>)}{list(s.children).length>0&&<Outline items={list(s.children)}/>}</section>;})}{list(o.findings).length>0&&<ul>{list(o.findings).map((f,i)=><li key={i}>{text(record(f).text)}</li>)}</ul>}{list(o.tables).map((v,i)=>{const t=record(v);return <section key={i}><h4>{text(t.title)}</h4><table><thead><tr>{list(t.columns).map((c,k)=><th key={k}>{text(c)}</th>)}</tr></thead><tbody>{list(t.rows).map((row,k)=><tr key={k}>{list(row).map((c,n)=><td key={n}>{text(c)}</td>)}</tr>)}</tbody></table></section>;})}{[...list(o.gaps),...list(o.limitations)].length>0&&<details><summary>Open questions</summary>{[...list(o.gaps),...list(o.limitations)].map((v,i)=><p key={i}>{text(v)}</p>)}</details>}</>;
}
