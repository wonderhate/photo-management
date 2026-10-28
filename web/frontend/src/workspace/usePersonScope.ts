import {useCallback,useEffect,useRef,useState} from 'react';
import {api,message} from '../api';
import {IS_BROWSER} from '../runtime';
import {bt} from '../browser/text';
import type {CountMode} from '../core/query-scope';

export interface PersonScopeState {id:string;name:string;library_id:string;mode:CountMode;revision:string;photo_count:number;pending:number;total:number;ignored:boolean;merged_into:{id:string;name:string}|null}
export function usePersonScope(personId:string,libraryId:string,mode:CountMode,enabled:boolean,onChanged:()=>void){
  const key=JSON.stringify([personId,libraryId,mode]),changed=useRef(onChanged);changed.current=onChanged;
  const seen=useRef({key:'',revision:'',error:''}),read=useRef<(()=>void)|null>(null);
  const [value,setValue]=useState<{key:string;data:PersonScopeState|null;error:string;loading:boolean}>({key:'',data:null,error:'',loading:false});
  useEffect(()=>{
    if(IS_BROWSER||!enabled||!personId||!libraryId)return;
    if(seen.current.key!==key)seen.current={key,revision:'',error:''};
    let alive=true,sequence=0,timer:ReturnType<typeof setTimeout>|undefined,request:AbortController|null=null;
    async function poll(force=false){
      if(!alive||document.visibilityState==='hidden')return;
      clearTimeout(timer);request?.abort();const controller=new AbortController();request=controller;const own=++sequence;
      setValue(old=>({key,data:old.key===key?old.data:null,error:old.key===key?old.error:'',loading:true}));
      const current=()=>alive&&own===sequence&&!controller.signal.aborted;
      try{
        const data=await api<PersonScopeState>(`/faces/persons/${encodeURIComponent(personId)}/scope?`+new URLSearchParams({library_id:libraryId,count_mode:mode}),'GET',undefined,controller.signal);
        if(!current())return;
        if(!data||data.id!==personId||data.library_id!==libraryId||data.mode!==mode||typeof data.name!=='string'||!/^[a-f0-9]{64}$/.test(data.revision)||typeof data.ignored!=='boolean'||![data.total,data.pending,data.photo_count].every(v=>Number.isSafeInteger(v)&&v>=0)||!(data.merged_into===null||typeof data.merged_into?.id==='string'&&typeof data.merged_into?.name==='string'))throw new Error(bt('人物范围响应无效，请刷新后重试。','Invalid person scope response. Refresh and try again.'));
        const refresh=force||seen.current.revision!==data.revision||!!seen.current.error;
        seen.current={key,revision:data.revision,error:''};setValue({key,data,error:'',loading:false});if(refresh)changed.current();
      }catch(e){if(current()){const error=message(e),refresh=force||seen.current.error!==error;seen.current={...seen.current,error};setValue({key,data:null,error,loading:false});if(refresh)changed.current();}}
      finally{if(current())timer=setTimeout(()=>void poll(),5000)}
    }
    const manual=()=>void poll(true);read.current=manual;
    const visibility=()=>{clearTimeout(timer);sequence++;request?.abort();if(document.visibilityState==='visible')void poll()};
    document.addEventListener('visibilitychange',visibility);void poll();
    return()=>{alive=false;sequence++;clearTimeout(timer);request?.abort();document.removeEventListener('visibilitychange',visibility);if(read.current===manual)read.current=null};
  },[key,enabled,personId,libraryId,mode]);
  const refresh=useCallback(()=>read.current?.(),[]);
  return {...(value.key===key?value:{data:null,error:'',loading:false}),refresh};
}
