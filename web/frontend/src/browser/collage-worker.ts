import {decodeEditorSource} from './decoded-source';
import {renderPixels,neutralRecipe} from './editing';
import {metadataFromTags} from '../core/metadata';
import {renderCollage} from './collage-render';
import type {CollageOutput} from './collage-render';
import {sourceDecodeProfile} from '../core/source-decode-profile';
import {validateCollage,sameCollageSource} from '../core/collage';
import type {CollageScene,CollageSource} from '../core/collage';
type Input={id:string;file:File;profile:CollageSource['profile'];photo_id?:string};
const sources=new Map<string,{input:Input;source:CollageSource;preview:ImageBitmap;capture_time:string|null}>();
const hash=async(file:File)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
async function bitmap(input:Input,edge:number){
 const {pixels,bits,metadata}=await decodeEditorSource(input.file,sourceDecodeProfile(input.profile).extra_orientation),rendered=renderPixels(pixels,neutralRecipe(),edge);
 return {image:await createImageBitmap(new ImageData(new Uint8ClampedArray(rendered.data),rendered.width,rendered.height)),width:pixels.width,height:pixels.height,bits,capture_time:metadataFromTags({...metadata,...(metadata.timestamp instanceof Date&&Number.isFinite(metadata.timestamp.getTime())?{CreateDate:metadata.timestamp.toISOString().slice(0,19)}:{})}).date_taken};
}
let tail=Promise.resolve();
self.onmessage=({data}:{data:{id:number;action:'open'|'inspect'|'render'|'export';inputs?:Input[];scene?:CollageScene;options?:CollageOutput&{showGuides?:boolean}}})=>{tail=tail.then(async()=>{
 try{
  let result:unknown;
  if(data.action==='open'||data.action==='inspect'){
   const inputs=data.inputs!;if(!Array.isArray(inputs)||data.action==='inspect'&&inputs.length!==1||inputs.length<1||inputs.length>12||inputs.reduce((sum,i)=>sum+i.file.size,0)>512*1024*1024)throw new Error('A collage needs 1–12 photos, at most 512 MiB in total.');
   const next=new Map<string,{input:Input;source:CollageSource;preview:ImageBitmap;capture_time:string|null}>();
   try{for(const input of inputs){if(next.has(input.id))throw new Error('Duplicate collage source.');const sha256=await hash(input.file),decoded=await bitmap(input,1000),source:CollageSource={id:input.id,name:input.file.name,sha256,width:decoded.width,height:decoded.height,bits:decoded.bits as 8|16,profile:sourceDecodeProfile(input.profile),...(input.photo_id?{photo_id:input.photo_id}:{})};next.set(input.id,{input,source,preview:decoded.image,capture_time:decoded.capture_time});self.postMessage({id:data.id,progress:{done:next.size,total:inputs.length}});}}
   catch(error){for(const item of next.values())item.preview.close();throw error;}
   for(const item of sources.values())item.preview.close();sources.clear();for(const [id,item] of next)sources.set(id,item);result=data.action==='inspect'?{source:[...sources.values()][0].source,capture_time:[...sources.values()][0].capture_time}:[...sources.values()].map(s=>s.source);
  }else{
   const scene=data.scene!;validateCollage(scene);
   for(const source of scene.sources)if(!sameCollageSource(sources.get(source.id)?.source,source))throw new Error('Collage sources changed. Reopen the photos.');
   result=await renderCollage(scene,async source=>{const stored=sources.get(source.id)!;if(data.action==='render')return {image:stored.preview,release:()=>{}};
    if(await hash(stored.input.file)!==source.sha256)throw new Error('The source photo changed. Reopen it before exporting.');
    const decoded=await bitmap(stored.input,0);if(decoded.width!==source.width||decoded.height!==source.height){decoded.image.close();throw new Error('Collage source dimensions changed.');}return {image:decoded.image,release:()=>decoded.image.close()};
   },data.action==='render',data.options);
  }
  self.postMessage({id:data.id,result});
 }catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:'Collage processing failed.'});}
 });};
