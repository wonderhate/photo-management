import {validateLutContext} from './lut-context.ts';
import type {LutContext} from './lut-context.ts';
// Source hash addresses an immutable UTF-8 .cube copy, never a mutable path.
export type LutSelection={version:1;asset_hash:string;strength:number;input:'srgb'};
export type LutAsset=({version:1;context?:never}|{version:2;context:LutContext})&{id:string;name:string;title:string;size:number;bytes:number;favorite:boolean;hidden:boolean;used_at:string|null};
const hash=/^[a-f0-9]{64}$/;
function object(value:unknown,keys:string[]):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))throw new Error('Invalid LUT data.');}
export function validateLutSelection(value:unknown):asserts value is LutSelection{
  object(value,['version','asset_hash','strength','input']);if(value.version!==1||typeof value.asset_hash!=='string'||!hash.test(value.asset_hash)||typeof value.strength!=='number'||!Number.isFinite(value.strength)||value.strength<0||value.strength>1||value.input!=='srgb')throw new Error('Invalid LUT data.');
}
export function validateLutAsset(value:unknown):asserts value is LutAsset{
  const v=value as LutAsset;object(value,['version','id','name','title','size','bytes','favorite','hidden','used_at',...(v?.version===2?['context']:[])]);if(v.version===2)validateLutContext(v.context);
  if(![1,2].includes(value.version as number)||typeof value.id!=='string'||!hash.test(value.id)||typeof value.name!=='string'||!value.name.trim()||value.name.length>255||typeof value.title!=='string'||value.title.length>255||/[\x00-\x1f\x7f]/.test(value.name+value.title)||typeof value.size!=='number'||!Number.isInteger(value.size)||value.size<2||value.size>65||typeof value.bytes!=='number'||!Number.isInteger(value.bytes)||value.bytes<1||value.bytes>32*1024*1024||typeof value.favorite!=='boolean'||typeof value.hidden!=='boolean'||value.used_at!==null&&(typeof value.used_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.used_at)||!Number.isFinite(Date.parse(value.used_at))||new Date(value.used_at).toISOString()!==value.used_at))throw new Error('Invalid LUT data.');
}

export type LutImportResult={asset:LutAsset;kind:'added'|'existing'|'restored'};
