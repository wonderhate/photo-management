import type {LocalAlbum,LocalPhoto} from './storage';
import {albumMemberIds} from './album-members.ts';
import {photoOrder} from '../core/photo-order.ts';
import {captures} from './capture-groups.ts';
import {compilePhotoQuery} from '../core/photo-query.ts';

export const memberAdded=(a:LocalAlbum,id:string)=>Object.hasOwn(a.member_added_at||{},id)?a.member_added_at![id]:null;
export function albumPhotos(a:LocalAlbum,photos:LocalPhoto[],byId=new Map(photos.map(p=>[p.id,p]))){
  const index=captures(photos);
  if(a.type==='rule')return index.representatives().filter(compilePhotoQuery(a.query)).sort(photoOrder('date_taken','desc'));
  const seen=new Set<string>();
  return albumMemberIds(a,photos).flatMap(id=>{const p=byId.get(id);if(!p)return [];const key=p.capture_group_id||p.id;if(seen.has(key))return [];seen.add(key);return [index.preferred.get(key)!];});
}
export function captureMemberAdded(a:LocalAlbum,p:LocalPhoto,photos:LocalPhoto[]){
  const stamps=captures(photos).members(p).map(member=>memberAdded(a,member.id)).filter((stamp):stamp is string=>stamp!=null);
  return stamps.sort().at(-1)||null;
}
function recentOrder(a:LocalAlbum,photos:LocalPhoto[]){
  return a.type==='rule'?photoOrder('created_at','desc'):(p:LocalPhoto,q:LocalPhoto)=>{
    const av=captureMemberAdded(a,p,photos),bv=captureMemberAdded(a,q,photos);
    return av==null?bv==null?0:1:bv==null?-1:Date.parse(bv)-Date.parse(av)||(p.id<q.id?-1:p.id>q.id?1:0);
  };
}
export function recentAlbumPhotos(a:LocalAlbum,photos:LocalPhoto[],byId?:Map<string,LocalPhoto>){
  return albumPhotos(a,photos,byId).sort(recentOrder(a,photos));
}
export function albumOverview(a:LocalAlbum,photos:LocalPhoto[],byId=new Map(photos.map(p=>[p.id,p]))){
  const rows=albumPhotos(a,photos,byId),dates=rows.flatMap(p=>p.date_taken?[p.date_taken]:[]).sort(),recent=[...rows].sort(recentOrder(a,photos));
  const mode=a.cover_mode||(a.cover_id?'manual':'auto'),manual=mode==='manual',available=!!a.cover_id&&byId.has(a.cover_id);
  const cover_ids=manual?(available?[a.cover_id!]:[]):rows.slice(0,4).map(p=>p.id);
  return {...a,count:rows.length,cover_mode:mode,cover_ids,cover_id:cover_ids[0]||null,cover_missing:manual&&!available,
    date_from:dates[0]||null,date_to:dates.at(-1)||null,unknown_date_count:rows.length-dates.length,
    last_added_at:a.type==='rule'||!recent.length?null:captureMemberAdded(a,recent[0],photos),last_imported_at:a.type==='rule'?recent[0]?.created_at||null:null,
    recent_photo_ids:recent.filter(p=>a.type==='rule'||captureMemberAdded(a,p,photos)!=null).slice(0,4).map(p=>p.id),recent_kind:a.type==='rule'?'imported' as const:'joined' as const};
}

/** Retain known history and unknown legacy membership; only new joins get a date. */
export function replaceMembers(a:LocalAlbum,ids:string[],stamp:string){
  const previous=new Set(a.photo_ids),next=[...new Set(ids)];
  a.member_added_at=Object.fromEntries(next.map(id=>[id,previous.has(id)?memberAdded(a,id):stamp]));
  a.photo_ids=next;
}
