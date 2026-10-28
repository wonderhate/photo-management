import {useEffect,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import type {MapCluster} from '../core/photo-map';
import type {Photo} from '../types';
import {bt} from '../browser/text';
import MediaImage from '../media/MediaImage';
export default function MapPhotoFan({point,requestKey,initial,load,onOpen,style}:{point:MapCluster;requestKey:string;initial?:Photo;load:(point:MapCluster,signal:AbortSignal)=>Promise<Photo[]>;onOpen:(id:string)=>void;style:CSSProperties}){
  const [items,setItems]=useState<Photo[]>(initial?[initial]:[]),latest=useRef(load);latest.current=load;
  useEffect(()=>{const controller=new AbortController();setItems(initial?[initial]:[]);if(point.count>1)void latest.current(point,controller.signal).then(photos=>{if(!controller.signal.aborted)setItems(photos.slice(0,6));}).catch(()=>{});return()=>controller.abort();},[point.photo_id,requestKey,initial]);
  return <div className="map-photo-fan" style={style} aria-label={bt('地点照片速览','Location photo previews')}><svg viewBox="-100 -100 200 200" aria-hidden="true">{items.map((p,i)=>{const a=(i/Math.max(3,items.length)*360-90)*Math.PI/180;return <path key={p.id} d={`M0 0L${Math.cos(a)*72} ${Math.sin(a)*72}`}/>;})}</svg>{items.map((p,i)=>{const a=(i/Math.max(3,items.length)*360-90)*Math.PI/180;return <button key={p.id} style={{left:Math.cos(a)*82,top:Math.sin(a)*82}} onClick={()=>onOpen(p.id)} aria-label={bt('打开照片：','Open photo: ')+p.file_name}><MediaImage src={p.thumbnail_url} alt=""/></button>;})}{point.count>items.length&&<span>+{point.count-items.length}</span>}</div>;
}
