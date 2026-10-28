import {test} from 'node:test';
import assert from 'node:assert/strict';
import {neutralRecipe} from '../src/browser/editing.ts';
import {createSplit,splitPlan} from '../src/core/seamless-split.ts';
import {splitRecipe} from '../src/core/split-render.ts';
import {validateStoredSplit,sameSplitValue,splitSourceGroup} from '../src/core/split-record.ts';
import type {StoredSplit} from '../src/core/split-record.ts';

function fixture():StoredSplit{
  const spec=createSplit({width:1001,height:137}),plan=splitPlan(spec),parent=neutralRecipe(),id=crypto.randomUUID(),hash='a'.repeat(64);
  return {version:1,id,document_id:'edit-1',document_revision:0,source_hash:hash,name:'panorama.png',spec,plan,parent_recipe:parent,recipe:splitRecipe(parent,spec.basis,spec),format:'png',quality:95,decode_profile:{version:2,extra_orientation:1},
    master:{id,name:'master.png',path:`drafts/splits/${id}/master.png`,sha256:hash,width:plan.width,height:plan.height},
    panels:plan.panels.map((p,i)=>({id:crypto.randomUUID(),name:`panel-${i+1}.png`,path:`drafts/splits/${id}/panel-${String(i+1).padStart(2,'0')}.png`,sha256:hash,width:p.width,height:p.height}))};
}
test('split lineage validates auto count, exact edges, frozen parent and decoding profile',()=>{
  const g=fixture();assert.equal(g.spec.count,null);validateStoredSplit(g);assert.equal(g.parent_recipe.version,1);assert.equal(g.recipe.version,2);
  assert.ok(sameSplitValue({a:1,b:{a:2}}, {b:{a:2},a:1}));assert.ok(!sameSplitValue({a:1},{a:1,b:undefined}));
});
test('split lineage rejects unknown versions, altered geometry, wrong parent and arbitrary files',()=>{
  const mutations:Array<(g:any)=>void>=[g=>g.version=2,g=>g.unrecognized=true,g=>g.plan.edges[1]++,g=>g.panels.pop(),g=>g.panels[0].id=g.id,g=>g.panels[1].id=g.panels[0].id,g=>g.panels[0].width++,g=>g.panels[0].path='photos/original.png',g=>g.panels[0].sha256='x',g=>g.master.path=g.panels[0].path,g=>g.parent_recipe.exposure=1,g=>g.decode_profile.version=99,g=>g.quality=NaN,g=>g.document_revision=-1,g=>g.spec.count=undefined];
  for(const change of mutations){const g=fixture();change(g);assert.throws(()=>validateStoredSplit(g));}
});

test('private source snapshots identify exactly one owning group with no arbitrary path',()=>{
  const id=crypto.randomUUID();assert.equal(splitSourceGroup(`drafts/splits/${id}/source.bin`),id);
  for(const path of [`drafts/splits/${id}/panel-01.png`,`drafts/splits/${id}/../source.bin`,`drafts/splits/${id}/source.bin/other`,`drafts/splits/invalid/source.bin`,`photos/${id}/source.bin`])assert.equal(splitSourceGroup(path),null);
});
