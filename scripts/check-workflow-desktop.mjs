import {_electron as electron} from 'playwright';
import executablePath from 'electron';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
import sharp from 'sharp';

// A disposable desktop profile. No existing projects, keys or settings are touched.
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'xeniur-workflow-qa-'));
const entry=join(dir,'entry.mjs');
writeFileSync(entry,`import {app} from 'electron';app.setPath('userData', ${JSON.stringify(join(dir,'profile'))});await import(${JSON.stringify(pathToFileURL(join(root,'apps/desktop/out/main/index.js')).href)}).catch(console.error);`);
const source=join(dir,'source.png'),output=join(dir,'logo.png');
writeFileSync(source,await sharp({create:{width:1200,height:1200,channels:4,background:'#29483D'}}).png().toBuffer());
const packaged=process.env.XENIUR_QA_EXECUTABLE;
const app=await electron.launch({executablePath:packaged??executablePath,args:packaged?[]:[entry],env:{...process.env,XENIUR_ROOT:root,XENIUR_DATA_DIR:join(dir,'profile')}});
 app.process().stderr.on('data',chunk=>process.stderr.write(chunk));
try {
 const page=await app.firstWindow();page.setDefaultTimeout(25000);
 if(packaged)assert.equal(await app.evaluate(({app})=>app.isPackaged),true);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'Use without AI',exact:true}).click();
 await page.getByRole('button',{name:'Workflows',exact:true}).click();
 await page.getByRole('button',{name:'Research review',exact:true}).click();await page.getByRole('heading',{name:'Bring what you know.'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'What are you making?'}).count(),0);
 await page.getByRole('textbox',{name:'Topic or goal'}).fill('Compare evidence from my actual experiment');await page.getByRole('button',{name:'Save brief',exact:true}).click();await page.getByRole('heading',{name:'Compare evidence from my actual experiment',exact:true}).waitFor();
 const first=await page.evaluate(async()=>{const worlds=await window.xeniur.worlds.list();const world=worlds.find(w=>w.title==='Research review');return {worldId:world.id,journey:await window.xeniur.journey.get(world.id)};});
 assert.equal(first.journey.kind,'review');assert.equal(first.journey.brief.topic,'Compare evidence from my actual experiment');
 await page.getByRole('button',{name:'Home',exact:true}).click();await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByRole('button',{name:'Prepare files',exact:true}).click();await page.getByRole('button',{name:'Open Brand identity workflow',exact:true}).click();await page.getByRole('heading',{name:'Start with your file.'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'What are you making?'}).count(),0);
 await app.evaluate(({dialog},{source,output})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},{source,output});
 await page.getByRole('button',{name:'Add source file',exact:true}).click();await page.getByRole('heading',{name:'Make useful versions.'}).waitFor();
 await page.getByRole('button',{name:'Create versions',exact:true}).click();await page.locator('.xr-recipe__output').first().waitFor();
 assert.ok(await page.locator('.xr-recipe__previews img').count()>0);
 await page.getByRole('button',{name:'Check results',exact:true}).click();await page.getByText(/^File checks ·/).waitFor();
 await page.locator('.xr-recipe__output').first().getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved.',{exact:true}).waitFor();
 const metadata=await sharp(readFileSync(output)).metadata();assert.equal(metadata.format,'png');assert.ok(metadata.width>0);
 await page.evaluate(async()=>{window.scrollTo(0,0);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 await page.screenshot({path:join(root,'docs/screenshots/workflow-desktop-files.png'),fullPage:true});
 await page.getByRole('button',{name:'Home',exact:true}).click();
 await page.evaluate(async id=>{const snapshot=await window.xeniur.worlds.open(id);return snapshot.world.title;},first.worldId);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({desktop:'actual graph, IPC, import, local image processing and saved PNG verified',packaged:!!packaged,runtime:await app.evaluate(()=>process.versions.electron),directSelection:true,briefPersisted:true,output:metadata.width+'×'+metadata.height,errors,paidCalls:0},null,2));
}finally{await app.close();rmSync(dir,{recursive:true,force:true});}
