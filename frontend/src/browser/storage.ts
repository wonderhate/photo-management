import {validateVisionAsset} from '../core/vision-assets';
import type {VisionAsset} from '../core/vision-assets';
import {recipeLayers} from '../core/layer-recipe';
import {layerAssetHashes} from '../core/layer-stack';
import {aiProfile,validateAIResult} from '../core/ai-studio';
import type {AIProfileRecord,AIResultRecord} from '../core/ai-studio';
import {validateFingerprint} from '../core/visual-hash';
import {assertLibraryWritable,enterLibraryMutation,maintainLibrary} from './maintenance';
import {validateAssetOrigin} from '../core/asset-origin';
import type {AssetOrigin} from '../core/asset-origin';
import {validateLocation} from '../core/photo-location';
import type {StoredLocation} from '../core/photo-location';
import {validateRawSource,validateRawRelation} from '../core/raw-source';
import type {RawSource,RawRelation} from '../core/raw-source';
import type {StoredFingerprint} from '../core/visual-hash';
import {validateFrame,validateLogo,validateUserFrame} from '../core/frame-v2';
import type {LogoAsset,FrameUserTemplate} from '../core/frame-v2';
import {validateVideos} from '../core/video';
import type {StoredVideo} from '../core/video';
import {validateCollageOutput} from '../core/collage-output';
import type {StoredCollageOutput} from '../core/collage-output';
import {validateCollageProject} from '../core/collage-project';
import type {StoredCollageProject} from '../core/collage-project';
import {validateLutFolders} from '../core/lut-folders';
import type {LutFolder} from '../core/lut-folders';
import {validateLutAsset} from '../core/lut-contract';
import type {LutAsset} from '../core/lut-contract';
import {validateFacetPreferences} from '../core/photo-facets';
import type {FacetPreferences} from '../core/photo-facets';
import type {Photo,Album,Settings,WatermarkDraft,Job} from '../types';
import {validateRecipe} from './editing';
import type {EditRecipe} from './editing';
import {resetMediaResources} from '../core/resource-lifecycle';
import {validateGalleryPreferences,validateDocumentPreferences,validateToolPreferenceValues} from '../core/preferences';
import type {GalleryPreferences,DocumentPreferences,ToolPreferenceValues} from '../core/preferences';
import {interruptTasks} from '../core/task-recovery';
import {localFileURL} from '../core/local-file-reference';
import {prepareLocalFiles} from './local-file-service';
import {sourceDecodeProfile} from '../core/source-decode-profile';
import {normalizePhotoQuery} from '../core/photo-query';
import {validateAlbumListPreferences} from '../core/album-list';
import type {AlbumListPreferences} from '../core/album-list';
import {PHOTO_FLAGS} from '../core/photo-flag';
import {RATING_SOURCES} from '../core/photo-rating';
import {validateAnnotationFields} from '../core/photo-annotation';
import {ANNOTATION_QUERY_FIELDS} from '../core/photo-text';
import type {SourceDecodeProfile} from '../core/source-decode-profile';
import {validateStoredSplit,sameSplitValue,splitSourceGroup} from '../core/split-record';
import type {StoredSplit} from '../core/split-record';
import type {SplitEditSource} from '../core/edit-lineage';
import {validateEditLineageGraph,validateSplitEditOutput} from '../core/edit-lineage-graph';
import type {SplitEditOutput} from '../core/edit-lineage-graph';

