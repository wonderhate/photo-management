import {existingPhotoSource} from './storage';
import {current,directory,librarySession,commit,writeFile,localFile,original,uid,now,assertCurrentRevision,runLibraryLock} from './storage';
import type {LocalEdit,LocalPhoto} from './storage';
import type {EditRecipe} from './editing';
import {validateRecipe} from './editing';
import {processImage} from './images';
import {sourceDecodeProfile} from '../core/source-decode-profile';
import type {SourceDecodeProfile} from '../core/source-decode-profile';
import {validateEditLineageGraph} from '../core/edit-lineage-graph';
import {sameSplitValue} from '../core/split-record';
import type {EditRecord} from '../core/editor-adapter';
export async function hashFile(file:Blob){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');}
export function editScope(){const base=directory(),id=current().id,generation=librarySession();return {base,id,check:()=>{if(librarySession()!==generation||directory()!==base||current().id!==id)throw new Error('Library changed. Reopen the current library.');}};}
export async function saveEdit(file:File,recipe:EditRecipe,photoId:string|null,id?:string,profile?:SourceDecodeProfile,expectedRevision?:number):Promise<LocalEdit>{
  validateRecipe(recipe);recipe=structuredClone(recipe);const scope=editScope(),editId=id||uid();return runLibraryLock('photocollection-edit:'+scope.id+':'+editId,async()=>{
    scope.check();await assertCurrentRevision();scope.check();const previous=current().edits?.find(e=>e.id===editId),hash=await hashFile(file),decode_profile=sourceDecodeProfile(profile??previous?.decode_profile);scope.check();
    if(id&&!previous)throw new Error('Record not found.');
    if(previous&&previous.recipe.version>=3&&recipe.version<previous.recipe.version)throw new Error('Text edits require a compatible editor.');
    if(previous&&expectedRevision!==undefined&&(previous.revision??0)!==expectedRevision)throw new Error('This work changed in another window. Reopen it before editing.');
    if(previous&&previous.source_hash!==hash)throw new Error('The source photo changed. Reopen it before saving.');
    if(previous&&JSON.stringify(sourceDecodeProfile(previous.decode_profile))!==JSON.stringify(decode_profile))throw new Error('The source decoding profile cannot change. Reopen the saved edit.');
    // A File retained by the editor can outlive a changed file on disk. Check
    // the authoritative linked source too, not only private source snapshots.
    if(previous)await editSource(previous);
    const linked=previous?previous.photo_id:photoId;
    if(linked&&!previous&&current().photos.find(p=>p.id===linked)?.file_hash!==hash)throw new Error('The source photo changed. Reopen it before saving.');
    if(linked&&!previous){const source=existingPhotoSource(linked);if(!source||await hashFile(await original(source))!==hash)throw new Error('The source photo changed. Reopen it before saving.');scope.check();}
    const sourcePath=previous?.source_path||(linked?undefined:`drafts/edits/${editId}/source.${file.name.split('.').pop()?.replace(/[^a-z0-9]/gi,'')||'bin'}`);
    let parent:FileSystemDirectoryHandle|undefined,owned=false,published=false;
    try{
      if(sourcePath&&!previous){
        scope.check();parent=await(await scope.base.getDirectoryHandle('drafts',{create:true})).getDirectoryHandle('edits',{create:true});scope.check();
        try{await parent.getDirectoryHandle(editId);throw new Error('This work changed in another window. Reopen it before editing.');}catch(e){if(!(e instanceof DOMException)||e.name!=='NotFoundError')throw e;}
        const folder=await parent.getDirectoryHandle(editId,{create:true});owned=true;scope.check();await writeFile(sourcePath.split('/').at(-1)!,file,folder);
      }
      scope.check();const record:LocalEdit={id:editId,photo_id:linked,source_path:sourcePath,source_name:file.name,source_hash:hash,decode_profile,recipe,revision:(previous?.revision??0)+1,updated_at:now()};
      await commit(s=>{
        scope.check();const latest=s.edits?.find(e=>e.id===editId);
        if(previous&&(!latest||(latest.revision??0)!==(previous.revision??0)||latest.source_hash!==hash))throw new Error('This work changed in another window. Reopen it before editing.');
        // Metadata-only changes such as a detached photo or view preference
        // can arrive while hashing. Preserve those fields at publication.
        if(latest){record.photo_id=latest.photo_id;record.source_path=latest.source_path??sourcePath;if(latest.view_preferences)record.view_preferences=latest.view_preferences;if(latest.derived_from)record.derived_from=structuredClone(latest.derived_from);}
        s.edits=[record,...(s.edits||[]).filter(e=>e.id!==editId)];
      });published=true;return record;
    }finally{if(owned&&!published){let absent=false;try{const disk=JSON.parse(await(await localFile('library.json',scope.base)).text());absent=Array.isArray(disk.edits)&&!disk.edits.some((e:{id:string})=>e.id===editId);}catch{/* Keep uncertain snapshots for recovery. */}if(absent)await parent!.removeEntry(editId,{recursive:true}).catch(()=>{});}}
  });
}
export async function getEditRecord(id:string){const scope=editScope();await assertCurrentRevision();scope.check();validateEditLineageGraph(current().edits||[],current().splits||[]);const record=current().edits?.find(e=>e.id===id);if(!record)throw new Error('Record not found.');return structuredClone(record);}
export async function editSource(edit:LocalEdit){
  validateEditLineageGraph(current().edits||[],current().splits||[]);
  const scope=editScope(),stored=current().edits?.find(e=>e.id===edit.id);if(!stored)throw new Error('Record not found.');
  if(stored.source_hash!==edit.source_hash||JSON.stringify(sourceDecodeProfile(stored.decode_profile))!==JSON.stringify(sourceDecodeProfile(edit.decode_profile)))throw new Error('The source photo changed. Reopen it before saving.');
  const p=existingPhotoSource(stored.photo_id||''),file=stored.source_path?await localFile(stored.source_path,scope.base):p?await original(p):null;scope.check();
  if(!file)throw new Error('Record not found.');if(await hashFile(file)!==stored.source_hash)throw new Error('The source photo changed. Reopen it before saving.');scope.check();return new File([file],stored.source_name,{type:file.type});
}
export async function saveDerivative(blob:Blob,name:string,sourcePhotoId:string|null,record?:EditRecord):Promise<LocalPhoto>{
  const scope=editScope(),frozen=record?structuredClone(record):undefined;
  const ensure=()=>{scope.check();if(!frozen)return;validateEditLineageGraph(current().edits||[],current().splits||[]);const latest=current().edits?.find(e=>e.id===frozen.id);if(!latest||latest.revision!==frozen.revision||latest.source_hash!==frozen.source_hash||!sameSplitValue(latest.recipe,frozen.recipe)||!sameSplitValue(latest.derived_from,frozen.derived_from))throw new Error('This work changed in another window. Reopen it before editing.');};
  const run=async()=>{
    await assertCurrentRevision();ensure();const id=uid(),ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg',file=new File([blob],name.replace(/\.[^.]+$/,'')+'-edited.'+ext,{type:blob.type});
    const result=await processImage<any>('analyze',{file});ensure();const path=`photos/${id}-edited.${ext}`,source=existingPhotoSource(sourcePhotoId||'');
    const p:LocalPhoto={...result.metadata,id,capture_group_id:id,source_id:scope.id,relative_path:path,managed_path:path,decode_profile:{version:2,extra_orientation:1},file_hash:result.digest,file_name:file.name,file_path:path,file_format:ext.toUpperCase(),is_raw:false,file_size:blob.size,width:result.width,height:result.height,created_at:now(),favorite:false,rating:null,color_label:null,tags:[],files:[],thumbnail_url:'',preview_url:'',thumbnail_path:null,preview_error:null};
    if(source)for(const key of ['camera_make','camera_model','lens_model','date_taken','f_number','exposure_time','exposure_seconds','iso','focal_length','focal_length_35mm'] as const)(p as any)[key]=source[key];
    if(frozen){p.asset_origin={version:1,document_id:frozen.id,document_revision:frozen.revision!,source_hash:frozen.source_hash,recipe:frozen.recipe,decode_profile:sourceDecodeProfile(frozen.decode_profile)};if(frozen.derived_from||frozen.recipe.version>=3)p.edit_origin={version:frozen.recipe.version>=3?2:1,document_id:frozen.id,document_revision:frozen.revision!,source_hash:frozen.source_hash,recipe:frozen.recipe,...(frozen.derived_from?{derived_from:frozen.derived_from}:{})} as LocalPhoto['edit_origin'];}
    p.files=[{id,file_name:file.name,file_format:p.file_format,is_raw:false,file_path:path,preview_available:true}];
    const folder=await scope.base.getDirectoryHandle('photos',{create:true}),owned:{name:string;handle:FileSystemFileHandle;hash:string}[]=[];let published=false;
    try{
      for(const [name,data] of [[`${id}-edited.${ext}`,blob],[`${id}-thumb.jpg`,result.thumbnail],[`${id}-preview.jpg`,result.preview]] as [string,Blob][]){
        ensure();try{await folder.getFileHandle(name);throw new Error('Output file already exists.');}catch(e){if(!(e instanceof DOMException)||e.name!=='NotFoundError')throw e;}
        const hash=await hashFile(data);ensure();const handle=await folder.getFileHandle(name,{create:true});owned.push({name,handle,hash});ensure();await writeFile(name,data,folder);
      }
      for(const entry of owned){ensure();if(await hashFile(await entry.handle.getFile())!==entry.hash)throw new Error('The saved output changed before completion.');}
      await commit(s=>{ensure();s.photos.push(p);});published=true;scope.check();return p;
    }finally{let absent=false;if(!published)try{const disk=JSON.parse(await(await localFile('library.json',scope.base)).text());absent=Array.isArray(disk.photos)&&!disk.photos.some((p:{id:string})=>p.id===id);}catch{/* Preserve uncertain output files for recovery. */}if(!published&&absent)for(const entry of owned)try{const handle=await folder.getFileHandle(entry.name),file=await handle.getFile();if(await handle.isSameEntry(entry.handle)&&(file.size===0||await hashFile(file)===entry.hash))await folder.removeEntry(entry.name);}catch{/* Keep files whose ownership cannot be confirmed. */}}
  };
  return frozen?runLibraryLock('photocollection-edit:'+scope.id+':'+frozen.id,run):run();
}
