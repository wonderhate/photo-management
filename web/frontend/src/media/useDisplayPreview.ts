import {useEffect,useRef,useState} from 'react';
import type {Photo} from '../types';
import {displayRequest,displayKey} from '../core/display-request';
import type {DisplayEdge} from '../core/display-request';
import type {ResourceLease} from '../core/resource-pool';

export default function useDisplayPreview(photo:Photo|null,edge:0|DisplayEdge,enabled:boolean,preferRaw=false){
  const request=photo&&edge?displayRequest(photo,edge,preferRaw):null,key=request?displayKey(request):'';
  const active=useRef<{key:string;token:number}|null>(null),sequence=useRef(0),[retry,setRetry]=useState(0);
  const [value,setValue]=useState<{key:string;token:number;url?:string;pending?:boolean;error?:unknown}>({key:'',token:0});
  useEffect(()=>{
    if(!enabled||!key)return;
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,lease:ResourceLease|undefined;
    let failed=false,failure:unknown;const token=++sequence.current;
    const stop=()=>{clearTimeout(timer);active.current=null;lease?.release();lease=undefined;};
    const start=()=>{
      stop();if(disposed||document.hidden)return;active.current={key,token};
      if(failed){setValue({key,token,error:failure});return;}setValue({key,token,pending:true});
      timer=setTimeout(()=>{void import('./display-preview').then(({displayPool})=>{
        if(disposed||document.hidden||active.current?.token!==token)return;
        const own=displayPool.acquire(key,0);lease=own;
        void own.ready.then(url=>{if(!disposed&&lease===own&&active.current?.token===token)setValue({key,token,url});})
          .catch(error=>{if(!disposed&&lease===own&&active.current?.token===token&&error?.name!=='AbortError'){failed=true;failure=error;setValue({key,token,error});}});
      }).catch(error=>{if(!disposed&&active.current?.token===token){failed=true;failure=error;setValue({key,token,error});}});},300);
    };
    start();document.addEventListener('visibilitychange',start);
    return()=>{disposed=true;stop();document.removeEventListener('visibilitychange',start);};
  },[key,enabled,retry]);
  const current=enabled&&key&&value.key===key&&active.current?.key===key&&active.current.token===value.token;
  return {source:current&&value.url?value.url:photo?.preview_url||'',pending:!!(current&&value.pending),
    error:current?value.error:undefined,unsupported:!!(photo&&edge&&!request),ready:!!(current&&value.url),
    retry:()=>setRetry(n=>n+1)};
}
