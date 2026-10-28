import test from 'node:test';
import assert from 'node:assert/strict';
import {LutPreviewQueue} from '../src/core/lut-preview-queue.ts';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('LUT thumbnails cancel queued IO, share active reads, and discard unused results',async()=>{
 const reads:string[]=[],revoked:string[]=[];let finish!:(url:string)=>void;
 const queue=new LutPreviewQueue<{id:string}>(async a=>{reads.push(a.id);return new Promise(r=>{finish=r;});},u=>revoked.push(u));
 const a=queue.acquire({id:'a'}),shared=queue.acquire({id:'a'}),b=queue.acquire({id:'b'});const cancelled=assert.rejects(b.promise,{name:'AbortError'});await tick();b.release();a.release();finish('blob:a');assert.equal(await shared.promise,'blob:a');await cancelled;assert.deepEqual(reads,['a']);shared.release();
 const c=queue.acquire({id:'c'});const abandoned=assert.rejects(c.promise,{name:'AbortError'});await tick();c.release();finish('blob:c');await abandoned;assert.deepEqual(revoked,['blob:c']);queue.close();assert.deepEqual(revoked,['blob:c','blob:a']);
});
test('LUT thumbnail LRU evicts unreferenced results while protecting visible images',async()=>{
 const revoked:string[]=[];const queue=new LutPreviewQueue<{id:string}>(async a=>'blob:'+a.id,u=>revoked.push(u),2);
 const a=queue.acquire({id:'a'});await a.promise;
 const b=queue.acquire({id:'b'});await b.promise;b.release();
 const c=queue.acquire({id:'c'});await c.promise;c.release();assert.deepEqual(revoked,['blob:b']);
 const again=queue.acquire({id:'a'});assert.equal(await again.promise,'blob:a');again.release();a.release();queue.close();assert.equal(new Set(revoked).size,3);
});
test('LUT thumbnail failures permit explicit retry and closing rejects late completion',async()=>{
 let attempts=0,finish!:(url:string)=>void;const revoked:string[]=[];
 const queue=new LutPreviewQueue<{id:string}>(async()=>{if(++attempts===1)throw new Error('synthetic read failure');return new Promise(r=>{finish=r;});},u=>revoked.push(u));
 const first=queue.acquire({id:'a'});await assert.rejects(first.promise,/synthetic/);first.release();
 const retry=queue.acquire({id:'a'}),closed=assert.rejects(retry.promise,{name:'AbortError'});await tick();queue.close();await closed;finish('blob:late');await tick();assert.deepEqual(revoked,['blob:late']);
});
