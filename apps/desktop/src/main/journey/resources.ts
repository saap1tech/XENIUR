import { request } from "node:https";
import { checkedDestination } from "../web/policy.js";
import { extractReading } from "../web/capture.js";
import type { WebRiskChecker } from "../web/risk.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import {createLocalOcr} from "./ocr.js";

export interface ReadResource { title: string; text: string; raw: Buffer; pdf: boolean; partial: boolean; pages: number; extraction?:{pagesRead:number;ocrPages:number;unreadablePages:number[]}; }
export const MAX_RESOURCE_BYTES=50_000_000;
const MAX_TEXT=5_000_000;
export async function readResource(raw: Buffer, name: string, mime: string): Promise<ReadResource> {
  if (raw.length > MAX_RESOURCE_BYTES) throw new Error("Choose a file smaller than 50 MB.");
  if (raw.subarray(0,5).toString() === "%PDF-") {
    const task = getDocument({ data: new Uint8Array(raw), useSystemFonts: false, isEvalSupported: false });
    const pdf = await task.promise;
    let ocr:Awaited<ReturnType<typeof createLocalOcr>>|null=null;
    try {
      if (pdf.numPages > 2000) throw new Error("Split PDFs with more than 2,000 pages into smaller volumes.");
      let text = "";
      let pagesRead=0,ocrPages=0;const unreadablePages:number[]=[];
      for (let i=1; i<=pdf.numPages;i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        let pageText=content.items.map(item=>"str" in item ? item.str : "").join(" ");
        if(pageText.trim().length<40&&ocrPages<200){
          ocr??=await createLocalOcr();
          const {createCanvas}=await import("@napi-rs/canvas");const base=page.getViewport({scale:1});
          const viewport=page.getViewport({scale:Math.min(2.5,2400/Math.max(base.width,base.height))});
          const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
          await page.render({canvasContext:canvas.getContext("2d") as any,viewport}).promise;
          const result=await ocr.recognize(canvas.toBuffer("image/png"));pageText=result.data.text;ocrPages++;
        }
        if(pageText.trim().length<40)unreadablePages.push(i);
        text += `\n[Page ${i}]\n` + pageText;pagesRead++;
        page.cleanup();
        if (text.length > MAX_TEXT) break;
      }
      if (text.replace(/\[Page \d+\]/g,"").trim().length < 80) throw new Error("No readable text was found after local English OCR. Add a text copy or a clearer scan.");
      return { title: name, text: text.slice(0,MAX_TEXT), raw, pdf: true,
        partial: pagesRead<pdf.numPages || text.length > MAX_TEXT || unreadablePages.length>0, pages: pdf.numPages,extraction:{pagesRead,ocrPages,unreadablePages} };
    } finally {await ocr?.terminate(); await task.destroy(); }
  }
  if (!/text\/|\.((md|txt|csv|html|tex|json))$/i.test(mime+name)) throw new Error("Add PDF, text, Markdown, CSV, or HTML material.");
  const decoded = raw.toString("utf8");
  const reading = /html/.test(mime+name) ? extractReading(decoded) : { title: name, text: decoded };
  if (!reading.text.trim()) throw new Error("This file is empty.");
  return { ...reading, raw, pdf:false, pages:0, partial: reading.text.length > MAX_TEXT, text: reading.text.slice(0,MAX_TEXT) };
}

/** Every redirect gets public DNS validation and a pinned TLS connection. No cookies or browser session. */
export async function downloadResource(input: string, risk: Pick<WebRiskChecker,"allow">): Promise<ReadResource & { url: string }> {
  let target = input;
  for(let i=0;i<5;i++) {
    const {url,addresses} = await checkedDestination(target);
    await risk.allow(url.href);
    const response = await new Promise<{status:number;location?:string;mime:string;raw:Buffer}>((resolve,reject)=>{
      const address = addresses[0]!;
      const req=request({hostname:address.address,family:address.family,servername:url.hostname,port:443,
        path:url.pathname+url.search,method:"GET",agent:false,headers:{Host:url.host,"Accept-Encoding":"identity",Accept:"application/pdf,text/html,text/plain","User-Agent":"XENIUR/1.0"}},res=>{
          const chunks:Buffer[]=[];let size=0;
          res.on("error",reject);res.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>MAX_RESOURCE_BYTES)req.destroy(new Error("This source exceeds 50 MB."));else chunks.push(chunk);});
          res.on("end",()=>resolve({status:res.statusCode??500,location:res.headers.location,mime:res.headers["content-type"]??"",raw:Buffer.concat(chunks)}));
        });
      const deadline=setTimeout(()=>req.destroy(new Error("The source took too long to respond.")),30_000);
      req.on("close",()=>clearTimeout(deadline));req.on("error",reject);req.end();
    });
    if ([301,302,303,307,308].includes(response.status) && response.location) {target=new URL(response.location,url).href;continue;}
    if(response.status<200||response.status>=300)throw new Error(`This source returned ${response.status}. You can upload a copy instead.`);
    const reading=await readResource(response.raw,decodeURIComponent(url.pathname.split("/").pop()||url.hostname),response.mime);
    return {...reading,url:url.href};
  }
  throw new Error("This source redirected too many times.");
}

/** Rasterize a chosen page and crop it; preserve the original in the stored source, never invent scientific pixels. */
export async function cropPdfFigure(raw:Buffer,pageNumber:number,crop:{x:number;y:number;width:number;height:number}):Promise<Buffer> {
  const {createCanvas}=await import("@napi-rs/canvas");
  const task=getDocument({data:new Uint8Array(raw),useSystemFonts:false,isEvalSupported:false});
  const pdf=await task.promise;
  try {
    if(pageNumber<1||pageNumber>pdf.numPages)throw new Error("Choose a page in this PDF.");
    const page=await pdf.getPage(pageNumber);const base=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:Math.min(2,1800/Math.max(base.width,base.height))});
    const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await page.render({canvasContext:canvas.getContext("2d") as any,viewport}).promise;
    const left=Math.floor(crop.x*canvas.width),top=Math.floor(crop.y*canvas.height);
    return await sharp(canvas.toBuffer("image/png")).extract({left,top,width:Math.min(canvas.width-left,Math.floor(crop.width*canvas.width)),height:Math.min(canvas.height-top,Math.floor(crop.height*canvas.height))}).png().toBuffer();
  } finally {await task.destroy();}
}
