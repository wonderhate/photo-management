import {useEffect,useState} from 'react';
import {ArrowUp,ChevronLeft,ChevronRight,FolderOpen,HardDrive,Image as ImageIcon} from 'lucide-react';
import {api,message,query} from './api';
import {t} from './i18n';

type Listing={path:string;parent:string|null;entries:{name:string;path:string;directory:boolean}[];page:number;pages:number;total:number};
export default function ComputerFilePicker({kind,onChoose,onCancel}:{kind:'files'|'directory';onChoose:(paths:string[])=>void;onCancel:()=>void}){
  const [location,setLocation]=useState({path:'',page:1}),[address,setAddress]=useState('');
  const [listing,setListing]=useState<Listing|null>(null),[selected,setSelected]=useState<string[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setListing(null);
    void api<Listing>('/files/browse?'+query({path:location.path,page:location.page,directories_only:kind==='directory'?'true':'false'}))
      .then(value=>{if(active){setListing(value);setAddress(value.path)}})
      .catch(error=>{if(active)setError(message(error))})
      .finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[location,kind]);
  function open(path:string){setAddress(path);setLocation({path,page:1})}
  return <div className="computer-picker">
    <p className="muted">{t('浏览已配对电脑上的文件。照片将导入电脑照片库，原文件保留在原位置。')}</p>
    <div className="computer-picker-nav"><button disabled={loading} onClick={()=>open('')}><HardDrive size={16}/>{t('电脑')}</button><button disabled={loading||!listing||listing.parent===null} onClick={()=>open(listing!.parent!)}><ArrowUp size={16}/>{t('上一级')}</button></div>
    <form className="computer-picker-path" onSubmit={event=>{event.preventDefault();open(address.trim())}}>
      <label>{t('电脑文件夹路径')}<input value={address} maxLength={4096} onChange={event=>setAddress(event.target.value)} placeholder={t('例如 C:\\Users\\你的用户名\\Pictures')}/></label><button disabled={loading} type="submit">{t('打开路径')}</button>
    </form>
    {loading?<p role="status">{t('正在读取电脑文件夹…')}</p>:error?<div className="error-box" role="alert">{error}<button onClick={()=>setLocation({...location})}>{t('重试')}</button></div>:listing&&<>
      <div className="computer-file-list" aria-label={t('电脑文件列表')}>
        {listing.entries.length?listing.entries.map(entry=>entry.directory?<button key={entry.path} className="computer-file-row" onClick={()=>open(entry.path)}><FolderOpen size={19}/><span>{entry.name==='用户文件夹'?t(entry.name):entry.name}</span><ChevronRight size={16}/></button>:<label key={entry.path} className="computer-file-row"><input type="checkbox" aria-label={entry.name} checked={selected.includes(entry.path)} onChange={event=>setSelected(values=>event.target.checked?[...values,entry.path]:values.filter(value=>value!==entry.path))}/><ImageIcon size={18}/><span>{entry.name}</span></label>):<p className="muted">{t(kind==='directory'?'此文件夹没有子文件夹':'此文件夹没有支持的照片或子文件夹')}</p>}
      </div>
      {listing.pages>1&&<div className="computer-picker-pagination"><button aria-label={t('上一页')} disabled={listing.page===1} onClick={()=>setLocation({...location,page:listing.page-1})}><ChevronLeft size={16}/></button><span>{listing.page} / {listing.pages}</span><button aria-label={t('下一页')} disabled={listing.page===listing.pages} onClick={()=>setLocation({...location,page:listing.page+1})}><ChevronRight size={16}/></button></div>}
    </>}
    <footer className="modal-footer"><button onClick={onCancel}>{t('取消')}</button><button className="primary" disabled={loading||!!error||(kind==='directory'?!listing?.path:!selected.length)} onClick={()=>onChoose(kind==='directory'?[listing!.path]:selected)}>{kind==='directory'?t('选择这个文件夹'):t('使用已选照片（{0}）',{0:selected.length})}</button></footer>
  </div>;
}
