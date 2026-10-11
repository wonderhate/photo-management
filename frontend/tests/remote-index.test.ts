import {test} from 'node:test';
import assert from 'node:assert/strict';
import {indexKey,rememberIndex,readIndex,clearIndex} from '../src/remote-client.ts';
function storage(){const data:Record<string,string>={};return new Proxy(data,{get:(t,k)=>k==='getItem'?(key:string)=>t[key]??null:k==='setItem'?(key:string,value:string)=>{t[key]=value}:k==='removeItem'?(key:string)=>{delete t[key]}:t[k as string]}) as unknown as Storage}
test('cache contains bounded JSON indexes and never queues edits or stores image bytes',()=>{
  const s=storage(),key=indexKey('/photos/ids?sort=date_taken','GET')!;
  rememberIndex(s,key,{ids:['one','two']});assert.deepEqual(readIndex(s,key),{ids:['one','two']});
  assert.equal(indexKey('/photos/one','PATCH',{favorite:true}),null);
  assert.equal(indexKey('/watermark/preview','POST',{}),null);
  assert.equal(indexKey('/watermark/export','POST',{}),null);
  assert.equal(indexKey('/photos/one/thumbnail','GET'),null);
  assert.equal(indexKey('/exports/file.jpg','GET'),null);
  rememberIndex(s,'remote-index:bad',{preview:'data:image/jpeg;base64,abc'});assert.equal(readIndex(s,'remote-index:bad'),undefined);
  for(let i=0;i<70;i++)rememberIndex(s,'remote-index:'+i,{name:'index '+i});assert.ok(Object.keys(s).length<=60);
  s.setItem('theme','light');clearIndex(s);assert.deepEqual(Object.keys(s),['theme']);
});
