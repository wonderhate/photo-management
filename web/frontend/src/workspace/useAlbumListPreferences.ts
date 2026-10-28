import {useEffect,useRef,useState} from 'react';
import {albumListDefaults,validateAlbumListPreferences} from '../core/album-list';
import type {AlbumListPreferences} from '../core/album-list';
import type {createAlbumPreferenceStore} from '../core/album-preference-store';
type AlbumPreferenceStore=Awaited<ReturnType<typeof createAlbumPreferenceStore>>;
import {registerPreferenceFlush,trackPreferenceWrite,waitForPendingPreferenceWrites} from '../core/preference-lifecycle';
import {message} from '../api';

const key=(id:string)=>'pc-album-list-pending:'+id;
function read(id:string){try{return validateAlbumListPreferences(JSON.parse(sessionStorage.getItem(key(id))||'{}'));}catch{return {};}}
function journal(id:string,patch:Partial<AlbumListPreferences>){try{if(Object.keys(patch).length)sessionStorage.setItem(key(id),JSON.stringify(patch));else sessionStorage.removeItem(key(id));}catch{/* The library save still proceeds. */}}
export default function useAlbumListPreferences(){
  const [value,setValue]=useState<AlbumListPreferences>({...albumListDefaults}),[error,setError]=useState('');
  const store=useRef<AlbumPreferenceStore|null>(null),pending=useRef<Partial<AlbumListPreferences>>({}),touched=useRef<Partial<AlbumListPreferences>>({}),inFlight=useRef<Partial<AlbumListPreferences>>({});
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
    const loading=ready.then(()=>import('../core/album-preference-store')).then(module=>module.createAlbumPreferenceStore()).then(async target=>{
      store.current=target;const restored=read(target.libraryId);pending.current={...restored,...pending.current};
      if(alive.current)setValue({...albumListDefaults,...target.value,...restored,...touched.current});
      if(Object.keys(pending.current).length)await flush();
    });
    void loading.catch(report);
    const unregister=registerPreferenceFlush(async()=>{await loading;await flush();});
    const hide=()=>void flush().catch(report);window.addEventListener('pagehide',hide);
    return()=>{alive.current=false;unregister();window.removeEventListener('pagehide',hide);void trackPreferenceWrite(loading.then(flush)).catch(report);};
  },[]);
  function update(patch:Partial<AlbumListPreferences>){
    patch=validateAlbumListPreferences(patch);touched.current={...touched.current,...patch};pending.current={...pending.current,...patch};setValue(v=>({...v,...patch}));
    if(store.current)journal(store.current.libraryId,{...inFlight.current,...pending.current});
    clearTimeout(timer.current);timer.current=setTimeout(()=>void flush().catch(report),350);
  }
  return {value,update,error,retry:()=>void flush().catch(report)};
}
