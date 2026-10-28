import {IS_BROWSER} from '../runtime';
import {api,nativeFetch,scopeNativeResult} from '../api';
import {sourceHash} from './editor-adapter';
import {assetHash,validateVisionAsset,VISION_MAX_BYTES} from './vision-assets';
import type {VisionAsset} from './vision-assets';
export interface VisionAssets {
  get(id:string):Promise<VisionAsset>;
  list(kind:'sticker'|'depth',page?:number,includeHidden?:boolean):Promise<{items:VisionAsset[];more:boolean}>;
  source(id:string):Promise<Blob>;
  importPNG(file:File,name:string):Promise<VisionAsset>;
  update(id:string,patch:{name?:string;hidden?:boolean}):Promise<VisionAsset>;
}
async function response(r:Response){if(!r.ok){const error=await r.json().catch(()=>null);throw new Error(typeof error?.detail==='string'?error.detail:'Local vision request failed.');}return r;}
export async function visionAssets():Promise<VisionAssets>{
  if(IS_BROWSER)return (await import('../browser/vision-assets')).createVisionAssets();
  // nativeFetch captures the current library/session, rejecting late responses.
  return {
    async get(id){if(!assetHash(id))throw new Error('Invalid local vision asset.');const r=await api('/vision/assets/'+id);validateVisionAsset(r);return r;},
    async list(kind,page=1,includeHidden=false){const r=await api<{items:VisionAsset[];more:boolean}>(`/vision/assets?kind=${kind}&page=${page}&include_hidden=${includeHidden}`);for(const a of r.items)validateVisionAsset(a);return r;},
    async source(id){if(!assetHash(id))throw new Error('Invalid local vision asset.');const blob=await(await response(await nativeFetch('/api/vision/assets/'+id+'/image'))).blob();if(blob.size>VISION_MAX_BYTES||await sourceHash(blob)!==id)throw new Error('Layer asset is missing or changed. Restore a backup.');return blob;},
    async importPNG(file,name){if(file.size>VISION_MAX_BYTES)throw new Error('Local vision asset exceeds the size limit.');const body=new FormData();body.append('file',file);body.append('name',name);const record=scopeNativeResult(await(await response(await nativeFetch('/api/vision/assets',{method:'POST',body}))).json());validateVisionAsset(record);return record;},
    async update(id,patch){if(!assetHash(id))throw new Error('Invalid local vision asset.');const r=await api('/vision/assets/'+id,'PATCH',patch);validateVisionAsset(r);return r;}
  };
}
