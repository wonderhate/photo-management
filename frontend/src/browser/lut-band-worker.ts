import {applyLut} from '../core/cube-lut';
import type {PreparedLut} from '../core/cube-lut';
let lut:PreparedLut|null=null,strength=1;
self.onmessage=({data}:{data:{lut?:PreparedLut;strength?:number;buffer?:ArrayBuffer}})=>{
 try{
  if(data.lut){lut=data.lut;strength=data.strength!;self.postMessage({ready:true});return;}
  if(!lut||!(data.buffer instanceof ArrayBuffer))throw new Error('Invalid LUT band.');
  const pixels=new Uint8ClampedArray(data.buffer);applyLut(pixels,lut,strength);self.postMessage({buffer:pixels.buffer},{transfer:[pixels.buffer]});
 }catch{self.postMessage({error:'LUT band failed.'});}
};
