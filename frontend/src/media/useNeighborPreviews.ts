import {useEffect} from 'react';
import {photoURL} from '../runtime';
import {isLocalPhotoSource} from '../core/media-source';
import type {ResourceLease} from '../core/resource-pool';

// At most the two adjacent previews are warmed after the current target settles.
export default function useNeighborPreviews(currentID:string,ids:string[],enabled:boolean){
  const index=ids.indexOf(currentID),neighbors=index<0?[]:[ids[index-1],ids[index+1]].filter((id):id is string=>!!id);
  const key=neighbors.join('|');
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
    const images:HTMLImageElement[]=[],leases:ResourceLease[]=[];
    const stop=()=>{clearTimeout(timer);controller?.abort();for(const image of images)image.removeAttribute('src');images.length=0;for(const lease of leases)lease.release();leases.length=0;};
    const start=()=>{
      stop();if(!enabled||document.hidden||!key)return;
      timer=setTimeout(()=>{
        const own=new AbortController();controller=own;
        const image=(url:string)=>{if(own.signal.aborted)return;const item=new Image();item.decoding='async';item.fetchPriority='low';images.push(item);item.src=url;};
        for(const id of key.split('|')){
          const source=photoURL(id,'preview');
          if(isLocalPhotoSource(source))void import('../browser/photo-media').then(({photoMediaPool})=>{
            if(own.signal.aborted)return;const lease=photoMediaPool.acquire(source,20);leases.push(lease);void lease.ready.then(image).catch(()=>{});
          }).catch(()=>{});
          else image(source);
        }
      },300);
    };
    start();document.addEventListener('visibilitychange',start);
    return()=>{stop();document.removeEventListener('visibilitychange',start);};
  },[currentID,key,enabled]);
}
