import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ResourcePool} from '../src/core/resource-pool.ts';
import {localPhotoSource,parsePhotoSource} from '../src/core/media-source.ts';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function urls(){let n=0;const created:string[]=[],revoked:string[]=[];return {created,revoked,createURL:()=>{const url='blob:fixture-'+(++n);created.push(url);return url;},revokeURL:(url:string)=>{revoked.push(url);}};}

test('shared leases load once and never revoke an image that is still displayed',async()=>{
  const records=urls();let loads=0;
  const pool=new ResourcePool(async()=>{loads++;return new Blob(['12345']);},{...records,maxEntries:1,maxBytes:100});
  const first=pool.acquire('a'),second=pool.acquire('a',0);assert.equal(await first.ready,await second.ready);assert.equal(loads,1);
  first.release();const other=pool.acquire('b');await other.ready;assert.equal(pool.snapshot().pinned,2);assert.equal(records.revoked.length,0);
  other.release();assert.deepEqual(records.revoked,['blob:fixture-2']);assert.equal(pool.snapshot().entries,1);
  second.release();pool.reset();assert.deepEqual(records.revoked,['blob:fixture-2','blob:fixture-1']);assert.equal(pool.snapshot().bytes,0);
});

test('current-photo priority wins and released queued work never reads a file',async()=>{
  const started:string[]=[],gates=new Map<string,(blob:Blob)=>void>(),records=urls();
  const pool=new ResourcePool(key=>{started.push(key);return new Promise(resolve=>gates.set(key,resolve));},{...records,concurrency:1});
  const thumb=pool.acquire('thumbnail',10),abandoned=pool.acquire('offscreen',20),viewer=pool.acquire('viewer',0);
  const rejected=assert.rejects(abandoned.ready,{name:'AbortError'});abandoned.release();await tick();assert.deepEqual(started,['viewer']);
  gates.get('viewer')!(new Blob(['v']));await viewer.ready;await tick();assert.deepEqual(started,['viewer','thumbnail']);
  gates.get('thumbnail')!(new Blob(['t']));await thumb.ready;await rejected;
  viewer.release();thumb.release();pool.reset();assert.equal(pool.snapshot().queued,0);
});

test('idle resources obey both byte and entry budgets after thousands of visits',async()=>{
  const records=urls(),pool=new ResourcePool(async()=>new Blob(['1234567890']),{...records,maxEntries:16,maxBytes:100});
  for(let i=0;i<2000;i++){const lease=pool.acquire(String(i));await lease.ready;lease.release();}
  assert.ok(pool.snapshot().entries<=10);assert.ok(pool.snapshot().bytes<=100);assert.ok(records.revoked.length>=1990);
  const pinned=pool.acquire('current');await pinned.ready;const url=await pinned.ready;
  for(let i=0;i<30;i++){const lease=pool.acquire('neighbor-'+i);await lease.ready;lease.release();}
  assert.ok(!records.revoked.includes(url));pinned.release();pool.reset();assert.ok(records.revoked.includes(url));
});

test('library reset invalidates in-flight work without creating a stale URL or exceeding concurrency',async()=>{
  const records=urls();let complete!:(blob:Blob)=>void;
  const pool=new ResourcePool(key=>key==='old'?new Promise(resolve=>{complete=resolve;}):Promise.resolve(new Blob(['new'])),{...records,concurrency:1});
  const old=pool.acquire('old'),oldRejected=assert.rejects(old.ready,{name:'AbortError'});await tick();pool.reset();
  const next=pool.acquire('new');assert.equal(pool.snapshot().running,1);complete(new Blob(['old']));await oldRejected;
  assert.equal(await next.ready,'blob:fixture-1');assert.equal(records.created.length,1);next.release();old.release();pool.reset();
});

test('failed file reads settle the queue and require a new explicit acquisition to retry',async()=>{
  const records=urls();let count=0;
  const pool=new ResourcePool(()=>{count++;if(count===1)throw new Error('synthetic missing file');return Promise.resolve(new Blob(['ok']));},records);
  const failed=pool.acquire('x');await assert.rejects(failed.ready,/missing/);failed.release();await tick();assert.equal(count,1);assert.equal(pool.snapshot().running,0);
  const retry=pool.acquire('x');await retry.ready;assert.equal(count,2);retry.release();pool.reset();
});

test('photo media references identify a library and only allow derived preview paths',()=>{
  const source=localPhotoSource('library-1','photos/frame-1-preview.jpg');assert.deepEqual(parsePhotoSource(source),{libraryID:'library-1',path:'photos/frame-1-preview.jpg'});
  assert.equal(parsePhotoSource('https://example.invalid/image.jpg'),null);
  for(const path of ['../original.jpg','photos/frame-1-original.jpg','C:/original.jpg','photos/../frame-thumb.jpg'])assert.throws(()=>localPhotoSource('library-1',path));
  assert.throws(()=>parsePhotoSource('pc-local-media:library-1/photos/../../original.jpg'));
});
