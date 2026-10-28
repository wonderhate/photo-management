import {IS_BROWSER} from '../runtime';
import {api,nativeFetch,scopeNativeResult} from '../api';
import {validateVisionRequest} from './local-vision';
import type {VisionModelStatus,VisionRequest} from './local-vision';
import type {Job} from '../types';
export type VisionJob=Omit<Job,'results'>&{results:{asset_id:string;instance_id:string|null}[]};
async function response(r:Response){if(!r.ok){const e=await r.json().catch(()=>null);throw new Error(typeof e?.detail==='string'?e.detail:'Local vision request failed.');}return r;}
export async function localVisionStatus():Promise<VisionModelStatus[]>{return IS_BROWSER?(await import('../browser/vision-models')).browserVisionModels():api('/vision/models');}
export async function importLocalModel(id:string,files:File[],confirmed:boolean){if(IS_BROWSER)return (await import('../browser/vision-models')).importVisionModel(id,files,confirmed);const body=new FormData();for(const file of files)body.append('files',file,file.name);body.append('confirmed',String(confirmed));return(await response(await nativeFetch('/api/vision/models/'+encodeURIComponent(id)+'/import',{method:'POST',body}))).json();}
export async function runLocalVision(payload:VisionRequest,image:Blob):Promise<VisionJob>{validateVisionRequest(payload,IS_BROWSER?'browser':'native');if(IS_BROWSER)return (await import('../browser/local-vision')).startLocalVision(payload,image) as unknown as Promise<VisionJob>;const body=new FormData();body.append('file',image,'input.png');body.append('payload',JSON.stringify(payload));return scopeNativeResult(await(await response(await nativeFetch('/api/vision/infer',{method:'POST',body}))).json());}
