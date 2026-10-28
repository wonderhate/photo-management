import {current,directory,librarySession,original,localFile,sourceHandle,commit} from './storage';
import type {Directory,LocalPhoto} from './storage';
import {processImage} from './images';
import {sourceHash} from '../core/editor-adapter';
import {supplementMetadata} from '../core/metadata';
import type {PhotoMetadata} from '../core/metadata';
import {externalRating,ratingProtected} from '../core/photo-rating';
import {parseXmp,readXmp,XmpIndex} from './xmp';
import type {XmpFile} from './xmp';

async function candidates(photo:LocalPhoto):Promise<XmpFile[]>{
  if(photo.managed_path)return Promise.all((photo.metadata_sidecars||[]).filter(ref=>ref.managed_path).map(async ref=>{
    const file=await localFile(ref.managed_path!);if(await sourceHash(file)!==ref.sha256)throw new Error('Invalid metadata sidecar.');
    return {file,path:ref.relative_path,sourceId:ref.source_id,read:async()=>file};
  }));
  const root=sourceHandle(photo.source_id);if(!root)throw new Error('Reconnect the original directory in local library settings.');
  const parts=photo.relative_path.split('/'),name=parts.pop()!,prefix=parts.length?parts.join('/')+'/':'';let parent:FileSystemDirectoryHandle=root;
  for(const part of parts)parent=await parent.getDirectoryHandle(part);
  const index=new XmpIndex();
  for await(const entry of (parent as Directory).values()){
    if(entry.kind!=='file')continue;
    if(entry.name.toLowerCase()===name.toLowerCase())index.addPhoto(photo.source_id,prefix+entry.name);
    if(/\.xmp$/i.test(entry.name)){const path=prefix+entry.name;index.add({file:new File([],entry.name),path,sourceId:photo.source_id,read:()=>localFile(path,root)});}
  }
  return index.forPhoto(photo.source_id,photo.relative_path);
}

export async function refreshExternalRating(photo:LocalPhoto){
  const base=directory(),generation=librarySession(),library=current().id,previous=[photo.rating,photo.rating_source];
  const check=()=>{if(directory()!==base||librarySession()!==generation||current().id!==library)throw new Error('Library changed. Reopen the current library.');};
  const file=await original(photo);check();
  const metadata=await processImage<{digest:string;metadata:PhotoMetadata;embeddedXmp?:string}>('metadata',{file});check();
  if(metadata.digest!==photo.file_hash)throw new Error('原片内容已变化，未刷新评分');
  let values=metadata.metadata;const embedded=metadata.embeddedXmp?parseXmp(metadata.embeddedXmp):null;
  if(embedded)values=supplementMetadata(values,embedded,'xmp-embedded');
  const tags:Record<string,unknown>={};
  for(const candidate of await candidates(photo)){check();const record=await readXmp(candidate,check);if(record)Object.assign(tags,record.tags);}
  values=supplementMetadata(values,tags,'xmp-sidecar');
  const external=externalRating(values.raw_exif);
  if(await sourceHash(await original(photo))!==photo.file_hash)throw new Error('原片内容已变化，未刷新评分');check();
  let status:'protected'|'changed'|'not_found'|'updated'='not_found';
  await commit(value=>{
    const fresh=value.photos.find(p=>p.id===photo.id);if(!fresh)throw new Error('Record not found.');
    if(fresh.file_hash!==photo.file_hash)throw new Error('原片内容已变化，未刷新评分');
    if(ratingProtected(fresh.rating_source))status='protected';
    else if(fresh.rating!==previous[0]||fresh.rating_source!==previous[1])status='changed';
    else if(external.rating!==null){Object.assign(fresh,external);status='updated';}
  });
  check();return {status,external,photo:current().photos.find(p=>p.id===photo.id)!};
}
