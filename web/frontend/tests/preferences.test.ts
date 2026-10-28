import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legacyGallery,validateGalleryPreferences,validateDocumentPreferences,validateToolPreferences,validateToolPreferenceValues} from '../src/core/preferences.ts';
test('legacy gallery migration retains valid presentation fields and rejects unrelated data',()=>{
  const data=new Map([['gallery-layout','waterfall'],['grid-size','310'],['grid-prefs',JSON.stringify({gap:8,radius:0,dense:true,api_key:'private',recipe:{}})]]);
  assert.deepEqual(legacyGallery({getItem:k=>data.get(k)??null}),{layout:'waterfall',grid:310,gap:8,radius:0,dense:true});
  data.set('grid-size','999999');assert.equal(legacyGallery({getItem:k=>data.get(k)??null}).grid,undefined);
  data.set('grid-prefs','malformed');assert.deepEqual(legacyGallery({getItem:k=>data.get(k)??null}),{layout:'waterfall'});
  assert.deepEqual(legacyGallery({getItem:()=>{throw new Error('Blocked');}}),{});
});

test('tool preferences accept only bounded presentation state in the matching tool',()=>{
  assert.deepEqual(validateToolPreferenceValues({viewer:{quality:6144,pinned:true},compare:{linked:false},darkroom:{format:'png',edge:0,quality:100}}),{viewer:{quality:6144,pinned:true},compare:{linked:false},darkroom:{format:'png',edge:0,quality:100}});
  for(const [kind,value] of [['viewer',{quality:true}],['viewer',{quality:2048}],['viewer',{pinned:1}],['viewer',{playing:true}],['viewer',{path:'private'}],['viewer',{quality:null}],['compare',{linked:'false'}],['compare',{zoom:2}],['darkroom',{format:'avif'}],['darkroom',{edge:-1}],['darkroom',{edge:16001}],['darkroom',{edge:1.5}],['darkroom',{quality:NaN}],['darkroom',{quality:0}],['darkroom',{quality:101}],['darkroom',{recipe:{}}],['darkroom',[]],['unknown',{}]])assert.throws(()=>validateToolPreferences(kind as never,value));
  assert.deepEqual(validateToolPreferences('darkroom',{format:'webp'}),{format:'webp'});
  assert.throws(()=>validateToolPreferenceValues({watercolor:{key:'private'}}));
  assert.throws(()=>validateToolPreferenceValues(null));
});
test('preference schemas reject cross-scope values and malformed or unbounded state',()=>{
  assert.deepEqual(validateGalleryPreferences({sort:'rating',direction:'asc'}),{sort:'rating',direction:'asc'});
  for(const value of [null,[],{layout:'torch'},{sort:'manual'},{grid:true},{gap:7},{radius:19},{dense:1},{theme:'dark'},{recipe:{}},{grid:NaN}])assert.throws(()=>validateGalleryPreferences(value));
  for(const value of [null,[],{zoom:true},{zoom:NaN},{zoom:4},{zoom:1,recipe:{}}])assert.throws(()=>validateDocumentPreferences(value));
  assert.deepEqual(validateDocumentPreferences({zoom:1.5}),{zoom:1.5});
});
test('split preferences retain fractional aspect sides but reject pixel recipes and invalid ranges',()=>{
  assert.deepEqual(validateToolPreferences('split',{width:2.35,height:1}),{width:2.35,height:1});
  for(const value of [{width:0},{height:101},{width:NaN},{width:Infinity},{width:true},{height:'4'},{count:3},{region:{}},{width:null}])assert.throws(()=>validateToolPreferences('split',value));
});
