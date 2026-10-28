import {test} from 'node:test';
import assert from 'node:assert/strict';
import {neutralRecipe} from '../src/core/editing.ts';
import {newSticker,newOverlay,validateLayerStack,reorderLayers,duplicateLayer,layerAssetHashes} from '../src/core/layer-stack.ts';
import {upgradeLayerDocument,layerRenderView,outputToSource,transformPoint,LAYER_HANDLES} from '../src/core/layer-geometry.ts';
import {withLayerStack,recipeLayers} from '../src/core/layer-recipe.ts';
import {turnRecipe,flipRecipe} from '../src/core/composition-recipe.ts';
import {depthVisibility} from '../src/core/vision-assets.ts';
import {validateToolPreferences} from '../src/core/preferences.ts';
const id='sticker-00000000-0000-4000-8000-000000000001',asset={id:'a'.repeat(64),name:'Subject',width:800,height:600};
test('mixed sticker/overlay ordering, independent copy and scoped preferences survive serialization',()=>{
 const sticker=newSticker(id,asset),overlay=newOverlay('overlay-00000000-0000-4000-8000-000000000002');
 const doc=upgradeLayerDocument({version:1,layers:[sticker,overlay]},neutralRecipe(),{width:1000,height:800});validateLayerStack(doc);
 const clone=duplicateLayer(doc,id,'sticker-00000000-0000-4000-8000-000000000003');assert.equal(clone.layers.length,3);assert.equal(doc.layers.length,2);
 assert.deepEqual(layerAssetHashes(clone),[asset.id]);assert.equal(reorderLayers(doc,[overlay.id,sticker.id]).layers[0].kind,'overlay');
 validateLayerStack(JSON.parse(JSON.stringify(doc)));assert.throws(()=>validateLayerStack({version:1,layers:[sticker]}));
 validateToolPreferences('layers',{snap:false,modelsOpen:true});validateToolPreferences('aiStudio',{mode:'annotation',tagCount:12,ocr:true});
 assert.throws(()=>validateToolPreferences('aiStudio',{apiKey:'secret'}));assert.throws(()=>validateToolPreferences('layers',{snap:'true'}));
});
test('frozen layer coordinates remain at the same original-image point after crop, turn and flip',()=>{
 const source={width:1000,height:800},sticker=newSticker(id,asset),original=neutralRecipe(),doc=upgradeLayerDocument({version:1,layers:[sticker]},original,source);
 const r=withLayerStack(original,source,doc),cropped={...r,crop:{x:.1,y:.15,width:.7,height:.7}};
 for(const recipe of [r,cropped,turnRecipe(cropped),flipRecipe(cropped,'x')]){
  const view=layerRenderView(doc,r,recipe,source,{width:700,height:560}),out=transformPoint(view.transform,view.reference.width*.5,view.reference.height*.5),point=transformPoint(outputToSource(recipe,source,{width:700,height:560}),out.x,out.y);
  assert.ok(Math.abs(point.x-.5)<1e-9);assert.ok(Math.abs(point.y-.5)<1e-9);assert.deepEqual(recipeLayers(recipe),doc);
 }
 assert.deepEqual([...LAYER_HANDLES].sort(),['e','n','ne','nw','s','se','sw','w']);
});
test('depth feather is continuous, reversible, source-bound and cannot leak into old formats',()=>{
 const depth={asset_hash:'b'.repeat(64),source_hash:'c'.repeat(64),threshold:.5,feather:.1,invert:false};
 assert.equal(depthVisibility(0,depth),1);assert.equal(depthVisibility(1,depth),0);assert.equal(depthVisibility(.5,depth),.5);
 for(const value of [.1,.45,.5,.55,.9])assert.ok(Math.abs(depthVisibility(value,depth)+depthVisibility(value,{...depth,invert:true})-1)<1e-12);
 const sticker={...newSticker(id,asset),depth},doc=upgradeLayerDocument({version:1,layers:[]},neutralRecipe(),{width:1000,height:800});validateLayerStack({...doc,layers:[sticker]});
 assert.throws(()=>validateLayerStack({...doc,layers:[{...sticker,depth:{...depth,feather:NaN}}]}));
 assert.deepEqual(layerAssetHashes({...doc,layers:[sticker]}).sort(),[asset.id,depth.asset_hash].sort());
});
