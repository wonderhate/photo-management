import {VISUAL_ENGINE,VisualHashIndex} from '../core/visual-hash';
import type {VisualFingerprint,StoredFingerprint} from '../core/visual-hash';
import {current,librarySession,localFile,original} from './storage';
import type {LocalPhoto,Library} from './storage';
import {captures} from './capture-groups';
import {launchTask} from './task-service';
import {processImage} from './images';
import {sourceHash} from '../core/editor-adapter';
import type {Job} from '../types';

const signature=(file:File)=>file.size+':'+file.lastModified;
const previewPath=(photo:LocalPhoto)=>`photos/${photo.id}-preview.jpg`;
let admission:{scope:string;promise:Promise<Job>}|undefined;
const cached=new WeakMap<StoredFingerprint[],{byId:Map<string,StoredFingerprint>;tree?:VisualHashIndex}>();
export function appearanceRecords(library:Library){
  const records=library.visual_fingerprints||[];let result=cached.get(records);
  if(!result){const byId=new Map(records.map(record=>[record.photo_id,record]));result={byId};cached.set(records,result);}return result;
}
const registered=(photo:LocalPhoto,record?:StoredFingerprint):record is StoredFingerprint=>!!record&&record.engine===VISUAL_ENGINE&&record.source_hash===photo.file_hash;
export async function analysisFor(id:string){
  const library=current(),generation=librarySession(),index=captures(library.photos),photo=index.byId.get(id);if(!photo)throw new Error('Photo record no longer exists.');
  const representative=index.preferred.get(photo.capture_group_id||photo.id)!,record=appearanceRecords(library).byId.get(representative.id);
  if(registered(representative,record)){try{const [source,preview]=await Promise.all([original(representative),localFile(previewPath(representative))]);if(generation===librarySession()&&current().id===library.id&&signature(source)===record.source_signature&&signature(preview)===record.preview_signature)return {indexed:true,engine:record.engine,palette:record.palette,contrast:record.contrast};}catch{}}return {indexed:false,palette:[]};
}
export function colorCaptureIds(library:Library,color:string){
  const records=appearanceRecords(library).byId;
  return new Set(captures(library.photos).representatives().filter(p=>{const record=records.get(p.id);return registered(p,record)&&record.palette.includes(color);}).map(p=>p.capture_group_id||p.id));
}

export function startAppearanceIndex():Promise<Job>{
  const scope=current().id+':'+librarySession();if(admission?.scope===scope)return admission.promise;
  const active=current().jobs.find(job=>job.kind==='appearance-index'&&!job.parent_id&&['queued','running'].includes(job.status));if(active)return Promise.resolve(active);
  const promise=launchTask('appearance-index',async context=>{
    const photos=captures(current().photos).representatives(),saved=appearanceRecords(current()).byId,job=context.job;job.total=photos.length;
    let pending:StoredFingerprint[]=[];
    const flush=async(allowCancelled=false)=>{if(!pending.length)return;const batch=pending;let published=0,skipped=0;await context.commit(library=>{
      const currentPhotos=new Map(library.photos.map(p=>[p.id,p])),records=new Map((library.visual_fingerprints||[]).map(record=>[record.photo_id,record]));
      for(const record of batch)if(currentPhotos.get(record.photo_id)?.file_hash===record.source_hash){records.set(record.photo_id,record);published++;}else skipped++;
      library.visual_fingerprints=[...records.values()];
    },allowCancelled);pending=[];job.success+=published;job.skipped+=skipped;};
    await context.checkpoint(true);
    try{for(const photo of photos){
      context.check();job.current=photo.file_name;
      try{
        const source=await context.original(photo),preview=await context.file(previewPath(photo)),preview_hash=await sourceHash(preview);
        const previous=saved.get(photo.id);
        if(registered(photo,previous)&&previous.source_signature===signature(source)&&previous.preview_hash===preview_hash&&previous.preview_signature===signature(preview)){job.skipped++;}
        else{
          const result=await processImage<VisualFingerprint>('visual-fingerprint',{file:preview},context.signal);context.check();
          const after=await context.original(photo),afterPreview=await context.file(previewPath(photo));
          if(signature(after)!==signature(source)||await sourceHash(afterPreview)!==preview_hash)throw new Error('Photo changed during appearance analysis.');
          pending.push({...result,photo_id:photo.id,source_hash:photo.file_hash,source_signature:signature(source),preview_hash,preview_signature:signature(afterPreview)});
        }
      }catch(error){context.check();job.failed++;if(job.errors.length<20)job.errors.push(photo.file_name+': '+(error instanceof Error?error.message:'Appearance analysis failed.'));}
      job.processed++;if(pending.length>=16)await flush();await context.checkpoint();
    }await flush();}finally{await flush(true);job.current='';}
  });
  admission={scope,promise};void promise.finally(()=>{if(admission?.promise===promise)admission=undefined;}).catch(()=>{});return promise;
}

