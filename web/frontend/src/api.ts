import {t,getLang} from './i18n';
import {IS_BROWSER} from './runtime';
import {browserError} from './browser/text';
let nativeBinding:{session:string;library:string}|undefined;
export async function nativeFetch(url:string,init:RequestInit={}):Promise<Response>{
  const headers=new Headers(init.headers);
  if(nativeBinding){headers.set('X-PhotoCollection-Session',nativeBinding.session);headers.set('X-PhotoCollection-Library',nativeBinding.library);}
  const response=await fetch(url,{...init,headers});
  const session=response.headers.get('X-PhotoCollection-Session'),library=response.headers.get('X-PhotoCollection-Library');
  if(session&&library){
    if(nativeBinding&&(nativeBinding.session!==session||nativeBinding.library!==library))throw new Error('图库已切换，请刷新页面后继续');
    nativeBinding={session,library};
  }
  return response;
}
export function scopeNativeResult<T>(value:T):T{
  if(!nativeBinding)return value;
  const visit=(item:any):any=>{
    if(Array.isArray(item))return item.map(visit);
    if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).map(([key,entry])=>[key,typeof entry==='string'&&(key==='url'||key.endsWith('_url'))&&entry.startsWith('/api/')?entry+(entry.includes('?')?'&':'?')+'pc_session='+encodeURIComponent(nativeBinding!.session):visit(entry)]));
    return item;
  };
  return visit(value) as T;
}
export async function api<T>(path:string, method='GET', body?:unknown,signal?:AbortSignal):Promise<T> {
  signal?.throwIfAborted();
  if(IS_BROWSER){const result=await (await import('./browser/api')).browserAPI<T>(path,method,body,signal);signal?.throwIfAborted();return result;}
  const response = await nativeFetch('/api'+path, {method, headers:body===undefined?undefined:{'Content-Type':'application/json'}, body:body===undefined?undefined:JSON.stringify(body),signal});
  if (!response.ok) {
    const error = await response.json().catch(()=>({detail:'请求失败'})) as {detail:unknown};
    throw new Error(typeof error.detail==='string'?error.detail:JSON.stringify(error.detail));
  }
  return scopeNativeResult(await response.json() as T);
}
export function message(error:unknown):string {let text=browserError(error);if(text==='Invalid composition.'||text==='Composition source dimensions changed. Reopen the photo.'||text.startsWith('Split ')||text.startsWith('Invalid split ')||text==='Invalid seamless split.'||text==='The split region needs at least one pixel per panel.')text=browserError(text);if(text==='Invalid face model space.')text='人脸模型记录不一致，请保留图库并检查模型';if(text==='Invalid face embedding.')text='人脸向量无效，分析结果未保存';if(text==='Invalid face observation.')text='人脸位置或向量无效，分析结果未保存';if(text==='Invalid photo scope.')text='检索范围无效，请返回全部照片重新选择。';if(text==='Search scope belongs to another library.')text='此检索范围属于其他图库，请返回全部照片。';if(text==='The scoped collection no longer exists.')text='此检索范围的影集已不存在，请返回全部照片。';if(text==='The scoped person no longer exists.')text='此检索范围的人物已不存在，请返回全部照片。';if(text==='Invalid photo tags query.')text='标签查询无效，请检查搜索词和分页。';if(text==='Invalid photo facets.')text='筛选条件无效，请检查范围或选项。';if(text==='Invalid filter bar preferences.')text='筛选栏设置无效。';if(text==='Invalid photo query.')text='照片条件无效，请检查字段、数值和分组';const translated=t(text);return getLang()==='en'&&translated===text&&/^[\u3400-\u9fff]/u.test(text)?'The operation failed. Please check the input and try again.':translated}
export function query(values:Record<string,string|number|undefined>):string {return new URLSearchParams(Object.entries(values).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)])).toString()}

import type {BatchEditPayload} from './types';

export async function batchEditPhotos(payload:BatchEditPayload):Promise<{updated:number}> {
  return api('/photos/batch-edit','POST',payload);
}

export async function apiBlob(path:string,body:unknown,signal?:AbortSignal):Promise<Blob>{
  if(IS_BROWSER){const blob=await (await import('./browser/api')).browserBlob(path,body);signal?.throwIfAborted();return blob;}
  const response=await nativeFetch('/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  if(!response.ok){const error=await response.json().catch(()=>({detail:t('请求失败')})) as {detail:unknown};throw new Error(typeof error.detail==='string'?error.detail:JSON.stringify(error.detail));}return response.blob();
}
