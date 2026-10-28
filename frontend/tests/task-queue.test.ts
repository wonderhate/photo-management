import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TaskQueue} from '../src/core/task-queue.ts';
const gate=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
test('bounded resource queues preserve FIFO while other resource work completes',async()=>{
  const queue=new TaskQueue(3),release=gate(),started=gate(),order:string[]=[];
  const first=queue.schedule('first','scope-a','io',async()=>{started.resolve();await release.promise;order.push('first');});
  await started.promise;const second=queue.schedule('second','scope-a','io',async()=>{order.push('second');});
  const other=queue.schedule('other','scope-a','render',async()=>{order.push('render');});
  assert.throws(()=>queue.schedule('overflow','scope-a','io',async()=>{}),/queue is full/);
  await other;assert.deepEqual(order,['render']);assert.equal(queue.snapshot().pending,2);
  release.resolve();await Promise.all([first,second]);assert.deepEqual(order,['render','first','second']);assert.equal(queue.snapshot().pending,0);
});
test('waiting cancellation releases capacity and running cancellation retains its physical slot',async()=>{
  const queue=new TaskQueue(2),release=gate(),started=gate();let ran=false;
  const first=queue.schedule('first','old','io',async()=>{started.resolve();await release.promise;});void first.catch(()=>{});await started.promise;
  const second=queue.schedule('second','old','io',async()=>{ran=true;});const stopped=assert.rejects(second,{name:'AbortError'});
  queue.cancel('second');await stopped;assert.equal(queue.snapshot().pending,1);
  const newer=queue.schedule('new','new','io',async()=>{ran=true;});queue.cancel('first');await Promise.resolve();assert.equal(queue.snapshot().pending,2);assert.equal(ran,false);
  release.resolve();await assert.rejects(first,{name:'AbortError'});await newer;assert.equal(ran,true);assert.equal(queue.snapshot().pending,0);
});
test('scope cancellation does not stop another library and rejected work frees its slot',async()=>{
  const queue=new TaskQueue(),release=gate(),started=gate();
  const old=queue.schedule('old','old','cloud',async signal=>{started.resolve();await release.promise;signal.throwIfAborted();});void old.catch(()=>{});await started.promise;
  const waiting=queue.schedule('waiting','old','cloud',async()=>assert.fail('Cancelled work ran'));void waiting.catch(()=>{});
  const newer=queue.schedule('new','new','render',async()=>42);queue.cancelScope('old');assert.equal(await newer,42);
  release.resolve();await assert.rejects(old,{name:'AbortError'});await assert.rejects(waiting,{name:'AbortError'});
  await assert.rejects(queue.schedule('bad','new','render',async()=>{throw new Error('broken');}),/broken/);
  assert.equal(await queue.schedule('good','new','render',async()=>7),7);assert.equal(queue.snapshot().pending,0);
});
test('import render leases count one workflow and give an already queued export the next slot',async()=>{
  const queue=new TaskQueue(2),entered=gate(),release=gate(),order:string[]=[];
  const imported=queue.schedule('import','library','io',async()=>{
    await queue.borrow('import','preview',async()=>{order.push('preview-1');entered.resolve();await release.promise;});
    await queue.borrow('import','preview',async()=>{order.push('preview-2');});
  });
  await entered.promise;assert.equal(queue.snapshot().pending,1);
  assert.deepEqual(queue.snapshot().items.map(r=>r.running),[1,1,0,0]);
  const exported=queue.schedule('export','library','render',async()=>{order.push('export');});
  assert.equal(queue.snapshot().pending,2);release.resolve();await Promise.all([imported,exported]);
  assert.deepEqual(order,['preview-1','export','preview-2']);assert.equal(queue.snapshot().pending,0);
});
test('cancelling an import removes its waiting render lease while the export stays active',async()=>{
  const queue=new TaskQueue(2),entered=gate(),release=gate(),queued=gate();
  const exported=queue.schedule('export','library','render',async()=>{entered.resolve();await release.promise;});
  await entered.promise;
  const imported=queue.schedule('import','library','io',async()=>{
    const borrowed=queue.borrow('import','preview',async()=>assert.fail('Cancelled preview ran'));queued.resolve();await borrowed;
  });
  const cancelled=assert.rejects(imported,{name:'AbortError'});await queued.promise;
  assert.equal(queue.snapshot().items.find(r=>r.name==='render')!.queued,1);
  queue.cancel('import');await cancelled;
  assert.equal(queue.snapshot().pending,1);assert.equal(queue.snapshot().items.find(r=>r.name==='render')!.queued,0);
  assert.throws(()=>queue.borrow('export','invalid',async()=>{}),/Invalid render lease/);
  release.resolve();await exported;
});
