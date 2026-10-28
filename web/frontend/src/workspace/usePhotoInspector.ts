import {createContext,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {Photo} from '../types';
import {api,message} from '../api';

export interface PhotoHoverActions {enter:(photo:Photo)=>void;leave:(id:string)=>void}
export const PhotoHoverContext=createContext<PhotoHoverActions|null>(null);

// Hover is a preview identity, independent of the library's selection model.
export function usePhotoInspector(scope:string,enabled:boolean,suspended:boolean){
  const [photo,setPhoto]=useState<Photo|null>(null),[visible,setVisible]=useState(false);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const current=useRef({scope,enabled,suspended,open:false,id:'',candidate:'',generation:0});
  const request=useRef<AbortController|null>(null);
  current.current.enabled=enabled;current.current.suspended=suspended;
  const cancelPending=useCallback(()=>{clearTimeout(timer.current);timer.current=undefined;current.current.candidate='';},[]);
  const cancelRequest=useCallback(()=>{current.current.generation++;request.current?.abort();request.current=null;},[]);
  const close=useCallback(()=>{cancelPending();cancelRequest();current.current.open=false;current.current.id='';setVisible(false);setLoading(false);setError('');},[cancelPending,cancelRequest]);
  const show=useCallback((source:Photo)=>{
    const state=current.current;
    if(!state.enabled||state.suspended||document.hidden)return;
    cancelPending();
    if(state.open&&state.id===source.id)return;
    cancelRequest();const generation=state.generation,scopeAtStart=state.scope;
    state.open=true;state.id=source.id;setPhoto(source);setVisible(true);setLoading(true);setError('');
    const controller=new AbortController();request.current=controller;
    void api<Photo>('/photos/'+source.id,'GET',undefined,controller.signal).then(detail=>{
      const latest=current.current;
      if(controller.signal.aborted||latest.generation!==generation||latest.scope!==scopeAtStart||!latest.open||latest.id!==source.id)return;
      setPhoto(detail);setLoading(false);
    }).catch(reason=>{
      if(controller.signal.aborted||current.current.generation!==generation)return;
      setLoading(false);setError(message(reason));
    });
  },[cancelPending,cancelRequest]);
  const enter=useCallback((source:Photo)=>{
    const state=current.current;if(!state.enabled||state.suspended||document.hidden)return;
    if(state.open){show(source);return;}
    // A redraw can leave the pointer on the same card without another enter.
    // Move events recover that dwell, while keeping its initial deadline.
    if(state.candidate===source.id)return;
    cancelPending();
    state.candidate=source.id;const scopeAtStart=state.scope;
    timer.current=setTimeout(()=>{if(current.current.candidate===source.id&&current.current.scope===scopeAtStart)show(source);},1000);
  },[cancelPending,show]);
  const leave=useCallback((id:string)=>{if(current.current.candidate===id)cancelPending();},[cancelPending]);
  const update=useCallback((next:Photo)=>{if(current.current.id!==next.id)return;cancelRequest();setPhoto(next);setLoading(false);setError('');},[cancelRequest]);
  const patch=useCallback((id:string,values:Partial<Photo>)=>{if(current.current.id!==id)return;cancelRequest();setPhoto(previous=>previous?.id===id?{...previous,...values}:previous);setLoading(false);setError('');},[cancelRequest]);
  useEffect(()=>{current.current.scope=scope;close();},[scope,close]);
  useEffect(()=>{if(!enabled)close();else if(suspended){cancelPending();cancelRequest();setLoading(false);}},[enabled,suspended,close,cancelPending,cancelRequest]);
  useEffect(()=>{const hide=()=>{if(document.hidden){cancelPending();cancelRequest();setLoading(false);}};document.addEventListener('visibilitychange',hide);return()=>{document.removeEventListener('visibilitychange',hide);cancelPending();request.current?.abort();};},[cancelPending,cancelRequest]);
  return {photo,visible,loading,error,show,close,update,patch,actions:useMemo(()=>({enter,leave}),[enter,leave])};
}
