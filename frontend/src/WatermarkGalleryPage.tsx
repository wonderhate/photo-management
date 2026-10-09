import {useEffect,useState} from 'react';
import {Frame,Sun,Search,Copy,Download,Trash2,ImageOff} from 'lucide-react';
import {api,message,query} from './api';
import {Empty,Modal} from './components';
import WatermarkExportDialog from './WatermarkExportDialog';
import type {WatermarkDraft,Job} from './types';

const statusLabels:Record<string,string>={all:'全部',draft:'编辑中',ready:'待导出',exported:'已导出'};
type Listing={drafts:WatermarkDraft[];total:number;counts:Record<string,number>};
export default function WatermarkGalleryPage({onEdit,onChoose,onJob,notify,photoId='',revision=0}:{onEdit:(id:string)=>void;onChoose:()=>void;onJob:(job:Job)=>void;notify:(s:string)=>void;photoId?:string;revision?:number}) {
  const [data,setData]=useState<Listing>({drafts:[],total:0,counts:{}});
  const [status,setStatus]=useState(''),[type,setType]=useState(''),[search,setSearch]=useState(''),[sort,setSort]=useState('updated_desc');
  const [page,setPage]=useState(1),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<Set<string>>(new Set()),[exporting,setExporting]=useState<WatermarkDraft[]|null>(null);
  const [relocate,setRelocate]=useState<WatermarkDraft|null>(null),[path,setPath]=useState('');
  const reload=()=>setRefresh(v=>v+1);
  useEffect(()=>{setPage(1);setSelected(new Set())},[status,type,search,sort,photoId]);
  useEffect(()=>{
    let alive=true;const timer=setTimeout(()=>{
      setBusy(true);api<Listing>('/watermark/drafts?'+query({status,watermark_type:type,search,sort,page,page_size:40,photo_id:photoId})).then(r=>{
        if(alive){setData(r);setError('');if(!r.drafts.length&&page>1)setPage(page-1)}
      }).catch(e=>{if(alive)setError(message(e))}).finally(()=>{if(alive)setBusy(false)});
    },200);return()=>{alive=false;clearTimeout(timer)};
  },[status,type,search,sort,page,refresh,photoId,revision]);
  function toggle(id:string){setSelected(s=>{const next=new Set(s);next.has(id)?next.delete(id):next.add(id);return next})}
  async function action(ids:string[],kind:'delete'|'ready'|'draft'|'duplicate'){
    if(kind==='delete'&&!confirm(`删除 ${ids.length} 个水印作品？这只会删除水印编辑记录和预览，不会删除原始照片或已导出的文件。`))return;
    setBusy(true);try{
      for(const id of ids){if(kind==='delete')await api('/watermark/drafts/'+id,'DELETE');
        else if(kind==='duplicate')await api('/watermark/drafts/'+id+'/duplicate','POST');
        else await api('/watermark/drafts/'+id+'/status','PATCH',{status:kind})}
      setSelected(new Set());reload();notify(kind==='delete'?'草稿已删除，原图保留':kind==='duplicate'?'已创建独立副本':'作品状态已更新');
    }catch(e){notify(message(e));reload()}finally{setBusy(false)}
  }
  async function exportSelection(){try{const drafts=await Promise.all([...selected].map(id=>api<WatermarkDraft>('/watermark/drafts/'+id)));setExporting(drafts)}catch(e){notify(message(e))}}
  async function locate(){setBusy(true);try{await api('/watermark/drafts/'+relocate!.id+'/relocate','POST',{path});setRelocate(null);reload();notify('已重新关联原始照片')}catch(e){notify(message(e))}finally{setBusy(false)}}
  return <>
    <div className="gallery-heading"><div><span className="eyebrow">SAVED LIGHT, STILL IN THE MAKING</span><h1>水印图库<span>{data.counts.all||0}</span></h1><p>保存每一种表达，在准备好时导出。</p></div><button className="primary" onClick={onChoose}>选择照片创作</button></div>
    {photoId&&<p className="muted">当前显示这次拍摄的全部水印作品（含 RAW / JPG）。</p>}
    <div className="draft-status-tabs">{Object.entries(statusLabels).map(([value,label])=><button key={value} className={(status||'all')===value?'active':''} onClick={()=>setStatus(value==='all'?'':value)}>{label}<b>{data.counts[value]||0}</b></button>)}</div>
    <div className="library-toolbar draft-toolbar"><label className="search"><Search size={16}/><input aria-label="搜索水印作品" placeholder="作品、文件名、相机、镜头或署名" value={search} onChange={e=>setSearch(e.target.value)}/></label><div className="button-row"><select aria-label="水印类型" value={type} onChange={e=>setType(e.target.value)}><option value="">全部水印类型</option><option value="frame">现代信息条相框</option><option value="ambient">沉浸光感</option></select><select aria-label="水印作品排序" value={sort} onChange={e=>setSort(e.target.value)}>{[['updated_desc','最近编辑'],['updated_asc','最早编辑'],['created_desc','创建时间'],['date_taken','照片拍摄时间'],['file_name','文件名'],['watermark_type','水印类型']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div></div>
    <div className="button-row draft-batch"><button onClick={()=>setSelected(new Set(data.drafts.map(d=>d.id)))}>选择本页</button>{selected.size>0&&<><span>已选 {selected.size}</span><button disabled={busy} className="primary" onClick={exportSelection}>批量导出</button><button disabled={busy} onClick={()=>action([...selected],'ready')}>标记为待导出</button><button disabled={busy} onClick={()=>action([...selected],'draft')}>移动到编辑中</button><button disabled={busy} className="danger" onClick={()=>action([...selected],'delete')}>删除草稿</button><button onClick={()=>setSelected(new Set())}>清空选择</button></>}</div>
    {error&&<div className="error-box">{error}<button onClick={reload}>重试</button></div>}
    <div className="draft-grid" aria-busy={busy}>{data.drafts.map(d=><article className={'draft-card '+(selected.has(d.id)?'selected':'')} key={d.id}>
      <div className="draft-cover"><button className="draft-image" onClick={()=>onEdit(d.id)} aria-label={'继续编辑 '+d.name}>{d.preview_url?<img loading="lazy" src={d.preview_url} alt={d.name}/>:<ImageOff size={32}/>}</button><input className="draft-select" type="checkbox" aria-label={'选择 '+d.name} checked={selected.has(d.id)} onChange={()=>toggle(d.id)}/><div className="draft-cover-actions"><button onClick={()=>onEdit(d.id)}>继续编辑</button><button disabled={d.source_missing} onClick={()=>setExporting([d])}><Download size={15}/>导出</button></div></div>
      <div className="draft-card-info"><h3 title={d.name}>{d.name}</h3><div className="draft-meta">{d.watermark_type==='ambient'?<Sun size={14}/>:<Frame size={14}/>}<span>{d.watermark_type==='ambient'?'沉浸光感':'现代信息条相框'}</span><small>{new Date(d.updated_at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</small></div>
      <div className="draft-card-bottom"><span className={'draft-badge '+d.status}>{d.modified_since_export?'导出后有修改':statusLabels[d.status]}</span><details className="draft-menu"><summary aria-label={'更多 '+d.name}>更多</summary><div><button onClick={()=>action([d.id],'duplicate')}><Copy size={14}/>复制作品</button><button onClick={async()=>{const name=prompt('作品名称',d.name);if(name?.trim()){try{await api('/watermark/drafts/'+d.id,'PUT',{revision:d.revision,name:name.trim()});reload()}catch(e){notify(message(e))}}}}>重命名</button><button onClick={()=>action([d.id],'ready')}>标记为待导出</button><button onClick={()=>action([d.id],'draft')}>移动到编辑中</button><button className="danger" onClick={()=>action([d.id],'delete')}><Trash2 size={14}/>删除草稿</button></div></details></div>
      {d.source_missing&&<button className="missing-source" onClick={()=>{setRelocate(d);setPath('')}}>原始照片不可用 · 重新定位</button>}</div>
    </article>)}</div>
    {!data.drafts.length&&!busy&&!error&&<Empty title="还没有符合条件的水印作品">在水印工坊点击「保存到水印图库」，作品就会出现在这里。</Empty>}
    <div className="draft-pagination"><span>{data.total} 个作品 · 第 {page} / {Math.max(1,Math.ceil(data.total/40))} 页</span><button disabled={page<=1||busy} onClick={()=>{setPage(p=>p-1);setSelected(new Set())}}>上一页</button><button disabled={page*40>=data.total||busy} onClick={()=>{setPage(p=>p+1);setSelected(new Set())}}>下一页</button></div>
    {exporting&&<WatermarkExportDialog drafts={exporting} onClose={()=>setExporting(null)} onDone={reload} onJob={onJob} notify={notify}/>}
    {relocate&&<Modal title="重新定位原始照片" onClose={()=>setRelocate(null)}><div className="draft-dialog"><p>{relocate.source.file_name}</p><label>原图的新路径<input value={path} onChange={e=>setPath(e.target.value)}/></label><p className="muted">系统验证文件内容一致后恢复关联，保留现有设计。</p><div className="button-row"><button onClick={async()=>{try{const r=await api<{paths:string[]}>('/dialog/files','POST');if(r.paths[0])setPath(r.paths[0])}catch(e){notify(message(e))}}}>选择原始照片</button><button className="primary" disabled={busy||!path} onClick={locate}>恢复关联</button></div></div></Modal>}
  </>;
}