export interface Directory extends FileSystemDirectoryHandle {
  values():AsyncIterableIterator<FileSystemHandle>;
  queryPermission(options:{mode:'read'|'readwrite'}):Promise<PermissionState>;
  requestPermission(options:{mode:'read'|'readwrite'}):Promise<PermissionState>;
}
export type MetadataSidecar={name:string;sha256:string;photo_hash:string;relative_path:string;source_id:string;managed_path?:string};
export type LocalPhoto=Photo&{source_id:string;relative_path:string;file_hash:string;managed_path?:string;metadata_sidecars?:MetadataSidecar[];edit_origin?:SplitEditOutput;asset_origin?:AssetOrigin};
export type LocalEdit={id:string;photo_id:string|null;source_path?:string;source_name:string;source_hash:string;recipe:EditRecipe;updated_at:string;revision?:number;view_preferences?:Partial<DocumentPreferences>;decode_profile?:SourceDecodeProfile;derived_from?:SplitEditSource};
export type LocalAlbum=Album&{photo_ids:string[];member_added_at?:Record<string,string|null>};
export type ArtLayout={title:string;title_source:'manual'|'suggested'|'none';title_evidence:string;layout:'airy'|'reference';font:string;paper:number};
export type LocalWork={id:string;photo_id:string|null;source:{file_name:string;width:number;height:number;edit_origin?:SplitEditOutput};layout:ArtLayout;generation:{model:string;seconds:number};width:number;height:number;revision:number};
export type LocalDraft=WatermarkDraft&{exported_revision?:number;preview_file?:string;source_revision?:number;source:WatermarkDraft['source']&{edit_origin?:SplitEditOutput;artwork_poster_hash?:string}};
export interface Library {
  application:'photocollection-browser';version:1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24;id:string;revision:number;
  vision_assets?:VisionAsset[];
  ai_profiles?:AIProfileRecord[];ai_results?:AIResultRecord[];
  sources:{id:string;name:string}[];photos:LocalPhoto[];albums:LocalAlbum[];
  removed_photos?:{photo:LocalPhoto;removed_at:string}[];
  drafts:LocalDraft[];works:LocalWork[];jobs:Job[];settings:Settings;
  art:{image_model:string;title_model:string};
  showcase?:{photo_ids:string[]};edits?:LocalEdit[];
  frame_templates?:FrameUserTemplate[];
  logos?:LogoAsset[];
  videos?:StoredVideo[];
  visual_fingerprints?:StoredFingerprint[];
  photo_locations?:StoredLocation[];
  raw_sources?:RawSource[];
  raw_relations?:RawRelation[];
  splits?:StoredSplit[];
  collages?:StoredCollageProject[];
  collage_outputs?:StoredCollageOutput[];
  luts?:LutAsset[];
  lut_folders?:LutFolder[];
  view_preferences?:Partial<GalleryPreferences>;
  tool_preferences?:ToolPreferenceValues;
  facet_preferences?:Partial<FacetPreferences>;
  album_preferences?:Partial<AlbumListPreferences>;
}
export const defaults:Settings={thumbnail_quality:85,count_mode:'capture',preview_preference:'jpeg',export_format:'jpg',export_quality:95,export_long_edge:4096,focal_bands:[24,35,50,85,135],data_dir:'',models_dir:'',exports_dir:'exports',ai_model:'',scan_paths:[]};
let root:Directory|null=null;
let library:Library|null=null;
let queue:Promise<unknown>=Promise.resolve();
let restoring:Promise<Library|null>|undefined;
let sessionGeneration=0,sessionNonce='',openAttempt=0;
const MAX_MANIFEST_BYTES=64*1024*1024;
export const mediaSession=()=>sessionNonce;
export const librarySession=()=>sessionGeneration;
const sources=new Map<string,Directory>();
export const now=()=>new Date().toISOString();
export const uid=()=>crypto.randomUUID();
export function current():Library {if(!library)throw new Error('Open a local library first.');return library;}
/** Saved works may retain a source removed from ordinary photo browsing. */
export function existingPhotoSource(id:string):LocalPhoto|undefined{return current().photos.find(p=>p.id===id)||current().removed_photos?.find(r=>r.photo.id===id)?.photo;}
export function allPhotoSources(value:Library=current()):LocalPhoto[]{return [...value.photos,...(value.removed_photos||[]).map(r=>r.photo)];}
export function directory():Directory {if(!root)throw new Error('Open a local library first.');return root;}

