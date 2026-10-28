import {validateCollage,upgradeCollage} from './collage.ts';
import type {CollageScene,CollageSource} from './collage.ts';
import {validateCollageBook,upgradeCollageBook} from './collage-book.ts';
import type {CollageBook} from './collage-book.ts';
import {splitID} from './split-record.ts';
export type CollageDocument={kind:'single';value:CollageScene}|{kind:'batch';value:CollageBook};
export type CollageProject={version:1;id:string;name:string;revision:number;request_id:string;created_at:string;updated_at:string;document:CollageDocument;origin_library_id:string;photo_links:{source_id:string;photo_id:string}[]};
export type CollageProjectSave={id:string;request_id:string;expected_revision:number;name:string;document:CollageDocument};
export type StoredCollageProject=CollageProject&{assets:{sha256:string;storage_id:string}[]};
const object=(v:unknown,keys:string[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(v);
export function validateCollageDocument(value:unknown):asserts value is CollageDocument{
 const d=value as CollageDocument;if(!object(d,['kind','value']))throw new Error('Invalid collage project.');if(d.kind==='single')validateCollage(d.value);else if(d.kind==='batch')validateCollageBook(d.value);else throw new Error('Invalid collage project.');
}
export function upgradeCollageDocument(value:CollageDocument):CollageDocument{validateCollageDocument(value);return value.kind==='single'?{kind:'single',value:upgradeCollage(value.value)}:{kind:'batch',value:upgradeCollageBook(value.value)};}
export function collageDocumentSources(d:CollageDocument):CollageSource[]{return d.kind==='single'?d.value.sources:d.value.items.map(i=>i.source);}
export function validateCollageSave(value:unknown):asserts value is CollageProjectSave{
 const v=value as CollageProjectSave;if(!object(v,['id','request_id','expected_revision','name','document'])||!splitID(v.id)||!splitID(v.request_id)||!Number.isSafeInteger(v.expected_revision)||v.expected_revision<0||typeof v.name!=='string'||!v.name.trim()||v.name.length>120||/[\x00-\x1f]/.test(v.name))throw new Error('Invalid collage project.');validateCollageDocument(v.document);
}
export function validateCollageProject(value:unknown,stored=false):asserts value is StoredCollageProject{
 const v=value as StoredCollageProject;if(!object(v,['version','id','name','revision','request_id','created_at','updated_at','document','origin_library_id','photo_links',...(stored?['assets']:[])])||v.version!==1||!Number.isSafeInteger(v.revision)||v.revision<1||!id(v.origin_library_id)||typeof v.created_at!=='string'||!Number.isFinite(Date.parse(v.created_at))||typeof v.updated_at!=='string'||!Number.isFinite(Date.parse(v.updated_at)))throw new Error('Invalid collage project.');
 validateCollageSave({id:v.id,request_id:v.request_id,expected_revision:v.revision-1,name:v.name,document:v.document});const sources=collageDocumentSources(v.document);
 if(!Array.isArray(v.photo_links)||new Set(v.photo_links.map(l=>l.source_id)).size!==v.photo_links.length||v.photo_links.some(l=>!object(l,['source_id','photo_id'])||!id(l.photo_id)||!sources.some(s=>s.id===l.source_id)))throw new Error('Invalid collage project.');
 if(stored){const hashes=new Set(sources.map(s=>s.sha256));if(!Array.isArray(v.assets)||v.assets.length!==hashes.size||new Set(v.assets.map(a=>a.sha256)).size!==hashes.size||v.assets.some(a=>!object(a,['sha256','storage_id'])||!hashes.has(a.sha256)||!splitID(a.storage_id)))throw new Error('Invalid collage project.');}
}
export function collageAssetPath(asset:{sha256:string;storage_id:string}){if(!/^[a-f0-9]{64}$/.test(asset.sha256)||!splitID(asset.storage_id))throw new Error('Invalid collage project.');return `drafts/collages/${asset.storage_id}/${asset.sha256}.bin`;}

export type CollageProjectQuery={search?:string;sort?:'updated'|'name';direction?:'asc'|'desc'};
export function collageProjectQuery(q:CollageProjectQuery={}){if(!q||typeof q!=='object'||Object.keys(q).some(k=>!['search','sort','direction'].includes(k))||q.search!==undefined&&(typeof q.search!=='string'||q.search.length>120)||q.sort!==undefined&&!['updated','name'].includes(q.sort)||q.direction!==undefined&&!['asc','desc'].includes(q.direction))throw new Error('Invalid collage project.');return {search:q.search||'',sort:q.sort||'updated',direction:q.direction||'desc'} as const;}
// Match SQLite's ASCII case folding and Unicode scalar ordering deterministically.
export const collageSearchText=(s:string)=>s.replace(/[A-Z]/g,c=>c.toLowerCase());
export function collageCompareText(a:string,b:string){const aa=Array.from(a),bb=Array.from(b);for(let i=0;i<Math.min(aa.length,bb.length);i++){const x=aa[i].codePointAt(0)!,y=bb[i].codePointAt(0)!;if(x!==y)return x-y;}return aa.length-bb.length;}
