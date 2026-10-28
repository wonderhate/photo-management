import {bt} from './browser/text';
import AlbumOverview,{AlbumRecent} from './AlbumOverview';
import {t,getLocale} from './i18n';
import {useEffect,useState,useRef} from 'react';
import {Sparkles,Plus,RefreshCw,Trash2,Pencil,ArrowUp,ArrowDown,GripVertical,Search} from 'lucide-react';
import {api,message,query} from './api';
import {Empty,PhotoCard,Pager,Modal} from './components';
import type {Album,Photo,Filters,AIStatus} from './types';
import RuleAlbumDialog from './RuleAlbumDialog';
import {albumList,moveAlbum} from './core/album-list';
import type {AlbumListPreferences} from './core/album-list';
import useAlbumListPreferences from './workspace/useAlbumListPreferences';
export default function AlbumsPage({smart,selectedIds,onBrowse,onOpenPhoto,notify,ai}:{smart:boolean;selectedIds:string[];onBrowse:(filters:Filters)=>void;onOpenPhoto:(photo:Photo)=>void;notify:(value:string)=>void;ai:AIStatus|null}) {
  const [recent,setRecent]=useState<Album|null>(null);
  const [ruleEditor,setRuleEditor]=useState<{album:Album|null}|null>(null);
  const view=useAlbumListPreferences(),viewRef=useRef(view.value);viewRef.current=view.value;
  const [search,setSearch]=useState(''),[renaming,setRenaming]=useState<Album|null>(null),[renameName,setRenameName]=useState('');
  const drag=useRef(''),generation=useRef(0),mounted=useRef(true),proposal=useRef(0),proposalRequest=useRef<AbortController|null>(null);
  const [saving,setSaving]=useState(false);
  const [albums,setAlbums]=useState<Album[]>([]);const [name,setName]=useState('');const [keywords,setKeywords]=useState('');const [mode,setMode]=useState<'all'|'any'>('all');const [threshold,setThreshold]=useState(.38);const [maximum,setMaximum]=useState(100);const [candidates,setCandidates]=useState<Photo[]>([]);const [chosen,setChosen]=useState<Set<string>>(new Set());const [busy,setBusy]=useState(false);const [show,setShow]=useState(false);const [manual,setManual]=useState(false);const [manualPhotos,setManualPhotos]=useState<Photo[]>([]);const [page,setPage]=useState(1);const [total,setTotal]=useState(0);const [editing,setEditing]=useState<Album|null>(null);
  async function refresh(top?:string){const id=++generation.current;try{const rows=await api<Album[]>('/albums');if(!mounted.current||id!==generation.current)return;setAlbums(rows);if(top){setSearch('');const order=albumList(rows,viewRef.current,'',getLocale()).map(a=>a.id);view.update({sort:'custom',direction:'asc',order:[top,...order.filter(id=>id!==top)]});}}catch(e){if(mounted.current&&id===generation.current)notify(message(e));}}
  useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;generation.current++;proposal.current++;proposalRequest.current?.abort();}},[]);
  useEffect(()=>{if(!manual)return;const controller=new AbortController();setManualPhotos([]);void api<{photos:Photo[];total:number}>('/photos?'+query({page,page_size:40}),'GET',undefined,controller.signal).then(r=>{setManualPhotos(r.photos);setTotal(r.total);}).catch(e=>{if(!controller.signal.aborted)notify(message(e));});return()=>controller.abort();},[manual,page]);
  function toggle(id:string){if(busy)return;setChosen(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next;});}
  function closeEditor(){if(saving)return;proposal.current++;proposalRequest.current?.abort();setShow(false);setManual(false);setBusy(false);}
  function create(){if(saving)return;proposal.current++;proposalRequest.current?.abort();setBusy(false);setEditing(null);setName('');setKeywords('');setCandidates([]);setChosen(new Set(selectedIds));setShow(true);}
  async function preview(){
    const token=++proposal.current;proposalRequest.current?.abort();const controller=new AbortController();proposalRequest.current=controller;setBusy(true);
    try{
      const result=await api<{candidates:Photo[]}>('/albums/smart/preview','POST',{keywords:keywords.split(/[,，\n]|\s+(?:AND|OR)\s+/i).map(x=>x.trim()).filter(Boolean),match_mode:mode,threshold,max_results:maximum},controller.signal);
      // Preserve photos explicitly selected before the new proposal, including
      // manual additions that the current model no longer ranks above threshold.
      const known=new Set(result.candidates.map(p=>p.id)),missing=[...chosen].filter(id=>!known.has(id)),retained:Photo[]=[];
      for(let offset=0;offset<missing.length;offset+=200){const rows=await api<{photos:Photo[]}>('/photos/by-ids','POST',{ids:missing.slice(offset,offset+200)},controller.signal);retained.push(...rows.photos);}
      if(!mounted.current||token!==proposal.current)return;
      setCandidates([...retained,...result.candidates]);setChosen(new Set([...retained,...result.candidates].map(p=>p.id)));
      if(!result.candidates.length)notify(t('没有达到阈值的照片，可降低阈值或检查索引状态'));
    }catch(e){if(!controller.signal.aborted&&mounted.current&&token===proposal.current)notify(message(e));}finally{if(mounted.current&&token===proposal.current)setBusy(false);}
  }
  async function save(){
    if(busy)return;if(!name.trim()){notify(t('请填写影集名称'));return;}const token=++proposal.current;proposalRequest.current?.abort();setBusy(true);setSaving(true);
    try{const payload={name,type:smart?'smart':'normal',keywords:keywords.split(/[,，\n]|\s+(?:AND|OR)\s+/i).map(x=>x.trim()).filter(Boolean),match_mode:mode,threshold,max_results:maximum,photo_ids:[...chosen],scores:Object.fromEntries(candidates.filter(p=>p.similarity_score!==undefined&&chosen.has(p.id)).map(p=>[p.id,p.similarity_score]))};const saved=editing?await api<Album>('/albums/'+editing.id+'/photos','PUT',payload):await api<Album>(smart?'/albums/smart/create':'/albums','POST',payload);if(!mounted.current||token!==proposal.current)return;setShow(false);setManual(false);await refresh(editing?undefined:saved.id);notify(t('影集已保存'));}catch(e){if(mounted.current&&token===proposal.current)notify(message(e));}finally{if(mounted.current&&token===proposal.current){setBusy(false);setSaving(false);}}
  }
  async function rerun(album:Album){
    if(busy)return;const token=++proposal.current;proposalRequest.current?.abort();const controller=new AbortController();proposalRequest.current=controller;setBusy(true);
    try{const result=await api<{candidates:Photo[];selected_photo_ids:string[]}>('/albums/'+album.id+'/rerun','POST',undefined,controller.signal);if(!mounted.current||token!==proposal.current)return;setEditing(album);setName(album.name);setKeywords(album.keywords.join('，'));setMode(album.match_mode);setThreshold(album.threshold);setMaximum(album.max_results);setCandidates(result.candidates);setChosen(new Set(result.selected_photo_ids));setShow(true);}catch(e){if(!controller.signal.aborted&&mounted.current&&token===proposal.current)notify(message(e));}finally{if(mounted.current&&token===proposal.current)setBusy(false);}
  }
  async function remove(album:Album){if(!confirm(t("删除影集「{0}」？照片和原图将保留。",{0:album.name})))return;try{await api('/albums/'+album.id,'DELETE');refresh()}catch(e){notify(message(e))}}
  async function removeMany(ids:string[]){if(!ids.length||!confirm(t('删除选中的 {0} 个影集？照片、人物和原图将保留。',{0:ids.length})))return false;try{await api('/albums/batch-delete','POST',{ids});view.update({order:viewRef.current.order.filter(id=>!ids.includes(id))});await refresh();return true;}catch(e){notify(message(e));return false;}}
  async function resetCover(album:Album){try{await api('/albums/'+album.id,'PATCH',{cover_photo_id:''});await refresh();}catch(e){notify(message(e));}}
  async function rename(){if(!renaming||!renameName.trim())return;setBusy(true);try{await api('/albums/'+renaming.id,'PATCH',{name:renameName.trim()});setRenaming(null);await refresh();notify(t('影集名称已更新'));}catch(e){notify(message(e));}finally{setBusy(false);}}
  function reorder(source:string,target:string,after=false){try{const ids=albumList(albums,{...view.value,sort:'custom'},'',getLocale()).map(a=>a.id);view.update({sort:'custom',direction:'asc',order:moveAlbum(ids,source,target,after)});}catch(e){notify(message(e));}}
  const filtered=albumList(albums,view.value,search,getLocale()).filter(a=>smart?a.type==='smart':a.type!=='smart');
  return <div className="albums-page"><div className="section-intro"><div><span className="eyebrow">{smart?'FIND THE FEELING':'CURATE YOUR STORIES'}</span><h2>{smart?t("用一句话，找回那个画面。"):t("让散落的瞬间，成为一个故事。")}</h2><p>{smart?t("本地视觉语义搜索 · {0} · 已索引 {1} 张",{0:t(ai?.stage||t("模型尚未加载")),1:ai?.indexed||0}):t("将图库中选中的照片收入影集，也可以手动补选。")}</p></div><div className="album-create-actions">{!smart&&<button onClick={()=>setRuleEditor({album:null})}>{t("新建条件集合")}</button>}<button className="primary" disabled={saving} onClick={create}><Plus size={17}/>{smart?t("新建智能影集"):t("新建影集")}</button></div></div>
  <div className="album-list-toolbar">
    <label className="album-search"><Search size={16}/><input aria-label={t('搜索影集名称')} placeholder={t('搜索影集名称')} value={search} maxLength={120} onChange={e=>setSearch(e.target.value)}/></label>
    {search&&<button onClick={()=>setSearch('')}>{t('清除搜索')}</button>}
    <select aria-label={t('影集列表排序')} value={view.value.sort} onChange={e=>{const sort=e.target.value as AlbumListPreferences['sort'];view.update({sort,direction:sort==='name'||sort==='custom'?'asc':'desc'});}}>
      <option value="custom">{t('自定义顺序')}</option><option value="name">{t('影集名称')}</option><option value="created_at">{t('新建时间')}</option><option value="count">{t('照片数量')}</option>
    </select>
    <button className="icon" aria-label={t('切换影集升降序')} aria-pressed={view.value.direction==='desc'} title={t(view.value.direction==='asc'?'当前排序：升序':'当前排序：降序')} disabled={view.value.sort==='custom'} onClick={()=>view.update({direction:view.value.direction==='asc'?'desc':'asc'})}>{view.value.direction==='asc'?<ArrowUp size={16}/>:<ArrowDown size={16}/>}</button>
    {view.error&&<span role="alert">{t('影集设置未保存：')}{view.error}<button onClick={view.retry}>{t('重试保存')}</button></span>}
  </div>
  {!filtered.length?<Empty title={search?t('没有匹配的影集'):smart?t("第一个智能影集，从一个关键词开始"):t("还没有影集")}>{search?t('试试其他名称，或清除搜索。'):smart?t("日落、海边、城市夜景、猫……通过照片画面寻找关联。"):t("先在图库选择照片，再来整理你的作品。")}</Empty>:<AlbumOverview albums={filtered} view={view.value.view} onView={value=>view.update({view:value})} onOpen={album=>onBrowse({album_id:album.id})} onRecent={setRecent} onDelete={removeMany} onDragOver={e=>{if(drag.current&&view.value.sort==='custom'){e.preventDefault();e.stopPropagation();}}} onDrop={(e,album)=>{const source=drag.current;if(!source)return;e.preventDefault();e.stopPropagation();drag.current='';reorder(source,album.id);}} actions={(album,index)=><>
      {album.type==='rule'&&<button onClick={()=>setRuleEditor({album})}>{t("编辑条件")}</button>}
      <button onClick={()=>onBrowse({album_id:album.id})}>{t("打开影集 ↗")}</button>
      <button onClick={()=>{setRenaming(album);setRenameName(album.name);}} aria-label={t('重命名影集 {0}',{0:album.name})}><Pencil size={15}/></button>
      {view.value.sort==='custom'&&<><button className="album-drag-handle" draggable onDragStart={e=>{e.stopPropagation();drag.current=album.id;e.dataTransfer.setData('application/x-photocollection-album',album.id);e.dataTransfer.effectAllowed='move';}} onDragEnd={e=>{e.stopPropagation();drag.current='';}} aria-label={t('拖动排序影集 {0}',{0:album.name})}><GripVertical size={15}/></button><button disabled={index===0} onClick={()=>reorder(album.id,filtered[index-1].id)} aria-label={t('上移影集 {0}',{0:album.name})}><ArrowUp size={15}/></button><button disabled={index===filtered.length-1} onClick={()=>reorder(album.id,filtered[index+1].id,true)} aria-label={t('下移影集 {0}',{0:album.name})}><ArrowDown size={15}/></button></>}
      {smart&&<button disabled={busy} onClick={()=>rerun(album)} title={t("重新匹配")}><RefreshCw size={15}/></button>}<button onClick={()=>remove(album)} aria-label={t("删除影集 ")+album.name}><Trash2 size={15}/></button>
      {album.cover_mode==='manual'&&<button onClick={()=>void resetCover(album)}>{t('恢复自动封面')}</button>}
    </>}/>}
  {recent&&<AlbumRecent key={recent.id} album={recent} onClose={()=>setRecent(null)} onOpenPhoto={onOpenPhoto}/>}

  {renaming&&<Modal title={t('重命名影集')} onClose={()=>{if(!busy)setRenaming(null);}}><div className="album-rename-form"><label>{t('影集名称')}<input autoFocus maxLength={120} value={renameName} disabled={busy} onChange={e=>setRenameName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();if(!busy)void rename();}}}/></label><footer className="modal-footer"><button disabled={busy} onClick={()=>setRenaming(null)}>{t('取消')}</button><button className="primary" disabled={busy||!renameName.trim()} onClick={()=>void rename()}>{t('保存名称')}</button></footer></div></Modal>}
  {show&&<Modal title={editing?t("审阅重新匹配结果"):smart?t("创建智能影集"):t("创建影集")} wide onClose={closeEditor}><div className="album-form"><label>{t("影集名称")}<input value={name} onChange={e=>setName(e.target.value)} maxLength={120} placeholder={t("例如：海边日落")}/></label>{smart&&<><label>{t("关键词")}<input value={keywords} onChange={e=>setKeywords(e.target.value)} placeholder={t("海边，日落（用逗号分隔）")} disabled={!!editing}/></label><div className="three-columns"><label>{t("关键词关系")}<select value={mode} onChange={e=>setMode(e.target.value as 'all'|'any')} disabled={!!editing}><option value="all">{t("所有关键词都匹配 · AND")}</option><option value="any">{t("任意关键词匹配 · OR")}</option></select></label><label>{t("匹配阈值 · ")}{threshold.toFixed(2)}<input type="range" min={.05} max={.5} step={.01} value={threshold} onChange={e=>setThreshold(Number(e.target.value))} disabled={!!editing}/><small>{t("宽松 ← → 严格")}</small></label><label>{t("最多照片")}<input type="number" min={1} max={10000} value={maximum} onChange={e=>setMaximum(Math.max(1,Math.min(10000,Number(e.target.value))))} disabled={!!editing}/></label></div><button className="primary" disabled={busy||!!editing} onClick={preview}><Sparkles size={16}/>{busy?t("正在匹配…"):t("预览候选照片")}</button><p className="muted">{t("相似度是模型分数，不是准确率。可手动增删候选后保存。")}</p></>}
  {editing&&<p className="muted">{bt('已保留原影集成员的勾选。新匹配的候选需手动选择；取消不会更改影集。','Existing album members remain selected. Select new matches manually; cancelling leaves the album unchanged.')}</p>}
  <div className="selection-toolbar"><b>{t("已选 ")}{chosen.size}{t(" 张")}</b><button disabled={busy} onClick={()=>setChosen(new Set([...chosen,...candidates.map(p=>p.id)]))}>{t("全选候选")}</button><button disabled={busy} onClick={()=>setChosen(new Set())}>{t("取消全选")}</button><button disabled={busy} onClick={()=>setManual(true)}>{t("手动补选")}</button></div><div className="gallery compact">{candidates.map(photo=><PhotoCard interaction="pick" key={photo.id} photo={photo} selected={chosen.has(photo.id)} onToggle={()=>toggle(photo.id)} onOpen={()=>toggle(photo.id)}/>)}</div><footer className="modal-footer"><button disabled={saving} onClick={closeEditor}>{t("取消")}</button><button className="primary" disabled={busy} onClick={save}>{t("保存影集 · ")}{chosen.size}{t(" 张")}</button></footer></div></Modal>}
  {ruleEditor&&<RuleAlbumDialog album={ruleEditor.album} onClose={()=>setRuleEditor(null)} onSaved={saved=>{const created=!ruleEditor.album;setRuleEditor(null);void refresh(created?saved.id:undefined);notify(t("条件集合已保存"));}}/>}
  {manual&&<Modal title={t("从图库手动补选")} wide onClose={()=>setManual(false)}><div className="gallery compact">{manualPhotos.map(photo=><PhotoCard interaction="pick" key={photo.id} photo={photo} selected={chosen.has(photo.id)} onToggle={()=>toggle(photo.id)} onOpen={()=>toggle(photo.id)}/>)}</div><Pager page={page} total={total} size={40} onChange={setPage}/><footer className="modal-footer"><button className="primary" onClick={()=>setManual(false)}>{t("完成 · 已选 ")}{chosen.size}{t(" 张")}</button></footer></Modal>}</div>;
}

