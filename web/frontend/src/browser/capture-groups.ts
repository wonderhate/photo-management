import type {LocalPhoto} from './storage';
import type {PhotoFile} from '../types';

const jpeg=(photo:LocalPhoto)=>/^(jpe?g)$/i.test(photo.file_format);
const groupId=(photo:LocalPhoto)=>photo.capture_group_id||photo.id;
const caches=new WeakMap<LocalPhoto[],CaptureIndex>();

export class CaptureIndex {
  readonly byId:Map<string,LocalPhoto>;
  readonly groups=new Map<string,LocalPhoto[]>();
  readonly preferred=new Map<string,LocalPhoto>();
  constructor(photos:LocalPhoto[]){
    this.byId=new Map(photos.map(p=>[p.id,p]));
    for(const p of photos){const id=groupId(p),group=this.groups.get(id)||[];group.push(p);this.groups.set(id,group);}
    for(const [id,rows] of this.groups){
      const ordered=[...rows].sort((a,b)=>Number(a.is_raw)-Number(b.is_raw)||Number(jpeg(b))-Number(jpeg(a))||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
      this.preferred.set(id,ordered[0]);
    }
  }
  representatives(){return [...this.preferred.values()];}
  members(photo:LocalPhoto){return this.groups.get(groupId(photo))||[photo];}
  idsForGroups(ids:Iterable<string>){
    const groups=new Set([...ids].flatMap(id=>{const p=this.byId.get(id);return p?[groupId(p)]:[];}));
    return new Set([...groups].flatMap(id=>(this.groups.get(id)||[]).map(p=>p.id)));
  }
  files(photo:LocalPhoto):PhotoFile[]{return this.members(photo).map(p=>({id:p.id,file_name:p.file_name,file_format:p.file_format,is_raw:p.is_raw,file_path:p.file_path,file_hash:p.file_hash,preview_available:(p.preview_status||'ready')==='ready'}));}
  matchesType(photo:LocalPhoto,type:string){
    const members=this.members(photo),raw=members.some(p=>p.is_raw),rendered=members.some(p=>!p.is_raw);
    switch(type){case 'all':case '':return true;case 'raw':return raw;case 'jpeg':return rendered;case 'paired':return raw&&rendered;case 'raw_only':return raw&&!rendered;case 'jpeg_only':return rendered&&!raw;default:throw new Error('Invalid photo query.');}
  }
}
export function captures(photos:LocalPhoto[]){let index=caches.get(photos);if(!index){index=new CaptureIndex(photos);caches.set(photos,index);}return index;}

function pairingKey(p:LocalPhoto){
  const path=p.relative_path.replaceAll('\\','/'),slash=path.lastIndexOf('/'),name=path.slice(slash+1),dot=name.lastIndexOf('.');
  return `${p.source_id}\0${path.slice(0,slash+1).toLowerCase()}\0${(dot<0?name:name.slice(0,dot)).toLowerCase()}`;
}
function compatible(a:LocalPhoto,b:LocalPhoto){
  if(a.is_raw===b.is_raw||(!a.is_raw&&!jpeg(a))||(!b.is_raw&&!jpeg(b)))return false;
  if(a.camera_model&&b.camera_model&&a.camera_model!==b.camera_model)return false;
  if(a.date_taken&&b.date_taken){
    const offset=/(?:Z|[+-]\d{2}:\d{2})$/;
    if(offset.test(a.date_taken)!==offset.test(b.date_taken))return false;
    // Camera wall times without an offset are compared in a fixed zone, not
    // the computer's current zone (including daylight-saving transitions).
    const stamp=(value:string)=>Date.parse(offset.test(value)?value:value+'Z');
    if(!Number.isFinite(stamp(a.date_taken))||!Number.isFinite(stamp(b.date_taken))||Math.abs(stamp(a.date_taken)-stamp(b.date_taken))>2000)return false;
  }
  return true;
}
const exifFields=['date_taken','camera_make','camera_model','lens_model','f_number','exposure_time','exposure_seconds','iso','focal_length','focal_length_35mm','gps_latitude','gps_longitude'] as const;

/** Only newly admitted files may pair. Existing IDs, album membership and
 * manual per-file decisions are never rewritten by a read/query. */
export function appendImportedPhotos(photos:LocalPhoto[],incoming:LocalPhoto[]){
  const groups=new Map<string,LocalPhoto[]>(),buckets=new Map<string,LocalPhoto[]>();
  for(const p of [...photos,...incoming]){
    const key=pairingKey(p),bucket=buckets.get(key)||[];bucket.push(p);buckets.set(key,bucket);
    const id=groupId(p),group=groups.get(id)||[];group.push(p);groups.set(id,group);
  }
  const admitted=new Set(photos.map(p=>p.id));
  for(const p of incoming){
    const candidates=(buckets.get(pairingKey(p))||[]).filter(other=>other.id!==p.id&&compatible(p,other));
    const other=candidates.length===1?candidates[0]:undefined;
    const mutual=other&&(buckets.get(pairingKey(other))||[]).filter(candidate=>candidate.id!==other.id&&compatible(other,candidate));
    if(other&&admitted.has(other.id)&&mutual?.length===1&&(groups.get(groupId(other))||[]).length===1){
      p.capture_group_id=groupId(other);groups.set(groupId(other),[other,p]);
      p.favorite=other.favorite;p.color_label=other.color_label;p.flag=other.flag;
      p.tags=[...other.tags];p.tag_origins=other.tag_origins?{...other.tag_origins}:undefined;p.rejected_ai_tags=[...(other.rejected_ai_tags||[])];
      if(other.rating_source!=='none'){p.rating=other.rating;p.rating_source=other.rating_source;}else if(p.rating_source!=='none'){other.rating=p.rating;other.rating_source=p.rating_source;}
      const raw=p.is_raw?p:other,rendered=p.is_raw?other:p;
      for(const field of exifFields){if(raw[field]!=null)(rendered as any)[field]=raw[field];else if(rendered[field]!=null)(raw as any)[field]=rendered[field];}
    }
    photos.push(p);admitted.add(p.id);
  }
  caches.delete(photos);
}
