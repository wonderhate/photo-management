import test from 'node:test';
import assert from 'node:assert/strict';
import {LutPreviewQueue} from '../src/core/lut-preview-queue.ts';
import {LutThumbnailPool,lutThumbnailConcurrency} from '../src/core/lut-thumbnail-pool.ts';
import type {ThumbnailWorker} from '../src/core/lut-thumbnail-pool.ts';
import {VerifiedLutCache} from '../src/core/lut-cache.ts';
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
test('thumbnail concurrency reserves CPU and scales down on low-memory or unknown devices',()=>{
 assert.equal(lutThumbnailConcurrency(24,32),4);assert.equal(lutThumbnailConcurrency(8,8),4);assert.equal(lutThumbnailConcurrency(8,4),2);assert.equal(lutThumbnailConcurrency(24),2);assert.equal(lutThumbnailConcurrency(2,8),1);assert.equal(lutThumbnailConcurrency(8,2),1);assert.equal(lutThumbnailConcurrency(NaN),1);
});
test('parallel thumbnail admission respects both slots and bytes and releases cancellation capacity',async()=>{
 const started:string[]=[],finish=new Map<string,(url:string)=>void>(),revoked:string[]=[];
 const queue=new LutPreviewQueue<{id:string;bytes:number}>(async a=>{started.push(a.id);return new Promise(r=>finish.set(a.id,r));},u=>revoked.push(u),64,{concurrency:4,maxWeight:10,weight:a=>a.bytes});
 const a=queue.acquire({id:'a',bytes:6}),b=queue.acquire({id:'b',bytes:4}),c=queue.acquire({id:'c',bytes:3}),d=queue.acquire({id:'d',bytes:2}),cancelled=assert.rejects(d.promise,{name:'AbortError'});await tick();assert.deepEqual(started,['a','b']);d.release();await cancelled;
 finish.get('b')!('b');await b.promise;await tick();assert.deepEqual(started,['a','b','c']);finish.get('a')!('a');finish.get('c')!('c');await Promise.all([a.promise,c.promise]);queue.close();assert.equal(new Set(revoked).size,3);
});
test('parallel thumbnail jobs share a lease, start at most four and close all late results',async()=>{
 const pending:((url:string)=>void)[]=[],revoked:string[]=[];
 const queue=new LutPreviewQueue<{id:string}>(()=>new Promise(r=>pending.push(r)),u=>revoked.push(u),64,{concurrency:9});
 const leases=Array.from({length:6},(_,i)=>queue.acquire({id:String(i)})),shared=queue.acquire({id:'0'}),checks=[...leases,shared].map(l=>assert.rejects(l.promise,{name:'AbortError'}));await tick();assert.equal(pending.length,4);queue.close();await Promise.all(checks);pending.forEach((done,i)=>done('late'+i));await tick();assert.equal(new Set(revoked).size,4);assert.equal(pending.length,4);
});
class FakeWorker implements ThumbnailWorker{
 onmessage:ThumbnailWorker['onmessage']=null;onmessageerror:ThumbnailWorker['onmessageerror']=null;onerror:ThumbnailWorker['onerror']=null;terminated=false;messages:{id:number;base?:Blob;hash?:string}[]=[];
 postMessage(data:object){const message=data as {id:number;base?:Blob;hash?:string};this.messages.push(message);if(message.base)queueMicrotask(()=>this.reply({id:message.id,ready:true}));}
 reply(data:object){this.onmessage?.call(this as unknown as Worker,new MessageEvent('message',{data}));}
 fail(){this.onerror?.call(this as unknown as Worker,{preventDefault(){}} as ErrorEvent);}
 terminate(){this.terminated=true;}
}
test('one thumbnail worker failure leaves other slots alive and retry starts a fresh slot',async()=>{
 const workers:FakeWorker[]=[];const pool=new LutThumbnailPool(()=>{const worker=new FakeWorker();workers.push(worker);return worker;},async()=>new File(['cube'],'x.cube'),new Blob(['base']),2);
 const a=pool.render({id:'a'}),failed=assert.rejects(a,/unavailable/),b=pool.render({id:'b'});await tick();workers[0].fail();await failed;assert.equal(workers[0].terminated,true);assert.equal(workers[1].terminated,false);workers[1].reply({id:workers[1].messages.at(-1)!.id,blob:new Blob(['b'])});assert.equal(await(await b).text(),'b');
 const retry=pool.render({id:'a'});await tick();assert.equal(workers.length,3);workers[2].reply({id:workers[2].messages.at(-1)!.id,blob:new Blob(['a'])});assert.equal(await(await retry).text(),'a');pool.close();assert.ok(workers.every(w=>w.terminated));
});
test('thumbnail timeout and close release pending messages without accepting stale worker output',async()=>{
 const worker=new FakeWorker(),pool=new LutThumbnailPool(()=>worker,async()=>new File(['cube'],'x.cube'),new Blob(['base']),1,10);
 await assert.rejects(pool.render({id:'a'}),/timed out/);assert.equal(worker.terminated,true);assert.equal(worker.onmessage,null);pool.close();await assert.rejects(pool.render({id:'b'}),{name:'AbortError'});
});
test('closing during a thumbnail source read never sends the returned file to a worker',async()=>{
 const worker=new FakeWorker();let release!:(file:File)=>void;
 const pool=new LutThumbnailPool(()=>worker,()=>new Promise(r=>release=r),new Blob(['base']),1),render=pool.render({id:'a'}),closed=assert.rejects(render,{name:'AbortError'});await tick();pool.close();release(new File(['cube'],'x.cube'));await closed;assert.equal(worker.messages.length,1);assert.equal(worker.terminated,true);
});
const cube=(n:number)=>new Blob([`# ${n}\nLUT_3D_SIZE 2\n`+[0,1].flatMap(b=>[0,1].flatMap(g=>[0,1].map(r=>`${r} ${g} ${b}`))).join('\n')]);
const digest=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
test('prepared LUT cache reuses four verified immutable tables and evicts the least recently used',async()=>{
 const cache=new VerifiedLutCache(),files=Array.from({length:5},(_,i)=>cube(i)),ids=await Promise.all(files.map(digest)),tables=[];
 for(let i=0;i<4;i++)tables.push(await cache.load(files[i],ids[i]));assert.equal(await cache.load(files[0],ids[0]),tables[0]);await cache.load(files[4],ids[4]);assert.notEqual(await cache.load(files[1],ids[1]),tables[1]);cache.clear();assert.notEqual(await cache.load(files[0],ids[0]),tables[0]);
});
test('prepared LUT cache rejects source tampering even for an already cached content hash',async()=>{
 const cache=new VerifiedLutCache(),file=cube(0),id=await digest(file),table=await cache.load(file,id);await assert.rejects(cache.load(cube(1),id),/source changed/);assert.equal(await cache.load(file,id),table);
});
