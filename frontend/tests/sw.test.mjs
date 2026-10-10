import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('service worker refreshes HTML and bounds its cache',async()=>{
  const handlers={},store=new Map();let requests=0;
  const cache={put:async(r,v)=>store.set(typeof r==='string'?r:r.url,v),keys:async()=>[...store.keys()],delete:async r=>store.delete(r),addAll:async()=>{}};
  const caches={open:async()=>cache,match:async r=>store.get(r.url),keys:async()=>[]};
  const sandbox={self:{addEventListener:(type,handler)=>handlers[type]=handler},location:{origin:'http://localhost'},caches,URL,Response,fetch:async()=>{requests++;return new Response('current-build')}};
  vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),sandbox);
  async function load(path){let promise;handlers.fetch({request:{url:'http://localhost'+path,method:'GET'},respondWith:value=>promise=value});return promise;}
  store.set('http://localhost/',new Response('old-build'));
  assert.equal(await (await load('/')).text(),'current-build');
  await load('/assets/index-hash.js');await load('/assets/index-hash.js');assert.equal(requests,2);
  for(let i=0;i<260;i++)await load(`/api/photos/${i}/thumbnail`);
  assert.ok(store.size<=250);
});
