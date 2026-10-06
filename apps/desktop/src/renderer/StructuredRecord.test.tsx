import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StructuredRecord } from './StructuredRecord.js';

describe('saved work reading view',()=>{
 it('shows work-path headings and text rather than empty document sections',()=>{
  const html=renderToStaticMarkup(<StructuredRecord value={{title:'A brief',summary:'The audience is local repair shops.',sections:[{heading:'The actual goal',text:'Book repairs without a network connection.'}],options:[],checks:['Try offline'],uncertainties:[],sourceIds:[]}}/>);
  expect(html).toContain('The actual goal');expect(html).toContain('Book repairs without a network connection.');expect(html).toContain('The audience is local repair shops.');
 });
 it('preserves document outlines, nested headings and tables',()=>{
  const html=renderToStaticMarkup(<StructuredRecord value={{abstract:'A careful review.',sections:[{title:'Conditions',purpose:'Compare operating windows.',children:[{title:'Duration',children:['Measurement limits']}]}],tables:[{title:'Comparison',columns:['Study','Hours'],rows:[['A','10']]}]}}/>);
  for(const label of ['A careful review.','Compare operating windows.','Duration','Measurement limits','Comparison','Hours','10'])expect(html).toContain(label);
 });
});
