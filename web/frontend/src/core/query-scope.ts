import {normalizePhotoQuery} from './photo-query.ts';
import {normalizePhotoFacets} from './photo-facets.ts';
import {geoBounds,exactPlace} from './photo-location.ts';
import type {Filters} from '../types.ts';
export type CountMode='capture'|'file';
export type ScopeOrigin='library'|'collection'|'person'|'stats'|'reports'|'favorite'|'query';
export type QueryScope={version:1;library_id:string;mode:CountMode;base:Filters;origin:ScopeOrigin};
const numeric=['focal_length','f_number','iso','exposure_seconds'];
export const FILTER_KEYS=['album_id','person_id','camera','lens','camera_make','camera_model','lens_model','search','text','filename','semantic','semantic_threshold','favorite','rating','color_label','analyzed_color','geo_bounds','geo_presence','location_exact','location_country','location_city','flag','tag','date_from','date_to','orientation','file_type','query','facets',...numeric.flatMap(f=>['','_min','_max','_lt','_gt'].map(s=>f+s))] as const;
const origins=['library','collection','person','stats','reports','favorite','query'];
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=():never=>{throw new Error('Invalid photo scope.');};
const size=(v:unknown)=>{try{if(new TextEncoder().encode(JSON.stringify(v)).length>32768)fail();}catch{fail();}};
function text(v:unknown){if(typeof v!=='string'||[...v].length>256||v.includes('\0')||[...v].some(c=>c.codePointAt(0)!>=0xd800&&c.codePointAt(0)!<=0xdfff))return fail();return v;}
export function normalizeScopeBase(value:unknown):Filters{
  if(!object(value))return fail();const result:Filters={};
  for(const [raw,v] of Object.entries(value)){
    if(!(FILTER_KEYS as readonly string[]).includes(raw)||typeof v!=='string')return fail();if(v==='')continue;
    const key=raw==='camera'?'camera_model':raw==='lens'?'lens_model':raw;let next=v;
    if(key==='query'){let parsed;try{parsed=JSON.parse(v);}catch{return fail();}next=JSON.stringify(normalizePhotoQuery(parsed));}
    else if(key==='facets')next=JSON.stringify(normalizePhotoFacets(v));
    else if(key==='geo_bounds'){try{if(v.length>512)return fail();next=JSON.stringify(geoBounds(JSON.parse(v)));}catch{return fail();}}
    else if(key==='geo_presence'){if(!['located','unlocated'].includes(v))return fail();}
    else if(key==='location_exact')next=JSON.stringify(exactPlace(v));
    else if(key==='location_country'||key==='location_city'){next=text(v);if([...next].length>120||/[\u0000-\u001f]/.test(next))return fail();}
    else if(['album_id','person_id'].includes(key)){if(!/^[a-zA-Z0-9-]{1,80}$/.test(v))return fail();}
    else if(key==='favorite'){if(!['true','false','1','0'].includes(v))return fail();next=['true','1'].includes(v)?'true':'false';}
    else if(key==='rating'){if(!/^\d+$/.test(v)||Number(v)>5)return fail();next=String(Number(v));}
    else if(key==='analyzed_color'){if(!/^#[a-f0-9]{6}$/i.test(v))return fail();next=v.toLowerCase();}
    else if(numeric.some(f=>key===f||key.startsWith(f+'_'))||key==='semantic_threshold'){
      if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.trim()))return fail();const n=Number(v);if(!Number.isFinite(n)||n<0||n>(key==='semantic_threshold'?1:1e12))return fail();next=v.trim();
    }else if(key==='date_from'||key==='date_to')normalizePhotoQuery({version:1,root:{op:'gte',field:'date_taken',value:v}});
    else if(key==='orientation'){if(!['landscape','portrait','square'].includes(v))return fail();}
    else if(key==='flag'){if(!['picked','rejected','unmarked'].includes(v))return fail();}
    else if(key==='file_type'){if(!['all','raw','jpeg','paired','raw_only','jpeg_only'].includes(v))return fail();if(v==='all')continue;}
    else next=text(v);
    if(Object.hasOwn(result,key)&&result[key]!==next)return fail();result[key]=next;
  }
  return result;
}
export function normalizeQueryScope(value:unknown):QueryScope{
  if(typeof value==='string'){if(new TextEncoder().encode(value).length>32768)return fail();try{value=JSON.parse(value);}catch{return fail();}}
  size(value);if(!object(value)||Object.keys(value).some(k=>!['version','library_id','mode','base','origin'].includes(k))||value.version!==1||typeof value.library_id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(value.library_id)||!['capture','file'].includes(value.mode as string)||('origin' in value&&!origins.includes(value.origin as string)))return fail();
  const base=normalizeScopeBase(value.base),origin=(value.origin|| (base.album_id?'collection':base.person_id?'person':base.favorite==='true'?'favorite':Object.keys(base).length?'query':'library')) as ScopeOrigin;
  const result:QueryScope={version:1,library_id:value.library_id,mode:value.mode as CountMode,base,origin};size(result);return result;
}
export function enterScope(libraryId:string,base:Filters,mode:CountMode='capture',origin?:ScopeOrigin):Filters{return {scope:JSON.stringify(normalizeQueryScope({version:1,library_id:libraryId,mode,base,...(origin?{origin}:{})}))};}
export function scopeBase(filters:Filters):Filters{return Object.hasOwn(filters,'scope')?normalizeQueryScope(filters.scope).base:Object.fromEntries(Object.entries(filters).filter(([k])=>k==='album_id'||k==='person_id'));}
export function clearTemporary(filters:Filters):Filters{return Object.hasOwn(filters,'scope')?{scope:filters.scope}:Object.fromEntries(Object.entries(filters).filter(([k])=>['album_id','person_id','count_mode'].includes(k)));}
export function temporaryFilters(filters:Filters):Filters{return Object.fromEntries(Object.entries(filters).filter(([k])=>!['scope','album_id','person_id','count_mode'].includes(k)));}
export function promoteLegacyScope(filters:Filters,libraryId:string):Filters{
  if(Object.hasOwn(filters,'scope'))return {...filters};const base=scopeBase(filters),mode=filters.count_mode||'capture';if(!['capture','file'].includes(mode))return fail();return {...enterScope(libraryId,base,mode as CountMode),...temporaryFilters(filters)};
}
export function galleryRoute(filters:Filters){const p=new URLSearchParams({page:'photos'});for(const [k,v] of Object.entries(filters))if((v||k==='scope')&&((FILTER_KEYS as readonly string[]).includes(k)||k==='scope'||k==='count_mode'))p.set(k,v);return '/?'+p;}
export function galleryFilters(search:string):Filters{const p=new URLSearchParams(search),result:Filters={};for(const [k,v] of p)if((FILTER_KEYS as readonly string[]).includes(k)||k==='scope'||k==='count_mode')result[k]=v;return result;}
export function periodEnd(period:string){return period.length===7?new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).toISOString().slice(0,10):period;}
