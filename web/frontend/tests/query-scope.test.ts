import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enterScope,normalizeQueryScope,clearTemporary,promoteLegacyScope,scopeBase,temporaryFilters,galleryRoute,galleryFilters,periodEnd} from '../src/core/query-scope.ts';
test('a query scope keeps its base, library and count mode through clear and routes',()=>{
  const initial=enterScope('library-a',{album_id:'album-a',camera:'SONY',favorite:'1'},'file','collection');
  const next={...initial,text:'海岸 %_',camera_model:'Canon'};assert.deepEqual(clearTemporary(next),initial);assert.deepEqual(scopeBase(next),{album_id:'album-a',camera_model:'SONY',favorite:'true'});assert.deepEqual(temporaryFilters(next),{text:'海岸 %_',camera_model:'Canon'});
  assert.deepEqual(galleryFilters(galleryRoute(next).split('?')[1]),next);assert.equal(normalizeQueryScope(initial.scope).mode,'file');
  const promoted=promoteLegacyScope({album_id:'old-album',camera:'Canon',count_mode:'file'},'library-a');assert.deepEqual(scopeBase(promoted),{album_id:'old-album'});assert.deepEqual(temporaryFilters(promoted),{camera:'Canon'});
  assert.deepEqual(clearTemporary({scope:''}),{scope:''});assert.equal(galleryFilters(galleryRoute({scope:''}).split('?')[1]).scope,'');
});
test('scope validation refuses nested scopes, unknown fields, bad types and future versions',()=>{
  const valid={version:1,library_id:'library-a',mode:'capture',base:{}};
  for(const change of [{version:2},{library_id:'../private'},{mode:'other'},{origin:'unknown'},{base:{scope:'{}'}},{base:{file_path:'/private'}},{base:{rating:'6'}},{base:{rating:true}},{base:{iso:'Infinity'}},{base:{iso:'0x10'}},{base:{favorite:'perhaps'}},{base:{date_to:'2026-02-30'}},{base:{camera:'SONY',camera_model:'Canon'}},{base:{page:'2'}}])assert.throws(()=>normalizeQueryScope({...valid,...change}));
  assert.throws(()=>normalizeQueryScope(''));assert.throws(()=>normalizeQueryScope({...valid,extra:1}));assert.throws(()=>normalizeQueryScope({...valid,base:{filename:'x'.repeat(257)}}));
  assert.deepEqual(normalizeQueryScope({...valid,base:{rating:'00',favorite:'0',iso:' 1e3 '}}).base,{rating:'0',favorite:'false',iso:'1e3'});
  assert.equal(periodEnd('2026-02'),'2026-02-28');assert.equal(periodEnd('2024-02'),'2024-02-29');assert.equal(periodEnd('2026-12'),'2026-12-31');
});
