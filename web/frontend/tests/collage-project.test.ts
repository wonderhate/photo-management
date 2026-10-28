import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollage} from '../src/core/collage.ts';
import {validateCollageProject,validateCollageSave,collageAssetPath,collageDocumentSources} from '../src/core/collage-project.ts';
import type {StoredCollageProject} from '../src/core/collage-project.ts';
const uuid='a1234567-1234-4123-8123-123456789abc',source={id:'source',name:'Photo.png',sha256:'a'.repeat(64),width:400,height:300,bits:8 as const,profile:{version:2 as const,extra_orientation:1 as const}},document={kind:'single' as const,value:createCollage([source])};
test('stored collage contracts bind source assets, revisions and historical photo links without requiring live photos',()=>{
 const record:StoredCollageProject={version:1,id:uuid,name:'工程',revision:1,request_id:uuid,created_at:'2026-10-26T01:00:00Z',updated_at:'2026-10-26T01:00:00Z',origin_library_id:'library',document,photo_links:[{source_id:'source',photo_id:'removed-photo'}],assets:[{sha256:source.sha256,storage_id:uuid}]};validateCollageProject(record,true);assert.deepEqual(collageDocumentSources(document),[source]);assert.equal(collageAssetPath(record.assets[0]),`drafts/collages/${uuid}/${source.sha256}.bin`);
 for(const patch of [{revision:0},{assets:[]},{assets:[{sha256:'b'.repeat(64),storage_id:uuid}]},{photo_links:[{source_id:'missing',photo_id:'photo'}]},{document:{...document,secret:1}},{updated_at:'invalid'},{version:2}])assert.throws(()=>validateCollageProject({...record,...patch},true));
 assert.throws(()=>collageAssetPath({storage_id:'../source',sha256:source.sha256}));assert.throws(()=>collageAssetPath({storage_id:uuid,sha256:'../../original'}));
});
test('project save requests forbid paths, missing identities and malformed mutable fields',()=>{
 const value={id:uuid,request_id:uuid,expected_revision:0,name:'Project',document};validateCollageSave(value);for(const patch of [{path:'secret'},{name:' '},{name:'x\n'},{expected_revision:-1},{expected_revision:1.5},{id:'photo'},{request_id:'invalid'}])assert.throws(()=>validateCollageSave({...value,...patch}));
});

import {collageProjectQuery,collageSearchText,collageCompareText} from '../src/core/collage-project.ts';
import {validateToolPreferences} from '../src/core/preferences.ts';
import {collageDefaults,collageBatchDefaults} from '../src/core/collage-preferences.ts';
test('collage preferences isolate canvas and output defaults from document contents',()=>{
 assert.deepEqual(validateToolPreferences('collage',collageDefaults),collageDefaults);assert.deepEqual(validateToolPreferences('collageBatch',collageBatchDefaults),collageBatchDefaults);
 for(const patch of [{canvas:{...collageDefaults.canvas,width:12000,height:12000}},{canvas:{...collageDefaults.canvas,version:2}},{canvas:{...collageDefaults.canvas,background:'url(secret)'}},{canvas:{...collageDefaults.canvas,edge_blend:Infinity}},{sources:[]},{quality:0},{showGuides:1},{format:'exe'}])assert.throws(()=>validateToolPreferences('collage',patch));
 for(const patch of [{size:5},{size:'4'},{order:'random'},{remainder:'delete'},{canvas:collageDefaults.canvas}])assert.throws(()=>validateToolPreferences('collageBatch',patch));
});
test('collage search is literal with stable Unicode ordering and bounded query fields',()=>{
 assert.deepEqual(collageProjectQuery(),{search:'',sort:'updated',direction:'desc'});assert.equal(collageSearchText('AbC_%中文'),'abc_%中文');assert.ok(collageCompareText('中','😀')<0);assert.ok(collageCompareText('same','same')===0);
 for(const q of [{sort:'private'},{direction:'up'},{search:'x'.repeat(121)},{path:'private'}])assert.throws(()=>collageProjectQuery(q as never));
});
