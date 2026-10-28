import {t} from './i18n';
import {bt} from './browser/text';
import {useState,useEffect,useRef} from 'react';
import {X,ZoomIn,ZoomOut,GitCompare,Link,Unlink,Focus} from 'lucide-react';
import {api,message} from './api';
import {Empty} from './components';
import type {Photo} from './types';
import ComparePicture from './workspace/ComparePicture';
import {comparisonDefault,comparisonZoom} from './core/comparison-view';
import type {ComparisonPose} from './core/comparison-view';
import './workspace/compare.css';
import useToolPreferences from './workspace/useToolPreferences';
import {toolDefaults} from './core/preferences';

type Views={linked:boolean;shared:ComparisonPose;individual:Record<string,ComparisonPose>};
const initialViews=(linked=true):Views=>({linked,shared:comparisonDefault(),individual:{}});
const poseFor=(views:Views,id:string)=>views.linked?views.shared:views.individual[id]||comparisonDefault();

export default function ComparePage({ids,notify,onClose}:{ids:string[];notify:(msg:string)=>void;onClose:()=>void}){
  const [photos,setPhotos]=useState<Photo[]>([]);
  const [views,setViews]=useState<Views>(initialViews),[active,setActive]=useState('');
  const [loading,setLoading]=useState(false);
  const [preferences,savePreferences]=useToolPreferences('compare',toolDefaults.compare,notify),preferredLinked=useRef(preferences.linked);preferredLinked.current=preferences.linked;
  const notifyRef=useRef(notify);notifyRef.current=notify;
  const requestIds=[...new Set(ids.filter(Boolean))].slice(0,4).join(',');

  useEffect(()=>{
    const requested=requestIds?requestIds.split(','):[];setPhotos([]);setViews(initialViews(preferredLinked.current));setActive(requested[0]||'');
    if(requested.length<2){setLoading(false);return;}
    const abort=new AbortController();setLoading(true);
    void api<{photos:Photo[]}>('/compare?ids='+encodeURIComponent(requestIds),'GET',undefined,abort.signal).then(result=>{if(!abort.signal.aborted){const ordered=requested.flatMap(id=>{const photo=result.photos.find(p=>p.id===id);return photo?[photo]:[];});setPhotos(ordered);setActive(ordered[0]?.id||'');}}).catch(error=>{if(!abort.signal.aborted)notifyRef.current(message(error));}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[requestIds]);

  function linkedView(previous:Views,linked:boolean):Views{return previous.linked===linked?previous:linked?{...previous,linked:true,shared:poseFor(previous,active)}:{...previous,linked:false,individual:Object.fromEntries(photos.map(photo=>[photo.id,previous.shared]))};}
  useEffect(()=>{setViews(previous=>linkedView(previous,preferences.linked));},[preferences.linked]);

  function change(id:string,update:(pose:ComparisonPose)=>ComparisonPose){setViews(previous=>previous.linked?{...previous,shared:update(previous.shared)}:{...previous,individual:{...previous.individual,[id]:update(poseFor(previous,id))}});}
  function toggleLink(){const linked=!views.linked;setViews(previous=>linkedView(previous,linked));savePreferences({linked});}

  function removePhoto(id:string){
    const next=photos.filter(p=>p.id!==id);
    if(next.length>=2){setPhotos(next);if(active===id)setActive(next[0].id);}else onClose();
  }

  const current=poseFor(views,active),ready=photos.length>0&&!loading;
  const cols=photos.length<=2?'cols-2':photos.length===3?'cols-3':'cols-4';
  return <div className="compare-page">
    <div className="compare-toolbar">
      <div><span className="eyebrow">SIDE BY SIDE</span><h2>{t("照片对比 · ")}{photos.length}{t(" 张")}</h2></div>
      <div className="controls">
        <button className="icon" disabled={!ready||current.zoom<=.5} onClick={()=>change(active,pose=>({...pose,zoom:comparisonZoom(pose.zoom-.25)}))} aria-label={t("缩小")} title={t("缩小")}><ZoomOut size={16}/></button>
        <span className="compare-percent" title={bt('相对于每张照片适应窗口时的大小','Relative to each photo’s fit size')}>{Math.round(current.zoom*100)}%</span>
        <button className="icon" disabled={!ready||current.zoom>=8} onClick={()=>change(active,pose=>({...pose,zoom:comparisonZoom(pose.zoom+.25)}))} aria-label={t("放大")} title={t("放大")}><ZoomIn size={16}/></button>
        <button className="quiet" disabled={!ready} onClick={()=>change(active,comparisonDefault)}>{bt('适应窗口','Fit views')}</button>
        <button className="quiet" disabled={!ready} onClick={()=>change(active,pose=>({...pose,focus:{x:.5,y:.5}}))} title={bt('保留缩放比例，将画面中心对齐','Keep the zoom and align image centers')}><Focus size={15}/>{bt('居中对齐','Align centers')}</button>
        <button className="quiet" disabled={!ready} aria-pressed={views.linked} onClick={toggleLink}>{views.linked?<Link size={15}/>:<Unlink size={15}/>}{bt('同步视图','Sync views')}</button>
        <button className="quiet" onClick={onClose}>{t("返回图库")}</button>
      </div>
      {ready&&<p className="compare-hint">{bt('滚轮缩放，拖动或方向键移动。同步时按画面相对位置对齐；关闭同步可分别调整。','Use the wheel to zoom, drag or use arrow keys to pan. Synced views share the same relative image position; turn sync off to adjust separately.')}</p>}
    </div>
    {loading?<p className="loading">{t("加载中…")}</p>:
    !photos.length?<Empty title={t("选择照片进行对比")}><GitCompare size={28} style={{marginBottom:8}}/>{t("在图库中选择 2-4 张照片，")}<br/>{t("然后点击工具栏中的「对比」按钮。")}</Empty>:
    <div className={`compare-grid ${cols}`}>{photos.map(photo=><div className="compare-item" key={photo.id} data-active={active===photo.id}>
      <button className="close-btn" onClick={()=>removePhoto(photo.id)} aria-label={t("移除")}><X size={14}/></button>
      <ComparePicture id={photo.id} name={photo.file_name} source={photo.preview_url||photo.thumbnail_url} pose={poseFor(views,photo.id)} activate={()=>setActive(photo.id)} change={update=>change(photo.id,update)}/>
      <div className="info-panel"><button className="compare-select" aria-pressed={active===photo.id} title={bt('操作这张照片的视图','Select this photo’s view')} onClick={()=>setActive(photo.id)}><b title={photo.file_name}>{photo.file_name}</b></button>
        <div className="exif-grid">
          {photo.camera_model&&<span>{photo.camera_model}</span>}
          {photo.lens_model&&<span>{photo.lens_model}</span>}
          <span>{[photo.focal_length&&`${photo.focal_length}mm`,photo.f_number&&`f/${photo.f_number}`,photo.exposure_time&&`${photo.exposure_time}s`,photo.iso&&`ISO ${photo.iso}`].filter(Boolean).join(' · ')}</span>
          {photo.date_taken&&<span>{photo.date_taken.slice(0,16).replace('T',' ')}</span>}
          {photo.width&&photo.height&&<span>{photo.width}×{photo.height}</span>}
        </div>
      </div>
    </div>)}</div>}
  </div>;
}
