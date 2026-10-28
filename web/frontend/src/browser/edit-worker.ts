import {decodeEditorSource as decode} from './decoded-source';
import {drawLayerStack} from './layer-render';
import {recipeLayers} from '../core/layer-recipe';
import {layerRenderView} from '../core/layer-geometry';
import {layerAssetHashes} from '../core/layer-stack';
import {assetHash,VISION_MAX_BYTES,VISION_MAX_PIXELS} from '../core/vision-assets';
import {renderPixels,analyzePixels,colorStats,neutralRecipe,validateRecipe} from './editing';
import type {Pixels,EditRecipe} from './editing';
import {sourceDecodeProfile} from '../core/source-decode-profile';
import {renderSplitPixels,splitPixelPanels} from '../core/split-render';
import type {EncodedSplit} from '../core/split-render';
import {splitPlan} from '../core/seamless-split';
import type {SplitSpec} from '../core/seamless-split';
import {applyLut} from '../core/cube-lut';
import {applyLutBands,lutExportConcurrency} from '../core/lut-bands';
import {VerifiedLutCache} from '../core/lut-cache';
import type {PreparedLut} from '../core/cube-lut';

let source:Pixels|null=null;
let activeLut:{id:string;prepared:PreparedLut}|null=null;
const lutCache=new VerifiedLutCache();
let layerImages=new Map<string,ImageBitmap>();
async function loadLayerImages(files:{id:string;file:Blob}[],recipe:EditRecipe){
  const wanted=layerAssetHashes(recipeLayers(recipe)),next=new Map<string,ImageBitmap>();let memory=0;
  const budget=(image:ImageBitmap)=>{memory+=image.width*image.height*4;if(memory>256*1024*1024)throw new Error("Layer assets exceed the 256 MiB decoded memory limit. Use smaller PNGs.");};
  try{for(const id of wanted){if(layerImages.has(id)){const image=layerImages.get(id)!;budget(image);next.set(id,image);continue;}const file=files.find(f=>f.id===id)?.file;if(!assetHash(id)||!file||file.size>VISION_MAX_BYTES)throw new Error('Layer asset is missing or changed. Restore a backup.');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==id)throw new Error('Layer asset is missing or changed. Restore a backup.');const image=await createImageBitmap(file);if(image.width>8192||image.height>8192||image.width*image.height>VISION_MAX_PIXELS){image.close();throw new Error('Invalid local vision asset.');}next.set(id,image);budget(image);}}
  catch(e){for(const [id,image] of next)if(!layerImages.has(id))image.close();throw e;}
  for(const [id,image] of layerImages)if(!next.has(id))image.close();layerImages=next;
}
async function grade(pixels:Pixels,recipe:EditRecipe,parallel=false):Promise<Pixels>{
  if(recipe.version!==5||!recipe.lut)return pixels;
  if(!activeLut||activeLut.id!==recipe.lut.asset_hash)throw new Error('LUT source is unavailable. Reopen the editor.');
  const count=parallel?lutExportConcurrency(pixels.width*pixels.height,navigator.hardwareConcurrency,(navigator as Navigator & {deviceMemory?:number}).deviceMemory):1;
  if(count>1)await applyLutBands(pixels.data as Uint8ClampedArray,activeLut.prepared,recipe.lut.strength,()=>new Worker(new URL('./lut-band-worker.ts',import.meta.url),{type:'module'}),count);
  else applyLut(pixels.data as Uint8ClampedArray,activeLut.prepared,recipe.lut.strength);
  return pixels;
}

