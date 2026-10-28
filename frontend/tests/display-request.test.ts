import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayRequest,displayKey,parseDisplayKey} from '../src/core/display-request.ts';
import {localPhotoSource} from '../src/core/media-source.ts';
import type {Photo} from '../src/types.ts';
const jpeg='a'.repeat(64),raw='b'.repeat(64);
const photo={id:'jpeg-id',file_hash:jpeg,preview_url:'/api/photos/jpeg-id/preview',files:[
  {id:'jpeg-id',is_raw:false,preview_available:true,file_hash:jpeg},
  {id:'raw-id',is_raw:true,preview_available:true,file_hash:raw}
]} as Photo;
test('display identity follows verified source and the existing RAW preview preference',()=>{
  assert.deepEqual(displayRequest(photo,4096),{scope:'native',id:'jpeg-id',hash:jpeg,edge:4096});
  assert.deepEqual(displayRequest(photo,6144,true),{scope:'native',id:'raw-id',hash:raw,edge:6144});
  const pending={...photo,files:photo.files.map(f=>({...f,preview_available:false}))};
  assert.equal(displayRequest(pending,4096,true)?.id,'jpeg-id');
  const request=displayRequest(photo,6144,true)!;assert.deepEqual(parseDisplayKey(displayKey(request)),request);
});
test('display cache identity isolates library, input hash and output tier',()=>{
  const local={...photo,preview_url:localPhotoSource('library-a','photos/jpeg-id-preview.jpg')};
  const a=displayKey(displayRequest(local,4096)!),b=displayKey(displayRequest({...local,preview_url:localPhotoSource('library-b','photos/jpeg-id-preview.jpg')},4096)!);
  assert.notEqual(a,b);assert.notEqual(a,displayKey(displayRequest(local,6144)!));
  assert.notEqual(a,displayKey(displayRequest({...local,file_hash:raw},4096)!));
  assert.equal(displayRequest({...photo,file_hash:undefined},4096),null);
  assert.equal(displayRequest({...photo,id:'../../source'},4096),null);
});
test('display request parser accepts no arbitrary path, object, hash or unbounded resolution',()=>{
  for(const value of [null,{},[1,'native','id',jpeg,4096,'extra'],[1,123,'id',jpeg,4096],
    [1,'native','C:/private.jpg',jpeg,4096],[1,'native','id','short',4096],[1,'native','id',jpeg,16000]])
    assert.throws(()=>parseDisplayKey(JSON.stringify(value)),/Invalid display request/);
  assert.throws(()=>parseDisplayKey('not json'),/Invalid display request/);
});
test('display requests bind stored source profiles and keep legacy keys readable',()=>{
  const old=displayRequest(photo,4096)!,p={version:2 as const,extra_orientation:6};const fresh=displayRequest({...photo,decode_profile:p},4096)!;
  assert.notEqual(displayKey(old),displayKey(fresh));assert.deepEqual(parseDisplayKey(displayKey(fresh)),fresh);assert.deepEqual(parseDisplayKey(displayKey(old)),old);
  assert.throws(()=>parseDisplayKey(JSON.stringify([2,'native','id',jpeg,4096,{version:3,extra_orientation:1}])));
});
