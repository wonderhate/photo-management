import {useCallback,useEffect,useRef,useState} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import {api,message} from '../api';
import type {Photo} from '../types';

export function usePhotoViewer(scope:string,setPhoto:Dispatch<SetStateAction<Photo|null>>,notify:(text:string)=>void){
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  const previewTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const requested=useRef(''),[pendingID,setPendingID]=useState('');
  const cancel=useCallback(()=>{generation.current++;clearTimeout(previewTimer.current);request.current?.abort();request.current=null;requested.current='';},[]);
  const close=useCallback(()=>{cancel();setPendingID('');setPhoto(null);},[cancel,setPhoto]);
  const load=useCallback(async(id:string,originCurrent?:()=>boolean)=>{
    // An old film advance callback must not cancel a newer user-initiated request.
    if(originCurrent&&!originCurrent())return null;
    cancel();const own=generation.current,controller=new AbortController();request.current=controller;requested.current=id;setPendingID(id);
    const current=()=>generation.current===own&&!controller.signal.aborted;
    try{
      const photo=await api<Photo>('/photos/'+id,'GET',undefined,controller.signal);
      if(!current())return null;
      if(originCurrent&&!originCurrent()){requested.current='';setPendingID('');return null;}
      setPendingID('');setPhoto(photo);
      if(photo.preview_status==='pending'){
        const refresh=async()=>{
          try{
            const fresh=await api<Photo>('/photos/'+id,'GET',undefined,controller.signal);if(!current())return;
            if(fresh.preview_status==='pending'){previewTimer.current=setTimeout(()=>void refresh(),1000);return;}
            // A preview refresh must not replace rating/tag changes made while
            // its GET was in flight, or the photo navigated to afterwards.
            setPhoto(previous=>current()&&previous?.id===id?{...previous,preview_status:fresh.preview_status,preview_url:fresh.preview_url,thumbnail_url:fresh.thumbnail_url,thumbnail_path:fresh.thumbnail_path,preview_error:fresh.preview_error,width:fresh.width,height:fresh.height,files:previous.files.map(file=>({...file,preview_available:fresh.files.find(f=>f.id===file.id)?.preview_available??file.preview_available}))}:previous);
          }catch(reason){if(current())setPhoto(previous=>previous?.id===id?{...previous,preview_status:'failed',preview_error:message(reason)}:previous);}
        };
        previewTimer.current=setTimeout(()=>void refresh(),1000);
      }
      return {photo,signal:controller.signal,current};
    }catch(reason){if(current()){requested.current='';setPendingID('');notify(message(reason));}return null;}
  },[cancel,notify,setPhoto]);
  useEffect(()=>{close();return cancel;},[scope,close,cancel]);
  return {load,close,requested,pendingID,generation};
}
