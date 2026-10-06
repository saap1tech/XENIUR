import {_electron as electron} from 'playwright';
import executablePath from 'electron';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import sharp from 'sharp';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'xeniur-browser-qa-'));
const entry=join(dir,'entry.mjs');
writeFileSync(entry,`import {app} from 'electron';app.setPath('userData',${JSON.stringify(join(dir,'profile'))});await import(${JSON.stringify(pathToFileURL(join(root,'apps/desktop/out/main/index.js')).href)});`);
let app;
try{
 app=await electron.launch({executablePath,args:[entry],env:{...process.env,XENIUR_ROOT:root}});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error("Renderer error",e.message);});page.on("console",m=>{if(m.type()==="error")console.error("Renderer console",m.text());});console.log("Test window ready",await page.title());
 try{await page.getByRole('button',{name:'Use without AI',exact:true}).click();}catch(error){console.error('Startup state',await page.locator('body').innerText());console.error('Bridge present',await page.evaluate(()=>!!window.xeniur));throw error;}
 await page.getByRole('button',{name:'Workflows',exact:true}).click();await page.getByRole('button',{name:'Research review',exact:true}).click();
 await page.getByRole('heading',{name:'Bring what you know.'}).waitFor();
 await page.getByRole('textbox',{name:'Topic or goal'}).fill('Compare catalyst stability measurements');await page.getByRole('button',{name:'Save brief',exact:true}).click();
 await page.getByText('More',{exact:true}).click();await page.getByRole('button',{name:'Open browser',exact:true}).click();
 await page.locator('.xr-web-browser--fill').waitFor();
 const context=await page.evaluate(async()=>{const worlds=await window.xeniur.worlds.list();const w=worlds.find(w=>w.title==='Research review');const ps=await window.xeniur.browser.profiles();return {worldId:w.id,profile:ps.find(p=>p.kind==='ephemeral')??ps[0]};});
 // Only this disposable browser profile serves two fixed fixtures. Production HTTPS and DNS policy remain enabled.
 await app.evaluate(async({session},profile)=>{await session.fromPartition(profile.partition).protocol.handle('https',request=>{
  const u=new URL(request.url),a=u.pathname==='/xeniur-a';if(u.hostname!=='example.org'||!['/xeniur-a','/xeniur-b'].includes(u.pathname))return new Response('Fixture not found',{status:404});
  return new Response(`<!doctype html><meta charset="utf-8"><title>${a?'Study A':'Study B'}</title><style>body{font:20px Georgia;background:#faf8ef;color:#29483d;padding:50px;line-height:1.6}h1{font-size:42px}small{font:13px sans-serif}article{max-width:600px}blockquote{border-left:4px solid #b9ce64;padding-left:20px}</style><article><small>PUBLIC TEST FIXTURE · NOT SCIENTIFIC EVIDENCE</small><h1>${a?'Durability at steady current':'Different operating conditions'}</h1><p id="passage">${a?'Catalyst stability was measured over 24 hours at a stated current density. This result does not establish durability under intermittent operation.':'Measurements under intermittent operation cannot be compared without matching temperature, current and duration.'}</p><blockquote>Compare the conditions before choosing a conclusion.</blockquote></article>`,{headers:{'Content-Type':'text/html'}});
 });},context.profile);
 const open=async url=>page.evaluate(async({context,url})=>window.xeniur.browser.openTab({profileId:context.profile.id,worldId:context.worldId,url}),{context,url});
 const first=await open('https://example.org/xeniur-a'),second=await open('https://example.org/xeniur-b');
 await page.getByRole('tab',{name:'Study A',exact:true}).click();
 await page.getByRole('button',{name:'Compare',exact:true}).click();await page.locator('.xr-browser-other-host').waitFor();
 await page.getByRole('button',{name:/^Sources/}).click();
 // ResizeObserver and native IPC settle on separate turns after opening the shelf.
 let bounds=[];
 for(let attempt=0;attempt<40;attempt++){
  bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.map(view=>view.getBounds()).filter(r=>r.width>0&&r.height>0));
  const rects=await page.locator('.xr-web-browser__host,.xr-browser-other-host').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),width:Math.round(r.right)-Math.round(r.x)};}));
  if(bounds.length===2&&rects.every(r=>bounds.some(b=>b.x===r.x&&b.width===r.width)))break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(bounds.length,2);assert.ok(bounds.every(r=>r.width>250&&r.height>300));assert.ok(bounds[0].x+bounds[0].width<=bounds[1].x||bounds[1].x+bounds[1].width<=bounds[0].x);
 const remote=await app.evaluate(async({webContents},id)=>{const wc=webContents.getAllWebContents().find(c=>c.getURL()==='https://example.org/xeniur-a');return wc.executeJavaScript(`({bridge:typeof window.xeniur,node:typeof require,selection:(()=>{const r=document.createRange();r.selectNodeContents(document.getElementById('passage'));getSelection().removeAllRanges();getSelection().addRange(r);return getSelection().toString();})()})`);},first.id);
 assert.equal(remote.bridge,'undefined');assert.equal(remote.node,'undefined');
 await page.getByRole('button',{name:'Save to project',exact:true}).click();
 await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('checkbox',{name:'Use in the work path'}).isChecked(),true);
 const hidden=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.every(v=>v.getBounds().width===0));assert.equal(hidden,true);
 await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 const saved=await page.evaluate(async id=>{const j=await window.xeniur.journey.get(id),s=await window.xeniur.browser.shelf(id);return {j,s};},context.worldId);
 assert.equal(saved.j.resources.length,1);assert.equal(saved.s.length,1);assert.equal(saved.s[0].inPath,true);assert.equal(saved.s[0].excerpt,remote.selection);
 await page.getByRole('textbox',{name:'What matters for your work?'}).fill('The operating conditions differ. I need a matched-duration comparison before choosing.');
 await page.getByRole('button',{name:'Save my note',exact:true}).click();await page.getByRole('status').filter({hasText:'Comparison note saved to your project.'}).waitFor();
 // Native views are separate surfaces; capture their actual pixels alongside the shell.
 const capture=await app.evaluate(async({BrowserWindow})=>{
  const win=BrowserWindow.getAllWindows()[0];
  const views=win.contentView.children.filter(v=>v.getBounds().width>0);
  return {width:win.getContentBounds().width,shell:(await win.webContents.capturePage()).toPNG().toString('base64'),views:await Promise.all(views.map(async v=>({bounds:v.getBounds(),png:(await v.webContents.capturePage()).toPNG().toString('base64')})))};
 });
 const shell=Buffer.from(capture.shell,'base64'),meta=await sharp(shell).metadata(),scale=meta.width/capture.width;
 const layers=await Promise.all(capture.views.map(async v=>({input:await sharp(Buffer.from(v.png,'base64')).resize(Math.round(v.bounds.width*scale),Math.round(v.bounds.height*scale)).png().toBuffer(),left:Math.round(v.bounds.x*scale),top:Math.round(v.bounds.y*scale)})));
 await sharp(shell).composite(layers).png().toFile(join(root,'docs/screenshots/browser-project-comparison.png'));
 await page.getByRole('button',{name:'Swap comparison pages',exact:true}).click();await page.getByRole('tab',{name:'Study B',exact:true}).waitFor();
 await page.getByRole('button',{name:'Close comparison',exact:true}).click();assert.equal(await page.locator('.xr-browser-other-host').count(),0);
 await page.evaluate(async()=>{await window.xeniur.browser.setFullscreen(true);await window.xeniur.browser.setFullscreen(false);});
 await page.locator('#browser-address').focus();await page.keyboard.press(process.platform==='darwin'?'Meta+l':'Control+l');assert.equal(await page.locator('#browser-address').evaluate(e=>document.activeElement===e),true);
 await assert.rejects(()=>page.evaluate(async id=>window.xeniur.browser.navigate(id,'http://127.0.0.1/'),first.id));
 await page.evaluate(async id=>{await window.xeniur.browser.find(id,'conditions');await window.xeniur.browser.find(id,'');},first.id);
 await app.evaluate(async({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1100,780);});
 await page.waitForFunction(()=>window.innerWidth===1100);
 await page.getByRole('button',{name:'Return to work',exact:true}).click();await page.getByRole('heading',{name:'Bring what you know.'}).waitFor();
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.every(v=>v.getBounds().width===0)),true);
 assert.deepEqual(errors,[]);
 // Test real file holding and dialog save without depending on internet download behavior.
 const payload='An actual downloaded test file.\n',hash=createHash('sha256').update(payload).digest('hex');
 const held=join(dir,'held.txt'),destination=join(dir,'kept.txt');writeFileSync(held,payload);
 const db=new Database(join(dir,'profile','xeniur.db'));db.prepare('INSERT INTO held_downloads (id,tab_id,filename,mime,bytes,sha256,path,at,decided) VALUES (?,?,?,?,?,?,?,?,NULL)').run('download-test',first.id,'test.txt','text/plain',Buffer.byteLength(payload),hash,held,Date.now());db.close();
 await app.evaluate(({dialog},destination)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:destination});},destination);
 // Cancelling the save dialog retains the held file for a later decision.
 await app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true});});
 await page.evaluate(()=>window.xeniur.browser.decideDownload('download-test','kept'));assert.equal(readFileSync(held,'utf8'),payload);
 assert.equal((await page.evaluate(id=>window.xeniur.browser.downloads(id),context.worldId)).length,1);
 writeFileSync(held,'Changed bytes');await assert.rejects(()=>page.evaluate(()=>window.xeniur.browser.decideDownload('download-test','kept')),/changed/);
 writeFileSync(held,payload);await app.evaluate(({dialog},destination)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:destination});},destination);
 await page.evaluate(()=>window.xeniur.browser.decideDownload('download-test','kept'));assert.equal(readFileSync(destination,'utf8'),payload);
 // Closing the app preserves open tabs, but reopening it must not browse in the background.
 await app.close();app=await electron.launch({executablePath,args:[entry],env:{...process.env,XENIUR_ROOT:root}});
 const reopened=await app.firstWindow();await reopened.getByRole('button',{name:'Use without AI',exact:true}).click();await reopened.getByRole('button',{name:'Workflows',exact:true}).waitFor();
 const restored=await reopened.evaluate(id=>window.xeniur.browser.tabs(id),context.worldId);
 assert.deepEqual(restored.map(t=>t.id).sort(),[first.id,second.id].sort());
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].contentView.children.length),0);
 await app.evaluate(async({session},profile)=>{await session.fromPartition(profile.partition).protocol.handle('https',()=>new Response('<title>Restored study</title><p>Restored only when requested.</p>',{headers:{'Content-Type':'text/html'}}));},context.profile);
 await reopened.evaluate(id=>window.xeniur.browser.activate(id),first.id);
 assert.equal((await reopened.evaluate(id=>window.xeniur.browser.state(id),first.id)).title,'Restored study');
 assert.equal((await reopened.evaluate(id=>window.xeniur.browser.tabs(id),context.worldId)).length,2);
 console.log(JSON.stringify({runtime:await app.evaluate(()=>process.versions.electron),twoRealViews:true,selectionSavedToPath:true,privateBridgeAbsent:true,projectNote:true,blockedLocalAddress:true,resize:true,returnedToWork:true,heldDownloadSaved:true,cancelledSaveRetained:true,tamperedDownloadRejected:true,tabsRestoredOnDemand:true,pageErrors:errors,paidCalls:0},null,2));
}finally{await app?.close();rmSync(dir,{recursive:true,force:true});}
