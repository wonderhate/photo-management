import {current,original,localFile,mediaSession} from './storage';
import type {Library} from './storage';
import type {SourceDecodeProfile} from '../core/source-decode-profile';
import {collageOutputPath} from '../core/collage-output';
import {localFileURL} from '../core/local-file-reference';

export type PublishKind='photo'|'watercolor'|'collage-output'|'split-panel';
export type PublishRef={id:string;kind?:PublishKind};
export const publishKey=(v:PublishRef)=>`${v.kind||'photo'}:${v.id}`;
export type PublishChoice=PublishRef&{name:string;thumbnail_url:string;missing?:boolean};
export function publishName(value:PublishRef,library:Library=current()){
  if(!value.kind||value.kind==='photo')return library.photos.find(p=>p.id===value.id)?.file_name||value.id;
  if(value.kind==='watercolor')return library.works.find(p=>p.id===value.id)?.source.file_name||value.id;
  if(value.kind==='collage-output'){const item=library.collage_outputs?.find(p=>p.id===value.id);return item?`${item.project.name} · ${item.page+1}`:value.id;}
  return library.splits?.flatMap(g=>g.panels).find(p=>p.id===value.id)?.name||value.id;
}
export function derivedPublishChoices(kind:Exclude<PublishKind,'photo'>,search:string,page:number){
  const s=current();let items:PublishChoice[]=[];
  if(kind==='watercolor')items=s.works.map(w=>({id:w.id,kind,name:w.source.file_name,thumbnail_url:localFileURL(s.id,mediaSession(),`works/${w.id}/preview-${w.revision}.webp`)}));
  if(kind==='collage-output')items=(s.collage_outputs||[]).map(v=>({id:v.id,kind,name:publishName({id:v.id,kind},s),thumbnail_url:''}));
  if(kind==='split-panel')items=(s.splits||[]).flatMap(g=>g.panels.map(v=>({id:v.id,kind,name:g.name+' · '+v.name,thumbnail_url:''})));
  items=items.filter(p=>p.name.toLowerCase().includes(search.toLowerCase()));return {items:items.slice((page-1)*40,page*40),total:items.length};
}
export function publishSource(ref:PublishRef,s:Library):{read:()=>Promise<File>;hash?:string;profile:SourceDecodeProfile|undefined}{
  if(!ref.kind||ref.kind==='photo'){const p=s.photos.find(p=>p.id===ref.id);if(!p)throw new Error('Record not found.');return {read:()=>original(p),hash:p.file_hash,profile:p.decode_profile};}
  const profile:SourceDecodeProfile={version:2,extra_orientation:1};
  if(ref.kind==='watercolor'){const w=s.works.find(w=>w.id===ref.id);if(!w)throw new Error('Record not found.');return {read:()=>localFile(`works/${w.id}/poster-${w.revision}.png`),profile};}
  if(ref.kind==='collage-output'){const v=s.collage_outputs?.find(v=>v.id===ref.id);if(!v)throw new Error('Record not found.');return {read:()=>localFile(collageOutputPath(v)),hash:v.sha256,profile};}
  if(ref.kind==='split-panel'){const p=s.splits?.flatMap(g=>g.panels).find(p=>p.id===ref.id);if(!p)throw new Error('Record not found.');return {read:()=>localFile(p.path),hash:p.sha256,profile};}
  throw new Error('Invalid public export options.');
}
