import {_electron as electron} from 'playwright';
import executablePath from 'electron';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {unzipSync} from 'fflate';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const dir=mkdtempSync(join(tmpdir(),'xeniur-export-qa-')),module=join(dir,'document.cjs'),output=join(dir,'review.zip');
let app;
try {
 // Bundle the production export function; provider calls and paid work are not involved.
 await build({entryPoints:[join(root,'apps/desktop/src/main/journey/document.ts')],outfile:module,bundle:true,platform:'node',format:'cjs',tsconfig:join(root,'tsconfig.json'),external:['electron'],plugins:[{name:'runtime-dependencies',setup(b){b.onResolve({filter:/^(sharp|fflate|zod)$/},a=>({path:require.resolve(a.path),external:true}));}}]});
 const journey={reviewed:true,figureIds:[],illustration:null,resources:[],choices:{palette:null,font:'erewhon',layout:'field'},draft:{title:'Portable print check',abstract:'A real PDF without an external TeX installation.',sections:[{title:'Result',level:1,paragraphs:['The local print edition preserves the reviewed content.','<script> is printed as text; document scripts are disabled.'],sourceIds:[]}],tables:[{title:'Checks',columns:['Item','Result'],rows:[['Portable PDF','Included'],['Editable source','Included']],sourceIds:[]}],limitations:['This fixture checks exporting, not research accuracy.']},decisions:[],goalId:'export-test'};
 const entry=join(dir,'entry.mjs');
 writeFileSync(entry,`import api from ${JSON.stringify(pathToFileURL(module).href)};globalThis.__exportQa=()=>api.exportJourney(${JSON.stringify(journey)},{readBlob(){throw Error('No fixture figures');}},${JSON.stringify(root)},${JSON.stringify(join(dir,'scratch'))},${JSON.stringify(output)});await import(${JSON.stringify(pathToFileURL(join(root,'apps/desktop/out/main/index.js')).href)});`);
 app=await electron.launch({executablePath,args:[entry],env:{...process.env,XENIUR_ROOT:root,XENIUR_DATA_DIR:join(dir,'profile'),XENIUR_XELATEX:join(dir,'no-xelatex')}});
 const page=await app.firstWindow();await page.getByRole('button',{name:'Use without AI',exact:true}).waitFor();
 const result=await app.evaluate(()=>globalThis.__exportQa());assert.equal(result.pdf,true);assert.match(result.warning,/built-in print edition/);
 const files=unzipSync(readFileSync(output));
 for(const name of ['review.pdf','review.html','main.tex','fonts/Erewhon-Regular.otf','evidence-coverage.json','evidence-reviews.json'])assert.ok(files[name],name);
 assert.equal(Buffer.from(files['review.pdf']).subarray(0,4).toString(),'%PDF');
 assert.match(Buffer.from(files['review.html']).toString(),/&lt;script&gt;/);
 const pdf=await getDocument({data:files['review.pdf'],useSystemFonts:false}).promise;
 const first=await pdf.getPage(1),viewport=first.getViewport({scale:1}),content=await first.getTextContent();
 assert.ok(Math.abs(viewport.width-595)<2&&Math.abs(viewport.height-842)<2);
 assert.ok(content.items.some(item=>'str' in item&&item.str.includes('Portable print check')));
 console.log(JSON.stringify({builtInPdf:true,A4:true,pages:pdf.numPages,editableTex:true,licensedFonts:true,htmlEscaped:true,evidenceRecords:true,paidCalls:0},null,2));await pdf.destroy();
}finally{await app?.close();rmSync(dir,{recursive:true,force:true});}
