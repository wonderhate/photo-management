import {test} from 'node:test';
import assert from 'node:assert/strict';
import {albumList,albumListDefaults,moveAlbum,validateAlbumListPreferences} from '../src/core/album-list.ts';

const albums=[{id:'a',name:'Trip 10',count:2,created_at:'2026-01-01T00:00:00Z'},{id:'b',name:'trip 2',count:0,created_at:'2026-01-02T00:00:00Z'},{id:'c',name:'旅途',count:2},{id:'d',name:'Trip 2',count:2,created_at:'2026-01-02T00:00:00Z'}];
test('album sorts keep natural names, known counts, missing dates last and stable ties',()=>{
  const list=(sort:typeof albumListDefaults.sort,direction:'asc'|'desc'='asc')=>albumList(albums,{...albumListDefaults,sort,direction},'','en-US').map(a=>a.id);
  assert.deepEqual(list('name'),['b','d','a','c']);assert.deepEqual(list('count'),['b','a','c','d']);assert.deepEqual(list('count','desc'),['a','c','d','b']);
  assert.deepEqual(list('created_at','desc'),['b','d','a','c']);assert.deepEqual(list('created_at'),['a','b','d','c']);
  assert.deepEqual(albumList(albums,{...albumListDefaults,sort:'name'},' TRIP 2 ','en-US').map(a=>a.id),['b','d']);assert.equal(albums[0].id,'a');
});
test('custom album order keeps hidden entries and puts unlisted new albums first',()=>{
  const values={...albumListDefaults,order:['d','a','b','c']};assert.deepEqual(albumList(albums,values).map(a=>a.id),values.order);
  const added=[...albums,{id:'new',name:'New',count:0,created_at:'2026-02-01T00:00:00Z'}];assert.deepEqual(albumList(added,values).map(a=>a.id),['new',...values.order]);
  const order=moveAlbum(values.order,'b','d');assert.deepEqual(order,['b','d','a','c']);assert.deepEqual(moveAlbum(order,'b','a',true),['d','a','b','c']);assert.deepEqual(moveAlbum(order,'unknown','a'),order);assert.deepEqual(values.order,['d','a','b','c']);
  const legacy=albums.map(({created_at,...a})=>a);assert.deepEqual(albumList(legacy,albumListDefaults).map(a=>a.id),['a','b','c','d']);
});
test('album presentation settings reject paths, duplicate IDs, nulls and oversized lists',()=>{
  const good={sort:'count',direction:'desc',order:['a','b']};const copy=validateAlbumListPreferences(good);assert.deepEqual(copy,good);(copy.order as string[]).push('c');assert.deepEqual(good.order,['a','b']);
  for(const value of [null,[],{sort:'rating'},{sort:null},{direction:true},{direction:'descending'},{order:['a','a']},{order:['../private']},{order:[1]},{order:Array.from({length:10001},(_,i)=>'id-'+i)},{api_key:'private'},{order:null}])assert.throws(()=>validateAlbumListPreferences(value));
});
