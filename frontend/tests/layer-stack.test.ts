import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateLayerStack,duplicateLayer,reorderLayers,overlayRect} from '../src/core/layer-stack.ts';
import type {LayerDocument,OverlayLayer} from '../src/core/layer-stack.ts';
import {withLayerStack,recipeLayers,keepLayerFormat} from '../src/core/layer-recipe.ts';
import {withTextLayers} from '../src/core/text-recipe.ts';
import {neutralRecipe,validateRecipe} from '../src/browser/editing.ts';
import {turnRecipe,flipRecipe,compositionBase} from '../src/core/composition-recipe.ts';
import {splitRecipe} from '../src/core/split-render.ts';
import {createSplit} from '../src/core/seamless-split.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/layer-stack-contract.json',import.meta.url),'utf8')) as LayerDocument;
test('mixed stack rejects future and malformed layers, excessive gradients and duplicate IDs',()=>{
  validateLayerStack(fixture);const overlay=fixture.layers[0] as OverlayLayer;
  for(const patch of [{kind:'future'},{visible:1},{opacity:NaN},{coverage:0},{edge:'center'},{id:'overlay-x'},{paint:{kind:'linear',angle:0,stops:[]}},{paint:{kind:'linear',angle:0,stops:[{offset:1,color:'#000000',opacity:1},{offset:0,color:'#ffffff',opacity:1}]}},{paint:{kind:'solid',color:'url(remote)',opacity:1}},{future:true}])assert.throws(()=>validateLayerStack({version:1,layers:[{...overlay,...patch}]}));
  assert.throws(()=>validateLayerStack({...fixture,version:2}));assert.throws(()=>validateLayerStack({version:1,layers:[overlay,overlay]}));assert.throws(()=>validateLayerStack({version:1,layers:Array.from({length:33},(_,i)=>({...overlay,id:`overlay-00000000-0000-4000-8000-${String(i).padStart(12,'0')}`}))}));
});
test('mixed layer ordering is immutable and duplicate text/overlay retains its own geometry',()=>{
  const before=structuredClone(fixture),copy=duplicateLayer(fixture,fixture.layers[0].id,'overlay-00000000-0000-4000-8000-000000000099');assert.equal(copy.layers.length,3);assert.deepEqual(fixture,before);assert.equal((copy.layers[1] as OverlayLayer).coverage,.6);
  const reverse=reorderLayers(copy,copy.layers.map(l=>l.id).reverse());assert.equal(reverse.layers[0].kind,'text');assert.equal(copy.layers[0].kind,'overlay');assert.throws(()=>reorderLayers(copy,[copy.layers[0].id]));
  for(const [edge,rect] of [['top',{x:0,y:0,width:1000,height:200}],['bottom',{x:0,y:600,width:1000,height:200}],['left',{x:0,y:0,width:250,height:800}],['right',{x:750,y:0,width:250,height:800}]] as const)assert.deepEqual(overlayRect({...fixture.layers[0],edge,coverage:.25} as OverlayLayer,1000,800),rect);
});
test('recipe4 preserves mixed stack through photo geometry, text gestures and legacy promotion',()=>{
  const source={width:1000,height:800},r=withLayerStack(neutralRecipe(),source,fixture);validateRecipe(r);assert.throws(()=>validateRecipe({...r,version:3}));assert.throws(()=>validateRecipe({...r,version:6}));
  for(const modified of [turnRecipe(r),flipRecipe(r,'x')])assert.deepEqual(recipeLayers(modified),fixture);
  const edited=withTextLayers(r,source,{version:1,layers:fixture.layers.filter(l=>l.kind==='text').map(l=>({...l,text:'Changed'}))});assert.equal(edited.version,4);assert.equal(recipeLayers(edited).layers[0].kind,'overlay');assert.equal(recipeLayers(edited).layers.length,2);
  const stripped=compositionBase(r);assert.equal(stripped.version,1);assert.equal('layer_stack' in stripped,false);const split=splitRecipe(r,source,createSplit(source));validateRecipe(split);assert.equal('layer_stack' in split,false);
});
test('saved layer versions survive undo across their introduction without borrowing future layers',()=>{
  const source={width:640,height:480},original=neutralRecipe(),text=withTextLayers(original,source,{version:1,layers:fixture.layers.filter(l=>l.kind==='text')});
  const empty4=keepLayerFormat(original,source,4),text4=keepLayerFormat(text,source,4),empty3=keepLayerFormat(original,source,3);
  for(const r of [empty4,text4,empty3])validateRecipe(r);assert.equal(empty4.version,4);assert.deepEqual(recipeLayers(empty4).layers,[]);assert.deepEqual(recipeLayers(text4),recipeLayers(text));assert.equal(empty3.version,3);assert.deepEqual(recipeLayers(empty3).layers,[]);assert.equal(original.version,1);
});
