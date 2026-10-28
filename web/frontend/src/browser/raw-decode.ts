import {browserImageBitmap} from './format-decode';
import type LibRaw from 'libraw-wasm';
import * as exifr from 'exifr';
import {isRawFile,rawGeometry} from './raw-file';
import {neutralRecipe,renderPixels} from './editing';
import type {Pixels} from './editing';
import {imageHeader} from './image-header';
import {imageOrientation} from '../core/image-orientation';
import {sourceDecodeProfile} from '../core/source-decode-profile';

export async function openRaw(file:File,bytes?:ArrayBuffer){
  if(file.size>256*1024*1024)throw new Error('Photo exceeds the 256 MiB browser import limit.');
  if(!self.crossOriginIsolated)throw new Error('RAW needs cross-origin isolation. Check the site hosting headers.');
  const path='/raw-1.6.0/index.js';const {default:Decoder}=await import(/* @vite-ignore */path) as {default:typeof LibRaw},raw=new Decoder();
  try{await raw.open(new Uint8Array(bytes||await file.arrayBuffer()),{outputBps:16,outputColor:1,gamm:[1,1],noAutoBright:true,useCameraWb:true});return raw;}
  catch{raw.dispose();throw new Error('RAW file is unsupported by this decoder or is damaged.');}
}
export async function rawInfo(file:File,bytes?:ArrayBuffer){
  const raw=await openRaw(file,bytes);try{const info=await raw.metadata(true);if(!info)throw new Error('RAW decoding failed or returned unsupported pixels.');return {info,...rawGeometry(info)};}finally{raw.dispose();}
}
export function rawPixels(image:Awaited<ReturnType<LibRaw['imageData']>>):Pixels{
  if(!image||image.bits!==16||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||image.width<=0||image.height<=0||image.width*image.height>100_000_000||![3,4].includes(image.colors)||!(image.data instanceof Uint16Array)||image.data.length!==image.width*image.height*image.colors)throw new Error('RAW decoding failed or returned unsupported pixels.');
  return {width:image.width,height:image.height,channels:image.colors as 3|4,data:image.data,linear:true};
}
export async function decodeRaw(file:File){
  const raw=await openRaw(file);try{const metadata=await raw.metadata(false);if(!metadata)throw new Error('RAW decoding failed or returned unsupported pixels.');rawGeometry(metadata);const pixels=rawPixels(await raw.imageData().catch(()=>undefined));return {pixels,metadata:{...metadata,decoder:'LibRaw-Wasm 1.6.0',decoded_bits:16},bits:16};}finally{raw.dispose();}
}
function pixelsBitmap(pixels:Pixels,edge=0){
  const rendered=renderPixels(pixels,neutralRecipe(),edge),canvas=new OffscreenCanvas(rendered.width,rendered.height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rendered.data),rendered.width,rendered.height),0,0);return canvas.transferToImageBitmap();
}
export async function photoBitmap(file:Blob,profile?:unknown):Promise<ImageBitmap>{
  const orientation=sourceDecodeProfile(profile).extra_orientation,raw=file instanceof File&&isRawFile(file.name);
  if(raw&&orientation!==1)throw new Error('Unsupported source decoding profile.');
  const bitmap=raw?pixelsBitmap((await decodeRaw(file as File)).pixels):await browserImageBitmap(file);
  if(orientation===1)return bitmap;
  try{
    if(bitmap.width*bitmap.height>100_000_000)throw new Error('Image exceeds the 100 megapixel limit.');
    const geometry=imageOrientation(bitmap.width,bitmap.height,orientation),canvas=new OffscreenCanvas(geometry.width,geometry.height),ctx=canvas.getContext('2d')!;
    ctx.setTransform(...geometry.transform);ctx.drawImage(bitmap,0,0);return canvas.transferToImageBitmap();
  }finally{bitmap.close();}
}

async function orientPreview(bitmap:ImageBitmap,orientation:number){
  if(orientation===1)return bitmap;
  const w=bitmap.width,h=bitmap.height,swapped=orientation>=5,canvas=new OffscreenCanvas(swapped?h:w,swapped?w:h),ctx=canvas.getContext('2d')!;
  const transforms:Record<number,[number,number,number,number,number,number]>={2:[-1,0,0,1,w,0],3:[-1,0,0,-1,w,h],4:[1,0,0,-1,0,h],5:[0,1,1,0,0,0],6:[0,1,-1,0,h,0],7:[0,-1,-1,0,h,w],8:[0,-1,1,0,0,w]};
  try{ctx.transform(...transforms[orientation]);ctx.drawImage(bitmap,0,0);return canvas.transferToImageBitmap();}finally{bitmap.close();}
}
export async function rawPreview(file:File){
  const raw=await openRaw(file);try{
    const info=await raw.metadata(false);if(!info)throw new Error('RAW decoding failed or returned unsupported pixels.');const dimensions=rawGeometry(info);
    const thumb=await raw.thumbnailData().catch(()=>undefined);let bitmap:ImageBitmap|undefined,source:'embedded-jpeg'|'embedded-bitmap'|'decoded-raw'='decoded-raw';
    if(thumb?.data?.length)try{
      let orientation=dimensions.orientation;
      if(thumb.format==='jpeg'){
        imageHeader(new Uint8Array(thumb.data));
        const blob=new Blob([new Uint8Array(thumb.data)],{type:'image/jpeg'});bitmap=await createImageBitmap(blob);source='embedded-jpeg';
        const own=await exifr.orientation(blob).catch(()=>undefined);
        // createImageBitmap already applies the JPEG's EXIF. Fall back to the RAW
        // orientation only when absent, or when an unrotated portrait is obvious.
        if(own&&!(own===1&&dimensions.orientation>=5&&(bitmap.width>bitmap.height)!==(dimensions.width>dimensions.height)))orientation=1;
      }else if(thumb.format==='bitmap'&&thumb.width>0&&thumb.height>0&&thumb.width*thumb.height<=100_000_000){
        const channels=thumb.data.length/(thumb.width*thumb.height);if(channels!==3&&channels!==4)throw new Error('Invalid embedded preview.');
        const data=new Uint8ClampedArray(thumb.width*thumb.height*4);for(let i=0,j=0;i<data.length;i+=4,j+=channels){data[i]=thumb.data[j];data[i+1]=thumb.data[j+1];data[i+2]=thumb.data[j+2];data[i+3]=255;}
        const canvas=new OffscreenCanvas(thumb.width,thumb.height);canvas.getContext('2d')!.putImageData(new ImageData(data,thumb.width,thumb.height),0,0);bitmap=canvas.transferToImageBitmap();source='embedded-bitmap';
      }
      if(bitmap)bitmap=await orientPreview(bitmap,orientation);
    }catch{bitmap?.close();bitmap=undefined;}
    if(!bitmap){source='decoded-raw';bitmap=pixelsBitmap(rawPixels(await raw.imageData().catch(()=>undefined)),1600);}
    return {...dimensions,bitmap,source};
  }finally{raw.dispose();}
}
