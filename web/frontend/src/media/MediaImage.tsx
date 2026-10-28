import {useEffect,useRef,useState} from 'react';
import type {ImgHTMLAttributes} from 'react';
import {isLocalMediaSource} from '../core/media-source';

export function useMediaURL(source:string,priority=1,enabled=true){
  const token=useRef(0),active=useRef<{source:string;token:number}|null>(null);
  const [value,setValue]=useState<{source:string;url:string;token?:number;error?:unknown}>(()=>({source,url:isLocalMediaSource(source)?'':source}));
  useEffect(()=>{
    if(!enabled||!isLocalMediaSource(source))return;
    let disposed=false,release:(()=>void)|undefined;const own=++token.current;active.current={source,token:own};
    void import('../browser/photo-media').then(({photoMediaPool})=>{
      if(disposed)return;const lease=photoMediaPool.acquire(source,priority);release=lease.release;
      void lease.ready.then(url=>{if(!disposed)setValue({source,url,token:own});}).catch(error=>{if(!disposed&&error?.name!=='AbortError')setValue({source,url:'',token:own,error});});
    }).catch(error=>{if(!disposed)setValue({source,url:'',token:own,error});});
    return()=>{disposed=true;if(active.current?.token===own)active.current=null;release?.();};
  },[source,priority,enabled]);
  if(!isLocalMediaSource(source))return {url:source,error:undefined};
  return enabled&&value.source===source&&active.current?.source===source&&active.current.token===value.token?{url:value.url,error:value.error}:{url:'',error:undefined};
}

const visibilityCallbacks=new Map<Element,(visible:boolean)=>void>();let observer:IntersectionObserver|undefined;
function observe(element:Element,callback:(visible:boolean)=>void){
  observer??=new IntersectionObserver(entries=>{for(const entry of entries)visibilityCallbacks.get(entry.target)?.(entry.isIntersecting);},{rootMargin:'600px'});
  visibilityCallbacks.set(element,callback);observer.observe(element);
  return()=>{observer?.unobserve(element);visibilityCallbacks.delete(element);};
}

export default function MediaImage({src='',mediaPriority,fetchPriority,...props}:ImgHTMLAttributes<HTMLImageElement>&{mediaPriority?:number}){
  const element=useRef<HTMLImageElement>(null),local=isLocalMediaSource(src);
  const priority=mediaPriority??(fetchPriority==='high'?0:fetchPriority==='low'?20:10);
  const [visible,setVisible]=useState(!local||priority<=1),enabled=!local||priority<=1||visible;
  const {url,error}=useMediaURL(src,priority,enabled);
  useEffect(()=>{
    if(!local||priority<=1||!element.current)return;
    return observe(element.current,setVisible);
  },[src,local,priority]);
  useEffect(()=>{if(error)element.current?.dispatchEvent(new Event('error'));},[error]);
  return <img {...props} ref={element} src={url||undefined} fetchPriority={fetchPriority} data-media-source={local?src:undefined}/>;
}