export async function appearance(id:string,distance=6,limit=60,signal?:AbortSignal){
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error('Invalid similarity result limit.');
  const library=current(),generation=librarySession(),index=captures(library.photos),photo=index.byId.get(id);
  if(!photo)throw new Error('Photo record no longer exists.');
  const source=index.preferred.get(photo.capture_group_id||photo.id)!,cache=appearanceRecords(library),record=cache.byId.get(source.id);
  const unchanged=async(p:LocalPhoto,record:StoredFingerprint)=>{
    signal?.throwIfAborted();try{const [source,preview]=await Promise.all([original(p),localFile(previewPath(p))]);return signature(source)===record.source_signature&&signature(preview)===record.preview_signature;}catch{return false;}
  };
  if(!registered(source,record)||!await unchanged(source,record))throw new Error('Build the local appearance index before searching this photo.');
  const candidates: (LocalPhoto&{appearance_distance:number})[]=[];
  cache.tree??=new VisualHashIndex([...cache.byId.values()].map(item=>({id:item.photo_id,phash:item.phash})));
  for(const match of cache.tree.candidates(record.phash,distance)){
    signal?.throwIfAborted();if(match.id===source.id)continue;
    const p=index.byId.get(match.id),candidate=cache.byId.get(match.id);
    if(!p||index.preferred.get(p.capture_group_id||p.id)?.id!==p.id||!registered(p,candidate)||!await unchanged(p,candidate))continue;
    candidates.push({...p,appearance_distance:match.distance});if(candidates.length===limit)break;
  }
  signal?.throwIfAborted();if(librarySession()!==generation||current().id!==library.id)throw new Error('Library changed. Reopen the current library.');
  return {mode:'appearance',engine:VISUAL_ENGINE,distance,indexed:cache.byId.size,verified_with_clip:false,low_information:record.contrast<2,source_id:source.id,candidates};
}

export async function appearanceGroups(after='',distance=6,limit=12,signal?:AbortSignal){
  if(!Number.isInteger(distance)||distance<0||distance>16)throw new Error('Invalid appearance distance.');
  if(!Number.isSafeInteger(limit)||limit<1||limit>20||after.length>80)throw new Error('Invalid similarity result limit.');
  const library=current(),generation=librarySession(),photos=captures(library.photos).representatives(),byId=new Map(photos.map(p=>[p.id,p])),cache=appearanceRecords(library);
  cache.tree??=new VisualHashIndex([...cache.byId.values()].map(item=>({id:item.photo_id,phash:item.phash})));
  const ids=photos.filter(p=>registered(p,cache.byId.get(p.id))).map(p=>p.id).filter(id=>id>after).sort(),groups:{source:LocalPhoto;candidates:(LocalPhoto&{appearance_distance:number})[];candidate_count:number;low_information:boolean}[]=[];
  const checks=new Map<string,Promise<boolean>>();
  const valid=(id:string)=>{if(!checks.has(id))checks.set(id,(async()=>{const p=byId.get(id),record=cache.byId.get(id);if(!p||!registered(p,record))return false;try{const [source,preview]=await Promise.all([original(p),localFile(previewPath(p))]);return signature(source)===record.source_signature&&signature(preview)===record.preview_signature;}catch{return false;}})());return checks.get(id)!;};
  let cursor=after;
  for(const id of ids.slice(0,300)){
    signal?.throwIfAborted();cursor=id;if(!await valid(id))continue;
    const record=cache.byId.get(id)!,matches=cache.tree.candidates(record.phash,distance).filter(item=>item.id>id&&byId.has(item.id)),candidates:(LocalPhoto&{appearance_distance:number})[]=[];
    for(const match of matches){signal?.throwIfAborted();if(await valid(match.id))candidates.push({...byId.get(match.id)!,appearance_distance:match.distance});if(candidates.length===8)break;}
    if(candidates.length)groups.push({source:byId.get(id)!,candidates,candidate_count:matches.length,low_information:record.contrast<2});
    if(groups.length===limit)break;
  }
  signal?.throwIfAborted();if(generation!==librarySession()||current().id!==library.id)throw new Error('Library changed. Reopen the current library.');
  return {indexed:photos.filter(p=>registered(p,cache.byId.get(p.id))).length,groups,next_cursor:cursor,has_more:!!ids.length&&cursor<ids.at(-1)!};
}
