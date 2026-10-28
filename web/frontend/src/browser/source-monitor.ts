import {current,directory,librarySession,sourceHandle,commit} from './storage';
import {getTask,recentTasks} from './task-service';
import type {Job} from '../types';

export type SourceScanState={path:string;source_id?:string;state:'connected'|'disconnected'|'permission'|'partial'|'excluded';checked_at:string;files:number;missing:number;changed:number;removed:number;errors:number};
export type ScanOptions={automatic?:boolean;force?:boolean;accept?:(sourceId:string,path:string,file:File)=>boolean;seen?:(sourceId:string,path:string,file:File)=>void;done?:(success:boolean)=>void;changed?:(sourceId:string)=>void;failed?:(sourceId:string)=>void};
const PERIOD=300_000;
let generation=-1,jobId:string|null=null,lastStarted=0,states:SourceScanState[]=[],known=new Map<string,string>(),starting:Promise<unknown>|null=null;
const fileKey=(id:string,path:string)=>JSON.stringify([id,path]);
const signature=(file:File)=>`${file.size}:${file.lastModified}`;
function sync(){if(generation!==librarySession()){generation=librarySession();jobId=null;lastStarted=0;states=[];known.clear();starting=null;}}
function job(){if(!jobId)return null;try{return getTask(jobId);}catch{return null;}}
export function sourceScanStatus(){sync();return {paths:current().settings.scan_paths||[],job:job(),sources:states,available:current().sources,interval_seconds:PERIOD/1000,event_hints:false,monitoring:document.visibilityState==='visible'};}
export async function configureSourceScan(input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['source_id','enabled'].includes(k)))throw new Error('Invalid source scan setting.');
  const {source_id,enabled}=input as {source_id:unknown;enabled:unknown};
  if(typeof source_id!=='string'||typeof enabled!=='boolean')throw new Error('Invalid source scan setting.');
  await commit(s=>{if(!s.sources.some(source=>source.id===source_id))throw new Error('Unknown source directory.');const token='source:'+source_id;s.settings.scan_paths=(s.settings.scan_paths||[]).filter(p=>p!==token);if(enabled)s.settings.scan_paths.push(token);});
  known.clear();lastStarted=0;return sourceScanStatus();
}
export async function waitForVisible(signal:AbortSignal){
  signal.throwIfAborted();if(document.visibilityState==='visible')return;
  await new Promise<void>((resolve,reject)=>{
    const clear=()=>{document.removeEventListener('visibilitychange',visible);signal.removeEventListener('abort',aborted);};
    const visible=()=>{if(document.visibilityState==='visible'){clear();resolve();}};
    const aborted=()=>{clear();reject(signal.reason);};
    document.addEventListener('visibilitychange',visible);signal.addEventListener('abort',aborted,{once:true});visible();if(signal.aborted)aborted();
  });
}
export async function startSourceScan(force=false){
  sync();if(starting){await starting;return sourceScanStatus();}
  const previous=job();if(previous&&['queued','running'].includes(previous.status)||!force&&Date.now()-lastStarted<60_000||document.visibilityState!=='visible')return sourceScanStatus();
  // Do not enqueue another import while a user's import is registering these paths.
  if((recentTasks() as Job[]).some(j=>j.kind==='import'&&['queued','running'].includes(j.status)))return sourceScanStatus();
  const scope=current().id,base=directory(),session=librarySession(),check=()=>{if(librarySession()!==session||directory()!==base||current().id!==scope)throw new Error('Library changed. Reopen the current library.');};
  const run=async()=>{
    const tokens=(current().settings.scan_paths||[]).filter(p=>p.startsWith('source:')),allowed:string[]=[],next:SourceScanState[]=[],seen=new Map<string,Set<string>>(),pending=new Map<string,string>();
    for(const token of tokens){
      check();const id=token.slice(7),source=current().sources.find(s=>s.id===id);if(!source)continue;
      const h=sourceHandle(id),state:SourceScanState={path:source.name,source_id:id,state:'disconnected',checked_at:new Date().toISOString(),files:0,missing:0,changed:0,removed:0,errors:0};next.push(state);
      if(!h)continue;
      try{state.state=await h.queryPermission({mode:'read'})==='granted'?'connected':'permission';check();if(state.state==='connected'){allowed.push(token);seen.set(id,new Set());}}
      catch{check();state.state='disconnected';}
    }
    check();states=next;lastStarted=Date.now();if(!allowed.length)return;
    const removed=new Set((current().removed_photos||[]).map(r=>fileKey(r.photo.source_id,r.photo.relative_path)));
    const {importSources}=await import('./api');check();
    const result=await importSources(allowed,true,[],{automatic:true,force,
      seen:(id,path,file)=>{check();seen.get(id)?.add(path);const s=next.find(s=>s.source_id===id)!;s.files++;const key=fileKey(id,path);if(removed.has(key))s.removed++;else pending.set(key,signature(file));},
      accept:(id,path,file)=>!removed.has(fileKey(id,path))&&(force||known.get(fileKey(id,path))!==signature(file)),
      changed:id=>{check();const s=next.find(s=>s.source_id===id);if(s)s.changed++;},
      failed:id=>{check();const s=next.find(s=>s.source_id===id);if(s){s.state='partial';s.errors++;}},
      done:success=>{check();for(const s of next){if(s.state!=='connected')continue;s.missing=current().photos.filter(p=>p.source_id===s.source_id&&!p.managed_path&&!seen.get(s.source_id!)?.has(p.relative_path)).length;}if(success)known=pending;states=next;},
    });check();jobId=result.id;
  };
  const active=run();starting=active;
  try{await active;}finally{if(starting===active)starting=null;}
  return sourceScanStatus();
}

/** Only a foreground, open library is scanned; permissions are never requested here. */
export function monitorSources(onJob:(job:Job)=>void){
  let stopped=false;
  const tick=()=>{if(stopped||document.visibilityState!=='visible')return;void startSourceScan().then(value=>{if(!stopped&&value.job)onJob(value.job);}).catch(()=>{/* Reauthorization stays an explicit action in settings. */});};
  const timer=window.setInterval(tick,PERIOD);document.addEventListener('visibilitychange',tick);tick();
  return()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',tick);};
}
