import {api,nativeFetch,scopeNativeResult} from '../api';
import {IS_BROWSER} from '../runtime';
import {ResourcePool} from '../core/resource-pool';
import {registerResourceReset} from '../core/resource-lifecycle';
import {displayLibraryId} from './display-library';
import type {VideoAsset} from '../core/video';
import {sourceBlob} from '../core/source-stream';
import type {Job} from '../types';

export const videoFrames=new ResourcePool(async(key,signal)=>{
  const [scope,id,index]=JSON.parse(key) as [string,string,number];signal.throwIfAborted();
  if(await displayLibraryId()!==scope)throw new DOMException('Library changed','AbortError');
  if(IS_BROWSER){const [{videoFile},{decodeVideoFrame}]=await Promise.all([import('../browser/video-storage'),import('../browser/video-decode')]);const file=await videoFile(id,'original');signal.throwIfAborted();return (await decodeVideoFrame(file,index,signal)).cover;}
  const response=await nativeFetch(`/api/videos/${encodeURIComponent(id)}/frame?index=${index}`,{method:'POST',signal});
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.detail||'Video preview failed.');}return sourceBlob(response,signal,8*1024**2);
},{concurrency:1,maxEntries:64,maxBytes:24*1024**2});
registerResourceReset(()=>videoFrames.reset());
export async function videoFrameLease(id:string,index:number){return videoFrames.acquire(JSON.stringify([await displayLibraryId(),id,index]));}
export async function videoURL(asset:VideoAsset,kind:'cover'|'original'){
  if(!IS_BROWSER)return {url:kind==='cover'?asset.cover_url:asset.original_url,release:()=>{}};
  const file=await(await import('../browser/video-storage')).videoFile(asset.id,kind),url=URL.createObjectURL(file);return {url,release:()=>URL.revokeObjectURL(url)};
}
export async function listVideos(page=1):Promise<{items:VideoAsset[];total:number}>{return IS_BROWSER?(await import('../browser/video-storage')).listVideos(page):api('/videos?page='+page);}
export async function removeVideo(id:string){return IS_BROWSER?(await import('../browser/video-storage')).removeVideo(id):api('/videos/'+encodeURIComponent(id),'DELETE');}
export async function importVideoFiles(files:File[]):Promise<Job>{
  if(IS_BROWSER)return (await import('../browser/video-storage')).importVideos(files);
  const body=new FormData();for(const file of files)body.append('files',file,file.name);
  const response=await nativeFetch('/api/videos/upload',{method:'POST',body});const value=await response.json();if(!response.ok)throw new Error(value.detail||'Video import failed.');return value;
}
export function proxyURL(id:string,edge:number,toneMap:boolean){return scopeNativeResult({url:`/api/videos/${encodeURIComponent(id)}/proxy?edge=${edge}&tone_map=${toneMap}`}).url;}
