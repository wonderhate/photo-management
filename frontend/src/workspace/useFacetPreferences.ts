import {useEffect,useRef,useState} from 'react';
import {facetDefaults,validateFacetPreferences} from '../core/photo-facets';
import type {FacetPreferences} from '../core/photo-facets';
import type {createFacetPreferenceStore} from '../core/facet-preference-store';
type FacetPreferenceStore=Awaited<ReturnType<typeof createFacetPreferenceStore>>;
import {registerPreferenceFlush,trackPreferenceWrite,waitForPendingPreferenceWrites} from '../core/preference-lifecycle';
import {message} from '../api';

const key=(id:string)=>'pc-facet-bar-pending:'+id;
function read(id:string){try{return validateFacetPreferences(JSON.parse(sessionStorage.getItem(key(id))||'{}'));}catch{return {};}}
function journal(id:string,patch:Partial<FacetPreferences>){try{if(Object.keys(patch).length)sessionStorage.setItem(key(id),JSON.stringify(patch));else sessionStorage.removeItem(key(id));}catch{/* The library save still proceeds. */}}
export default function useFacetPreferences(){
  const [value,setValue]=useState<FacetPreferences>({...facetDefaults}),[error,setError]=useState('');
  const store=useRef<FacetPreferenceStore|null>(null),pending=useRef<Partial<FacetPreferences>>({}),touched=useRef<Partial<FacetPreferences>>({}),inFlight=useRef<Partial<FacetPreferences>>({});
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),writing=useRef<Promise<void>|null>(null),alive=useRef(true);
  function report(e:unknown){if(alive.current)setError(message(e));}
  async function flush():Promise<void>{
    clearTimeout(timer.current);if(writing.current){await writing.current;return flush();}
    const target=store.current,patch=pending.current;if(!target||!Object.keys(patch).length)return;
    pending.current={};inFlight.current=patch;journal(target.libraryId,patch);
    const work=trackPreferenceWrite(target.save(patch).catch(e=>{if(store.current===target)pending.current={...patch,...pending.current};throw e;}));writing.current=work;
    try{await work;if(alive.current)setError('');}finally{if(writing.current===work){writing.current=null;inFlight.current={};journal(target.libraryId,pending.current);}}
    if(Object.keys(pending.current).length)await flush();
  }
  useEffect(()=>{
    alive.current=true;
    // Capture older page writes before registering this page's cleanup promise.
    // A failed older save keeps its journal and can be replayed by this store.
    const ready=waitForPendingPreferenceWrites().catch(()=>{});
    const loading=ready.then(()=>import('../core/facet-preference-store')).then(module=>module.createFacetPreferenceStore()).then(async target=>{
      store.current=target;const restored=read(target.libraryId);pending.current={...restored,...pending.current};
      if(alive.current)setValue({...facetDefaults,...target.value,...restored,...touched.current});
      if(Object.keys(pending.current).length)await flush();
    });
    void loading.catch(report);
    const unregister=registerPreferenceFlush(async()=>{await loading;await flush();});
    const hide=()=>void flush().catch(report);window.addEventListener('pagehide',hide);
    return()=>{alive.current=false;unregister();window.removeEventListener('pagehide',hide);void trackPreferenceWrite(loading.then(flush)).catch(report);};
  },[]);
  function update(patch:Partial<FacetPreferences>){
    patch=validateFacetPreferences(patch);touched.current={...touched.current,...patch};pending.current={...pending.current,...patch};setValue(v=>({...v,...patch}));
    if(store.current)journal(store.current.libraryId,{...inFlight.current,...pending.current});
    clearTimeout(timer.current);timer.current=setTimeout(()=>void flush().catch(report),350);
  }
  return {value,update,error,retry:()=>void flush().catch(report)};
}
