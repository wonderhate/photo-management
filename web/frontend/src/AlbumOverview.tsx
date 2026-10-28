import {useEffect,useState} from 'react';
import type {DragEvent,ReactNode} from 'react';
import {Folder,ImageOff,Sparkles,LayoutGrid,List,Clock,Trash2} from 'lucide-react';
import MediaImage from './media/MediaImage';
import {photoURL} from './runtime';
import {t} from './i18n';
import {api,message,query} from './api';
import {Empty,Modal,Pager,PhotoCard} from './components';
import type {Album,Photo} from './types';

const day=(value?:string|null)=>value?.slice(0,10)||t('未知');
export function AlbumDates({album:a}:{album:Album}){
  return <span className="album-date-span">{a.date_from?`${day(a.date_from)}${a.date_to!==a.date_from?' — '+day(a.date_to):''}`:t('暂无拍摄日期')}{!!a.unknown_date_count&&<small>{t('另有 {0} 张日期未知',{0:a.unknown_date_count})}</small>}</span>;
}
export function AlbumCover({album:a,onOpen}:{album:Album;onOpen:()=>void}){
  const ids=a.cover_ids||(a.cover_id?[a.cover_id]:[]);
  return <button className="album-cover" onClick={onOpen} aria-label={t('打开影集 {0}',{0:a.name})}>
    {ids.length?<div className={'album-cover-images count-'+ids.length}>{ids.map(id=><MediaImage key={id} src={photoURL(id)} alt="" draggable={false} loading="lazy"/>)}</div>:a.cover_missing?<div className="album-cover-missing"><ImageOff size={28}/><small>{t('手动封面不可用')}</small></div>:<Folder size={40}/>}
    <span>{a.type==='smart'?<Sparkles size={16}/>:<Folder size={16}/>}</span>
  </button>;
}
type Props={albums:Album[];view:'cards'|'table';onView:(view:'cards'|'table')=>void;onOpen:(a:Album)=>void;onRecent:(a:Album)=>void;onDelete:(ids:string[])=>Promise<boolean>;actions:(a:Album,index:number)=>ReactNode;onDragOver:(e:DragEvent)=>void;onDrop:(e:DragEvent,a:Album)=>void};
export default function AlbumOverview({albums,view,onView,onOpen,onRecent,onDelete,actions,onDragOver,onDrop}:Props){
  const [selected,setSelected]=useState<Set<string>>(new Set()),[page,setPage]=useState(1),[busy,setBusy]=useState(false);
  const signature=albums.map(a=>a.id).join(','),size=view==='cards'?24:50,pages=Math.max(1,Math.ceil(albums.length/size)),current=Math.min(page,pages);
  useEffect(()=>{setPage(1);setSelected(previous=>new Set([...previous].filter(id=>albums.some(a=>a.id===id))));},[signature]);
  const rows=albums.slice((current-1)*size,current*size),toggle=(id:string)=>setSelected(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);return next;});
  const checkbox=(a:Album)=><input type="checkbox" aria-label={t('选择影集 {0}',{0:a.name})} checked={selected.has(a.id)} onChange={()=>toggle(a.id)} disabled={busy}/>;
  const recent=(a:Album)=><button className="album-recent-button" onClick={()=>onRecent(a)}><Clock size={14}/><span>{t(a.recent_kind==='imported'?'最近导入匹配':'最近加入')}<small>{day(a.recent_kind==='imported'?a.last_imported_at:a.last_added_at)}</small></span></button>;
  async function remove(){setBusy(true);try{if(await onDelete([...selected]))setSelected(new Set());}finally{setBusy(false);}}
  return <>
    <div className="album-overview-controls">
      <div className="album-view-switch" role="group" aria-label={t('影集展示方式')}><button aria-pressed={view==='cards'} onClick={()=>onView('cards')}><LayoutGrid size={16}/>{t('卡片')}</button><button aria-pressed={view==='table'} onClick={()=>onView('table')}><List size={16}/>{t('表格')}</button></div>
      <button disabled={!rows.length||busy} onClick={()=>setSelected(new Set(rows.map(a=>a.id)))}>{t('选择本页影集')}</button>
      {!!selected.size&&<><span>{t('已选 {0} 个影集',{0:selected.size})}</span><button disabled={busy} onClick={()=>setSelected(new Set())}>{t('取消选择')}</button><button disabled={busy} onClick={()=>void remove()}><Trash2 size={15}/>{t('删除所选影集')}</button></>}
    </div>
    {view==='cards'?<div className="album-grid">{rows.map((a,i)=><article key={a.id} data-album-id={a.id} className={'album-card'+(selected.has(a.id)?' album-selected':'')} aria-label={a.name} onDragOver={onDragOver} onDrop={e=>onDrop(e,a)}>
      <AlbumCover album={a} onOpen={()=>onOpen(a)}/><div><div className="album-heading">{checkbox(a)}<h3>{a.name}</h3></div><p>{a.type==='rule'&&<span>{t('条件集合')} · </span>}{a.count}{t(' 次拍摄')}{a.keywords.length?' · '+a.keywords.join(' / '):''}</p><AlbumDates album={a}/>{recent(a)}<div className="album-actions">{actions(a,(current-1)*size+i)}</div></div>
    </article>)}</div>:<div className="album-table-scroll"><table className="album-table"><thead><tr><th>{t('选择')}</th><th>{t('影集名称')}</th><th>{t('照片数量')}</th><th>{t('拍摄日期范围')}</th><th>{t('近期照片')}</th><th>{t('操作')}</th></tr></thead><tbody>{rows.map((a,i)=><tr key={a.id} data-album-id={a.id} className={selected.has(a.id)?'album-selected':''} onDragOver={onDragOver} onDrop={e=>onDrop(e,a)}><td>{checkbox(a)}</td><td><div className="album-table-title"><AlbumCover album={a} onOpen={()=>onOpen(a)}/><button onClick={()=>onOpen(a)}>{a.name}</button>{a.type==='rule'&&<small>{t('条件集合')}</small>}</div></td><td>{a.count}</td><td><AlbumDates album={a}/></td><td>{recent(a)}</td><td><div className="album-actions">{actions(a,(current-1)*size+i)}</div></td></tr>)}</tbody></table></div>}
    {pages>1&&<nav className="pager" aria-label={t('影集分页')}><span>{t('共 {0} 个影集',{0:albums.length})}</span><button disabled={current<=1} onClick={()=>setPage(current-1)}>{t('上一页')}</button><span>{current} / {pages}</span><button disabled={current>=pages} onClick={()=>setPage(current+1)}>{t('下一页')}</button></nav>}
  </>;
}
export function AlbumRecent({album,onClose,onOpenPhoto}:{album:Album;onClose:()=>void;onOpenPhoto:(photo:Photo)=>void}){
  const [page,setPage]=useState(1),[result,setResult]=useState<{photos:Photo[];total:number;recent_kind:'joined'|'imported'}|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[selected,setSelected]=useState<Set<string>>(new Set());
  useEffect(()=>{const abort=new AbortController();setResult(null);setError('');api<NonNullable<typeof result>>('/albums/'+album.id+'/recent?'+query({page,page_size:24}),'GET',undefined,abort.signal).then(r=>{if(!abort.signal.aborted)setResult(r);}).catch(e=>{if(!abort.signal.aborted)setError(message(e));});return()=>abort.abort();},[album.id,page,retry]);
  return <Modal wide title={t(album.type==='rule'?'最近导入匹配':'最近加入')+' · '+album.name} onClose={onClose}><div className="album-recent-content"><p className="muted">{t(album.type==='rule'?'按当前匹配照片的导入时间排序，条件集合不记录加入时间。':'按加入影集的时间排序，旧记录的未知时间排在末尾。')}</p>{error?<p role="alert">{error}<button onClick={()=>setRetry(n=>n+1)}>{t('重试')}</button></p>:!result?<p role="status">{t('正在加载…')}</p>:!result.photos.length?<Empty title={t('暂无照片')}/>:<><div className="gallery compact">{result.photos.map(p=><div key={p.id}><PhotoCard photo={p} selected={selected.has(p.id)} onToggle={()=>setSelected(previous=>{const next=new Set(previous);next.has(p.id)?next.delete(p.id):next.add(p.id);return next;})} onOpen={()=>{onClose();onOpenPhoto(p);}}/><small className="album-photo-joined">{t(result.recent_kind==='imported'?'导入时间':'加入时间')} · {day(result.recent_kind==='imported'?p.created_at:p.album_added_at)}</small></div>)}</div><Pager page={page} total={result.total} size={24} onChange={setPage}/></>}</div></Modal>;
}
