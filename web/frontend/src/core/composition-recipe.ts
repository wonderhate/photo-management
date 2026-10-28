import type {EditRecipe,EditRecipeV1,EditRecipeV2,EditRecipeV3,EditRecipeV4,EditRecipeV5} from './editing';
import {compositionBasis,cropCenter,cropForAspect,fitCrop,flipCrop,rotateCrop,moveCrop} from './composition-geometry.ts';
import type {Size,CompositionView} from './composition-geometry.ts';

export function composeRecipe(recipe:EditRecipe,source:Size):EditRecipeV2|EditRecipeV3|EditRecipeV4|EditRecipeV5{
  return recipe.version!==1?recipe:{...recipe,version:2,composition:{source_width:source.width,source_height:source.height,angle:0}};
}
export function straightenRecipe(recipe:EditRecipe,source:Size,angle:number):EditRecipeV2|EditRecipeV3|EditRecipeV4|EditRecipeV5{
  const r=composeRecipe(recipe,source),size=compositionBasis(source,r.rotation);
  return {...r,composition:{...r.composition,angle},crop:fitCrop(r.crop,size,angle)};
}
export function aspectRecipe(recipe:EditRecipe,source:Size,aspect?:number):EditRecipeV2|EditRecipeV3|EditRecipeV4|EditRecipeV5{
  const r=composeRecipe(recipe,source),{aspect:_,...composition}=r.composition,size=compositionBasis(source,r.rotation);
  return {...r,composition:aspect?{...composition,aspect}:composition,crop:aspect?cropForAspect(r.crop,size,composition.angle,aspect):r.crop};
}
export function turnRecipe(r:EditRecipe,direction:1|-1=1):EditRecipe{
  const rotation=((r.rotation+direction*90+360)%360) as EditRecipe['rotation'];
  if(r.version===1)return {...r,rotation};
  return {...r,rotation,flipX:r.flipY,flipY:r.flipX,crop:rotateCrop(r.crop,direction===1),composition:{...r.composition,...(r.composition.aspect?{aspect:1/r.composition.aspect}:{})}};
}
function maximumCrop(r:EditRecipe,source:Size,angle:number){const size=compositionBasis(source,r.rotation),c=r.crop,ratio=Math.max(1e-12,Math.min(1e12,c.width*size.width/(c.height*size.height)));return cropForAspect({...c,x:.5-c.width/2,y:.5-c.height/2},size,angle,ratio);}
const viewScale=(scale:number)=>Math.max(.000001,Math.min(1_000_000,Number.isNaN(scale)?1:scale));
export function compositionZoom(r:EditRecipe,source:Size):number{return Math.max(1,viewScale(maximumCrop(r,source,r.version!==1?r.composition.angle:0).width/r.crop.width));}
export function compositionView(r:EditRecipe,source:Size):CompositionView{return {center:cropCenter(r.crop),scale:Math.max(1,viewScale(maximumCrop(r,source,0).width/r.crop.width))};}
export function trackCompositionView(before:EditRecipe,after:EditRecipe,view:CompositionView):CompositionView{
  const a=cropCenter(before.crop),b=cropCenter(after.crop),scale=viewScale(view.scale*before.crop.width/after.crop.width),ratio=view.scale/scale;
  return {scale,center:{x:b.x-(a.x-view.center.x)*ratio,y:b.y-(a.y-view.center.y)*ratio}};
}
export function zoomRecipe(recipe:EditRecipe,source:Size,zoom:number):EditRecipeV2|EditRecipeV3|EditRecipeV4|EditRecipeV5{
  if(!Number.isFinite(zoom)||zoom<1)throw new Error('Invalid composition.');
  const r=composeRecipe(recipe,source),size=compositionBasis(source,r.rotation),max=maximumCrop(r,source,r.composition.angle),center=cropCenter(r.crop),width=max.width/zoom,height=max.height/zoom;
  return {...r,crop:moveCrop({x:center.x-width/2,y:center.y-height/2,width,height},size,r.composition.angle,{x:0,y:0})};
}
export function flipRecipe(r:EditRecipe,axis:'x'|'y'):EditRecipe{
  const patch=axis==='x'?{flipX:!r.flipX}:{flipY:!r.flipY};
  return r.version===1?{...r,...patch}:{...r,...patch,crop:flipCrop(r.crop,axis),composition:{...r.composition,angle:-r.composition.angle}};
}
// The crop workspace shows the turned/flipped, color-adjusted source under
// the frame. Committing still renders the actual recipe through the same kernel.
export function compositionBase(r:EditRecipe):EditRecipeV1|EditRecipeV5{
  if(r.version===5){const {aspect:_,...composition}=r.composition;return {...r,layer_stack:{version:1,layers:[]},composition:{...composition,angle:0},crop:{x:0,y:0,width:1,height:1}};}
  const base=r.version===4?(({layer_stack:_,...rest})=>rest)(r):r.version===3?(({text_layers:_,...rest})=>rest)(r):r;
  const parameters=base.version!==1?(({composition:_,...rest})=>rest)(base):base;
  return {...parameters,version:1,crop:{x:0,y:0,width:1,height:1}};
}
