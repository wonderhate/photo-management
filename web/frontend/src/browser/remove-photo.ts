import type {Library} from './storage';
import {captures} from './capture-groups.ts';

/** Archive records and preserve their relations. This module never touches files. */
export function removePhotoRecords(library:Library,id:string,scope:string='capture'){
  if(scope!=='capture'&&scope!=='file')throw new Error('Invalid photo scope.');
  const index=captures(library.photos),photo=index.byId.get(id);
  if(!photo)throw new Error('Record not found.');
  const ids=scope==='capture'?index.idsForGroups([id]):new Set([id]),removed_at=new Date().toISOString();
  library.removed_photos=[...(library.removed_photos||[]),...library.photos.filter(p=>ids.has(p.id)).map(photo=>({photo,removed_at}))];
  library.photos=library.photos.filter(p=>!ids.has(p.id));
  // Keep album order, covers, showcase selections, drafts and source relations.
  return ids.size;
}

export function removedPhotoPage(library:Library,page=1,pageSize=40){
  if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new Error('Invalid removal history page.');
  const rows=[...(library.removed_photos||[])].sort((a,b)=>b.removed_at.localeCompare(a.removed_at)||a.photo.id.localeCompare(b.photo.id));
  return {total:rows.length,page,page_size:pageSize,items:rows.slice((page-1)*pageSize,page*pageSize).map(({photo:p,removed_at})=>({id:p.id,file_name:p.file_name,file_path:p.file_path,file_hash:p.file_hash,capture_group_id:p.capture_group_id,removed_at}))};
}

export function restorePhotoRecords(library:Library,value:unknown){
  if(!Array.isArray(value)||!value.length||value.length>1000||value.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))||new Set(value).size!==value.length)throw new Error('Invalid removal history selection.');
  const ids=new Set<string>(value),active=new Map(library.photos.map(p=>[p.id,p])),archived=new Map((library.removed_photos||[]).map(r=>[r.photo.id,r.photo]));
  if(value.some(id=>!active.has(id)&&!archived.has(id)))throw new Error('Removed photo record no longer exists.');
  const restored=value.filter(id=>!active.has(id)).map(id=>archived.get(id)!);
  const destinations=new Set(library.photos.map(p=>JSON.stringify([p.source_id,p.managed_path||p.relative_path]))),hashes=new Set(library.photos.map(p=>p.file_hash));
  for(const photo of restored){
    const path=JSON.stringify([photo.source_id,photo.managed_path||photo.relative_path]);
    if(destinations.has(path)||hashes.has(photo.file_hash))throw new Error('The original path is occupied by another photo record. No records were restored.');
    destinations.add(path);hashes.add(photo.file_hash);
  }
  library.photos=[...library.photos,...restored];library.removed_photos=(library.removed_photos||[]).filter(r=>!ids.has(r.photo.id));
  return {restored:restored.length,originals_untouched:true};
}
