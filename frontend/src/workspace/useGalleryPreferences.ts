import {useEffect,useRef,useState} from 'react';
import {createPreferenceStore} from '../core/preference-store';
import {galleryDefaults,legacyGallery,validateGalleryPreferences} from '../core/preferences';
import type {GalleryPreferences,PreferenceStore} from '../core/preferences';
import {message} from '../api';
import {bt} from '../browser/text';
import {registerPreferenceFlush} from '../core/preference-lifecycle';

const migratedKey='pc-gallery-preferences-migrated';
const journalKey=(id:string)=>'pc-gallery-pending:'+id;
function journal(id:string):Partial<GalleryPreferences>{try{return validateGalleryPreferences(JSON.parse(sessionStorage.getItem(journalKey(id))||'{}'));}catch{return {};}}
function saveJournal(id:string,patch:Partial<GalleryPreferences>){try{if(Object.keys(patch).length)sessionStorage.setItem(journalKey(id),JSON.stringify(patch));else sessionStorage.removeItem(journalKey(id));}catch{/* Durable storage still proceeds if the tab journal is unavailable. */}}
export default function useGalleryPreferences(onError:(s:string)=>void){
  const [value,setValue]=useState<GalleryPreferences>({...galleryDefaults});
  const store=useRef<PreferenceStore|null>(null),pending=useRef<Partial<GalleryPreferences>>({}),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const touched=useRef<Partial<GalleryPreferences>>({});
  const writing=useRef<Promise<void>|null>(null);
  const inFlight=useRef<Partial<GalleryPreferences>>({});
  const errors=useRef(onError);errors.current=onError;
  function report(e:unknown){errors.current(bt('浏览设置未保存：','View settings were not saved: ')+message(e));}
  async function flush(){
    clearTimeout(timer.current);
    if(writing.current){await writing.current;return flush();}
    const target=store.current,patch=pending.current;if(!target||!Object.keys(patch).length)return;
    pending.current={};inFlight.current=patch;saveJournal(target.libraryId,patch);
    const work=target.saveGallery(patch).catch(e=>{if(store.current===target)pending.current={...patch,...pending.current};throw e;});
    writing.current=work;
    try{await work;}finally{if(writing.current===work){writing.current=null;inFlight.current={};saveJournal(target.libraryId,pending.current);}}
    if(Object.keys(pending.current).length)return flush();
  }
  useEffect(()=>{
    let alive=true;
    const loading=createPreferenceStore().then(async target=>{
      if(!alive)return;
      store.current=target;
      const restored=journal(target.libraryId);pending.current={...restored,...pending.current};
      let inherited:Partial<GalleryPreferences>={};
      try{if(!localStorage.getItem(migratedKey)){inherited=legacyGallery(localStorage);if(Object.keys(inherited).length){await target.saveGallery({...inherited,...target.gallery});}localStorage.setItem(migratedKey,target.libraryId);}}catch(e){report(e);}
      if(!alive)return;
      setValue({...galleryDefaults,...inherited,...target.gallery,...restored,...touched.current});
      if(Object.keys(pending.current).length)await flush();
    }).catch(report);
    const unregister=registerPreferenceFlush(async()=>{await loading;await flush();});
    const hide=()=>void flush().catch(report);window.addEventListener('pagehide',hide);
    return()=>{alive=false;unregister();window.removeEventListener('pagehide',hide);void flush().catch(report);};
  },[]);
  function update(patch:Partial<GalleryPreferences>){
    validateGalleryPreferences(patch);touched.current={...touched.current,...patch};pending.current={...pending.current,...patch};setValue(v=>({...v,...patch}));
    if(store.current)saveJournal(store.current.libraryId,{...inFlight.current,...pending.current});
    clearTimeout(timer.current);timer.current=setTimeout(()=>void flush().catch(report),350);
  }
  return [value,update] as const;
}
