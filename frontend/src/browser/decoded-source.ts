import {browserImageBitmap} from './format-decode';
import * as exifr from 'exifr';
import {decodeRaw} from './raw-decode';
import {isRawFile} from './raw-file';
import {imageOrientation} from '../core/image-orientation';
import type {Pixels} from './editing';
export async function decodeEditorSource(file:File,orientation=1):Promise<{pixels:Pixels;metadata:Record<string,unknown>;bits:number}>{
  if(file.size>256*1024*1024)throw new Error('Photo exceeds the 256 MiB browser import limit.');
  if(isRawFile(file.name)){if(orientation!==1)throw new Error('Unsupported source decoding profile.');return decodeRaw(file);}
  const bitmap=await browserImageBitmap(file);try{if(bitmap.width*bitmap.height>100_000_000)throw new Error('Image exceeds the 100 megapixel limit.');const geometry=imageOrientation(bitmap.width,bitmap.height,orientation),c=new OffscreenCanvas(geometry.width,geometry.height),ctx=c.getContext('2d')!;ctx.setTransform(...geometry.transform);ctx.drawImage(bitmap,0,0);let metadata={};try{metadata=await exifr.parse(file,{reviveValues:false})||{};}catch{}return {pixels:{width:c.width,height:c.height,channels:4,data:ctx.getImageData(0,0,c.width,c.height).data},metadata,bits:8};}finally{bitmap.close();}
}
