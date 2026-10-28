import {useLayoutEffect} from 'react';
import type {RefObject} from 'react';
import type {Photo} from '../types';
import MediaImage from '../media/MediaImage';
import {t} from '../i18n';
import useViewerZoom from './useViewerZoom';
import ViewerTools from './ViewerTools';

export interface ViewerCommands {canPan:boolean;fit:()=>void;zoom:(scale:number)=>void;step:(direction:number)=>void;toggleProof:()=>void}
type Props={stage:RefObject<HTMLDivElement|null>;commands:RefObject<ViewerCommands|null>;photo:Photo;source:string;onInteract:()=>void;onProof:(proof:boolean)=>void;pinned:boolean;onPin:(pinned:boolean)=>void};
export default function ViewerPicture({stage,commands,photo,source,onInteract,onProof,pinned,onPin}:Props){
  const zoom=useViewerZoom(stage,photo.id,true,onInteract);
  useLayoutEffect(()=>{commands.current={canPan:zoom.canPan,fit:zoom.fit,zoom:zoom.zoom,step:zoom.step,toggleProof:zoom.toggleProof};return()=>{commands.current=null;};},[commands,zoom.canPan,zoom.fit,zoom.zoom,zoom.step,zoom.toggleProof]);
  useLayoutEffect(()=>onProof(zoom.proof),[zoom.proof,onProof]);
  return <>
    {source?<MediaImage key={photo.id} draggable={false} onLoad={event=>zoom.loaded(event.currentTarget)} onDoubleClick={()=>zoom.isFit?zoom.zoom(1):zoom.fit()} style={zoom.imageStyle} mediaPriority={0} fetchPriority="high" src={source} alt={photo.file_name} onError={event=>{event.currentTarget.alt=photo.preview_error?t(photo.preview_error):t('照片预览不可用');}}/>:<p className="loading" role="status">{photo.preview_status==='pending'?t('预览正在生成'):photo.preview_error?t(photo.preview_error):t('照片预览不可用')}</p>}
    <ViewerTools stage={stage} enabled ready={zoom.ready} scale={zoom.scale} isFit={zoom.isFit} proof={zoom.proof} pinned={pinned} onPin={onPin} fit={zoom.fit} zoom={zoom.zoom} step={zoom.step} toggleProof={zoom.toggleProof}/>
  </>;
}
