import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import type {CollageBook} from '../core/collage-book';
import {assertCollageSources} from '../core/collage-batch-export';
import {CollageSession} from '../browser/collage-session';
import type {CollageInput} from '../browser/collage-session';
/** Visible pages share one worker. At most 24 small previews survive scrolling. */
export function useCollageBatchPreviews(book:CollageBook|null,inputs:CollageInput[],root:RefObject<HTMLDivElement|null>,paused:boolean){
 const [previews,setPreviews]=useState<Record<number,string>>({}),[errors,setErrors]=useState<Record<number,boolean>>({});const urls=useRef(new Map<number,string>()),previous=useRef('');const signature=JSON.stringify(book?.pages||[]);
 useEffect(()=>()=>{for(const url of urls.current.values())URL.revokeObjectURL(url);urls.current.clear();},[]);
 useEffect(()=>{
  if(previous.current!==signature){previous.current=signature;setPreviews({});setErrors({});for(const url of urls.current.values())URL.revokeObjectURL(url);urls.current.clear();}
  if(!book||paused||!root.current)return;let alive=true,active=false;const pending=new Set<number>(),worker=new CollageSession(),byId=new Map(inputs.map(i=>[i.id,i]));
  async function pump(){if(active||!alive)return;active=true;try{while(pending.size&&alive){const index=pending.values().next().value!;pending.delete(index);if(urls.current.has(index))continue;
   try{const scene=book!.pages[index];assertCollageSources(scene,await worker.open(scene.sources.map(s=>byId.get(s.id)!)));const output=await worker.render(scene);if(!alive)break;
    const image=await createImageBitmap(output.blob);let blob:Blob;try{const scale=Math.min(1,360/Math.max(image.width,image.height)),canvas=new OffscreenCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);blob=await canvas.convertToBlob({type:'image/png'});}finally{image.close();}if(!alive)break;
    urls.current.set(index,URL.createObjectURL(blob));if(urls.current.size>24){const oldest=urls.current.keys().next().value!;URL.revokeObjectURL(urls.current.get(oldest)!);urls.current.delete(oldest);}setPreviews(Object.fromEntries(urls.current));
   }catch{if(alive)setErrors(old=>({...old,[index]:true}));}
  }}finally{active=false;}}
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){const index=Number((entry.target as HTMLElement).dataset.batchPage);if(entry.isIntersecting&&!urls.current.has(index))pending.add(index);else if(!entry.isIntersecting)pending.delete(index);}void pump();},{rootMargin:'100px'});
  root.current.querySelectorAll('[data-batch-page]').forEach(element=>observer.observe(element));
  return()=>{alive=false;observer.disconnect();pending.clear();worker.close();};
 },[signature,inputs,paused]);
 return {previews,errors};
}
