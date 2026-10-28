import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLutBands,lutExportConcurrency,LUT_BAND_BYTES} from '../src/core/lut-bands.ts';
import {applyLut,prepareLut} from '../src/core/cube-lut.ts';
import type {PreparedLut} from '../src/core/cube-lut.ts';
import type {ThumbnailWorker} from '../src/core/lut-thumbnail-pool.ts';
import {orderLuts,lutVisiblePage,lutGroupedStep} from '../src/core/lut-order.ts';
import {lutViewDefaults} from '../src/core/lut-view.ts';
import {validateToolPreferences} from '../src/core/preferences.ts';
import type {LutAsset} from '../src/core/lut-contract.ts';
const lut=prepareLut({title:'',size:2,domainMin:[-.1,0,.1],domainMax:[1.1,.9,1.2],table:new Float32Array(Array.from({length:24},(_,i)=>((i*197)%1009)/1008))});
class BandWorker implements ThumbnailWorker{
 onmessage:ThumbnailWorker['onmessage']=null;onerror:ThumbnailWorker['onerror']=null;onmessageerror:ThumbnailWorker['onmessageerror']=null;
 terminated=false;lut:PreparedLut|null=null;strength=1;sizes:number[]=[];
 mode:string;constructor(mode='normal'){this.mode=mode;}
 postMessage(message:{lut?:PreparedLut;strength?:number;buffer?:ArrayBuffer},transfer?:Transferable[]){
  const data=structuredClone(message,{transfer});
  if(data.lut){this.lut=data.lut;this.strength=data.strength!;queueMicrotask(()=>this.reply({ready:true}));return;}
  this.sizes.push(data.buffer!.byteLength);
  if(this.mode==='hang')return;
  if(this.mode==='error'){queueMicrotask(()=>this.onerror?.call(this as unknown as Worker,{preventDefault(){}} as ErrorEvent));return;}
  if(this.mode==='bad'){queueMicrotask(()=>this.reply({buffer:new ArrayBuffer(4)}));return;}
  const pixels=new Uint8ClampedArray(data.buffer!);applyLut(pixels,this.lut!,this.strength);
  queueMicrotask(()=>this.reply({buffer:pixels.buffer}));
 }
 reply(data:object){this.onmessage?.call(this as unknown as Worker,new MessageEvent('message',{data}));}
 terminate(){this.terminated=true;}
}
test('large LUT exports use capability gates, leaving previews and unknown-memory devices serial',()=>{
 assert.equal(lutExportConcurrency(7_999_999,24,32),1);assert.equal(lutExportConcurrency(24e6,24),1);assert.equal(lutExportConcurrency(24e6,2,8),1);assert.equal(lutExportConcurrency(24e6,8,2),1);assert.equal(lutExportConcurrency(24e6,4,4),2);assert.equal(lutExportConcurrency(24e6,8,8),4);
});
test('parallel LUT bands preserve every RGBA byte, short tail and source ownership within a four-band budget',async()=>{
 const original=new Uint8ClampedArray(LUT_BAND_BYTES*5+28);for(let i=0;i<original.length;i++)original[i]=(i*157+(i>>13))%256;
 const expected=applyLut(original.slice(),lut,.73);
 for(const mode of ['normal','error','bad','hang','spawn']){
  const pixels=original.slice(),workers:BandWorker[]=[];
  await applyLutBands(pixels,lut,.73,()=>{if(mode==='spawn')throw new Error('Unsupported nested worker');const worker=new BandWorker(workers.length===1?mode:'normal');workers.push(worker);return worker;},4,10);
  assert.deepEqual(pixels,expected,mode);assert.equal(pixels.byteLength,original.byteLength);assert.equal(workers.length,mode==='spawn'?0:4);assert.ok(workers.every(w=>w.terminated&&w.onmessage===null&&w.sizes.every(n=>n<=LUT_BAND_BYTES)));
 }
});
test('zero-strength LUT exports launch no workers and invalid requests reject before dispatch',async()=>{
 const pixels=new Uint8ClampedArray([1,2,3,4]),factory=()=>{throw new Error('must not spawn');};
 assert.equal(await applyLutBands(pixels,lut,0,factory,4),pixels);assert.deepEqual([...pixels],[1,2,3,4]);await assert.rejects(applyLutBands(pixels,lut,NaN,factory,4));await assert.rejects(applyLutBands(new Uint8ClampedArray(3),lut,1,factory,4));
});
test('folded LUT groups keep headers and counts but use no page or arrow positions',()=>{
 const assets=Array.from({length:90},(_,i)=>({version:1,id:String(i).padStart(2,'0'),name:String(i).padStart(2,'0'),title:'',size:2,bytes:100,favorite:i<45,hidden:false,used_at:null} as LutAsset)),ordered=orderLuts(assets,'all',['45','46','47']);
 const view={...lutViewDefaults,'collapse:favorite':true},first=lutVisiblePage(ordered,view,0,40);assert.equal(first.rows.length,45);assert.equal(first.sections[0].count,45);assert.equal(first.sections[0].assets.length,0);assert.equal(first.sections.flatMap(s=>s.assets).length,40);assert.equal(first.rows[0].id,'45');
 assert.equal(lutGroupedStep(2,first.groups,2,'ArrowDown',40),3);const last=lutVisiblePage(ordered,view,1,40);assert.equal(last.sections.flatMap(s=>s.assets).length,5);
 const collapsed=lutVisiblePage(ordered,{...view,'collapse:recent':true,'collapse:other':true},8,40);assert.equal(collapsed.page,0);assert.equal(collapsed.rows.length,0);assert.equal(collapsed.sections.length,3);
});
test('LUT group fold preferences accept only named boolean groups and coexist with source tree state',()=>{
 assert.deepEqual(validateToolPreferences('lut',{'collapse:favorite':true,'collapse:recent':false,'fold:library:Pack':false}),{'collapse:favorite':true,'collapse:recent':false,'fold:library:Pack':false});
 for(const patch of [{'collapse:unknown':true},{'collapse:favorite':1},{'collapse:recent':'true'}])assert.throws(()=>validateToolPreferences('lut',patch));
});
