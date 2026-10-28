import type {Photo} from '../types';
import {parsePhotoSource} from './media-source.ts';
import {sourceDecodeProfile} from './source-decode-profile.ts';
import type {SourceDecodeProfile} from './source-decode-profile.ts';
export type DisplayEdge=4096|6144;
export type DisplayRequest={scope:string;id:string;hash:string;edge:DisplayEdge;profile?:SourceDecodeProfile};
const idPattern=/^[a-zA-Z0-9-]{1,80}$/;
export function displayRequest(photo:Photo,edge:DisplayEdge,preferRaw=false):DisplayRequest|null{
  const raw=preferRaw?photo.files.find(file=>file.is_raw&&file.preview_available):undefined;
  const source=raw||photo,hash=source.file_hash||(source.id===photo.id?photo.file_hash:undefined);
  let scope:string;try{scope=parsePhotoSource(photo.preview_url)?.libraryID||'native';}catch{return null;}
  if(![4096,6144].includes(edge))return null;
  if(!idPattern.test(source.id)||!hash||! /^[a-f0-9]{64}$/.test(hash))return null;
  return {scope,id:source.id,hash,edge,...(source.id===photo.id&&photo.decode_profile?{profile:sourceDecodeProfile(photo.decode_profile)}:{})};
}
export function displayKey(request:DisplayRequest){return JSON.stringify(request.profile?[2,request.scope,request.id,request.hash,request.edge,sourceDecodeProfile(request.profile)]:[1,request.scope,request.id,request.hash,request.edge]);}
export function parseDisplayKey(key:string):DisplayRequest{
  let value:unknown;try{value=JSON.parse(key)}catch{throw new Error('Invalid display request.');}
  if(!Array.isArray(value)||!(value.length===5&&value[0]===1||value.length===6&&value[0]===2)||typeof value[1]!=='string'||!idPattern.test(value[1])||typeof value[2]!=='string'||!idPattern.test(value[2])||typeof value[3]!=='string'||! /^[a-f0-9]{64}$/.test(value[3])||![4096,6144].includes(value[4]))throw new Error('Invalid display request.');
  if(value[0]===2&&value[5]===undefined)throw new Error('Invalid display request.');
  return {scope:value[1],id:value[2],hash:value[3],edge:value[4],...(value[0]===2?{profile:sourceDecodeProfile(value[5])}:{})};
}
