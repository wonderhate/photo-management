import {current,sourceHandle,localFile,now,librarySession,original,commit} from './storage';
import type {Directory} from './storage';
import {launchTask} from './task-service';
import {processImage} from './images';
import {sourceHash} from '../core/editor-adapter';
import {isRawFile} from './raw-file';
import {validateRawSource,validateRawRelation,rawCandidate,rawConfirmation} from '../core/raw-source';
import type {RawSource,RawRelation} from '../core/raw-source';

export function registerRawSources(values:unknown){
  if(!Array.isArray(values)||!values.length||values.length>20||values.some(v=>typeof v!=='string'||!/^source:[a-zA-Z0-9-]{1,80}$/.test(v)))throw new Error('Choose a RAW source folder.');
  const handles=[...new Set(values as string[])].map(v=>{const id=v.slice(7),handle=sourceHandle(id);if(!handle)throw new Error('Reconnect the original photo directory in local library settings.');return {id,handle};});
  return launchTask('raw-source-index',async context=>{
    const job=context.job;job.phase='scanning';let pending:RawSource[]=[];
    const flush=async(allowCancelled=false)=>{if(!pending.length)return;const batch=pending;await context.commit(s=>{const map=new Map((s.raw_sources||[]).map(r=>[r.id,r]));for(const r of batch)map.set(r.id,r);s.raw_sources=[...map.values()];},allowCancelled);pending=[];};
    async function* walk(dir:Directory,prefix=''):AsyncGenerator<{path:string;file:File}>{for await(const entry of dir.values()){context.check();const path=prefix+entry.name;if(entry.kind==='directory')yield* walk(await dir.getDirectoryHandle(entry.name) as Directory,path+'/');else if(isRawFile(entry.name))yield {path,file:await(await dir.getFileHandle(entry.name)).getFile()};}}
    try{for(const {id,handle} of handles){
      context.check();if(await handle.queryPermission({mode:'read'})!=='granted')throw new Error('Read permission was not granted.');
      for await(const {path,file} of walk(handle)){
        context.check();job.current=file.name;job.total++;
        try{
          if(file.size>256*1024*1024)throw new Error('Photo exceeds the 256 MiB browser import limit.');
          const result=await processImage<{digest:string;metadata:Record<string,string|null>}>('metadata',{file},context.signal);context.check();
          const after=await localFile(path,handle);if(await sourceHash(after)!==result.digest)throw new Error('RAW source or photo changed. Reload before confirming.');context.check();
          const record:RawSource={version:1,id:result.digest,file_hash:result.digest,file_name:file.name,file_size:file.size,path,source_id:id,date_taken:result.metadata.date_taken||null,camera_make:result.metadata.camera_make||null,camera_model:result.metadata.camera_model||null,lens_model:result.metadata.lens_model||null,registered_at:now()};validateRawSource(record);
          const old=current().raw_sources?.find(r=>r.id===record.id);
          if(old&&old.path===path&&old.source_id===id)job.skipped++;else{pending.push(record);job.success++;}
          if(pending.length>=16)await flush();
        }catch(e){context.check();job.failed++;if(job.errors.length<20)job.errors.push(file.name+': '+(e instanceof Error?e.message:'RAW registration failed.'));}
        job.processed++;await context.checkpoint();
      }
    }await flush();}finally{await flush(true);job.current='';}
  });
}
export function rawSuggestions(id:string,search='',page=1,pageSize=20){
  if(search.length>512||!Number.isSafeInteger(page)||page<1||page>50000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new Error('Invalid RAW source query.');
  const s=current(),photo=s.photos.find(p=>p.id===id);if(!photo)throw new Error('Photo record no longer exists.');
  const record=s.raw_relations?.find(r=>r.photo_id===id)||null,linked=record?.raw_id?s.raw_sources?.find(r=>r.id===record.raw_id)||null:null;
  const q=search.toLowerCase(),ranked=(s.raw_sources||[]).filter(r=>r.file_hash!==photo.file_hash&&(!q||(r.file_name+' '+r.path).toLowerCase().includes(q))).map(r=>rawCandidate(photo,r)).sort((a,b)=>b.score-a.score||(a.source.id<b.source.id?-1:1));
  return {photo_hash:photo.file_hash,record,linked,candidates:ranked.slice((page-1)*pageSize,page*pageSize),total:ranked.length,page,page_size:pageSize};
}
export async function confirmRawSource(id:string,input:unknown){
  const value=rawConfirmation(input),snapshot=current(),generation=librarySession(),photo=snapshot.photos.find(p=>p.id===id),source=value.raw_id?snapshot.raw_sources?.find(r=>r.id===value.raw_id):null;
  const conflict=()=>new Error('RAW source or photo changed. Reload before confirming.');
  if(!photo||photo.is_raw||photo.file_hash!==value.photo_hash||value.raw_id===photo.file_hash||value.raw_id&&!source)throw conflict();
  const check=()=>{if(current().id!==snapshot.id||librarySession()!==generation)throw new Error('Library changed. Reopen the current library.');};
  if(source&&await sourceHash(await original(photo))!==value.photo_hash)throw conflict();check();
  if(source){const handle=source.source_id?sourceHandle(source.source_id):null;if(!handle)throw new Error('Reconnect the original photo directory in local library settings.');if(await sourceHash(await localFile(source.path,handle))!==source.file_hash)throw conflict();check();}
  let saved:RawRelation|null=null;
  await commit(library=>{
    check();const currentPhoto=library.photos.find(p=>p.id===id),previous=library.raw_relations?.find(r=>r.photo_id===id),raw=source?library.raw_sources?.find(r=>r.id===source.id):null;
    if(!currentPhoto||currentPhoto.file_hash!==value.photo_hash||(previous?.revision||0)!==value.expected_revision||source&&(!raw||raw.path!==source.path||raw.source_id!==source.source_id))throw conflict();
    saved={version:1,photo_id:id,photo_hash:value.photo_hash,revision:value.expected_revision+1,raw_id:value.raw_id,confirmed_at:now()};validateRawRelation(saved);
    library.raw_relations=[...(library.raw_relations||[]).filter(r=>r.photo_id!==id),saved];
  });check();return saved;
}
