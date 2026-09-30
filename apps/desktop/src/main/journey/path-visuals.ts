import type { StepOutput } from "@xeniur/core";
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
function words(s:string,max=42):string[]{const result:string[]=[];let line='';for(const raw of s.split(/\s+/)){const chunks=raw.match(new RegExp(`.{1,${max}}`,'g'))??[];for(const word of chunks){if((line+' '+word).trim().length>max){result.push(line);line=word;}else line=(line+' '+word).trim();}}if(line)result.push(line);return result;}
const text=(s:string,x:number,y:number,size=18,max=48,color='#29483D')=>`<text x="${x}" y="${y}" fill="${color}" font-family="Arial,sans-serif" font-size="${size}">${words(s,max).map((l,i)=>`<tspan x="${x}" dy="${i?size*1.4:0}">${esc(l)}</tspan>`).join('')}</text>`;
const shell=(body:string,w=1200,h=800)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#F8F6ED"/>${body}</svg>`;
export function renderPathVisual(o:StepOutput,identityFont="Georgia"):string|null {
 if(o.onePage){return shell(text(o.title,52,76,30,38)+o.onePage.map((p,i)=>{const x=52+i%2*355,y=150+Math.floor(i/2)*280;return `<rect x="${x}" y="${y}" width="335" height="260" rx="4" fill="#E8ECDD"/>`+text(p.heading,x+20,y+32,18,26)+text(p.text,x+20,y+70,15,34);}).join('')+text('Working plan · review assumptions before acting',52,1060,13,80),794,1123);}
 if(o.identity){const b=o.identity;return shell(text('Identity direction',64,58,15)+`<text x="64" y="225" fill="#243E32" font-family="${esc(identityFont)},serif" font-size="${Math.min(64,1072/(Math.max(1,b.name.length)*.7))}">${esc(b.name)}</text>`+text(b.tagline,68,277,22,75)+b.colors.map((c,i)=>{const width=1072/b.colors.length;return `<rect x="${64+i*width}" y="350" width="${width}" height="170" fill="${c}"/>`+text(c,76+i*width,550,15,20);}).join('')+text(`Type direction: ${b.font}`,64,605,18,80)+text(b.voice.join(' · '),64,660,16,100)+text('Wordmark study · verify rights and test contrast before release',64,755,13,100));}
 const d=o.diagram;if(!d)return null;
 let body=text(d.title,60,62,30,65);
 if(d.kind==='schematic'){
  const positions=new Map(d.nodes.map((n,i)=>[n.id,{x:90+(i%3)*370,y:165+Math.floor(i/3)*160}]));
  body+='<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#63785B"/></marker></defs>';
  body+=d.edges.map(e=>{const a=positions.get(e.from)!,b=positions.get(e.to)!;const dx=b.x-a.x,dy=b.y-a.y,t=1/Math.max(Math.abs(dx)/145,Math.abs(dy)/55,1);return `<path d="M${a.x+145+dx*t},${a.y+55+dy*t} L${b.x+145-dx*t},${b.y+55-dy*t}" stroke="#63785B" stroke-width="3" fill="none" marker-end="url(#arrow)"/>`;}).join('');
  body+=d.nodes.map(n=>{const p=positions.get(n.id)!;return `<rect x="${p.x}" y="${p.y}" width="290" height="110" rx="8" fill="#E1E7D7" stroke="#809274"/>`+text(n.label,p.x+20,p.y+35,18,25);}).join('');
 }else{
  const lo=Math.min(0,...d.points.map(p=>p.value)),hi=Math.max(0,...d.points.map(p=>p.value));const span=hi-lo||1;
  const x=(i:number)=>150+i*900/Math.max(1,d.points.length-1),y=(v:number)=>600-(v-lo)/span*430;
  body+=text(d.unit,65,112,16,70);
  for(let i=0;i<=4;i++){const v=lo+span*i/4,yy=y(v);body+=`<path d="M130 ${yy} H1100" stroke="#D2D9C8"/>`+text(Number(v.toPrecision(5)).toString(),30,yy+6,14,16);}
  if(d.kind==='line')body+=`<polyline points="${d.points.map((p,i)=>`${x(i)},${y(p.value)}`).join(' ')}" fill="none" stroke="#29483D" stroke-width="3"/>`;
  body+=d.points.map((p,i)=>{const xx=x(i),yy=y(p.value),baseline=y(0);return(d.kind==='bar'?`<rect x="${xx-25}" y="${Math.min(yy,baseline)}" width="50" height="${Math.max(1,Math.abs(baseline-yy))}" fill="#789864"/>`:`<circle cx="${xx}" cy="${yy}" r="6" fill="#29483D"/>`)+`<text x="${xx}" y="630" text-anchor="middle" fill="#29483D" font-family="Arial,sans-serif" font-size="12" transform="rotate(20 ${xx} 630)">${esc(p.label)}</text>`;}).join('');
 }
 return shell(body+text(d.caption,60,710,14,128)+text(d.kind==='schematic'?'Conceptual relationships · check against the cited sources':'Values transcribed from sources · verify values, units and uncertainty',60,775,12,130));
}
