import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {neutralRecipe,validateRecipe,renderPixels} from '../src/browser/editing.ts';
import {withTextLayers,textRenderView,multiplyTextTransforms} from '../src/core/text-recipe.ts';
import {turnRecipe,flipRecipe,straightenRecipe,compositionBase} from '../src/core/composition-recipe.ts';
import {createSplit} from '../src/core/seamless-split.ts';
import {splitRecipe} from '../src/core/split-render.ts';
const layers=JSON.parse(readFileSync(new URL('./fixtures/text-layer-contract.json',import.meta.url),'utf8'));
test('text recipe V3 preserves old geometry and rejects future layer formats instead of dropping them',()=>{
  const r=withTextLayers(neutralRecipe(),{width:640,height:480},layers);validateRecipe(r);
  for(const version of [1,2,4])assert.throws(()=>validateRecipe({...r,version}));assert.throws(()=>validateRecipe({...r,text_layers:{version:99,layers:[]}}));
  assert.deepEqual(turnRecipe(r).version,3);assert.deepEqual(flipRecipe(r,'x').version,3);assert.deepEqual(straightenRecipe(r,{width:640,height:480},10).text_layers,layers);
  const base=compositionBase(r);validateRecipe(base);assert.equal(base.version,1);assert.equal('text_layers' in base,false);
  const pixels={width:640,height:480,channels:4 as const,data:new Uint8ClampedArray(640*480*4)};assert.deepEqual(renderPixels(pixels,r).data,renderPixels(pixels,neutralRecipe()).data);
});
test('text split views retain parent positions instead of centering each panel',()=>{
  const source={width:1000,height:800},r=withTextLayers({...neutralRecipe(),crop:{x:.2,y:.25,width:.6,height:.5}},source,layers),spec=createSplit(source,0,{width:5,height:8});
  const split=splitRecipe(r,source,spec);assert.equal(split.version,2);assert.equal('text_layers' in split,false);assert.equal(r.version,3);
  const full=textRenderView(r,{...split,crop:{x:0,y:0,width:1,height:1},composition:{...split.composition,aspect:undefined}},source,source);
  assert.deepEqual(full.reference,{width:600,height:400});full.transform.forEach((v,i)=>assert.ok(Math.abs(v-[1,0,0,1,200,200][i])<1e-10));
  const scaled=textRenderView(r,r,source,{width:300,height:200});scaled.transform.forEach((v,i)=>assert.ok(Math.abs(v-[.5,0,0,.5,0,0][i])<1e-10));
});
test('text split mapping composes consistent source planes after rotated crops',()=>{
  const source={width:1000,height:800},parent=withTextLayers(neutralRecipe(),source,layers);parent.crop={x:.2,y:.25,width:.4,height:.4};parent.composition.angle=20;
  const target={...parent,crop:{x:.35,y:.3,width:.4,height:.4}},back=textRenderView(target,parent,source,{width:400,height:320}).transform,forward=textRenderView(parent,target,source,{width:400,height:320}).transform;
  const identity=multiplyTextTransforms(back,forward);identity.forEach((v,i)=>assert.ok(Math.abs(v-[1,0,0,1,0,0][i])<1e-8));
  assert.throws(()=>textRenderView(parent,{...target,flipX:true},source,{width:400,height:320}));
});
