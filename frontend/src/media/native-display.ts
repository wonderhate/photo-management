import {api,nativeFetch} from '../api';
import {sourceBlob} from '../core/source-stream';
import type {DisplayRequest} from '../core/display-request';

export const needsNativeDisplay=(name:string)=>/\.(tiff?|heic|heif)$/i.test(name);
let facts:Promise<{engine:string;formats:string[]}>|undefined;
export function nativeDisplayFacts(){return facts??=api<{engine:string;formats:string[]}>('/display/capabilities').catch(error=>{facts=undefined;throw error;});}
export async function renderNativeDisplay(request:DisplayRequest,signal:AbortSignal){
  const response=await nativeFetch('/api/display/'+encodeURIComponent(request.id)+'/render?'+new URLSearchParams({source_hash:request.hash,edge:String(request.edge)}),{method:'POST',signal});
  if(!response.ok){const payload=await response.json().catch(()=>({}));throw new Error(typeof payload.detail==='string'?payload.detail:'Native high-resolution preview failed.');}
  return sourceBlob(response,signal);
}
