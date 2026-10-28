import {test} from 'node:test';
import assert from 'node:assert/strict';
import {neutralRecipe,renderPixels,analyzePixels,colorStats,validateRecipe} from '../src/browser/editing.ts';
import type {Pixels} from '../src/browser/editing.ts';

test('identity, exposure and 16-bit linear development preserve source pixels',()=>{
  const p:Pixels={width:3,height:1,channels:4,data:new Uint8ClampedArray([0,0,0,255,64,100,160,255,255,255,255,255])},before=p.data.slice();
  assert.deepEqual(renderPixels(p,neutralRecipe()).data,p.data);
  const bright=renderPixels(p,{...neutralRecipe(),exposure:1});assert.ok(bright.data[4]>p.data[4]);assert.deepEqual(p.data,before);
  const raw:Pixels={width:2,height:1,channels:3,data:new Uint16Array([100,100,100,200,200,200]),linear:true};
  const out=renderPixels(raw,{...neutralRecipe(),exposure:4});assert.ok(out.data[4]>out.data[0]);assert.equal(out.data[3],255);
});
test('rotation, flip and normalized crop select the expected source pixels',()=>{
  const p:Pixels={width:2,height:2,channels:4,data:new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])};
  const r=renderPixels(p,{...neutralRecipe(),rotation:90});assert.deepEqual([...r.data.slice(0,4)],[0,0,255,255]);
  const flipped=renderPixels(p,{...neutralRecipe(),flipX:true});assert.deepEqual([...flipped.data.slice(0,4)],[0,255,0,255]);
  const crop=renderPixels(p,{...neutralRecipe(),crop:{x:.5,y:0,width:.5,height:1}});assert.equal(crop.width,1);assert.equal(crop.height,2);assert.deepEqual([...crop.data.slice(0,4)],[0,255,0,255]);
});
test('flat grayscale references, clipping and invalid recipes stay deterministic',()=>{
  const p:Pixels={width:2,height:1,channels:4,data:new Uint8ClampedArray([0,0,0,255,255,255,255,255])};const stats=colorStats({width:1,height:1,channels:3,data:new Uint8Array([100,100,100])});
  const r={...neutralRecipe(),reference:stats,match:100,preserveLuminance:false};assert.deepEqual(renderPixels(p,r).data,renderPixels(p,r).data);
  const analysis=analyzePixels(p);assert.equal(analysis.shadows,.5);assert.equal(analysis.highlights,.5);assert.equal(analysis.histogram[3].reduce((a,b)=>a+b,0),2);
  assert.throws(()=>validateRecipe({...r,exposure:NaN}));assert.throws(()=>validateRecipe({...r,crop:{x:.8,y:0,width:.5,height:1}}));assert.throws(()=>validateRecipe({...r,reference:{mean:[NaN,0,0],std:[1,1,1]}}));
});
