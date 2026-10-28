import {current,directory,librarySession,commit,localFile,writeFile} from './storage';
import {sourceHash} from '../core/editor-adapter';
import type {VisionAssets} from '../core/vision-service';
import type {VisionAsset} from '../core/vision-assets';
import {assetHash,validateVisionAsset,VISION_MAX_BYTES} from '../core/vision-assets';
function clean(file:File){return new Promise<{blob:Blob;width:number;height:number}>((resolve,reject)=>{const worker=new Worker(new URL('./vision-image-worker.ts',import.meta.url),{type:'module'}),timer=setTimeout(()=>{worker.terminate();reject(new Error('Local vision request timed out.'));},30000);const done=()=>{clearTimeout(timer);worker.terminate();};worker.onmessage=({data})=>{done();if(data.error)reject(new Error(data.error));else resolve(data);};worker.onerror=()=>{done();reject(new Error('Local vision request failed.'));};worker.postMessage({file});});}
export function createVisionAssets():VisionAssets{
  const base=directory(),id=current().id,epoch=librarySession();
  const check=()=>{if(directory()!==base||librarySession()!==epoch||current().id!==id)throw new Error('Library changed. Reopen the tool.');};
  const get=(hash:string)=>{check();if(!assetHash(hash))throw new Error('Invalid local vision asset.');const r=current().vision_assets?.find(a=>a.id===hash);if(!r)throw new Error('Local vision asset not found.');validateVisionAsset(r);return r;};
  return {
    async get(hash){return structuredClone(get(hash));},
    async list(kind,page=1,includeHidden=false){check();if(!['sticker','depth'].includes(kind)||!Number.isInteger(page)||page<1)throw new Error('Invalid local vision asset.');const rows=(current().vision_assets||[]).filter(a=>a.kind===kind&&(includeHidden||!a.hidden)).sort((a,b)=>a.id.localeCompare(b.id)).slice((page-1)*24,page*24+1);return {items:structuredClone(rows.slice(0,24)),more:rows.length>24};},
    async source(hash){const r=get(hash),file=await localFile('stickers/'+hash+'.png',base);if(file.size>VISION_MAX_BYTES||file.size!==r.bytes||await sourceHash(file)!==hash)throw new Error('Layer asset is missing or changed. Restore a backup.');check();return file;},
    async importPNG(file,name){check();const {blob,width,height}=await clean(file),hash=await sourceHash(blob);check();const existing=current().vision_assets?.find(a=>a.id===hash);if(existing){await this.source(hash);return structuredClone(existing);}const record:VisionAsset={version:1,id:hash,kind:'sticker',name,width,height,bytes:blob.size,created_at:new Date().toISOString(),source:null,model:null,instance_id:null,hidden:false};validateVisionAsset(record);await writeFile('stickers/'+hash+'.png',blob,base);check();await commit(s=>{check();s.vision_assets??=[];if(!s.vision_assets.some(a=>a.id===hash))s.vision_assets.push(record);});return record;},
    async update(hash,patch){const r=structuredClone(get(hash));Object.assign(r,patch);validateVisionAsset(r);await commit(s=>{check();const i=s.vision_assets?.findIndex(a=>a.id===hash)??-1;if(i<0)throw new Error('Local vision asset not found.');s.vision_assets![i]=r;});return r;}
  };
}
