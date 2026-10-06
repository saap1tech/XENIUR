import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(12000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const base=process.env.XENIUR_PREVIEW_URL??'http://localhost:5180/';
const out=new URL('../docs/screenshots/',import.meta.url).pathname;
async function shot(name){await page.evaluate(()=>document.fonts.ready);await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(img=>{img.loading='eager';return img.decode().catch(()=>{});})));await page.screenshot({path:out+name+'.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' overflow');}
async function library(){await page.goto(base+'?visual-preview=home');await page.getByRole('button',{name:'Workflows',exact:true}).click();}
async function pay(name){await page.getByRole('button',{name,exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Run step',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
async function step(){await pay(await page.getByRole('button',{name:'Create my brief',exact:true}).count()?'Create my brief':'Create this step');}
async function accept(){if(await page.locator('.xr-adaptive__options>button').count())await page.locator('.xr-adaptive__options>button').first().click();await page.getByRole('button',{name:'Use this',exact:true}).click();}
try {
 await library();await shot('workflow-library-direct');
 await page.getByRole('button',{name:'Research review',exact:true}).click();await page.getByRole('heading',{name:'Bring what you know.'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'What are you making?'}).count(),0);
 await page.getByRole('textbox',{name:'Topic or goal'}).fill('Compare evidence about CO₂ electrolysis');await page.getByRole('button',{name:'Save brief',exact:true}).click();await page.getByRole('heading',{name:'Compare evidence about CO₂ electrolysis',exact:true}).waitFor();await shot('workflow-research-brief');
 await library();await page.getByRole('button',{name:'Prepare files',exact:true}).click();await page.getByRole('button',{name:'Open Brand identity workflow',exact:true}).click();await page.getByRole('heading',{name:'Start with your file.'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'What are you making?'}).count(),0);await shot('workflow-file-direct');
 await library();await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('button',{name:'Film or video script',exact:true}).click();
 await page.getByRole('textbox',{name:'Topic or goal'}).fill('A short film about our repair workshop');await page.getByRole('textbox',{name:'Who is it for?'}).fill('People who want to repair furniture');await page.getByRole('button',{name:'Save brief',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
 for(let i=0;i<3;i++){await step();await accept();}await step();
 await page.getByRole('region',{name:'Storyboard',exact:true}).waitFor();assert.equal(await page.locator('.xr-storyboard__scenes article').count(),3);await page.getByRole('button',{name:'Illustrate scene',exact:true}).first().click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Run step',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 // Multiple buttons: select the first scene explicitly for subsequent actions.
 await shot('workflow-storyboard');
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('textbox',{name:'Narration',exact:true}).first().fill('A careful repair gives a favourite object another life.');await page.getByRole('button',{name:'Save edits',exact:true}).click();await accept();
 await page.locator('.xr-project__path').getByRole('button',{name:'Shape the scenes'}).click();await page.getByText('Accepted work',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Illustrate scene',exact:true}).count(),0);await shot('workflow-accepted-preview');
 await page.getByRole('button',{name:'Back to current step',exact:true}).click();await step();await accept();await step();await page.getByRole('textbox',{name:'What did you personally check?'}).fill('I checked the script, scene order and the estimated production timing.');await page.locator('.xr-adaptive__judgment input').check();await page.getByRole('button',{name:'Finish review',exact:true}).click();await shot('workflow-production-ready');
 await page.setViewportSize({width:640,height:900});await page.locator('.xr-project__path').getByRole('button',{name:'Shape the scenes'}).click();assert.ok(await page.locator('.xr-project__path').evaluate(el=>el.getBoundingClientRect().height<160),'compact path must not stretch around a decorative image');await shot('workflow-storyboard-small');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({navigation:'selected paths and file workflows open directly',storyboard:'editable scenes, optional images, accepted previews, review',screenshots:7,errors,note:'Sample UI fixture; desktop and backend checked separately.'},null,2));
}finally{await browser.close();}
