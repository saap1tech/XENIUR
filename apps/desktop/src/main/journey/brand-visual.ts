import { join } from 'node:path';
import { GlobalFonts, convertSVGTextToPath } from '@napi-rs/canvas';
import { JOURNEY_FONTS, type StepOutput } from '@xeniur/core';
import { renderPathVisual } from './path-visuals.js';

/** Outline the bundled typeface so the exported board looks the same on any PC. */
export function renderBrandVisual(output:StepOutput,projectRoot:string):string {
 const font=JOURNEY_FONTS.find(f=>f.id===output.identity?.font);
 if(!font)throw new Error('Choose a bundled typeface for this identity.');
 const alias=`XeniurIdentity-${font.id}`;
 if(!GlobalFonts.has(alias)&&!GlobalFonts.registerFromPath(join(projectRoot,'brand/fonts',font.file),alias))throw new Error('The selected typeface could not be loaded.');
 return convertSVGTextToPath(renderPathVisual(output,alias)!).toString();
}
