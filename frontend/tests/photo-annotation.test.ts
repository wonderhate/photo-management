import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {annotationView,editPhotoTags,applyAnnotation,annotationInput,userDescription,validateAnnotationFields} from '../src/core/photo-annotation.ts';
import type {AnnotationFields} from '../src/core/photo-annotation.ts';
const contract=JSON.parse(readFileSync(new URL('./fixtures/annotation-contract.json',import.meta.url),'utf8'));
test('manual descriptions, AI ownership and rejections follow the same persisted contract as SQL',()=>{
  let p:AnnotationFields=structuredClone(contract.initial),revision=0;
  for(const step of contract.steps){
    if(step.ai){const {annotation}=annotationInput({version:1,source_hash:'a'.repeat(64),expected_revision:revision++,provider:'synthetic-local',model:'fixture-v1',...step.ai});Object.assign(p,applyAnnotation(p,annotation));}
    else{if(Object.hasOwn(step.manual,'user_description'))p.user_description=userDescription(step.manual.user_description);Object.assign(p,editPhotoTags(p,step.manual));}
    const view=annotationView(p);assert.deepEqual(view.tag_origins,step.origins);assert.deepEqual(view.rejected_ai_tags,step.rejected);assert.equal(view.description,step.description);assert.equal(view.description_source,step.source);validateAnnotationFields(p);
  }
});
test('damaged or future annotations cannot become valid library state',()=>{
  const body={version:1,source_hash:'a'.repeat(64),expected_revision:0,caption:' test ',tags:[' tag ','tag'],provider:'fixture',model:'v1'};
  const a=annotationInput(body).annotation;assert.deepEqual(a.tags,['tag']);assert.equal(a.caption,'test');assert.equal(userDescription('  '),'');assert.equal(userDescription(null),null);
  for(const change of [{version:2},{version:true},{source_hash:'bad'},{expected_revision:true},{expected_revision:-1},{caption:'x'.repeat(4001)},{detected_text:[]},{tags:[1]},{provider:' '},{api_key:'never-persist'}])assert.throws(()=>annotationInput({...body,...change}));
  for(const p of [{tags:['tag'],tag_origins:{tag:'external'}},{tags:['tag'],rejected_ai_tags:['tag']},{tags:[],annotation:{...a,revision:0}},{tags:[],user_description:3}])assert.throws(()=>validateAnnotationFields(p as AnnotationFields));
});

test('manual editing preserves existing browser tags up to the previous 200-character limit',()=>{
  const name='旧'.repeat(150),p={tags:[name],tag_origins:{[name]:'user' as const}};
  assert.deepEqual(editPhotoTags(p,{tags:[name]}).tags,[name]);
  const removed={...p,...editPhotoTags(p,{remove_tags:[name]})};assert.deepEqual(removed.tags,[]);assert.deepEqual(removed.rejected_ai_tags,[name]);validateAnnotationFields(removed);
  assert.deepEqual(editPhotoTags(removed,{add_tags:[name]}).tags,[name]);
});
