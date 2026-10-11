import {t,getLang} from './i18n';
import {isRemote,indexKey,rememberIndex,readIndex} from './remote-client';
export async function api<T>(path:string, method='GET', body?:unknown):Promise<T> {
  const key=isRemote?indexKey(path,method,body):null;
  let response:Response;
  try{
    response = await fetch('/api'+path, {method, cache:isRemote?'no-store':'default', headers:body===undefined?undefined:{'Content-Type':'application/json'}, body:body===undefined?undefined:JSON.stringify(body)});
  }catch(error){
    if(isRemote){window.dispatchEvent(new Event('photo-offline'));if(key){const saved=readIndex(localStorage,key);if(saved!==undefined)return saved as T}}
    throw new Error(isRemote?'电脑连接已断开，操作未保存。请连接后重试。':message(error));
  }
  if (!response.ok) {
    const error = await response.json().catch(()=>({detail:'请求失败'})) as {detail:unknown};
    if(isRemote&&(response.status===401||response.status===403))window.dispatchEvent(new Event('photo-auth'));
    throw new Error(typeof error.detail==='string'?error.detail:JSON.stringify(error.detail));
  }
  const value=await response.json() as T;
  if(isRemote){window.dispatchEvent(new Event('photo-online'));if(key)rememberIndex(localStorage,key,value);else if(['PATCH','PUT'].includes(method)){const detail=indexKey(path,'GET');if(detail)rememberIndex(localStorage,detail,value)}}
  return value;
}
export function message(error:unknown):string {const text=error instanceof Error?error.message:String(error);const translated=t(text);return getLang()==='en'&&translated===text&&/^[\u3400-\u9fff]/u.test(text)?'The operation failed. Please check the input and try again.':translated}
export function query(values:Record<string,string|number|undefined>):string {return new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)])).toString()}

import type {BatchEditPayload} from './types';

export async function batchEditPhotos(payload:BatchEditPayload):Promise<{updated:number}> {
  return api('/photos/batch-edit','POST',payload);
}
