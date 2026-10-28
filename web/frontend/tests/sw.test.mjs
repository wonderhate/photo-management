import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {MessageChannel} from 'node:worker_threads';
test('service worker refreshes HTML and bounds its cache',async()=>{
  const handlers={},store=new Map();let requests=0;
  const cache={put:async(r,v)=>store.set(typeof r==='string'?r:r.url,v),keys:async()=>[...store.keys()],delete:async r=>store.delete(r),addAll:async()=>{}};
  const caches={open:async()=>cache,match:async r=>store.get(r.url),keys:async()=>[]};
  const sandbox={self:{addEventListener:(type,handler)=>handlers[type]=handler},location:{origin:'http://localhost'},caches,URL,Response,fetch:async()=>{requests++;return new Response('current-build')}};
  const localSource=await readFile(new URL('../public/local-file-worker.js',import.meta.url),'utf8');sandbox.importScripts=()=>vm.runInNewContext(localSource,sandbox);
  vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),sandbox);
  async function load(path){let promise;handlers.fetch({request:{url:'http://localhost'+path,method:'GET'},respondWith:value=>promise=value});return promise;}
  store.set('http://localhost/',new Response('old-build'));
  assert.equal(await (await load('/')).text(),'current-build');
  await load('/assets/index-hash.js');await load('/assets/index-hash.js');assert.equal(requests,2);
  for(let i=0;i<260;i++)assert.equal(await load(`/api/photos/${i}/thumbnail`),undefined);
  assert.ok([...store.keys()].every(key=>!key.includes('/api/')));
  assert.ok(store.size<=250);
});
test('private local files stream only through the requesting window, support ranges, and never enter caches',async()=>{
  const handlers={},body=new Blob(['0123456789'],{type:'image/png'});let connected=true,status=0,served=0;
  const client={postMessage:(_message,[port])=>{served++;port.postMessage(status?{status}:{file:body});port.close();}};
  const sandbox={self:{addEventListener:(type,handler)=>handlers[type]=handler,clients:{get:async()=>connected?client:null}},location:{origin:'http://localhost'},MessageChannel,Blob,Response,Headers,URL,setTimeout,clearTimeout,caches:{open:()=>assert.fail('Private bytes were cached')},fetch:()=>assert.fail('Private request went to the server')};
  const source=await readFile(new URL('../public/local-file-worker.js',import.meta.url),'utf8');
  sandbox.importScripts=()=>vm.runInNewContext(source,sandbox);vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),sandbox);
  async function load(range){let promise;handlers.fetch({clientId:'window',request:new Request('http://localhost/_pc-file/session/library/exports/a.png',{headers:range?{Range:range}:{}}),respondWith:value=>promise=value});return promise;}
  const complete=await load();assert.equal(complete.status,200);assert.equal(complete.headers.get('Cache-Control'),'no-store');assert.equal(complete.headers.get('Content-Type'),'image/png');assert.equal(await complete.text(),'0123456789');
  const part=await load('bytes=2-5');assert.equal(part.status,206);assert.equal(part.headers.get('Content-Range'),'bytes 2-5/10');assert.equal(await part.text(),'2345');
  assert.equal(await(await load('bytes=-3')).text(),'789');assert.equal((await load('bytes=20-')).status,416);assert.equal((await load('bytes=-')).status,416);
  status=409;assert.equal((await load()).status,409);const before=served;connected=false;assert.equal((await load()).status,404);assert.equal(served,before);
});
