import {applyLut} from './cube-lut.ts';
import type {PreparedLut} from './cube-lut.ts';
import type {ThumbnailWorker} from './lut-thumbnail-pool.ts';

export const LUT_BAND_BYTES=4*1024*1024;
// Preview-sized images stay in their existing editor worker. Unknown memory
// uses the same path; only larger exports on capable machines get subworkers.
export function lutExportConcurrency(pixels:number,cores:number,memory?:number){
 if(pixels<8_000_000||!Number.isFinite(cores)||cores<4||!memory||memory<4)return 1;
 return cores>=8&&memory>=8?4:2;
}

export async function applyLutBands(pixels:Uint8ClampedArray,lut:PreparedLut,strength:number,factory:()=>ThumbnailWorker,count:number,timeout=30000){
 // Validate before dispatch, including the zero-strength fast path.
 if(!(pixels instanceof Uint8ClampedArray)||pixels.length%4)throw new Error('Invalid LUT pixels.');
 applyLut(pixels.subarray(0,0),lut,strength);
 const concurrency=Number.isFinite(count)?Math.max(1,Math.min(4,Math.floor(count))):1;
 if(concurrency===1||strength===0||!pixels.length)return applyLut(pixels,lut,strength);
 let next=0,broken=false;
 const workers=new Set<ThumbnailWorker>();
 const stop=(worker:ThumbnailWorker)=>{worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();workers.delete(worker);};
 function send(worker:ThumbnailWorker,data:object,transfer:Transferable[]=[]):Promise<{ready?:boolean;buffer?:ArrayBuffer}>{
  return new Promise((resolve,reject)=>{
   const clear=()=>{clearTimeout(timer);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;};
   const fail=()=>{clear();reject(new Error('LUT band worker unavailable.'));};
   const timer=setTimeout(fail,timeout);
   worker.onmessage=e=>{clear();e.data?.error?reject(new Error('LUT band failed.')):resolve(e.data);};
   worker.onerror=e=>{e.preventDefault();fail();};worker.onmessageerror=fail;
   try{worker.postMessage(data,transfer);}catch{fail();}
  });
 }
 try{
  await Promise.all(Array.from({length:Math.min(concurrency,Math.ceil(pixels.length/LUT_BAND_BYTES))},async()=>{
   let worker:ThumbnailWorker|null=null;
   try{worker=factory();workers.add(worker);if(!(await send(worker,{lut,strength})).ready)throw new Error('LUT worker initialization failed.');}
   catch{broken=true;if(worker)stop(worker);worker=null;}
   while(next<pixels.length){
    const start=next,end=Math.min(pixels.length,start+LUT_BAND_BYTES);next=end;
    // The original range stays owned here until a valid reply arrives. If a
    // worker fails, only that unmodified range is graded once in this worker.
    if(worker&&!broken){
     try{const band=pixels.slice(start,end),reply=await send(worker,{buffer:band.buffer},[band.buffer]);
      if(!(reply.buffer instanceof ArrayBuffer)||reply.buffer.byteLength!==end-start)throw new Error('Invalid LUT band result.');
      pixels.set(new Uint8ClampedArray(reply.buffer),start);continue;
     }catch{broken=true;stop(worker);worker=null;}
    }
    applyLut(pixels.subarray(start,end),lut,strength);
   }
  }));
  return pixels;
 }finally{for(const worker of workers)stop(worker);}
}
