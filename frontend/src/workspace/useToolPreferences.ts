import {useEffect,useRef,useState} from 'react';
import {validateToolPreferences} from '../core/preferences';
import type {ToolId,ToolPreferences} from '../core/preferences';
import {registerPreferenceFlush,trackPreferenceWrite,waitForPendingPreferenceWrites} from '../core/preference-lifecycle';
import {bt} from '../browser/text';
import {message} from '../api';

export default function useToolPreferences<K extends ToolId>(kind:K,defaults:ToolPreferences[K],onError:(text:string)=>void){
  type Patch=Partial<ToolPreferences[K]>;
  type Store={libraryId:string;value:Patch;save:(patch:Patch)=>Promise<void>};
  const [value,setValue]=useState<ToolPreferences[K]>(()=>({...defaults}));
  const latest=useRef<ToolPreferences[K]>(value),loadingRef=useRef<Promise<void>|null>(null);latest.current=value;
  const store=useRef<Store|null>(null),pending=useRef<Patch>({}),inFlight=useRef<Patch>({}),touched=useRef<Patch>({}),restored=useRef<Patch>({});
  const fallback=useRef(defaults);fallback.current=defaults;const errors=useRef(onError);errors.current=onError;
  const writing=useRef<Promise<void>|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const journalKey=(id:string)=>'pc-tool-pending:'+id+':'+kind;
  function journal(id:string,patch:Patch){try{if(Object.keys(patch).length)sessionStorage.setItem(journalKey(id),JSON.stringify(patch));else sessionStorage.removeItem(journalKey(id));}catch{/* The durable adapter still runs. */}}
  function report(error:unknown){errors.current(bt('工具设置未保存：','Tool settings were not saved: ')+message(error));}
  async function flush():Promise<void>{
    clearTimeout(timer.current);if(writing.current){await writing.current;return flush();}
    const target=store.current,patch=pending.current;if(!target||!Object.keys(patch).length)return;
    pending.current={};inFlight.current=patch;journal(target.libraryId,patch);
    const work=trackPreferenceWrite(target.save(patch).catch(error=>{pending.current={...patch,...pending.current};throw error;}));writing.current=work;
    try{await work;restored.current={...restored.current,...patch};}finally{if(writing.current===work){writing.current=null;inFlight.current={};journal(target.libraryId,pending.current);}}
    if(Object.keys(pending.current).length)await flush();
  }
  useEffect(()=>{
    let alive=true;
    const ready=waitForPendingPreferenceWrites();
    const loading=ready.then(()=>import('../core/tool-preference-store')).then(module=>module.createToolPreferenceStore(kind)).then(async target=>{
      store.current=target;let saved:Patch={};try{saved=validateToolPreferences(kind,JSON.parse(sessionStorage.getItem(journalKey(target.libraryId))||'{}'));}catch{/* Bad optional journal cannot modify settings. */}
      pending.current={...saved,...pending.current};restored.current={...target.value,...saved};
      if(alive){latest.current={...fallback.current,...restored.current,...touched.current};setValue(latest.current);}
      if(Object.keys(pending.current).length)await flush();
    });
    loadingRef.current=loading;void loading.catch(report);
    const unregister=registerPreferenceFlush(async()=>{await loading;await flush();});
    const hide=()=>{void trackPreferenceWrite(loading.then(flush)).catch(report);};window.addEventListener('pagehide',hide);
    return()=>{alive=false;clearTimeout(timer.current);unregister();window.removeEventListener('pagehide',hide);void trackPreferenceWrite(loading.then(flush)).catch(report);};
  },[kind]);
  const defaultsKey=JSON.stringify(defaults);
  useEffect(()=>{setValue({...fallback.current,...restored.current,...touched.current});},[defaultsKey]);
  function update(patch:Patch){
    validateToolPreferences(kind,patch);touched.current={...touched.current,...patch};pending.current={...pending.current,...patch};latest.current={...latest.current,...patch};setValue(latest.current);
    if(store.current)journal(store.current.libraryId,{...inFlight.current,...pending.current});
    clearTimeout(timer.current);timer.current=setTimeout(()=>void flush().catch(report),350);
  }
  return [value,update,async()=>{await loadingRef.current?.catch(()=>{});return latest.current;}] as const;
}
