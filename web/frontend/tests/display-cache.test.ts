import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayCacheKey,displayEvictions,readDisplayCache,writeDisplayCache,browserDisplayEngine,DISPLAY_WORKER_VERSION,DISPLAY_WORKER_NATIVE_VERSION,DISPLAY_NATIVE_VERSION,DISPLAY_DISK_BYTES} from '../src/core/display-cache.ts';
const request={scope:'library-a',id:'photo-1',hash:'a'.repeat(64),edge:4096 as const},spec={library:'library-a',request,engine:DISPLAY_WORKER_VERSION+'-white'};
test('display disk keys separate library, source, version, quality and rendering background',()=>{
  const base=displayCacheKey(spec);
  for(const other of [{...spec,library:'library-b'},{...spec,request:{...request,hash:'b'.repeat(64)}},{...spec,request:{...request,id:'photo-2'}},{...spec,request:{...request,edge:6144 as const}},{...spec,engine:DISPLAY_WORKER_VERSION+'-black'},{...spec,engine:DISPLAY_WORKER_NATIVE_VERSION},{...spec,engine:DISPLAY_NATIVE_VERSION+'-pillow-12.0-heif-1.0'}])assert.notEqual(displayCacheKey(other),base);
  assert.throws(()=>displayCacheKey({...spec,library:'../private'}));assert.throws(()=>displayCacheKey({...spec,engine:'unknown'}));assert.throws(()=>displayCacheKey({...spec,request:{...request,hash:'invalid'}}));
});
test('display persistence trims LRU by both counts and compressed bytes without mutating active memory leases',()=>{
  const rows=Array.from({length:70},(_,i)=>({key:'image-'+i,size:5*1024*1024,stamp:i}));const evicted=displayEvictions(rows);assert.equal(evicted.length,19);assert.equal(evicted[0],'image-0');assert.equal(evicted.at(-1),'image-18');assert.equal(rows.length,70);
  assert.deepEqual(displayEvictions([{key:'large',size:DISPLAY_DISK_BYTES+1,stamp:0}]),['large']);assert.deepEqual(displayEvictions(rows.map(r=>({...r,size:1}))),rows.slice(0,6).map(r=>r.key));
});
test('missing or denied persistent storage is a soft miss while cancellation remains observable',async()=>{
  assert.equal(await readDisplayCache(spec),null);await writeDisplayCache(spec,new Blob(['not JPEG']));const controller=new AbortController();controller.abort();await assert.rejects(readDisplayCache(spec,controller.signal),{name:'AbortError'});await assert.rejects(writeDisplayCache(spec,new Blob(['test']),controller.signal),{name:'AbortError'});
});
test('persistent browser keys separate all source orientations and legacy rendering',()=>{
  const keys=new Set([displayCacheKey({...spec,engine:browserDisplayEngine()})]);
  for(let n=1;n<=8;n++)keys.add(displayCacheKey({...spec,engine:browserDisplayEngine({version:2,extra_orientation:n})}));
  assert.equal(keys.size,9);
});
