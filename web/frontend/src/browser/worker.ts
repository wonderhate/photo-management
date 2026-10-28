import {browserImageBitmap} from './format-decode';
import * as exifr from 'exifr';
import {renderWatermark,renderPoster} from './render';
import {imageHeader} from './image-header';
import {isRawFile} from './raw-file';
import {rawInfo,rawPreview,photoBitmap} from './raw-decode';
import {originalMetadata} from '../core/metadata';
import {sourceDecodeProfile} from '../core/source-decode-profile';
import {visualFingerprint} from '../core/visual-hash';

async function resized(image:ImageBitmap,edge:number,type='image/jpeg',quality=.85){const scale=Math.min(1,edge/Math.max(image.width,image.height));const canvas=new OffscreenCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);return canvas.convertToBlob({type,quality});}
async function metadata(file:File){
  if(file.size>256*1024*1024)throw new Error('Photo exceeds the 256 MiB browser import limit.');
  const bytes=await file.arrayBuffer(),raw=isRawFile(file.name),header=raw?undefined:imageHeader(new Uint8Array(bytes));
  // LibRaw transfers its input buffer; retain scalar flags before rawInfo owns it.
  const prefix=new Uint8Array(bytes,0,Math.min(bytes.byteLength,2)),jpeg=!raw&&prefix[0]===255&&prefix[1]===216;
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  let tags:Record<string,any>={};try{tags=await exifr.parse(bytes,{reviveValues:false,translateValues:false,icc:true,xmp:{parse:false}})||{};}catch{/* Photos without readable EXIF still import with unknown fields. */}
  const embeddedXmp=typeof tags.xmp==='string'&&tags.xmp.length<=1024*1024?tags.xmp:undefined;delete tags.xmp;
  if(tags.GPSAltitudeRef instanceof Uint8Array)tags.GPSAltitudeRef=tags.GPSAltitudeRef.length===1?tags.GPSAltitudeRef[0]:undefined;
  let dimensions=header;
  if(raw){
    const parsed=await rawInfo(file,bytes),info=parsed.info;dimensions={width:parsed.width,height:parsed.height};
    const fallback:Record<string,unknown>={Make:info.camera_make,Model:info.camera_model,ISO:info.iso_speed,ExposureTime:info.shutter,FNumber:info.aperture,FocalLength:info.focal_len,Orientation:parsed.orientation};
    if(info.timestamp instanceof Date&&Number.isFinite(info.timestamp.getTime()))fallback.CreateDate=info.timestamp.toISOString().slice(0,19);
    for(const [key,value] of Object.entries(fallback))if(tags[key]===undefined||tags[key]===null)tags[key]=value;
  }
  if(!dimensions){const bitmap=await browserImageBitmap(file);try{dimensions={width:bitmap.width,height:bitmap.height};}finally{bitmap.close();}}
  else if(!raw&&[5,6,7,8].includes(Number(tags.Orientation)))dimensions={width:dimensions.height,height:dimensions.width};
  if(dimensions.width*dimensions.height>100_000_000)throw new Error('Photo exceeds the 100 megapixel browser processing limit.');
  return {digest,...dimensions,embeddedXmp,jpeg,explicitOrientation:tags.Orientation!==undefined,metadata:originalMetadata(tags)};
}
async function previews(file:File,profile?:unknown){
  const sourceProfile=sourceDecodeProfile(profile);
  if(isRawFile(file.name)){
    if(sourceProfile.extra_orientation!==1)throw new Error('Unsupported source decoding profile.');
    const result=await rawPreview(file);try{return {width:result.width,height:result.height,source:result.source,thumbnail:await resized(result.bitmap,480),preview:await resized(result.bitmap,1600)};}finally{result.bitmap.close();}
  }
  const bitmap=await photoBitmap(file,sourceProfile);try{
    if(bitmap.width*bitmap.height>100_000_000)throw new Error('Photo exceeds the 100 megapixel browser processing limit.');
    return {width:bitmap.width,height:bitmap.height,source:'browser',thumbnail:await resized(bitmap,480),preview:await resized(bitmap,1600)};
  }finally{bitmap.close();}
}
async function analyze(file:File){return {...await metadata(file),...await previews(file)};}
self.onmessage=async(event:MessageEvent)=>{const {id,action,payload}=event.data;try{let result:unknown;
  if(action==='analyze')result=await analyze(payload.file);
  else if(action==='metadata')result=await metadata(payload.file);
  else if(action==='previews')result=await previews(payload.file,payload.profile);
  else if(action==='visual-fingerprint'){
    const bitmap=await browserImageBitmap(payload.file);
    try{if(bitmap.width*bitmap.height>100_000_000)throw new Error('Image exceeds the 100 megapixel limit.');const canvas=new OffscreenCanvas(32,32),context=canvas.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,32,32);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(bitmap,0,0,32,32);result=visualFingerprint(context.getImageData(0,0,32,32).data);}finally{bitmap.close();}
  }
  else if(action==='portfolio'){
    if(![1600,2048,2560,3840].includes(payload.edge)||!Number.isInteger(payload.quality)||payload.quality<60||payload.quality>95||payload.file.size>256*1024*1024)throw new Error('Invalid public export options.');
    const bitmap=await photoBitmap(payload.file,payload.profile);
    try{if(bitmap.width*bitmap.height>100_000_000)throw new Error('Image exceeds the 100 megapixel limit.');const scale=Math.min(1,payload.edge/Math.max(bitmap.width,bitmap.height));result={preview:await resized(bitmap,payload.edge,'image/jpeg',payload.quality/100),thumbnail:await resized(bitmap,640,'image/jpeg',.8),width:Math.max(1,Math.round(bitmap.width*scale)),height:Math.max(1,Math.round(bitmap.height*scale))};}finally{bitmap.close();}
  }
  else if(action==='watermark')result=await renderWatermark(payload.file,payload.photo,payload.options,payload.preview);
  else if(action==='poster')result=await renderPoster(payload.file,payload.layout,payload.originalSize,payload.preview);
  else if(action==='scene'){const bitmap=await photoBitmap(payload.file);try{const [ow,oh]=payload.originalSize,ratio=Math.min(3,Math.max(1/3,ow/oh)),pw=ratio>=1?1536:Math.max(512,Math.round(1536*ratio/16)*16),ph=ratio<=1?1536:Math.max(512,Math.round(1536/ratio/16)*16);if(bitmap.width!==pw||bitmap.height!==ph)throw new Error('AI output dimensions differ from the requested size; no crop or stretch was applied.');const fit=Math.min(pw/ow,ph/oh),x=Math.floor((pw-ow*fit)/2),y=Math.floor((ph-oh*fit)/2),w=Math.min(pw-x,Math.ceil(ow*fit)),h=Math.min(ph-y,Math.ceil(oh*fit)),c=new OffscreenCanvas(w,h);c.getContext('2d')!.drawImage(bitmap,x,y,w,h,0,0,w,h);result=await c.convertToBlob({type:'image/png'});}finally{bitmap.close();}}
  else if(action==='ai-output'||action==='ai-ink-layout'){
    const bitmap=await browserImageBitmap(payload.file);
    try{if(bitmap.width*bitmap.height>40_000_000||Math.max(bitmap.width,bitmap.height)>8192)throw new Error('AI output dimensions exceed the supported limit.');
      const c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext('2d')!;ctx.drawImage(bitmap,0,0);
      if(action==='ai-output'){
        if(payload.ink){const pixels=ctx.getImageData(0,0,c.width,c.height);for(let i=0;i<pixels.data.length;i+=4){const alpha=255-Math.round(pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=0;pixels.data[i+3]=alpha;}ctx.putImageData(pixels,0,0);}
        const image=await c.convertToBlob({type:'image/png'}),small=new OffscreenCanvas(Math.max(1,Math.round(c.width*Math.min(1,1000/Math.max(c.width,c.height)))),Math.max(1,Math.round(c.height*Math.min(1,1000/Math.max(c.width,c.height)))));small.getContext('2d')!.drawImage(c,0,0,small.width,small.height);result={image,preview:await small.convertToBlob({type:'image/webp',quality:.9}),width:c.width,height:c.height};
      }else{if(!/^#[a-fA-F0-9]{6}$/.test(payload.color)||[payload.x,payload.y,payload.scale].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)||payload.scale<.05)throw new Error('Invalid handwriting layout.');ctx.globalCompositeOperation='source-in';ctx.fillStyle=payload.color;ctx.fillRect(0,0,c.width,c.height);const out=new OffscreenCanvas(c.width,c.height),w=Math.max(1,Math.round(c.width*payload.scale)),h=Math.max(1,Math.round(c.height*payload.scale));out.getContext('2d')!.drawImage(c,Math.round((c.width-w)*payload.x),Math.round((c.height-h)*payload.y),w,h);result=await out.convertToBlob({type:'image/png'});}
    }finally{bitmap.close();}
  }
  else if(action==='clean'){const bitmap=await photoBitmap(payload.file,payload.profile);try{if(payload.title)result=await resized(bitmap,1024,'image/jpeg',.85);else{const ratio=Math.min(3,Math.max(1/3,bitmap.width/bitmap.height)),w=ratio>=1?1536:Math.max(512,Math.round(1536*ratio/16)*16),h=ratio<=1?1536:Math.max(512,Math.round(1536/ratio/16)*16);const c=new OffscreenCanvas(w,h),ctx=c.getContext('2d')!;ctx.fillStyle='#faf7ef';ctx.fillRect(0,0,w,h);const s=Math.min(w/bitmap.width,h/bitmap.height);ctx.drawImage(bitmap,(w-bitmap.width*s)/2,(h-bitmap.height*s)/2,bitmap.width*s,bitmap.height*s);result=await c.convertToBlob({type:'image/png'});}}finally{bitmap.close();}}
  else throw new Error('Unknown image operation.');self.postMessage({id,result});
}catch(e){self.postMessage({id,error:e instanceof Error?e.message:'Image processing failed.'});}};
