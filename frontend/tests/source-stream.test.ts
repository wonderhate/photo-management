import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceBlob} from '../src/core/source-stream.ts';
test('bounded source reader retains exact bytes and MIME',async()=>{
  const source=Uint8Array.from([0,255,31,72,0]);
  const blob=await sourceBlob(new Response(source,{headers:{'content-type':'image/png','content-length':'5'}}),undefined,5);
  assert.equal(blob.type,'image/png');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),source);
});
test('oversized advertised and streamed sources cancel their own response body',async()=>{
  let cancelled=0;
  const declared=new ReadableStream({cancel(){cancelled++;}});
  await assert.rejects(sourceBlob(new Response(declared,{headers:{'content-length':'11'}}),undefined,10),/256 MiB/);
  const streamed=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(6));controller.enqueue(new Uint8Array(6));},cancel(){cancelled++;}});
  await assert.rejects(sourceBlob(new Response(streamed),undefined,10),/256 MiB/);assert.equal(cancelled,2);
});
test('source cancellation settles a pending read without waiting for another chunk',async()=>{
  let cancelled=false;
  const stream=new ReadableStream({cancel(){cancelled=true;}}),controller=new AbortController();
  const pending=sourceBlob(new Response(stream),controller.signal,10);controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,true);assert.equal(stream.locked,false);
});
