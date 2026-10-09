import {useState,useEffect} from 'react';
import {X,ZoomIn,ZoomOut,GitCompare} from 'lucide-react';
import {api,message} from './api';
import {Empty} from './components';
import type {Photo} from './types';

export default function ComparePage({ids,notify,onClose}:{ids:string[];notify:(msg:string)=>void;onClose:()=>void}){
  const [photos,setPhotos]=useState<Photo[]>([]);
  const [zoom,setZoom]=useState(1);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{if(ids.length>=2)loadCompare(ids)},[ids]);

  async function loadCompare(photoIds:string[]){
    setLoading(true);
    try{const r=await api<{photos:Photo[]}>('/compare?ids='+photoIds.join(','));setPhotos(r.photos)}
    catch(e){notify(message(e))}finally{setLoading(false)}
  }

  function removePhoto(id:string){
    const next=photos.filter(p=>p.id!==id);
    if(next.length>=2)setPhotos(next);else onClose();
  }

  const cols=photos.length<=2?'cols-2':photos.length===3?'cols-3':'cols-4';
  return <div className="compare-page">
    <div className="compare-toolbar">
      <div><span className="eyebrow">SIDE BY SIDE</span><h2>照片对比 · {photos.length} 张</h2></div>
      <div className="controls">
        <button className="icon" onClick={()=>setZoom(z=>Math.max(.5,z-.25))} title="缩小"><ZoomOut size={16}/></button>
        <span>{Math.round(zoom*100)}%</span>
        <button className="icon" onClick={()=>setZoom(z=>Math.min(3,z+.25))} title="放大"><ZoomIn size={16}/></button>
        <button className="quiet" onClick={onClose}>返回图库</button>
      </div>
    </div>
    {loading?<p className="loading">加载中…</p>:
    !photos.length?<Empty title="选择照片进行对比"><GitCompare size={28} style={{marginBottom:8}}/>在图库中选择 2-4 张照片，<br/>然后点击工具栏中的「对比」按钮。</Empty>:
    <div className={`compare-grid ${cols}`}>{photos.map(photo=><div className="compare-item" key={photo.id}>
      <button className="close-btn" onClick={()=>removePhoto(photo.id)} aria-label="移除"><X size={14}/></button>
      <div className="image-area"><img src={photo.preview_url||photo.thumbnail_url} alt={photo.file_name} style={{transform:`scale(${zoom})`}}/></div>
      <div className="info-panel"><b title={photo.file_name}>{photo.file_name}</b>
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
