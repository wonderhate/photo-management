import {validCameraAliases} from './camera-names.ts';
import type {CameraNamePreferences} from './camera-names.ts';
import {collageDefaults,collageBatchDefaults,validCollagePreference} from './collage-preferences.ts';
import type {CollagePreferences,CollageBatchPreferences} from './collage-preferences.ts';
import {validLutViewField,lutViewDefaults} from './lut-view.ts';
import type {LutView} from './lut-view.ts';
export type GalleryPreferences={layout:'justified'|'grid'|'tiles'|'waterfall';grid:number;gap:number;radius:number;dense:boolean;sort:'date_taken'|'created_at'|'file_name'|'rating';direction:'asc'|'desc'};
export type DocumentPreferences={zoom:1|1.5|2};
export type ToolPreferences={aiStudio:{mode:"annotation"|"restyle"|"handwriting";language:"zh"|"en"|"both";tagCount:number;captionLength:number;ocr:boolean;placeGuess:boolean;missingOnly:boolean};layers:{textOpen:boolean;stickersOpen:boolean;visionOpen:boolean;modelsOpen:boolean;includeHidden:boolean;snap:boolean};discover:{expanded:boolean;memories:boolean;people:boolean;places:boolean;albums:boolean};cameraNames:CameraNamePreferences;collage:CollagePreferences;collageBatch:CollageBatchPreferences;lut:LutView;viewer:{quality:0|4096|6144;pinned:boolean};compare:{linked:boolean};darkroom:{format:'jpg'|'png'|'webp';edge:number;quality:number};split:{width:number;height:number}};
export type ToolId=keyof ToolPreferences;
export type ToolPreferenceValues={[K in ToolId]?:Partial<ToolPreferences[K]>};
export const toolDefaults:ToolPreferences={aiStudio:{mode:"annotation",language:"both",tagCount:12,captionLength:300,ocr:true,placeGuess:false,missingOnly:false},layers:{textOpen:true,stickersOpen:false,visionOpen:false,modelsOpen:false,includeHidden:false,snap:true},discover:{expanded:false,memories:true,people:true,places:true,albums:true},cameraNames:{aliases:[]},collage:collageDefaults,collageBatch:collageBatchDefaults,lut:lutViewDefaults,viewer:{quality:0,pinned:false},compare:{linked:true},darkroom:{format:'jpg',edge:4096,quality:95},split:{width:3,height:4}};
export const galleryDefaults:GalleryPreferences={layout:'justified',grid:230,gap:14,radius:6,dense:false,sort:'date_taken',direction:'desc'};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validateToolPreferences<K extends ToolId>(kind:K,value:unknown):Partial<ToolPreferences[K]>{
  if(!object(value)||!Object.hasOwn(toolDefaults,kind))throw new Error('Invalid tool view preferences.');
  for(const [key,v] of Object.entries(value)){
    const valid=kind==='aiStudio'?(key==='mode'?['annotation','restyle','handwriting'].includes(v as string):key==='language'?['zh','en','both'].includes(v as string):['ocr','placeGuess','missingOnly'].includes(key)?typeof v==='boolean':typeof v==='number'&&Number.isInteger(v)&&(key==='tagCount'?v>=1&&v<=30:key==='captionLength'&&v>=30&&v<=1500)):kind==='layers'?['textOpen','stickersOpen','visionOpen','modelsOpen','includeHidden','snap'].includes(key)&&typeof v==='boolean':kind==='discover'?['expanded','memories','people','places','albums'].includes(key)&&typeof v==='boolean':kind==='cameraNames'?key==='aliases'&&validCameraAliases(v):kind==='collage'||kind==='collageBatch'?validCollagePreference(key,v,kind==='collageBatch'):kind==='lut'?validLutViewField(key,v):kind==='viewer'?(key==='quality'?typeof v==='number'&&[0,4096,6144].includes(v):key==='pinned'&&typeof v==='boolean')
      :kind==='compare'?key==='linked'&&typeof v==='boolean'
      :kind==='split'?['width','height'].includes(key)&&typeof v==='number'&&Number.isFinite(v)&&v>=1&&v<=100
      :key==='format'?['jpg','png','webp'].includes(v as string):typeof v==='number'&&Number.isInteger(v)&&(key==='edge'?v>=0&&v<=16000:key==='quality'&&v>=1&&v<=100);
    if(!valid)throw new Error('Invalid tool view preferences.');
  }
  return value as Partial<ToolPreferences[K]>;
}
export function validateToolPreferenceValues(value:unknown):ToolPreferenceValues{
  if(!object(value))throw new Error('Invalid tool view preferences.');
  for(const [key,v] of Object.entries(value))validateToolPreferences(key as ToolId,v);
  return value as ToolPreferenceValues;
}
export function validateGalleryPreferences(value:unknown):Partial<GalleryPreferences>{
  if(!object(value))throw new Error('Invalid library view preferences.');
  for(const [key,v] of Object.entries(value)){
    const valid=key==='layout'?['justified','grid','tiles','waterfall'].includes(v as string)
      :key==='sort'?['date_taken','created_at','file_name','rating'].includes(v as string)
      :key==='direction'?['asc','desc'].includes(v as string)
      :key==='dense'?typeof v==='boolean'
      :['grid','gap','radius'].includes(key)&&typeof v==='number'&&Number.isInteger(v)&&
        (key==='grid'?v>=150&&v<=380:key==='gap'?v>=8&&v<=36:v>=0&&v<=18);
    if(!valid)throw new Error('Invalid library view preferences.');
  }
  return value;
}
export function validateDocumentPreferences(value:unknown):Partial<DocumentPreferences>{
  if(!object(value)||Object.keys(value).some(k=>k!=='zoom')||
    ('zoom' in value&&(typeof value.zoom!=='number'||![1,1.5,2].includes(value.zoom))))throw new Error('Invalid document view preferences.');
  return value as Partial<DocumentPreferences>;
}
export interface PreferenceStore {
  libraryId:string;
  facets:Partial<import('./photo-facets').FacetPreferences>;
  saveFacets(patch:Partial<import('./photo-facets').FacetPreferences>):Promise<void>;
  albums:Partial<import('./album-list').AlbumListPreferences>;
  saveAlbums(patch:Partial<import('./album-list').AlbumListPreferences>):Promise<void>;
  gallery:Partial<GalleryPreferences>;
  tools:ToolPreferenceValues;
  saveTool<K extends ToolId>(kind:K,patch:Partial<ToolPreferences[K]>):Promise<void>;
  saveGallery(patch:Partial<GalleryPreferences>):Promise<void>;
  document(id:string):Promise<Partial<DocumentPreferences>>;
  saveDocument(id:string,patch:DocumentPreferences):Promise<void>;
}
// Only old, valid presentation fields are imported. No paths, credentials or edits.
export function legacyGallery(storage:Pick<Storage,'getItem'>):Partial<GalleryPreferences>{
  const result:Partial<GalleryPreferences>={};
  try{
    let grid:unknown={};try{grid=JSON.parse(storage.getItem('grid-prefs')||'{}');}catch{/* Other legacy fields remain usable. */}
    const old={layout:storage.getItem('gallery-layout'),grid:Number(storage.getItem('grid-size')),
      ...(object(grid)?grid:{})};
    for(const [k,v] of Object.entries(old)){try{Object.assign(result,validateGalleryPreferences({[k]:v}));}catch{/* Keep other valid fields. */}}
  }catch{/* Storage unavailable or malformed legacy JSON. */}
  return result;
}
