import {TagIndex,validateTagOptions} from '../core/tag-index';
import type {TagOptions,TagPage,TagRow} from '../core/tag-index';
import {registerResourceReset} from '../core/resource-lifecycle';
import {current,directory,librarySession} from './storage';
type Pending={resolve:(v:any)=>void;reject:(e:Error)=>void;cleanup:()=>void};
let worker:Worker|null=null,fallback:TagIndex|null=null,sequence=0,stamp='',ready:Promise<unknown>|undefined;
const pending=new Map<number,Pending>();
export function resetTagIndex(){worker?.terminate();worker=null;fallback=null;stamp='';ready=undefined;for(const p of pending.values()){p.cleanup();p.reject(new DOMException('Library changed','AbortError'));}pending.clear();}
registerResourceReset(resetTagIndex);
function failWorker(){worker?.terminate();worker=null;for(const p of pending.values()){p.cleanup();p.reject(new Error('Tag index is not ready.'));}pending.clear();}
function request(action:string,payload:object,signal?:AbortSignal):Promise<any>{
  signal?.throwIfAborted();return new Promise((resolve,reject)=>{
    if(!worker)return reject(new Error('Tag index is not ready.'));if(pending.size>=32)return reject(new Error('Tag index is busy. Try again.'));
    const id=++sequence,abort=()=>{const p=pending.get(id);if(p){p.cleanup();pending.delete(id);reject(signal?.reason||new DOMException('Cancelled','AbortError'));}},timer=setTimeout(failWorker,15000),cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});try{worker.postMessage({id,action,...payload});}catch(e){cleanup();pending.delete(id);reject(e);}
  });
}
export async function tagOptions(options:TagOptions,signal?:AbortSignal):Promise<TagPage>{
  validateTagOptions(options);signal?.throwIfAborted();const snapshot=current(),base=directory(),generation=librarySession(),key=snapshot.id+':'+generation+':'+snapshot.revision;
  const check=()=>{signal?.throwIfAborted();if(librarySession()!==generation||directory()!==base||current()!==snapshot)throw new DOMException('Library changed','AbortError');};
  if(stamp!==key){
    resetTagIndex();stamp=key;const rows:TagRow[]=snapshot.photos.map(p=>({id:p.id,tags:p.tags,tag_origins:p.tag_origins}));
    try{
      const own=new Worker(new URL('./tag-worker.ts',import.meta.url),{type:'module'});worker=own;
      own.onmessage=({data})=>{if(worker!==own)return;const p=pending.get(data.id);if(!p)return;p.cleanup();pending.delete(data.id);if(data.error)p.reject(new Error(data.error));else p.resolve(data.result);};own.onerror=e=>{e.preventDefault();if(worker===own)failWorker();};own.onmessageerror=()=>{if(worker===own)failWorker();};ready=request('build',{rows});
    }catch{fallback=new TagIndex(rows);ready=Promise.resolve();}
  }
  // A cancelled reader does not cancel a shared build needed by another reader.
  try{await ready;check();const result=fallback?fallback.query(options):await request('query',{options},signal);check();return result;}
  catch(e){
    check();if(stamp!==key||worker)throw e;
    // Loading/CSP errors and a crashed worker must preserve the previous metadata-only feature.
    fallback??=new TagIndex(snapshot.photos.map(p=>({id:p.id,tags:p.tags,tag_origins:p.tag_origins})));ready=Promise.resolve();return fallback.query(options);
  }
}
