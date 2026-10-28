import {dimensions,neutralRecipe} from './editing.ts';
import type {EditRecipe} from './editing.ts';
import {inverseComposition,compositionBasis} from './composition-geometry.ts';
import type {Size} from './composition-geometry.ts';
import {multiplyTextTransforms} from './text-recipe.ts';
import type {TextTransform,TextRect} from './text-layout.ts';
import {TEXT_REFERENCE_EDGE} from './text-layers.ts';
import type {LayerDocument,LayerFrame,PositionedText,StickerLayer} from './layer-stack.ts';
export function inverseLayerTransform(m:TextTransform):TextTransform{const d=m[0]*m[3]-m[1]*m[2];if(!Number.isFinite(d)||Math.abs(d)<1e-20)throw new Error('Invalid layer transform.');return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
export const transformPoint=(m:TextTransform,x:number,y:number)=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
export function frameForRecipe(r:EditRecipe,source:Size):LayerFrame{return {source_width:source.width,source_height:source.height,crop:structuredClone(r.crop),rotation:r.rotation,angle:r.version===1?0:r.composition.angle,flipX:r.flipX,flipY:r.flipY};}
export function upgradeLayerDocument(doc:LayerDocument,recipe:EditRecipe,source:Size):LayerDocument{return doc.version===2?doc:{version:2,frame:frameForRecipe(recipe,source),layers:structuredClone(doc.layers)};}
function frameRecipe(f:LayerFrame):EditRecipe{return {...neutralRecipe(),version:2,crop:f.crop,rotation:f.rotation,flipX:f.flipX,flipY:f.flipY,composition:{source_width:f.source_width,source_height:f.source_height,angle:f.angle}};}
// Output pixels -> original, orientation-normalized image coordinates [0..1].
// Rotation/flips are explicit, so a later crop/rotation cannot move the layers.
export function outputToSource(r:EditRecipe,source:Size,output:Size):TextTransform{
  const c=r.crop,unrotate:TextTransform=r.rotation===90?[0,-1,1,0,0,1]:r.rotation===180?[-1,0,0,-1,1,1]:r.rotation===270?[0,1,-1,0,1,0]:[1,0,0,1,0,0];
  const flip:TextTransform=[r.flipX?-1:1,0,0,r.flipY?-1:1,r.flipX?1:0,r.flipY?1:0];
  return multiplyTextTransforms(unrotate,multiplyTextTransforms(flip,multiplyTextTransforms(inverseComposition(c,compositionBasis(source,r.rotation),r.version===1?0:r.composition.angle),[c.width/output.width,0,0,c.height/output.height,c.x,c.y])));
}
export function layerRenderView(doc:LayerDocument,parent:EditRecipe,target:EditRecipe,source:Size,output:Size){
  const r=doc.version===2?frameRecipe(doc.frame):parent;
  if(doc.version===2&&(doc.frame.source_width!==source.width||doc.frame.source_height!==source.height))throw new Error('Layer source dimensions changed. Reopen the photo.');
  const reference=dimensions({...source,channels:4,data:new Uint8Array(0)},r),toSource=outputToSource(target,source,output);
  return {reference,transform:multiplyTextTransforms(inverseLayerTransform(toSource),outputToSource(r,source,reference)),toSource};
}
export function positionedTransform(layer:PositionedText|StickerLayer,width:number,height:number):TextTransform{
  const scale=Math.max(width,height)/TEXT_REFERENCE_EDGE,angle=layer.rotation*Math.PI/180,c=Math.cos(angle)*scale,s=Math.sin(angle)*scale;
  const m:TextTransform=[c,s,-s,c,layer.x*width,layer.y*height];
  return multiplyTextTransforms(m,[layer.scaleX??1,0,0,layer.scaleY??1,0,0]);
}
export function stickerBounds(layer:StickerLayer):TextRect{return {x:-layer.width/2,y:-layer.height/2,width:layer.width,height:layer.height};}
export const LAYER_HANDLES=['nw','n','ne','e','se','s','sw','w'] as const;
export type LayerHandle=typeof LAYER_HANDLES[number];
export function handlePoint(box:TextRect,h:LayerHandle){return {x:box.x+box.width*(h.includes('w')?0:h.includes('e')?1:.5),y:box.y+box.height*(h.includes('n')?0:h.includes('s')?1:.5)};}
