import {createHash} from "node:crypto";
import type {ObjectGraph} from "@xeniur/graph";
import type {EvidencePassage,EvidenceCoverage,JourneyResource,PassageCitation} from "@xeniur/core";

const SIZE=1800,OVERLAP=180;
export function splitPassages(sourceId:string,sourceVersionId:string,text:string):EvidencePassage[]{
  const marks=[...text.matchAll(/^\[Page (\d+)\]\s*$/gm)];
  const pages=marks.length?marks.map((m,i)=>({page:Number(m[1]),start:m.index!+m[0].length,end:marks[i+1]?.index??text.length})):[{page:null,start:0,end:text.length}];
  return pages.flatMap(page=>{
    const out:EvidencePassage[]=[];
    for(let start=page.start;start<page.end;start+=SIZE-OVERLAP){
      const end=Math.min(start+SIZE,page.end),value=text.slice(start,end);if(!value.trim())continue;
      out.push({id:createHash("sha256").update(`${sourceVersionId}:${page.page}:${start}:${end}`).digest("hex"),sourceId,sourceVersionId,page:page.page,start,end,text:value});
      if(end===page.end)break;
    }return out;
  });
}
const stop=new Set("the a an and or of to in on for with from this that what how is are be as by your our about review recent evidence resources work project".split(" "));
const terms=(query:string)=>[...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[])].filter(t=>!stop.has(t)).slice(0,24);
/** Spacing and typography never decide whether words match: curly and straight quotes, dash kinds
 *  and non-breaking spaces read the same. The words themselves must still match exactly. */
const normalize=(text:string)=>text.normalize("NFKC").replace(/[\u2018\u2019\u201A\u2032]/g,"'").replace(/[\u201C\u201D\u201E\u2033]/g,'"')
  .replace(/[\u2010-\u2015\u2212]/g,"-").replace(/\u2026/g,"...").replace(/\s+/g," ").trim();

/** Local full-text index of immutable source versions. No embedding provider or remote query. */
export class EvidenceIndex {
  constructor(private readonly graph:ObjectGraph){
    graph.db.exec(`CREATE TABLE IF NOT EXISTS journey_evidence_versions (version_id TEXT PRIMARY KEY, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS journey_passages (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, version_id TEXT NOT NULL, page INTEGER, start INTEGER NOT NULL, end INTEGER NOT NULL, text TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS journey_passages_version ON journey_passages(version_id,start);
      CREATE VIRTUAL TABLE IF NOT EXISTS journey_passage_search USING fts5(passage_id UNINDEXED,version_id UNINDEXED,text,tokenize='unicode61');`);
  }
  ensure(resource:JourneyResource,text:string){
    if(this.graph.db.prepare("SELECT 1 FROM journey_evidence_versions WHERE version_id=?").get(resource.sourceVersionId))return;
    const passages=splitPassages(resource.sourceId,resource.sourceVersionId,text);
    this.graph.db.transaction(()=>{
      const insert=this.graph.db.prepare("INSERT INTO journey_passages VALUES (?,?,?,?,?,?,?)"),search=this.graph.db.prepare("INSERT INTO journey_passage_search VALUES (?,?,?)");
      for(const p of passages){insert.run(p.id,p.sourceId,p.sourceVersionId,p.page,p.start,p.end,p.text);search.run(p.id,p.sourceVersionId,p.text);}
      this.graph.db.prepare("INSERT INTO journey_evidence_versions VALUES (?,?)").run(resource.sourceVersionId,passages.length);
    })();
  }
  private row(row:any):EvidencePassage{return {id:row.id,sourceId:row.source_id,sourceVersionId:row.version_id,page:row.page,start:row.start,end:row.end,text:row.text};}
  get(id:string):EvidencePassage|null{const row=this.graph.db.prepare("SELECT * FROM journey_passages WHERE id=?").get(id);return row?this.row(row):null;}
  select(resources:JourneyResource[],query:string,budgetCharacters=96000):{passages:EvidencePassage[];coverage:EvidenceCoverage}{
    const tokens=terms(query),match=tokens.map(t=>`"${t}"`).join(" OR ");
    const passages:EvidencePassage[]=[],coverage:EvidenceCoverage={query,resources:[],selectedCharacters:0,budgetCharacters,assessedAt:Date.now()};
    const allowance=Math.max(0,Math.floor(budgetCharacters/Math.max(1,resources.length)));
    for(const r of resources){
      const info=this.graph.db.prepare("SELECT COUNT(*) AS count,COUNT(DISTINCT page) AS pages FROM journey_passages WHERE version_id=?").get(r.sourceVersionId) as {count:number;pages:number};
      const ranked=match?this.graph.db.prepare(`SELECT p.* FROM journey_passage_search s JOIN journey_passages p ON p.id=s.passage_id
        WHERE journey_passage_search MATCH ? AND p.version_id=? ORDER BY bm25(journey_passage_search),p.start LIMIT 64`).all(match,r.sourceVersionId).map(row=>this.row(row)):[];
      // Include evidence from later pages even when no query term appears there. Coverage is still sampling.
      const all=this.graph.db.prepare("SELECT * FROM journey_passages WHERE version_id=? ORDER BY start").all(r.sourceVersionId).map(row=>this.row(row));
      const anchors=[all[0],all[Math.floor(all.length/2)],all.at(-1)].filter((p):p is EvidencePassage=>!!p);
      const candidates=[...ranked.slice(0,3),...anchors,...ranked.slice(3),...all];
      const unique=[...new Map(candidates.map(p=>[p.id,p])).values()];let remaining=allowance;
      const chosen:EvidencePassage[]=[];
      for(const p of unique){if(remaining<12)break;const text=p.text.slice(0,remaining);chosen.push({...p,text,end:p.start+text.length});remaining-=text.length;}
      passages.push(...chosen);const chars=chosen.reduce((n,p)=>n+p.text.length,0);coverage.selectedCharacters+=chars;
      coverage.resources.push({sourceId:r.sourceId,title:r.title,capturedPassages:info.count,selectedPassages:chosen.length,capturedPages:info.pages,selectedPages:[...new Set(chosen.flatMap(p=>p.page?[p.page]:[]))].sort((a,b)=>a-b),partial:r.partial});
    }
    return {passages,coverage};
  }
  /**
   * Every quote must appear, word for word, in a passage that was supplied from an allowed source.
   * A model that credits a real quote to the neighbouring passage (they overlap) is corrected to the
   * passage that holds it, with that passage's page; a quote found in no supplied passage is refused.
   */
  validate(citations:PassageCitation[],offered:EvidencePassage[],allowedSources:string[]){
    if(this.verified(citations,offered,allowedSources).removed)throw new Error("A quoted passage did not match the supplied source, version and page. Create a corrected draft.");
  }
  /** The citations whose quote is really in the source (re-anchored as above), and how many were not. */
  verified(citations:PassageCitation[],offered:EvidencePassage[],allowedSources:string[]):{kept:PassageCitation[];removed:number}{
    const kept:PassageCitation[]=[];
    for(const c of citations){
      if(!allowedSources.includes(c.sourceId))continue;
      const quote=normalize(c.quote??"");
      const holds=(p:EvidencePassage)=>p.sourceId===c.sourceId&&p.sourceVersionId===c.sourceVersionId&&quote.length>0&&normalize(p.text).includes(quote);
      const named=offered.find(p=>p.id===c.passageId);
      const p=named&&holds(named)?named:offered.find(holds);
      if(!p)continue;
      c.passageId=p.id;c.page=p.page;kept.push(c);
    }
    return {kept,removed:citations.length-kept.length};
  }
}