async function blob(p:Pixels,type='image/png',quality=.95,background?:'white'|'black'){const c=new OffscreenCanvas(p.width,p.height);try{const ctx=c.getContext('2d')!;ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data),p.width,p.height),0,0);if(background){ctx.globalCompositeOperation='destination-over';ctx.fillStyle=background;ctx.fillRect(0,0,p.width,p.height);}const result=await c.convertToBlob({type,quality});if(result.type!==type)throw new Error('This browser cannot encode the selected image format.');return result;}finally{c.width=1;c.height=1;}}
async function encoded(p:Pixels,type='image/png',quality=.95,background?:'white'){
  const value=await blob(p,type,quality,background),digest=await crypto.subtle.digest('SHA-256',await value.arrayBuffer());
  return {blob:value,sha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')};
}
async function compositeText(pixels:Pixels,parent:EditRecipe,target:EditRecipe){
  if(!recipeLayers(parent).layers.length)return {pixels,textLayouts:[]};
  const c=new OffscreenCanvas(pixels.width,pixels.height),ctx=c.getContext('2d')!;
  try{ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels.data),pixels.width,pixels.height),0,0);
    const document=recipeLayers(parent),textLayouts=await drawLayerStack(ctx,document,layerRenderView(document,parent,target,source!,pixels),layerImages);
    return {pixels:{...pixels,data:ctx.getImageData(0,0,c.width,c.height).data},textLayouts};
  }finally{c.width=1;c.height=1;}
}
// One image per editor worker. Terminating it cancels decoding and frees its pixel buffers.
self.onmessage=async({data}:{data:{id:number;action:string;file?:File;recipe?:EditRecipe;textRecipe?:EditRecipe;spec?:SplitSpec;edge?:number;format?:string;quality?:number;background?:'white'|'black';orientation?:number;profile?:unknown;lut?:{id:string;file:File};layerAssets?:{id:string;file:Blob}[]}})=>{const {id,action}=data;try{let result:unknown;
  const colorRecipe=data.textRecipe??data.recipe;if(data.textRecipe)validateRecipe(data.textRecipe);
  if(colorRecipe)await loadLayerImages(data.layerAssets??[],colorRecipe);
  if(colorRecipe?.version===5&&colorRecipe.lut){
    if(data.lut?.id!==colorRecipe.lut.asset_hash)throw new Error('LUT source is unavailable. Reopen the editor.');
    activeLut={id:data.lut.id,prepared:await lutCache.load(data.lut.file,data.lut.id)};
  }

  if(action==='display'){if(![4096,6144].includes(data.edge!)||!['white','black'].includes(data.background!))throw new Error('Invalid display request.');const decoded=await decode(data.file!,data.orientation);const image=renderPixels(decoded.pixels,neutralRecipe(),data.edge);result={blob:await blob(image,'image/jpeg',.94,data.background),width:image.width,height:image.height,bits:decoded.bits};}
  else if(action==='open'){source=null;const decoded=await decode(data.file!,sourceDecodeProfile(data.profile).extra_orientation);source=decoded.pixels;const preview=renderPixels(source,neutralRecipe(),2048);result={width:source.width,height:source.height,bits:decoded.bits,metadata:decoded.metadata,original:await blob(preview),analysis:analyzePixels(preview)};}
  else if(action==='reference'){const decoded=await decode(data.file!,sourceDecodeProfile(data.profile).extra_orientation);const preview=renderPixels(decoded.pixels,neutralRecipe(),1024);result={stats:colorStats(preview),preview:await blob(preview)};}
  else if(action==='split'){
    if(!source)throw new Error('Open a photo first.');
    if(data.format!=='png'&&data.format!=='jpg'||!Number.isInteger(data.quality)||data.quality!<1||data.quality!>100)throw new Error('Invalid split output format or quality.');
    const plan=splitPlan(data.spec!),progress=(phase:'render'|'encode',done:number)=>self.postMessage({id,progress:{phase,done,total:plan.count}});
    progress('render',0);const rendered=renderSplitPixels(source,data.recipe!,data.spec!);rendered.pixels=(await compositeText(await grade(rendered.pixels,data.recipe!,true),data.recipe!,rendered.recipe)).pixels;const master=await encoded(rendered.pixels),panels:EncodedSplit['panels']=[];let bytes=master.blob.size;
    if(bytes>512*1024*1024)throw new Error('Split output exceeds the 512 MiB limit.');progress('encode',0);
    for(const piece of splitPixelPanels(rendered.pixels,rendered.plan)){
      const panel=await encoded(piece.pixels,data.format==='jpg'?'image/jpeg':'image/png',data.quality!/100,data.format==='jpg'?'white':undefined);bytes+=panel.blob.size;
      if(bytes>512*1024*1024)throw new Error('Split output exceeds the 512 MiB limit.');panels.push({index:piece.index,...panel});progress('encode',piece.index+1);
    }
    result={version:data.recipe!.version>=3?2:1,...(data.recipe!.version>=3?{parent_recipe:structuredClone(data.recipe!)}:{}),spec:data.spec!,plan:rendered.plan,recipe:rendered.recipe,format:data.format,quality:data.quality!,master,panels} satisfies EncodedSplit;
  }
  else if(action==='render'||action==='export'){if(action==='export'&&(!['jpg','png','webp'].includes(data.format||'')||(data.quality!==undefined&&(!Number.isInteger(data.quality)||data.quality<1||data.quality>100))))throw new Error('Invalid export settings.');if(!source)throw new Error('Open a photo first.');const rendered=await compositeText(await grade(renderPixels(source,data.recipe!,action==='render'?2048:data.edge||0),colorRecipe!,action==='export'),data.textRecipe??data.recipe!,data.recipe!),p=rendered.pixels;result={blob:await blob(p,data.format==='jpg'?'image/jpeg':data.format==='webp'?'image/webp':'image/png',(data.quality||95)/100,data.format==='jpg'?'white':undefined),width:p.width,height:p.height,textLayouts:rendered.textLayouts,analysis:action==='render'?analyzePixels(p):undefined};}
  else throw new Error('Unknown image operation.');self.postMessage({id,result});
}catch(e){self.postMessage({id,error:e instanceof Error?e.message:'Image processing failed.'});}};
