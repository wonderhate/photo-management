import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSplit,splitPlan} from '../src/core/seamless-split.ts';
import {splitRecipe} from '../src/core/split-render.ts';
import type {StoredSplit} from '../src/core/split-record.ts';
import {splitEditDefaults} from '../src/core/edit-lineage.ts';
import {panelEditSource,validateEditLineageGraph,validateSplitEditOutput} from '../src/core/edit-lineage-graph.ts';

const hash='a'.repeat(64);
function group(document_id:string):StoredSplit{
  const id=crypto.randomUUID(),spec=createSplit({width:1001,height:137}),plan=splitPlan(spec),parent=splitEditDefaults().recipe;
  return {version:1,id,document_id,document_revision:1,source_hash:hash,name:'parent.png',spec,plan,parent_recipe:parent,recipe:splitRecipe(parent,spec.basis,spec),decode_profile:{version:2,extra_orientation:1},format:'png',quality:95,
    master:{id,name:'master.png',path:`drafts/splits/${id}/master.png`,sha256:hash,width:plan.width,height:plan.height},panels:plan.panels.map((p,i)=>({id:crypto.randomUUID(),name:`panel-${i}.png`,path:`drafts/splits/${id}/panel-${String(i+1).padStart(2,'0')}.png`,sha256:hash,width:p.width,height:p.height}))};
}
function fixture(){
  const g=group('parent'),id=crypto.randomUUID(),root={id:'parent',photo_id:null,source_hash:hash,revision:3},child={id,photo_id:null,source_hash:hash,revision:1,source_path:`drafts/edits/${id}/source.png`,...splitEditDefaults(),derived_from:panelEditSource(g,g.panels[0].id)};
  return {g,root,child};
}
test('browser source graph allows later parent revisions and requires independent snapshots and intact references',()=>{
  const f=fixture();assert.doesNotThrow(()=>validateEditLineageGraph([f.root,f.child],[f.g]));
  for(const patch of [{source_path:f.g.panels[0].path},{source_hash:'b'.repeat(64)},{photo_id:'original'},{decode_profile:{version:2,extra_orientation:8}}])assert.throws(()=>validateEditLineageGraph([f.root,{...f.child,...patch} as typeof f.child],[f.g]));
  assert.throws(()=>validateEditLineageGraph([f.child],[f.g]));assert.throws(()=>validateEditLineageGraph([f.root,f.child],[]));assert.throws(()=>validateEditLineageGraph([{...f.root,revision:0},f.child],[f.g]));
});
test('cyclic source references fail without recursive traversal',()=>{
  const a=crypto.randomUUID(),b=crypto.randomUUID(),ga=group(a),gb=group(b),row=(id:string,g:StoredSplit)=>({id,photo_id:null,source_hash:hash,revision:1,source_path:`drafts/edits/${id}/source.png`,...splitEditDefaults(),derived_from:panelEditSource(g,g.panels[0].id)});
  assert.throws(()=>validateEditLineageGraph([row(a,gb),row(b,ga)],[ga,gb]),/lineage/);
});
test('saved output freezes the child revision and recipe while retaining the immutable lineage',()=>{
  const {root,child}=fixture(),output={version:1,document_id:child.id,document_revision:1,source_hash:child.source_hash,recipe:child.recipe,derived_from:child.derived_from};
  assert.doesNotThrow(()=>validateSplitEditOutput(output,[root,{...child,revision:2}]));
  for(const patch of [{version:2},{document_revision:3},{source_hash:'b'.repeat(64)},{derived_from:{...child.derived_from,panel_index:9}},{unknown:true}])assert.throws(()=>validateSplitEditOutput({...output,...patch},[root,child]));
  assert.throws(()=>validateSplitEditOutput(output,[root]));
});
