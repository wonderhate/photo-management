import {useEffect,useState} from 'react';
import {Check,Images} from 'lucide-react';
import {api,message,query} from '../api';
import {Modal} from '../components';
import MediaImage from '../media/MediaImage';
import {bt} from '../browser/text';
import type {Photo} from '../types';
import './library-photo-picker.css';

const pageSize=24;
type PickerProps={onClose:()=>void;onBrowse?:()=>void}&({multiple?:false;selectedId:string;onChoose:(id:string)=>void}|{multiple:true;maxSelection:number;excludedIds?:string[];onChooseMany:(ids:string[])=>void});
export default function LibraryPhotoPicker(props:PickerProps){
  const {onClose,onBrowse}=props,multiple=props.multiple===true;
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[retry,setRetry]=useState(0);
  const [chosen,setChosen]=useState<string[]>([]);
  const [photos,setPhotos]=useState<Photo[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const excluded=new Set(props.multiple?props.excludedIds:[]),limit=props.multiple?props.maxSelection:1;
  function isSelected(id:string){return props.multiple?chosen.includes(id):props.selectedId===id;}
  function choose(id:string){if(props.multiple)setChosen(current=>current.includes(id)?current.filter(value=>value!==id):current.length<limit?[...current,id]:current);else props.onChoose(id);}
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setPhotos([]);
    const timer=setTimeout(()=>{
      void api<{photos:Photo[];total:number}>('/photos?'+query({page,page_size:pageSize,count_mode:'file',sort:'created_at',direction:'desc',filename:search.trim()}),'GET',undefined,controller.signal)
        .then(result=>{if(!controller.signal.aborted){setPhotos(result.photos);setTotal(result.total);}})
        .catch(e=>{if(!controller.signal.aborted)setError(message(e));})
        .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },150);
    return()=>{clearTimeout(timer);controller.abort();};
  },[search,page,retry]);
  function find(value:string){setLoading(true);setSearch(value);setPage(1);}
  const pages=Math.max(1,Math.ceil(total/pageSize));
  return <Modal title={multiple?bt('选择已导入的照片','Choose imported photos'):bt('选择已导入的照片','Choose an imported photo')} className="library-photo-picker" wide onClose={onClose}>
    <div className="library-photo-picker-content">
      <p className="muted">{multiple?bt(`按选择顺序加入拼图。本次最多可添加 ${limit} 张，可跨页选择。`,`Photos are added in selection order. Add up to ${limit} photos across pages.`):bt('选择一张照片，直接进入光影暗房编辑。','Choose a photo to edit directly in Lumina Darkroom.')}</p>
      <label className="library-photo-search"><span>{bt('搜索文件名','Search filename')}</span><input type="search" aria-label={bt('查找图库照片','Find library photo')} placeholder={bt('输入照片文件名','Enter a photo filename')} value={search} onChange={e=>find(e.target.value)}/></label>
      <div className="library-photo-results" aria-busy={loading}>
        {loading?<p role="status">{bt('正在读取图库照片…','Loading library photos…')}</p>:error?<div className="library-photo-empty"><p className="error-box" role="alert">{error}</p><button onClick={()=>setRetry(n=>n+1)}>{bt('重试','Retry')}</button></div>:photos.length?<div className="library-photo-grid">{photos.map(photo=><button key={photo.id} className="library-photo-choice" aria-label={photo.file_name} aria-pressed={isSelected(photo.id)} disabled={photo.missing||excluded.has(photo.id)||multiple&&!isSelected(photo.id)&&chosen.length>=limit} onClick={()=>choose(photo.id)}>
          <span className="library-photo-thumbnail"><MediaImage src={photo.thumbnail_url} alt="" loading="lazy"/>{isSelected(photo.id)&&<Check size={18} aria-hidden="true"/>}</span>
          <span className="library-photo-name" title={photo.file_name}>{photo.file_name}</span>
          <small>{photo.missing?bt('原文件不可用','Original unavailable'):excluded.has(photo.id)?bt('已在拼图中','Already in collage'):isSelected(photo.id)?multiple?bt(`已选第 ${chosen.indexOf(photo.id)+1} 张`,`Selection ${chosen.indexOf(photo.id)+1}`):bt('当前照片','Current photo'):[photo.file_format,photo.width&&photo.height?`${photo.width} × ${photo.height}`:''].filter(Boolean).join(' · ')}</small>
        </button>)}</div>:<div className="library-photo-empty"><Images size={32} aria-hidden="true"/><p>{search.trim()?bt('没有找到匹配的照片。','No matching photos found.'):bt('还没有导入照片。可先在图库导入，或返回打开本机照片。','No imported photos yet. Import into your library, or go back to open a local photo.')}</p>{search.trim()?<button onClick={()=>find('')}>{bt('清除搜索','Clear search')}</button>:onBrowse?<button onClick={onBrowse}>{bt('前往图库','Go to library')}</button>:<button onClick={onClose}>{bt('返回拼图','Back to collage')}</button>}</div>}
      </div>
      <footer className="library-photo-pagination"><span role="status">{!loading&&!error?bt(`共 ${total.toLocaleString()} 张照片`,`${total.toLocaleString()} photos`):''}</span><nav aria-label={bt('图库照片分页','Library photo pages')}><button disabled={loading||!!error||page<=1} onClick={()=>setPage(n=>n-1)}>{bt('上一页','Previous')}</button><span>{page} / {pages}</span><button disabled={loading||!!error||page>=pages} onClick={()=>setPage(n=>n+1)}>{bt('下一页','Next')}</button></nav></footer>
      {props.multiple&&<div className="library-photo-selection"><span role="status">{bt(`已选 ${chosen.length} / ${limit} 张`,`Selected ${chosen.length} / ${limit}`)}</span><button disabled={!chosen.length} onClick={()=>setChosen([])}>{bt('清空选择','Clear selection')}</button><button className="primary" disabled={!chosen.length} onClick={()=>props.onChooseMany(chosen)}>{bt(`添加所选照片（${chosen.length}）`,`Add selected photos (${chosen.length})`)}</button></div>}
    </div>
  </Modal>;
}
