import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {demoRecipe,demoFrame} from '../src/browser/demo-image.ts';
import {renderPixels} from '../src/core/editing.ts';
import {validateFrame,frameLayers} from '../src/core/frame-v2.ts';

test('demo adjustments use the shared engine without changing synthetic source pixels',()=>{
 const original={width:2,height:2,channels:4 as const,data:new Uint8Array([60,90,120,255,150,100,70,255,40,80,60,255,180,150,120,255])};
 const digest=()=>createHash('sha256').update(original.data).digest('hex'),before=digest();
 const plain=renderPixels(original,demoRecipe(0,0)),edited=renderPixels(original,demoRecipe(.5,25));
 assert.notDeepEqual(edited.data,plain.data);assert.equal(digest(),before);
 assert.deepEqual(renderPixels(original,demoRecipe(0,0)).data,plain.data);
});
test('both demo frames keep the whole illustration and explicitly label generated material',()=>{
 for(const style of ['paper','dark'] as const){const document=demoFrame(style);validateFrame(document);const plan=frameLayers(1200,800,document,0);
  assert.ok(plan.fullWidth>1200&&plan.fullHeight>800);assert.equal(document.logo,null);
  assert.ok(document.template.elements.some(element=>element.content?.includes('GENERATED DEMO')));
 }
});
