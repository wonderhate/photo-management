import {inspectMapPack,MapPackError} from '../core/offline-map-pack';
import type {OfflineMapPack,OpenMapPack} from '../core/offline-map-pack';

const DB='photocollection-offline-map-packs',EVENT='photo-offline-map-packs-changed';
function open(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>{request.result.createObjectStore('records',{keyPath:'id'});request.result.createObjectStore('files');};request.onsuccess=()=>resolve(request.result);request.onerror=request.onblocked=()=>reject(new MapPackError('storage'));});}
function done(tx:IDBTransaction){return new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new MapPackError(tx.error?.name==='QuotaExceededError'?'quota':'storage'));});}
function result<T>(request:IDBRequest<T>){return new Promise<T>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new MapPackError('storage'));});}
let channel:BroadcastChannel|undefined;
function changed(){window.dispatchEvent(new Event(EVENT));try{channel??=new BroadcastChannel(DB);channel.postMessage('changed');}catch{/* Local events work in restricted WebViews. */}}
export function watchMapPacks(run:()=>void){window.addEventListener(EVENT,run);let listener:BroadcastChannel|undefined;try{listener=new BroadcastChannel(DB);listener.onmessage=run;}catch{/* See above. */}return()=>{window.removeEventListener(EVENT,run);listener?.close();};}
export async function listMapPacks():Promise<OfflineMapPack[]>{const db=await open();try{return (await result(db.transaction('records').objectStore('records').getAll()) as OfflineMapPack[]).sort((a,b)=>b.installedAt.localeCompare(a.installedAt));}finally{db.close();}}
export async function installMapPack(file:File,signal:AbortSignal){
  const inspected=await inspectMapPack(file);
  const estimate=await navigator.storage?.estimate().catch(()=>({quota:undefined,usage:undefined}));
  if(estimate?.quota&&file.size>estimate.quota-(estimate.usage||0))throw new MapPackError('quota');
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const db=await open();try{
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    const tx=db.transaction(['records','files'],'readwrite'),finish=done(tx),cancel=()=>{try{tx.abort();}catch{/* Already committed. */}};
    signal.addEventListener('abort',cancel,{once:true});
    try{tx.objectStore('records').put(inspected.record);tx.objectStore('files').put(file,inspected.record.id);await finish;}
    catch(error){cancel();await finish.catch(()=>{});throw error instanceof MapPackError?error:new MapPackError(error instanceof DOMException&&error.name==='QuotaExceededError'?'quota':'storage');}
    finally{signal.removeEventListener('abort',cancel);}
  }finally{db.close();}
  changed();return inspected.record;
}
export async function changeMapPack(id:string,enabled:boolean|null){
  const db=await open();try{const tx=db.transaction(['records','files'],'readwrite'),finish=done(tx),store=tx.objectStore('records');
    if(enabled===null){store.delete(id);tx.objectStore('files').delete(id);}
    else {const r=store.get(id);r.onsuccess=()=>{if(r.result)store.put({...r.result,enabled});};}
    await finish;
  }finally{db.close();}changed();
}
export async function openMapPacks():Promise<{packs:OpenMapPack[];unavailable:string[]}>{
  const records=await listMapPacks(),packs:OpenMapPack[]=[],unavailable:string[]=[];
  for(const record of records.filter(r=>r.enabled)){
    try{const db=await open();let blob:Blob|undefined;try{blob=await result(db.transaction('files').objectStore('files').get(record.id));}finally{db.close();}
      if(!blob)throw new MapPackError('missing');
      const inspected=await inspectMapPack(new File([blob],record.filename),record.id);packs.push({record,archive:inspected.archive});
    }catch{unavailable.push(record.name);}
  }
  return {packs,unavailable};
}
