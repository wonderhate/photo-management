import type {ExportResult} from './types';

export let isRemote = typeof navigator !== 'undefined' && navigator.userAgent.includes('PhotoCollectionRemote/');
export function setRemote(value:boolean){isRemote=value}
const PREFIX='remote-index:';
export function indexKey(path:string,method:string,body?:unknown):string|null {
  const route=path.split('?')[0];
  const readable=method==='GET'&&(/^\/photos(?:\/(?:ids|[^/]+))?$/.test(route)||/^\/(?:albums|filter-options|timeline|stats|reports|watermark\/drafts)(?:\/[^/]+)*$/.test(route));
  return readable||(method==='POST'&&route==='/photos/by-ids')?PREFIX+method+':'+path+(body===undefined?'':':'+JSON.stringify(body)):null;
}
export function rememberIndex(storage:Storage,key:string,value:unknown){
  try{
    const text=JSON.stringify(value);
    if(text.length>1_500_000||/data:image|blob:/.test(text))return;
    storage.removeItem(key);storage.setItem(key,text);
    const keys=Object.keys(storage).filter(k=>k.startsWith(PREFIX));
    let size=keys.reduce((n,k)=>n+k.length+(storage.getItem(k)?.length||0),0);
    while(keys.length>60||size>3_000_000){const first=keys.shift()!;size-=first.length+(storage.getItem(first)?.length||0);storage.removeItem(first)}
  }catch{/* Index cache is optional; storage quota must never prevent an operation on the computer. */}
}
export function clearIndex(storage:Storage){for(const key of Object.keys(storage))if(key.startsWith(PREFIX))storage.removeItem(key)}
export function readIndex(storage:Storage,key:string){try{const text=storage.getItem(key);return text===null?undefined:JSON.parse(text)}catch{return undefined}}
export function downloadRemote(result:ExportResult){
  if(!isRemote)return;
  const link=document.createElement('a');link.href=result.url;link.download=result.file_name;document.body.append(link);link.click();link.remove();
}
