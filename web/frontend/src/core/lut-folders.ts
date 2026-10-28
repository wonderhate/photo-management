import {lutInputComments} from './lut-context.ts';
import {validateLutAsset} from './lut-contract.ts';
import type {LutAsset} from './lut-contract.ts';
export const LUT_FOLDER_LIMIT=20,LUT_ENTRY_LIMIT=5000,LUT_DEPTH_LIMIT=8;
export type LutFolderEntry={path:string;stamp:string;asset:LutAsset|null;comments:string[];error:string|null};
export type LutFolder={version:1;id:string;binding:string;name:string;revision:number;state:'ready'|'missing'|'permission'|'error';entries:LutFolderEntry[];truncated:boolean};
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:unknown,names:string[])=>plain(v)&&Object.keys(v).length===names.length&&Object.keys(v).every(k=>names.includes(k));
export function validLutPath(v:unknown):v is string{return typeof v==='string'&&v.length<=2048&&v.split('/').length<=LUT_DEPTH_LIMIT+1&&v.split('/').every(p=>!!p&&p!=='.'&&p!=='..'&&!/[\\\x00-\x1f\x7f]/.test(p));}
export function validateLutFolders(value:unknown):asserts value is LutFolder[]{
  const fail=()=>{throw new Error('Invalid LUT folder data.');};
  if(!Array.isArray(value)||value.length>LUT_FOLDER_LIMIT)return fail();const ids=new Set();
  for(const f of value){
    if(!keys(f,['version','id','binding','name','revision','state','entries','truncated'])||f.version!==1||typeof f.id!=='string'||!/^[a-f0-9-]{36}$/.test(f.id)||ids.has(f.id)||typeof f.binding!=='string'||!/^[a-f0-9-]{36}$/.test(f.binding)||typeof f.name!=='string'||!f.name.trim()||f.name.length>255||/[\x00-\x1f\x7f]/.test(f.name)||!Number.isSafeInteger(f.revision)||f.revision<0||!['ready','missing','permission','error'].includes(f.state)||typeof f.truncated!=='boolean'||!Array.isArray(f.entries)||f.entries.length>LUT_ENTRY_LIMIT)return fail();
    ids.add(f.id);const paths=new Set();
    for(const e of f.entries){
      if(!keys(e,['path','stamp','asset','comments','error'])||!validLutPath(e.path)||paths.has(e.path)||typeof e.stamp!=='string'||e.stamp.length>160||!Array.isArray(e.comments)||e.comments.length>32||e.comments.some((c:unknown)=>typeof c!=='string'||c.length>512||/[\x00-\x1f\x7f]/.test(c))||e.error!==null&&!['header','size','unreadable','changed'].includes(e.error))return fail();
      paths.add(e.path);if(e.asset!==null){validateLutAsset(e.asset);if(e.error!==null||e.asset.name!==e.path.split('/').at(-1))return fail();}else if(!e.error)return fail();
    }
  }
}
export function lutHeader(text:string){
  const comments=lutInputComments(text);
  if(/^\s*LUT_[12]D_/im.test(text))throw new Error('header');
  const sizes=[...text.matchAll(/^\s*LUT_3D_SIZE\s+(\d+)\s*(?:#.*)?$/gim)],titles=[...text.matchAll(/^\s*TITLE\s+([^\r\n]*)/gim)];
  if(sizes.length!==1||Number(sizes[0][1])<2||Number(sizes[0][1])>65||titles.length>1)throw new Error('header');
  const raw=titles[0]?.[1]?.trim()||'',quoted=/^"([^"\r\n]*)"\s*(?:#.*)?$/.exec(raw),title=raw.startsWith('"')?quoted?.[1]:raw.split('#')[0].trim();
  if(title===undefined||title.length>255||/[\x00-\x1f\x7f]/.test(title))throw new Error('header');
  return {size:Number(sizes[0][1]),title,comments};
}
export function folderAssets(stored:LutAsset[],folders:LutFolder[]){const found=new Map(stored.map(a=>[a.id,a]));for(const f of folders)if(f.state==='ready')for(const e of f.entries)if(e.asset&&!found.has(e.asset.id))found.set(e.asset.id,e.asset);return [...found.values()];}
