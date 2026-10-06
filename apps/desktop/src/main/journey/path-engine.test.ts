import { describe,it,expect } from 'vitest';
import { builtInPath, PATH_CATALOG, type StepOutput } from '@xeniur/core';
import { parsePath,validateStep } from './path-engine.js';
import { renderBrandVisual } from './brand-visual.js';
import { renderPathVisual } from './path-visuals.js';
const source='11111111-1111-4111-8111-111111111111';
const base:StepOutput={title:'A result',summary:'Summary',sections:[],options:[],checks:[],uncertainties:[],sourceIds:[]};
describe('bounded path contracts',()=>{
 it('validates every specialized template and rejects duplicate steps',()=>{for(const card of PATH_CATALOG){const p=builtInPath(card.id);if(p)expect(parsePath(p)).toEqual(p);}const p=builtInPath('software')!;expect(()=>parsePath({...p,steps:[p.steps[0],p.steps[0],p.steps.at(-1)]})).toThrow();});
 it('rejects missing outputs, foreign sources, unsafe project paths and excessive numbers',()=>{
  expect(()=>validateStep(base,'one_page',new Set())).toThrow('missing');
  for(const path of ['../escape.js','/absolute.js','a/../../escape.js','a//x.js','.secret.js','run.sh','CON.js'])expect(()=>validateStep({...base,project:{entry:'index.html',files:{'index.html':'hello',[path]:'bad'}}},'code',new Set())).toThrow();
  const diagram={kind:'bar',title:'Data',caption:'Source values',unit:'mA',points:[{label:'A',value:1,sourceId:source},{label:'B',value:2,sourceId:source}],sourceIds:[source]};
  expect(()=>validateStep({...base,diagram},'diagram',new Set())).toThrow('outside');
  expect(()=>validateStep({...base,diagram:{...diagram,points:[{label:'A',value:1e308,sourceId:source},diagram.points[1]]}},'diagram',new Set([source]))).toThrow();
 });
 it('outlines the selected bundled font for portable brand artwork',()=>{const svg=renderBrandVisual({...base,identity:{name:'Common Ground',tagline:'Useful things',colors:['#29483D','#F8F6ED'],font:'cochineal',voice:['Clear and specific']}},process.cwd());expect(svg).toContain('<path');expect(svg).not.toContain('<text');});
 it('bounds storyboards and rejects duplicated scenes and foreign factual sources',()=>{
  const scene={id:'opening',title:'Opening',seconds:30,visual:'A calm workshop with a chair being repaired.',narration:'A second life.',sourceIds:[]};
  const storyboard={aspect:'16:9',scenes:[scene,{...scene,id:'closing',sourceIds:[source]}]};
  expect(()=>validateStep({...base,storyboard},'storyboard',new Set())).toThrow('outside');
  expect(validateStep({...base,storyboard},'storyboard',new Set([source])).storyboard?.scenes).toHaveLength(2);
  expect(()=>validateStep({...base,storyboard:{...storyboard,scenes:[scene,scene]}},'storyboard',new Set())).toThrow();
  expect(()=>validateStep({...base,storyboard:{...storyboard,scenes:[scene,{...scene,id:'closing',seconds:181}]}},'storyboard',new Set())).toThrow();
  expect(()=>validateStep(base,'storyboard',new Set())).toThrow('missing');
  expect(()=>validateStep({...base,storyboard},'write',new Set([source]))).toThrow('approved step');
 });
 it('escapes labels and handles zero and negative chart values',()=>{
  const o=validateStep({...base,diagram:{kind:'bar',title:'<script>alert(1)</script>',caption:'A & B',unit:'mA',points:[{label:'A',value:-5,sourceId:source},{label:'B',value:0,sourceId:source}],sourceIds:[source]}},'diagram',new Set([source]));const svg=renderPathVisual(o)!;expect(svg).not.toContain('<script>');expect(svg).toContain('&lt;script&gt;');expect(svg).not.toMatch(/NaN|Infinity/);
 });
});
