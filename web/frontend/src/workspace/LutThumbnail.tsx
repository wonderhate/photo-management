import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import type {LutAsset} from '../core/lut-contract';
import type {LutPreviewQueue} from '../core/lut-preview-queue';
import {bt,browserError} from '../browser/text';
export default function LutThumbnail({asset,queue,children}:{asset:LutAsset;queue:LutPreviewQueue<LutAsset>|null;children:(image:ReactNode)=>ReactNode}){
 const ref=useRef<HTMLDivElement>(null),[src,setSrc]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let alive=true,visible=false,failed=false,lease:{promise:Promise<string>;release:()=>void}|null=null,serial=0;setSrc('');setError('');
  const observer=new IntersectionObserver(entries=>{for(const entry of entries){visible=entry.isIntersecting;if(!visible){serial++;lease?.release();lease=null;setSrc('');}else if(queue&&!lease&&!failed){const token=++serial;try{lease=queue.acquire(asset);void lease.promise.then(url=>{if(alive&&visible&&token===serial)setSrc(url);}).catch(e=>{if(alive&&visible&&token===serial&&!(e instanceof DOMException&&e.name==='AbortError')){failed=true;setError(browserError(e));}});}catch{/* A disposed queue is replaced by the new render effect. */}}}},{rootMargin:'80px'});
  if(ref.current)observer.observe(ref.current);return()=>{alive=false;observer.disconnect();lease?.release();};
 },[asset.id,queue,retry]);
 return <div ref={ref} className="lut-preview">{children(<span className="lut-thumbnail">{src?<img src={src} alt="" loading="lazy"/>:<span aria-hidden="true">{error?'!':'◈'}</span>}</span>)}{error&&<div className="lut-thumbnail-error" role="status"><small>{error}</small><button onClick={()=>setRetry(n=>n+1)}>{bt('重试缩略图','Retry thumbnail')}</button></div>}</div>;
}
