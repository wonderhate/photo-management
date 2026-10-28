import type {Layer} from './layer-stack.ts';
import {recipeLayers,withLayerStack} from './layer-recipe.ts';
import type {EditRecipeV4,EditRecipeV5} from './editing.ts';
import {dimensions,validateRecipeSource} from './editing.ts';
import type {EditRecipe,EditRecipeV3} from './editing.ts';
import {composeRecipe} from './composition-recipe.ts';
import {compositionBasis,inverseComposition} from './composition-geometry.ts';
import type {Size} from './composition-geometry.ts';
import type {TextTransform} from './text-layout.ts';
import type {TextLayerDocument} from './text-layers.ts';
export function withTextLayers(recipe:EditRecipe,source:Size,text_layers:TextLayerDocument):EditRecipeV3|EditRecipeV4|EditRecipeV5{if(recipe.version===4||recipe.version===5){const next=new Map(text_layers.layers.map(l=>[l.id,l])),existing=new Set(recipe.layer_stack.layers.map(l=>l.id));return withLayerStack(recipe,source,{...recipe.layer_stack,layers:[...recipeLayers(recipe).layers.flatMap<Layer>(l=>l.kind==='text'?(next.has(l.id)?[next.get(l.id)!]:[]):[l]),...text_layers.layers.filter(l=>!existing.has(l.id))]});}return {...composeRecipe(recipe,source),version:3,text_layers};}
export function multiplyTextTransforms(a:TextTransform,b:TextTransform):TextTransform{return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
function inverse(m:TextTransform):TextTransform{const d=m[0]*m[3]-m[1]*m[2];if(!Number.isFinite(d)||Math.abs(d)<1e-20)throw new Error('Invalid text transform.');return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
function plane(recipe:EditRecipe,source:Size,output:Size):TextTransform{
  const c=recipe.crop,angle=recipe.version===1?0:recipe.composition.angle;
  return multiplyTextTransforms(inverseComposition(c,compositionBasis(source,recipe.rotation),angle),[c.width/output.width,0,0,c.height/output.height,c.x,c.y]);
}
// Text is laid out in the parent's complete edited canvas. A split may show a
// different crop/center; map through their common source plane, not new percent
// coordinates per panel. The full mother is composed once before cutting.
export function textRenderView(parent:EditRecipe,target:EditRecipe,source:Size,output:Size){
  validateRecipeSource(parent,source);validateRecipeSource(target,source);
  if(parent.rotation!==target.rotation||parent.flipX!==target.flipX||parent.flipY!==target.flipY)throw new Error('Text render geometry changed.');
  const reference=dimensions({...source,channels:4,data:new Uint8Array(0)},parent);
  return {reference,transform:multiplyTextTransforms(inverse(plane(target,source,output)),plane(parent,source,reference))};
}
