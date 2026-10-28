import {imageHeader} from '../browser/image-header.ts';
import type {DisplayRequest} from './display-request.ts';
import {sourceDecodeProfile} from './source-decode-profile.ts';

export const DISPLAY_DISK_ENTRIES=64,DISPLAY_DISK_BYTES=256*1024*1024,DISPLAY_FILE_BYTES=64*1024*1024;
export const DISPLAY_WORKER_VERSION='pc-edit-v1-libraw-1.6.0-display-2',DISPLAY_NATIVE_VERSION='pc-display-2';
export const DISPLAY_WORKER_NATIVE_VERSION=DISPLAY_WORKER_VERSION+'-native-orientation-1-white';
export function browserDisplayEngine(profile?:unknown){const p=sourceDecodeProfile(profile);return DISPLAY_WORKER_VERSION+(p.version===1?'-black':`-browser-source-v2-${p.extra_orientation}-black`);}
export type DisplayCacheSpec={library:string;request:DisplayRequest;engine:string};
type Meta={key:string;library:string;size:number;sha:string;width:number;height:number;stamp:number};
const stores=['entries','images'];
export function displayCacheKey(spec:DisplayCacheSpec){
  const {library,request:r,engine}=spec;
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(library)||!/^[a-zA-Z0-9-]{1,80}$/.test(r.id)||!/^[a-f0-9]{64}$/.test(r.hash)||![4096,6144].includes(r.edge)||!([DISPLAY_WORKER_VERSION+'-white',DISPLAY_WORKER_VERSION+'-black',DISPLAY_WORKER_NATIVE_VERSION,...Array.from({length:8},(_,i)=>browserDisplayEngine({version:2,extra_orientation:i+1}))].includes(engine)||engine.startsWith(DISPLAY_NATIVE_VERSION+'-')&&/^[a-zA-Z0-9_.-]{1,160}$/.test(engine)))throw new Error('Invalid display cache key.');
  return JSON.stringify([1,library,r.id,r.hash,r.edge,engine]);
}
export function displayEvictions(rows:Pick<Meta,'key'|'size'|'stamp'>[],maxEntries=DISPLAY_DISK_ENTRIES,maxBytes=DISPLAY_DISK_BYTES){
  let bytes=rows.reduce((sum,row)=>sum+Math.max(0,row.size),0),count=rows.length;const remove:string[]=[];
  for(const row of [...rows].sort((a,b)=>a.stamp-b.stamp||a.key.localeCompare(b.key))){if(count<=maxEntries&&bytes<=maxBytes)break;remove.push(row.key);count--;bytes-=Math.max(0,row.size);}
  return remove;
}
async function jpeg(blob:Blob,edge:number){
  if(!blob.size||blob.size>DISPLAY_FILE_BYTES)return null;const bytes=new Uint8Array(await blob.arrayBuffer());
  if(bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)return null;
  let size;try{size=imageHeader(bytes);}catch{return null;}if(!size||Math.max(size.width,size.height)>edge)return null;
  const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');return {...size,sha};
}
function open(){return new Promise<IDBDatabase>((resolve,reject)=>{
  let blocked=false;
  const request=indexedDB.open('photocollection-display-cache',1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('entries',{keyPath:'key'});request.result.createObjectStore('images');};
  request.onsuccess=()=>{if(blocked){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};request.onerror=()=>reject(request.error);request.onblocked=()=>{blocked=true;reject(new Error('Display cache is busy.'));};
});}
async function transaction<T>(mode:IDBTransactionMode,action:(tx:IDBTransaction,result:(value:T)=>void)=>void,signal?:AbortSignal):Promise<T>{
  signal?.throwIfAborted();const db=await open();try{signal?.throwIfAborted();return await new Promise<T>((resolve,reject)=>{
    const tx=db.transaction(stores,mode);let value:T,done=false;const abort=()=>{if(!done)try{tx.abort();}catch{/* Already committed. */}};
    signal?.addEventListener('abort',abort,{once:true});const finish=()=>{done=true;signal?.removeEventListener('abort',abort);};
    tx.oncomplete=()=>{finish();resolve(value);};tx.onabort=()=>{finish();reject(signal?.aborted?signal.reason:tx.error||new Error('Display cache write failed.'));};tx.onerror=()=>{};
    try{action(tx,next=>{value=next;});}catch(error){abort();reject(error);}
  });}finally{db.close();}
}
async function discard(key:string){await transaction<void>('readwrite',tx=>{tx.objectStore('entries').delete(key);tx.objectStore('images').delete(key);});}
// This is a rebuildable, private origin cache, separate from the offline app cache.
// Source bytes must be hash-verified by the caller before any read or publication.
export async function readDisplayCache(spec:DisplayCacheSpec,signal?:AbortSignal):Promise<Blob|null>{
  try{
    const key=displayCacheKey(spec),record=await transaction<{meta?:Meta;blob?:Blob}>('readonly',(tx,result)=>{const value:{meta?:Meta;blob?:Blob}={};tx.objectStore('entries').get(key).onsuccess=event=>{value.meta=(event.target as IDBRequest<Meta>).result;};tx.objectStore('images').get(key).onsuccess=event=>{value.blob=(event.target as IDBRequest<Blob>).result;};result(value);},signal);
    signal?.throwIfAborted();const {meta,blob}=record;if(!meta||!blob)return null;
    const checked=blob instanceof Blob&&blob.size===meta.size&&meta.library===spec.library?await jpeg(blob,spec.request.edge):null;signal?.throwIfAborted();
    if(!checked||checked.sha!==meta.sha||checked.width!==meta.width||checked.height!==meta.height){await discard(key);return null;}
    try{await transaction<void>('readwrite',tx=>{const store=tx.objectStore('entries');store.get(key).onsuccess=event=>{const latest=(event.target as IDBRequest<Meta>).result;if(latest?.sha===meta.sha)store.put({...latest,stamp:Date.now()});};},signal);}catch{signal?.throwIfAborted();}return blob;
  }catch(error){signal?.throwIfAborted();return null;}
}
export async function writeDisplayCache(spec:DisplayCacheSpec,blob:Blob,signal?:AbortSignal){
  try{
    const key=displayCacheKey(spec),checked=await jpeg(blob,spec.request.edge);signal?.throwIfAborted();if(!checked)return;
    const meta:Meta={key,library:spec.library,size:blob.size,...checked,stamp:Date.now()};
    await transaction<void>('readwrite',tx=>{const entries=tx.objectStore('entries'),images=tx.objectStore('images');entries.put(meta);images.put(blob,key);entries.getAll().onsuccess=event=>{const rows=(event.target as IDBRequest<Meta[]>).result;for(const stale of displayEvictions(rows)){entries.delete(stale);images.delete(stale);}};},signal);
  }catch(error){signal?.throwIfAborted();/* A denied/full/unsupported cache must not hide a valid preview. */}
}
export async function displayCacheStatus(library:string){
  try{return await transaction<{available:boolean;entries:number;bytes:number;maxEntries:number;maxBytes:number}>('readonly',(tx,result)=>{tx.objectStore('entries').getAll().onsuccess=event=>{const rows=(event.target as IDBRequest<Meta[]>).result.filter(row=>row.library===library);result({available:true,entries:rows.length,bytes:rows.reduce((sum,row)=>sum+row.size,0),maxEntries:DISPLAY_DISK_ENTRIES,maxBytes:DISPLAY_DISK_BYTES});};});}
  catch{return {available:false,entries:0,bytes:0,maxEntries:DISPLAY_DISK_ENTRIES,maxBytes:DISPLAY_DISK_BYTES};}
}
export async function clearDisplayCache(library:string){
  await transaction<void>('readwrite',tx=>{const entries=tx.objectStore('entries'),images=tx.objectStore('images');entries.getAll().onsuccess=event=>{for(const row of (event.target as IDBRequest<Meta[]>).result)if(row.library===library){entries.delete(row.key);images.delete(row.key);}};});
}