async function handlesDB(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('photocollection-browser-handles',1);r.onupgradeneeded=()=>r.result.createObjectStore('handles');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function handleValue<T>(key:string,value?:T):Promise<T|undefined>{
  const db=await handlesDB();try{return await new Promise<T|undefined>((resolve,reject)=>{const tx=db.transaction('handles',value===undefined?'readonly':'readwrite'),store=tx.objectStore('handles');const r=value===undefined?store.get(key):store.put(value,key);let result:T|undefined;r.onsuccess=()=>{result=r.result};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
function safeParts(path:string){const p=path.split('/');if(!p.length||p.some(s=>!s||s==='.'||s==='..'||/[\\\x00-\x1f]/.test(s)))throw new Error('Invalid local file path.');return p;}
export async function localFile(path:string,base:FileSystemDirectoryHandle=directory()):Promise<File>{const p=safeParts(path);let d=base;for(const part of p.slice(0,-1))d=await d.getDirectoryHandle(part);return (await d.getFileHandle(p.at(-1)!)).getFile();}
export async function writeFile(path:string,data:Blob|string,base:FileSystemDirectoryHandle=directory()):Promise<void>{
  const p=safeParts(path);let d=base;for(const part of p.slice(0,-1))d=await d.getDirectoryHandle(part,{create:true});
  const file=await d.getFileHandle(p.at(-1)!,{create:true});const stream=await file.createWritable({mode:'exclusive'} as FileSystemCreateWritableOptions);
  try{await stream.write(data);await stream.close();}catch(e){await stream.abort().catch(()=>{});throw e;}
}
function validJoinDate(value:unknown):boolean{
  if(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))return false;
  const wall=value.slice(0,19),parsed=new Date(wall+'Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,19)===wall;
}
export function validate(value:unknown):Library {
  const s=value as Library;
  if(!s||s.application!=='photocollection-browser'||![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24].includes(s.version)||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.photos)||!Array.isArray(s.albums)||!Array.isArray(s.drafts)||!Array.isArray(s.works)||!Array.isArray(s.jobs)||!Array.isArray(s.sources)||!s.settings||!s.art)throw new Error('Unsupported or damaged browser library.');
  if(s.ai_profiles!==undefined||s.ai_results!==undefined){
    if(s.version<23||s.ai_profiles!==undefined&&(!Array.isArray(s.ai_profiles)||s.ai_profiles.length>20)||s.ai_results!==undefined&&!Array.isArray(s.ai_results))throw new Error('Invalid AI configuration or result.');
    const ids=new Set<string>();for(const p of s.ai_profiles||[]){aiProfile(p);if(ids.has(p.id))throw new Error('Duplicate AI profile.');ids.add(p.id);}ids.clear();for(const r of s.ai_results||[]){validateAIResult(r);if(ids.has(r.id))throw new Error('Duplicate AI result.');ids.add(r.id);}
  }
  if(s.removed_photos!==undefined&&(s.version<22||!Array.isArray(s.removed_photos)||s.removed_photos.some(r=>!r||typeof r!=='object'||Object.keys(r).some(k=>!['photo','removed_at'].includes(k))||!r.photo||!validJoinDate(r.removed_at))))throw new Error('Invalid removed photo record.');
  const allPhotos=[...s.photos,...(s.removed_photos||[]).map(r=>r.photo)];
  if(s.settings.scan_paths!==undefined&&(!Array.isArray(s.settings.scan_paths)||s.settings.scan_paths.length>100||s.settings.scan_paths.some(p=>typeof p!=='string'||!p.startsWith('source:')||!s.sources.some(source=>source.id===p.slice(7)))||new Set(s.settings.scan_paths).size!==s.settings.scan_paths.length))throw new Error('Invalid source scan setting.');
  for(const p of allPhotos)if(p.asset_origin!==undefined){if(s.version<22)throw new Error('Invalid derived asset origin.');validateAssetOrigin(p.asset_origin);const parent=s.edits?.find(e=>e.id===p.asset_origin!.document_id);if(!parent||parent.source_hash!==p.asset_origin.source_hash||(parent.revision||0)<p.asset_origin.document_revision)throw new Error('Invalid derived asset origin.');}
  for(const [values,validateAsset] of [[s.frame_templates,validateUserFrame],[s.logos,validateLogo]] as const){if(values!==undefined){if(s.version<20||!Array.isArray(values))throw new Error('Invalid frame library asset.');const ids=new Set<string>();for(const value of values){validateAsset(value);if(ids.has(value.id))throw new Error('Invalid frame library asset.');ids.add(value.id);}}}
  for(const draft of s.drafts){if(draft.settings_json?.frame_v2){if(s.version<20)throw new Error('Invalid v2 frame document.');validateFrame(draft.settings_json.frame_v2);}}
  if(s.videos!==undefined){if(s.version<20)throw new Error('Invalid video library.');validateVideos(s.videos);}
  if(s.version<20&&(s.settings.export_format==='webp'||s.tool_preferences?.darkroom?.format==='webp'||s.drafts.some(d=>d.settings_json?.format==='webp')))throw new Error('Unsupported export format version.');
  if(s.version<20&&s.tool_preferences?.cameraNames!==undefined)throw new Error('Unsupported camera name preferences.');
  if(s.collage_outputs!==undefined){if(s.version<19||!Array.isArray(s.collage_outputs))throw new Error('Invalid collage output.');const ids=new Set<string>();for(const output of s.collage_outputs){validateCollageOutput(output,true);if(ids.has(output.id))throw new Error('Invalid collage output.');ids.add(output.id);}}
  if(s.collages!==undefined){if(s.version<18||!Array.isArray(s.collages))throw new Error('Invalid collage project.');const ids=new Set<string>();for(const project of s.collages){validateCollageProject(project,true);if(ids.has(project.id))throw new Error('Invalid collage project.');ids.add(project.id);}}
  if(s.lut_folders!==undefined){if(s.version<16)throw new Error('Unsupported LUT folder format.');validateLutFolders(s.lut_folders);}
  const lutIds=new Set<string>();
  if(s.luts!==undefined){if(s.version<15||!Array.isArray(s.luts))throw new Error('Unsupported LUT library format.');for(const asset of s.luts){validateLutAsset(asset);if(asset.version===2&&s.version<17)throw new Error('Unsupported LUT source context.');if(lutIds.has(asset.id))throw new Error('Invalid LUT data.');lutIds.add(asset.id);}}
  const visionAssets=new Map<string,VisionAsset>();
  if(s.vision_assets!==undefined){if(s.version<24||!Array.isArray(s.vision_assets))throw new Error('Unsupported local vision asset format.');for(const a of s.vision_assets){validateVisionAsset(a);if(visionAssets.has(a.id))throw new Error('Invalid local vision asset.');visionAssets.set(a.id,a);}}
  const checkLut=(recipe:EditRecipe,sourceHash?:string)=>{const stack=recipeLayers(recipe);if(stack.version===2&&s.version<24)throw new Error('Unsupported layer document format.');for(const hash of layerAssetHashes(stack))if(!visionAssets.has(hash))throw new Error('Layer asset is missing or changed. Restore a backup.');for(const layer of stack.layers){if(layer.kind==='sticker'&&visionAssets.get(layer.asset_hash)?.kind!=='sticker')throw new Error('Invalid local vision asset.');if(layer.kind!=='overlay'&&layer.depth){const a=visionAssets.get(layer.depth.asset_hash);if(a?.kind!=='depth'||a.source?.sha256!==layer.depth.source_hash||sourceHash!==undefined&&layer.depth.source_hash!==sourceHash)throw new Error('Depth asset belongs to a different source photo.');}}if(recipe.version===5&&(s.version<15||recipe.lut&&!lutIds.has(recipe.lut.asset_hash)))throw new Error('Missing or unsupported LUT asset.');};
  for(const edit of s.edits||[])checkLut(edit.recipe,edit.source_hash);
  for(const group of s.splits||[])checkLut(group.parent_recipe,group.source_hash);
  for(const origin of [...allPhotos.map(p=>p.edit_origin),...s.drafts.map(d=>d.source?.edit_origin),...s.works.map(w=>w.source?.edit_origin)])if(origin)checkLut(origin.recipe);
  const prefs=s.settings,bands=prefs.focal_bands;
  if(s.view_preferences!==undefined)validateGalleryPreferences(s.view_preferences);
  if(s.tool_preferences!==undefined)validateToolPreferenceValues(s.tool_preferences);
  if(s.album_preferences!==undefined)validateAlbumListPreferences(s.album_preferences);
  if(!['jpg','png','webp'].includes(prefs.export_format)||!Number.isFinite(prefs.export_quality)||prefs.export_quality<1||prefs.export_quality>100||!Number.isFinite(prefs.export_long_edge)||prefs.export_long_edge<0||prefs.export_long_edge>16000||!Array.isArray(bands)||bands.length!==5||bands.some((v,i)=>!Number.isFinite(v)||v<=0||(i>0&&v<=bands[i-1])))throw new Error('Invalid library preferences.');
  const ids=new Set<string>();
  for(const item of [s,...s.sources,...allPhotos,...s.albums,...s.drafts,...s.works]){if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(item.id)||ids.has(item.id))throw new Error('Invalid or duplicate library identifier.');ids.add(item.id);}
  const photoIds=new Set(allPhotos.map(p=>p.id)),sourceIds=new Set(s.sources.map(p=>p.id)),workIds=new Set(s.works.map(p=>p.id));
  if(s.raw_sources!==undefined){if(s.version<22||!Array.isArray(s.raw_sources))throw new Error('Invalid RAW source record.');const ids=new Set<string>();for(const raw of s.raw_sources){validateRawSource(raw);if(ids.has(raw.id)||raw.source_id===null||!sourceIds.has(raw.source_id))throw new Error('Invalid RAW source record.');ids.add(raw.id);}}
  if(s.raw_relations!==undefined){if(s.version<22||!Array.isArray(s.raw_relations))throw new Error('Invalid RAW source record.');const ids=new Set<string>(),rawIds=new Set((s.raw_sources||[]).map(r=>r.id));for(const r of s.raw_relations){validateRawRelation(r);if(ids.has(r.photo_id)||!photoIds.has(r.photo_id)||r.raw_id!==null&&!rawIds.has(r.raw_id))throw new Error('Invalid RAW source record.');ids.add(r.photo_id);}}
  if(s.photo_locations!==undefined){if(s.version<22||!Array.isArray(s.photo_locations))throw new Error('Invalid photo location.');const ids=new Set<string>();for(const record of s.photo_locations){validateLocation(record);if(!photoIds.has(record.photo_id)||ids.has(record.photo_id))throw new Error('Invalid photo location.');ids.add(record.photo_id);}}
  if(s.visual_fingerprints!==undefined){if(s.version<21||!Array.isArray(s.visual_fingerprints))throw new Error('Invalid appearance fingerprint.');const ids=new Set<string>();for(const record of s.visual_fingerprints){validateFingerprint(record);if(!photoIds.has(record.photo_id)||ids.has(record.photo_id))throw new Error('Invalid appearance fingerprint.');ids.add(record.photo_id);}}
  for(const p of allPhotos){safeParts(p.relative_path);if(p.managed_path){safeParts(p.managed_path);if(!p.managed_path.startsWith('photos/'))throw new Error('Invalid photo source.');}if((!p.managed_path&&!sourceIds.has(p.source_id))||!Array.isArray(p.tags)||!/^[a-f0-9]{64}$/.test(p.file_hash)||(p.preview_status!==undefined&&!['pending','ready','failed'].includes(p.preview_status)))throw new Error('Invalid photo source.');}
  for(const p of allPhotos)if(p.flag!==undefined&&(s.version<7||!PHOTO_FLAGS.includes(p.flag)))throw new Error('选片标记无效');
  for(const p of allPhotos){if(s.version<8&&['user_description','annotation','tag_origins','rejected_ai_tags'].some(key=>Object.hasOwn(p,key)))throw new Error('Invalid photo annotation.');validateAnnotationFields(p);}
  for(const p of allPhotos)if(p.rating_source!==undefined){
    if(s.version<6||!RATING_SOURCES.includes(p.rating_source)||p.rating!==null&&(!Number.isInteger(p.rating)||p.rating<0||p.rating>5)||p.rating_source==='none'&&p.rating!==null||p.rating_source.startsWith('xmp-')&&p.rating===null)throw new Error('Invalid photo rating source.');
  }
  for(const p of allPhotos)if(p.metadata_sidecars!==undefined){
    if(!Array.isArray(p.metadata_sidecars)||p.metadata_sidecars.length>2)throw new Error('Invalid metadata sidecar.');
    for(const ref of p.metadata_sidecars){
      if(!ref||typeof ref.name!=='string'||ref.name.length>255||!/\.xmp$/i.test(ref.name)||!ref.sha256||!/^[a-f0-9]{64}$/.test(ref.sha256)||ref.photo_hash!==p.file_hash||typeof ref.source_id!=='string')throw new Error('Invalid metadata sidecar.');
      safeParts(ref.relative_path);
      if(ref.managed_path){safeParts(ref.managed_path);if(!ref.managed_path.startsWith(`photos/${p.id}-metadata-`)||!ref.managed_path.endsWith('-'+ref.sha256+'.xmp'))throw new Error('Invalid metadata sidecar.');}
      else if(!/^[a-zA-Z0-9-]{1,80}$/.test(ref.source_id))throw new Error('Invalid metadata sidecar.');
    }
  }
  if(s.facet_preferences!==undefined){if(s.version<10)throw new Error('Invalid filter bar preferences.');validateFacetPreferences(s.facet_preferences);}
  for(const a of s.albums)if(!Array.isArray(a.photo_ids)||a.photo_ids.some(id=>!photoIds.has(id)))throw new Error('Invalid album relationship.');
  for(const a of s.albums){
    if(!['normal','smart','rule'].includes(a.type))throw new Error('Invalid album relationship.');
    if(a.type==='rule'){if(s.version<4||a.photo_ids.length)throw new Error('Invalid photo query.');normalizePhotoQuery(a.query);if(s.version<10&&JSON.stringify(a.query).includes('"field":"orientation"'))throw new Error('Invalid photo query.');if(s.version<9&&(JSON.stringify(a.query).includes('"op":"icontains"')||ANNOTATION_QUERY_FIELDS.some(field=>JSON.stringify(a.query).includes('"field":"'+field+'"'))))throw new Error('Invalid photo query.');if(s.version<7&&JSON.stringify(a.query).includes('"field":"flag"'))throw new Error('选片标记无效');}
    else if(a.query!=null)throw new Error('Invalid photo query.');
    if(a.cover_mode!==undefined&&(!['auto','manual'].includes(a.cover_mode)||s.version<5))throw new Error('Invalid album overview.');
    if(a.member_added_at!==undefined){
      if(s.version<5||!a.member_added_at||typeof a.member_added_at!=='object'||Array.isArray(a.member_added_at))throw new Error('Invalid album overview.');
      const members=new Set(a.photo_ids);
      for(const [id,date] of Object.entries(a.member_added_at))if(!members.has(id)||date!==null&&!validJoinDate(date))throw new Error('Invalid album overview.');
    }
  }
  if(s.version<5&&s.album_preferences?.view!==undefined)throw new Error('Invalid album overview.');
  for(const d of s.drafts)if((d.photo_id&&!photoIds.has(d.photo_id))||(d.artwork_id&&!workIds.has(d.artwork_id)))throw new Error('Invalid draft relationship.');
  if(s.showcase&&(!Array.isArray(s.showcase.photo_ids)||s.showcase.photo_ids.length>12||new Set(s.showcase.photo_ids).size!==s.showcase.photo_ids.length||s.showcase.photo_ids.some(id=>!photoIds.has(id))))throw new Error('Invalid showcase.');
  if(s.edits!==undefined&&!Array.isArray(s.edits))throw new Error('Invalid edit record.');
  for(const e of s.edits||[]){if(!e||typeof e.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(e.id)||ids.has(e.id)||typeof e.source_name!=='string'||e.source_name.length>255||!/^[a-f0-9]{64}$/.test(e.source_hash)||(!e.photo_id&&!e.source_path)||(e.photo_id&&!photoIds.has(e.photo_id)))throw new Error('Invalid edit record.');ids.add(e.id);if(e.source_path){safeParts(e.source_path);if(!e.source_path.startsWith('drafts/edits/')&&!splitSourceGroup(e.source_path))throw new Error('Invalid edit record.');}validateRecipe(e.recipe);if(e.recipe.version===4&&s.version<14)throw new Error('Unsupported layer stack in this library format.');if(e.recipe.version===3&&s.version<13)throw new Error('Unsupported text layers in this library format.');if(e.recipe.version!==1&&s.version<10)throw new Error('Invalid composition.');}
  for(const e of s.edits||[])if(e.view_preferences!==undefined)validateDocumentPreferences(e.view_preferences);
  for(const e of s.edits||[])if(e.source_path?.startsWith('drafts/splits/')){
    const id=splitSourceGroup(e.source_path),group=s.splits?.find(g=>g.id===id);
    if(s.version<11||!id||!group||group.document_id!==e.id||group.source_hash!==e.source_hash)throw new Error('Invalid edit record.');
  }
  for(const e of s.edits||[])if(e.revision!==undefined&&(s.version<11||!Number.isSafeInteger(e.revision)||e.revision<1))throw new Error('Invalid edit record.');
  if(s.splits!==undefined){
    if(s.version<11||!Array.isArray(s.splits))throw new Error('Split group is incomplete or damaged.');
    for(const group of s.splits){
      validateStoredSplit(group);const parent=s.edits?.find(e=>e.id===group.document_id);
      if(!parent||parent.source_hash!==group.source_hash||group.document_revision>(parent.revision??0)||!sameSplitValue(sourceDecodeProfile(parent.decode_profile),group.decode_profile))throw new Error('Split group is incomplete or damaged.');
      for(const p of [group.master,...group.panels]){if(ids.has(p.id))throw new Error('Invalid or duplicate library identifier.');ids.add(p.id);}
    }
  }
  for(const e of s.edits||[])if(e.derived_from!==undefined&&s.version<12)throw new Error('Unsupported or damaged edit source lineage.');
  if(s.version<14&&s.splits?.some(g=>g.parent_recipe.version===4))throw new Error('Unsupported layer stack in this library format.');
  if(s.version<13&&s.splits?.some(g=>g.parent_recipe.version===3))throw new Error('Unsupported text layers in this library format.');
  validateEditLineageGraph(s.edits||[],s.splits||[]);
  for(const origin of [...allPhotos.map(p=>p.edit_origin),...s.drafts.map(d=>d.source?.edit_origin),...s.works.map(w=>w.source?.edit_origin)])if(origin!==undefined){if(s.version<12||s.version<14&&origin.recipe?.version===4||s.version<13&&(origin.version===2||origin.recipe.version===3))throw new Error('Unsupported or damaged edit source lineage.');validateSplitEditOutput(origin,s.edits||[]);}
  for(const e of s.edits||[]){const profile=sourceDecodeProfile(e.decode_profile);if(s.version===1&&profile.version!==1)throw new Error('Unsupported source decoding profile.');}
  for(const value of [...allPhotos.map(p=>p.decode_profile),...s.drafts.map(d=>d.source?.decode_profile)]){const profile=sourceDecodeProfile(value);if(s.version<3&&profile.version!==1)throw new Error('Unsupported source decoding profile.');}
  return s;
}
async function readManifest(base:FileSystemDirectoryHandle,name='library.json'){const file=await localFile(name,base);if(file.size>MAX_MANIFEST_BYTES)throw new Error('Library metadata exceeds 64 MiB.');return validate(JSON.parse(await file.text()));}
export async function openLibrary(handle:Directory,create=false){
  const attempt=++openAttempt,ensureOpening=()=>{if(openAttempt!==attempt)throw new Error('Library changed. Reopen the current library.');};
  if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw new Error('Write permission is required for the library data directory.');
  ensureOpening();
  let next:Library;
  try{next=await readManifest(handle);}catch(e){
    if(!create)throw e;
    for await(const _entry of handle.values())throw new Error('Select an empty directory to create a browser library.');
    next={application:'photocollection-browser',version:24,id:uid(),revision:0,sources:[],photos:[],albums:[],drafts:[],works:[],jobs:[],settings:{...defaults,data_dir:handle.name},art:{image_model:'qwen-image-3.0',title_model:'qwen3-vl-plus'}};
    await writeFile('library.json',JSON.stringify(next),handle);
  }
  ensureOpening();root=handle;library=next;sessionGeneration++;sessionNonce=uid();sources.clear();clearURLs();
  for(const source of next.sources){let cached:Directory|undefined,granted=false;try{cached=await handleValue<Directory>(next.id+':'+source.id);ensureOpening();granted=!!cached&&await cached.queryPermission({mode:'read'})==='granted';}catch{/* Handles are a convenience cache; the directory manifest remains authoritative. */}ensureOpening();if(cached&&granted)sources.set(source.id,cached);}
  try{await handleValue('last-library',handle);}catch{/* Opening an explicitly granted directory must still work without IndexedDB. */}ensureOpening();
  // Completed results are durable; interrupted billable jobs must never be retried.
  if(next.jobs.some(j=>['running','queued','submitted'].includes(j.status)))await commit(s=>interruptTasks(s.jobs));
  return current();
}
export function restoreLibrary():Promise<Library|null>{return restoring??=(async()=>{const h=await handleValue<Directory>('last-library');if(h&&await h.queryPermission({mode:'readwrite'})==='granted'){// No permission prompt outside a user gesture.
    const next=await readManifest(h);root=h;library=next;sessionGeneration++;sessionNonce=uid();sources.clear();clearURLs();for(const source of next.sources){const v=await handleValue<Directory>(next.id+':'+source.id);if(v&&await v.queryPermission({mode:'read'})==='granted')sources.set(source.id,v);}if(next.jobs.some(j=>['running','queued','submitted'].includes(j.status)))await commit(s=>interruptTasks(s.jobs));return current();
  }return null;})();}
async function assertRevision(base:Directory,expected:Library){const disk=await readManifest(base);if(disk.id!==expected.id||disk.revision!==expected.revision)throw new Error('This library changed in another window. Reopen it before saving.');}
export async function assertCurrentRevision(){const base=directory(),expected=current();await assertRevision(base,expected);if(directory()!==base||current().id!==expected.id)throw new Error('Library changed. Reopen the current library.');}
export function commit(change:(value:Library)=>void):Promise<Library>{
  assertLibraryWritable();
  const scope=current().id,base=directory(),generation=librarySession();
  const run=async()=>navigator.locks.request('photocollection:'+scope,async()=>{
    assertLibraryWritable();
    if(current().id!==scope||directory()!==base||librarySession()!==generation)throw new Error('Library changed. Reopen the current library.');
    const previous=current();const next=structuredClone(previous);change(next);next.version=24;next.revision=previous.revision+1;for(const j of next.jobs)for(const result of j.results)result.url='';validate(next);
    const document=new Blob([JSON.stringify(next)],{type:'application/json'});
    if(document.size>MAX_MANIFEST_BYTES)throw new Error('Library metadata exceeds 64 MiB.');
    // ponytail: one metadata snapshot per transaction; introduce indexed shards only after measured large-library save costs.
    const handle=await base.getFileHandle('library.json');const stream=await handle.createWritable({mode:'exclusive'} as FileSystemCreateWritableOptions);
    try{await assertRevision(base,previous);if(previous.version<24)await writeFile('library.before-vision-v24-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<23)await writeFile('library.before-ai-v23-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<22)await writeFile('library.before-locations-v22-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<3)await writeFile('library.before-source-v3-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<4)await writeFile('library.before-rules-v4-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<5)await writeFile('library.before-overview-v5-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<6)await writeFile('library.before-ratings-v6-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<7)await writeFile('library.before-flags-v7-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<8)await writeFile('library.before-annotations-v8-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<9)await writeFile('library.before-text-v9-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<10)await writeFile('library.before-facets-v10-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<11)await writeFile('library.before-splits-v11-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<12)await writeFile('library.before-edit-lineage-v12-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<13)await writeFile('library.before-text-layers-v13-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<14)await writeFile('library.before-layer-stack-v14-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<15)await writeFile('library.before-luts-v15-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<16)await writeFile('library.before-lut-folders-v16-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<17)await writeFile('library.before-lut-context-v17-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<18)await writeFile('library.before-collages-v18-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<21)await writeFile('library.before-appearance-v21-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<20)await writeFile('library.before-media-frames-v20-'+uid()+'.json',await localFile('library.json',base),base);if(previous.version<19)await writeFile('library.before-collage-outputs-v19-'+uid()+'.json',await localFile('library.json',base),base);if(!(previous.edits||[]).some(e=>e.recipe.version!==1)&&(next.edits||[]).some(e=>e.recipe.version!==1))await writeFile('library.before-composition-v2-'+uid()+'.json',await localFile('library.json',base),base);await writeFile('library.previous.json',JSON.stringify(previous),base);await stream.write(document);await stream.close();if(librarySession()===generation&&root===base&&library?.id===scope)library=next;return next;}catch(e){await stream.abort().catch(()=>{});try{if(await(await localFile('library.json',base)).text()===await document.text()){if(librarySession()===generation&&root===base&&library?.id===scope)library=next;return next;}}catch{/* An uncertain result must not be mistaken for a verified commit. */}throw e;}
  });
  const pending=queue.then(run);queue=pending.catch(()=>{});return pending;
}
export async function selectDirectory(mode:'read'|'readwrite'='read'):Promise<Directory>{const picker=(window as unknown as {showDirectoryPicker:(o:object)=>Promise<Directory>}).showDirectoryPicker;if(!picker)throw new Error('Use the current desktop Chrome or Edge over HTTPS.');return picker({mode,id:mode==='read'?'photo-sources':'photo-library'});}
export async function connectSource(handle:Directory,sourceId?:string){
  const base=directory(),scope=current().id,generation=librarySession();
  const check=()=>{if(librarySession()!==generation||directory()!==base||current().id!==scope)throw new Error('Library changed. Reopen the current library.');};
  if(await base.isSameEntry(handle)||await base.resolve(handle)!==null||await handle.resolve(base)!==null)throw new Error('Keep original photos and the library data directory separate.');check();
  if(await handle.requestPermission({mode:'read'})!=='granted')throw new Error('Read permission was not granted.');
  check();let id=sourceId;
  if(!id)for(const [known,h] of sources){if(await h.isSameEntry(handle))id=known;check();}
  if(!id){id=uid();await commit(s=>{check();s.sources.push({id:id!,name:handle.name});});}check();
  if(!current().sources.some(s=>s.id===id))throw new Error('Unknown source directory.');
  try{await handleValue(scope+':'+id,handle);}catch{/* A session-only grant remains usable; reauthorize after reopening. */}check();sources.set(id,handle);return id;
}
export function sourceHandle(id:string){return sources.get(id);}
export async function original(photo:LocalPhoto){if(photo.managed_path)return localFile(photo.managed_path);const h=sources.get(photo.source_id);if(!h)throw new Error('Reconnect the original photo directory in local library settings.');return localFile(photo.relative_path,h);}
export async function imageURLs(paths:string[]){
  const scope=current().id,session=mediaSession();await prepareLocalFiles();
  if(current().id!==scope||mediaSession()!==session)throw new Error('Library changed. Reopen the current library.');
  return paths.map(path=>localFileURL(scope,session,path));
}
export async function imageURL(path:string){return (await imageURLs([path]))[0];}
export function clearURLs(){resetMediaResources();}
export function closeLibrary(){openAttempt++;sessionGeneration++;sessionNonce=uid();clearURLs();sources.clear();root=null;library=null;restoring=undefined;}
export async function backup(){
  const leave=enterLibraryMutation();
  try{
    const base=directory(),id=current().id,generation=librarySession(),check=()=>{if(librarySession()!==generation||directory()!==base||current().id!==id)throw new Error('Library changed. Reopen the current library.');};
    const target=await selectDirectory('readwrite');check();
    if(await target.isSameEntry(base)||await base.resolve(target)!==null||await target.resolve(base)!==null)throw new Error('Choose a separate backup directory.');check();
    for(const h of sources.values()){if(await h.isSameEntry(target)||await h.resolve(target)!==null||await target.resolve(h)!==null)throw new Error('Do not write backups into an original photo directory.');check();}
    leave(); // Transfer admission synchronously; maintenance must see no other writers.
    return await maintainLibrary(async()=>{
      const {recentTasks}=await import('./task-service');check();if(recentTasks().some(j=>['queued','running'].includes(j.status)))throw new Error('Wait for background tasks before backing up the library.');
      return navigator.locks.request('photocollection:'+id,async()=>{
        check();const snapshot=await readManifest(base);if(snapshot.id!==id||snapshot.revision!==current().revision)throw new Error('This library changed in another window. Reopen it before saving.');
        const copy=await target.getDirectoryHandle('PhotoCollection-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+uid(),{create:true});check();
        const hash=async(file:Blob)=>{const chunks:string[]=[];for(let offset=0;offset<file.size;offset+=8*1024*1024){check();chunks.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.slice(offset,offset+8*1024*1024).arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join(''));}check();return file.size+':'+chunks.join(':');};
        async function tree(from:Directory,to:FileSystemDirectoryHandle){for await(const entry of from.values()){check();if(entry.kind==='directory')await tree(await from.getDirectoryHandle(entry.name) as Directory,await to.getDirectoryHandle(entry.name,{create:true}));else{const handle=await from.getFileHandle(entry.name),file=await handle.getFile(),before=await hash(file);check();await writeFile(entry.name,file,to);check();if(await hash(await localFile(entry.name,to))!==before||await hash(await handle.getFile())!==before)throw new Error('A managed file changed while copying the library.');check();}}}
        for(const name of ['photos','drafts','works','exports','media','recycle','masks','stickers','analysis','ai-studio']){let from:Directory;try{from=await base.getDirectoryHandle(name) as Directory;}catch(e){if(e instanceof DOMException&&e.name==='NotFoundError')continue;throw e;}await tree(from,await copy.getDirectoryHandle(name,{create:true}));}
        // The manifest is the completion marker; an interrupted folder is not an openable backup.
        check();await assertRevision(base,snapshot);check();await writeFile('library.json',JSON.stringify(snapshot),copy);return copy.name;
      });
    });
  }finally{leave();}
}
export async function recoverLibrary(handle:Directory){
  if(await handle.requestPermission({mode:'readwrite'})!=='granted')throw new Error('Write permission is required for the library data directory.');
  const previous=await readManifest(handle,'library.previous.json');
  try{const damaged=await localFile('library.json',handle);await writeFile('library.damaged-'+uid()+'.json',damaged,handle);}catch(e){if(!(e instanceof DOMException)||e.name!=='NotFoundError')throw e;}
  await writeFile('library.json',JSON.stringify(previous),handle);return openLibrary(handle);
}
