import {MAX_CUBE_BYTES,parseCube,prepareLut,applyLut} from '../core/cube-lut';
let base:ImageData|null=null;
self.onmessage=async({data}:{data:{id:number;base?:Blob;file?:File;hash?:string}})=>{
  try{
    if(data.base){const bitmap=await createImageBitmap(data.base);try{const scale=Math.min(1,280/Math.max(bitmap.width,bitmap.height)),canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale))),ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);base=ctx.getImageData(0,0,canvas.width,canvas.height);}finally{bitmap.close();}self.postMessage({id:data.id,ready:true});return;}
    if(!base||!data.file||data.file.size>MAX_CUBE_BYTES)throw new Error('LUT preview unavailable.');
    const bytes=await data.file.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(hash!==data.hash)throw new Error('LUT source changed. Restore a backup.');
    const lut=prepareLut(parseCube(new TextDecoder('utf-8',{fatal:true}).decode(bytes))),pixels=base.data.slice();applyLut(pixels,lut,1);
    const canvas=new OffscreenCanvas(base.width,base.height);canvas.getContext('2d')!.putImageData(new ImageData(pixels,base.width,base.height),0,0);
    const blob=await canvas.convertToBlob({type:'image/png'});canvas.width=1;canvas.height=1;self.postMessage({id:data.id,blob});
  }catch(e){self.postMessage({id:data.id,error:e instanceof Error?e.message:'LUT preview unavailable.'});}
};
