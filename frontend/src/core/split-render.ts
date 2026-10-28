import {renderPixels,validateRecipeSource} from './editing.ts';
import type {EditRecipe,EditRecipeV2,Pixels} from './editing.ts';
import {compositionBasis} from './composition-geometry.ts';
import type {Size} from './composition-geometry.ts';
import {panelBoundaries,resolveSplitCount,splitPlan,validateSplit} from './seamless-split.ts';
import type {SplitSpec,SplitPlan} from './seamless-split.ts';

export type SplitProgress={phase:'render'|'encode';done:number;total:number};
export type EncodedSplit={version:1|2;parent_recipe?:EditRecipe;spec:SplitSpec;plan:SplitPlan;recipe:EditRecipeV2;format:'png'|'jpg';quality:number;master:{blob:Blob;sha256:string};panels:{index:number;blob:Blob;sha256:string}[]};

export function splitRecipe(recipe:EditRecipe,source:Size,spec:SplitSpec):EditRecipeV2{
  validateRecipeSource(recipe,source);validateSplit(spec);const basis=compositionBasis(source,recipe.rotation);
  if(basis.width!==spec.basis.width||basis.height!==spec.basis.height||spec.angle!==(recipe.version!==1?recipe.composition.angle:0))throw new Error('Split source dimensions or angle changed. Reopen the split tool.');
  const withoutLut=recipe.version===5?(({lut:_,...rest})=>({...rest,version:4 as const}))(recipe):recipe;
  const base=withoutLut.version===4?(({layer_stack:_,...rest})=>rest)(withoutLut):withoutLut.version===3?(({text_layers:_,...rest})=>rest)(withoutLut):withoutLut;
  const result:EditRecipeV2={...base,version:2,crop:{...spec.region},composition:{source_width:source.width,source_height:source.height,angle:spec.angle,aspect:spec.aspect.width/spec.aspect.height*resolveSplitCount(spec.basis,spec.aspect,spec.count)}};
  validateRecipeSource(result,source);return result;
}
export function renderSplitPixels(source:Pixels,recipe:EditRecipe,spec:SplitSpec){
  const frozen=splitRecipe(recipe,source,spec),plan=splitPlan(spec),pixels=renderPixels(source,frozen);
  if(pixels.width!==plan.width||pixels.height!==plan.height)throw new Error('Split render dimensions do not match its pixel plan.');
  return {recipe:frozen,plan,pixels};
}
// Render the whole region once BEFORE slicing. In particular, spatial
// sharpening/denoising must see the same neighbors on both sides of a seam.
// Consumers encode each yielded panel before asking for the next one, keeping
// only one additional uncompressed panel alive unless they choose to retain it.
export function* splitPixelPanels(pixels:Pixels,plan:SplitPlan){
  const {width,height,channels,data}=pixels;
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>100_000_000||width!==plan.width||height!==plan.height||![3,4].includes(channels)||data.length!==width*height*channels||
    !(data instanceof Uint8Array||data instanceof Uint8ClampedArray||data instanceof Uint16Array)||plan.panels.length!==plan.count||plan.edges.length!==plan.count+1||plan.edges[0]!==0||plan.edges.at(-1)!==width)throw new Error('Invalid split pixels.');
  const expected=panelBoundaries(width,plan.count);if(plan.edges.some((v,i)=>v!==expected[i]))throw new Error('Invalid split pixels.');
  // Validate the complete plan before yielding any panel, so a damaged late
  // edge cannot leave a caller with an apparently successful partial result.
  let right=0;
  for(let i=0;i<plan.panels.length;i++){
    const p=plan.panels[i];if(!Number.isInteger(p.width)||p.width<1||p.x!==right||p.y!==0||p.height!==height||plan.edges[i]!==p.x||plan.edges[i+1]!==p.x+p.width)throw new Error('Invalid split pixels.');right+=p.width;
  }
  if(right!==width)throw new Error('Invalid split pixels.');
  for(let index=0;index<plan.panels.length;index++){
    const rect=plan.panels[index],out=data instanceof Uint16Array?new Uint16Array(rect.width*height*channels):data instanceof Uint8ClampedArray?new Uint8ClampedArray(rect.width*height*channels):new Uint8Array(rect.width*height*channels);
    for(let y=0;y<height;y++){const at=(y*width+rect.x)*channels;out.set(data.subarray(at,at+rect.width*channels),y*rect.width*channels);}
    yield {index,rect:{...rect},pixels:{...pixels,width:rect.width,height,data:out}};
  }
}
