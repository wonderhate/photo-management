import {validateGalleryPreferences,validateToolPreferenceValues} from './preferences.ts';
import {validateFacetPreferences} from './photo-facets.ts';
import {aiProfile} from './ai-studio.ts';
import type {AIProfileRecord} from './ai-studio.ts';
export type TransferredAccount={profile:AIProfileRecord;api_key?:string};
export type SettingsSelection={global?:{theme?:'light'|'dark';lang?:'zh'|'en'};gallery?:ReturnType<typeof validateGalleryPreferences>;tools?:ReturnType<typeof validateToolPreferenceValues>;facets?:ReturnType<typeof validateFacetPreferences>};
export type SettingsPackage={application:'photocollection-settings';version:1;preferences:SettingsSelection;accounts?:TransferredAccount[]};
const invalid=()=>{throw new Error('Invalid or unsupported settings package.');};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validateSettings(value:unknown):SettingsPackage{
  if(!object(value)||value.application!=='photocollection-settings'||value.version!==1||Object.keys(value).some(k=>!['application','version','preferences','accounts'].includes(k))||!object(value.preferences))return invalid();
  if(value.accounts!==undefined){if(!Array.isArray(value.accounts)||value.accounts.length>20)return invalid();for(const entry of value.accounts){if(!object(entry)||Object.keys(entry).some(k=>!['profile','api_key'].includes(k)))return invalid();aiProfile(entry.profile);if(entry.api_key!==undefined&&(typeof entry.api_key!=='string'||entry.api_key.length<10||entry.api_key.length>512||/\s/.test(entry.api_key)))return invalid();}}
  const p=value.preferences;if(Object.keys(p).some(k=>!['global','gallery','tools','facets'].includes(k)))return invalid();
  if(p.global!==undefined&&(!object(p.global)||Object.entries(p.global).some(([k,v])=>typeof v!=='string'||(k==='theme'?!['light','dark'].includes(v):k==='lang'?!['zh','en'].includes(v):true))))return invalid();
  if(p.gallery!==undefined)validateGalleryPreferences(p.gallery);if(p.tools!==undefined)validateToolPreferenceValues(p.tools);if(p.facets!==undefined)validateFacetPreferences(p.facets);
  if(JSON.stringify(value).length>1024*1024)return invalid();return structuredClone(value) as SettingsPackage;
}
const encode=(bytes:Uint8Array)=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
const decode=(v:unknown,length?:number)=>{if(typeof v!=='string'||v.length>2*1024*1024||! /^[A-Za-z0-9+/]*={0,2}$/.test(v))return invalid();const b=Uint8Array.from(atob(v),c=>c.charCodeAt(0));if(length!==undefined&&b.length!==length)return invalid();return b;};
const aad=new TextEncoder().encode('photocollection-settings:v1:PBKDF2-SHA256:310000:AES-GCM');
async function key(password:string,salt:Uint8Array,usage:KeyUsage[]){
  if(password.length<12||password.length>1024)throw new Error('Use a password of 12 to 1024 characters.');
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt as Uint8Array<ArrayBuffer>,iterations:310000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,usage);
}
export async function encryptSettings(value:unknown,password:string){
  const data=validateSettings(value),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await key(password,salt,['encrypt']),new TextEncoder().encode(JSON.stringify(data)));
  return JSON.stringify({application:'photocollection-encrypted-settings',version:1,kdf:'PBKDF2-SHA256',iterations:310000,cipher:'AES-256-GCM',salt:encode(salt),iv:encode(iv),data:encode(new Uint8Array(encrypted))});
}
export async function decryptSettings(text:string,password:string){
  if(text.length>2*1024*1024)return invalid();const e=JSON.parse(text);
  if(!object(e)||Object.keys(e).sort().join(',')!=='application,cipher,data,iterations,iv,kdf,salt,version'||e.application!=='photocollection-encrypted-settings'||e.version!==1||e.kdf!=='PBKDF2-SHA256'||e.iterations!==310000||e.cipher!=='AES-256-GCM')return invalid();
  const salt=decode(e.salt,16),iv=decode(e.iv,12),data=decode(e.data);if(data.length<16)return invalid();
  let plain:ArrayBuffer;
  try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv as Uint8Array<ArrayBuffer>,additionalData:aad},await key(password,salt,['decrypt']),data as Uint8Array<ArrayBuffer>);}
  catch{throw new Error('Wrong password or damaged settings package.');}
  return validateSettings(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)));
}
