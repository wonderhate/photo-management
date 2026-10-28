import {orderLuts,lutGroupedStep,lutVisiblePage} from '../core/lut-order';
import LutContextMenu from './LutContextMenu';
import type {LutMenuAction} from './LutContextMenu';
import {downloadBlob} from '../browser/local-file-service';
import LutThumbnail from './LutThumbnail';
import useLutThumbnails from './useLutThumbnails';
import LutSourceInfo from './LutSourceInfo';
import {collectLutDrop,lutDropSelection} from '../core/lut-drop';
import {copiedLuts,inLutGroup,LUT_IMPORT_LIMIT} from '../core/lut-library';
import LutFoldersPanel from './LutFoldersPanel';
import type {LutFolderFilter} from './LutFoldersPanel';
import {validateLutFolders} from '../core/lut-folders';
import type {LutFolder} from '../core/lut-folders';
import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import type {CSSProperties,KeyboardEvent,DragEvent} from 'react';
import useToolPreferences from './useToolPreferences';
import {lutViewDefaults} from '../core/lut-view';
import type {LogMark,LutView} from '../core/lut-view';
import {guessLogInput} from '../core/lut-log';
import {bt,browserError} from '../browser/text';
import type {EditorLibrary} from '../core/editor-adapter';
import type {LutAsset,LutSelection} from '../core/lut-contract';
import {validateLutAsset} from '../core/lut-contract';

export default function LutPanel({library,selected,base,disabled,onChange,onBegin,onEnd,onError,onCompare}:{library:EditorLibrary;selected?:LutSelection;base:Blob|null;disabled:boolean;onChange:(value?:LutSelection)=>void;onBegin:()=>void;onEnd:(commit:boolean)=>void;onError:(error:string)=>void;onCompare:(active:boolean)=>void}){
  const [open,setOpen]=useState(false),[assets,setAssets]=useState<LutAsset[]>([]),[busy,setBusy]=useState(false),[query,setQuery]=useState(''),[page,setPage]=useState(0);
  const [dragging,setDragging]=useState(false),[collecting,setCollecting]=useState(false),dragDepth=useRef(0);
  const [bulkReport,setBulkReport]=useState(''),[menu,setMenu]=useState<{asset:LutAsset;anchor:HTMLElement;x:number;y:number}|null>(null);
  useEffect(()=>{if(disabled||busy||collecting||!open)setMenu(null);},[disabled,busy,collecting,open]);
  const [importReport,setImportReport]=useState<{added:number;existing:number;restored:number;failed:number;ignored:number;errors:string[]}|null>(null);
  const [folders,setFolders]=useState<LutFolder[]>([]),[scanning,setScanning]=useState(false),[folderFilter,setFolderFilter]=useState<LutFolderFilter>(null),folderWork=useRef(false),freshness=useRef(0);
  const [view,saveView]=useToolPreferences('lut',lutViewDefaults,onError),filter=view.filter,pageSize=view.columns===3?39:40,limit=(page+1)*pageSize;
  const list=useRef<HTMLUListElement>(null),browse=useRef<{timer:ReturnType<typeof setTimeout>;asset:LutAsset}|null>(null);
  const callbacks=useRef({onEnd,onCompare});callbacks.current={onEnd,onCompare};
  useEffect(()=>()=>{if(browse.current)clearTimeout(browse.current.timer);callbacks.current.onCompare(false);},[]);
  const usageWrites=useRef(new Set<Promise<void>>());
  function noteUsed(id:string){
    const pending=library.noteLutUsed(id).then(updated).catch(e=>{if(alive.current)onError(browserError(e));});
    usageWrites.current.add(pending);void pending.finally(()=>usageWrites.current.delete(pending));
  }
  function finishBrowse(commit=true){const pending=browse.current;if(!pending)return;clearTimeout(pending.timer);browse.current=null;onEnd(commit);if(commit)noteUsed(pending.asset.id);}
  const strengthDraft=useRef<number|null>(null);
  function finishStrength(commit:boolean){onEnd(commit);if(commit&&strengthDraft.current!==null)saveView({strength:strengthDraft.current});strengthDraft.current=null;}
  const input=useRef<HTMLInputElement>(null),folder=useRef<HTMLInputElement>(null),alive=useRef(true),recent=useRef<string[]>([]),thumbnails=useLutThumbnails(library,base,open);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[library]);
  async function refresh(scan=true){
    if(folderWork.current)return;folderWork.current=true;setScanning(true);
    try{await Promise.all([...usageWrites.current]);if(!alive.current)return;const version=freshness.current;let rows=await library.listLutFolders();if(scan){for(const folder of rows){if(!alive.current)return;await library.scanLutFolder(folder.id);}rows=await library.listLutFolders();}const next=await library.listLuts();validateLutFolders(rows);next.forEach(validateLutAsset);if(alive.current){setFolders(rows);setAssets(current=>{const latest=version===freshness.current?next:current;recent.current=latest.filter(a=>a.used_at).sort((a,b)=>b.used_at!.localeCompare(a.used_at!)).map(a=>a.id);return [...latest];});}}
    catch(e){if(alive.current)onError(browserError(e));}finally{folderWork.current=false;if(alive.current)setScanning(false);}
  }
  async function folderAction(id?:string,remove=false){
    if(folderWork.current)return;folderWork.current=true;setScanning(true);try{if(remove&&id){await library.removeLutFolder(id);if(folderFilter?.id===id)setFolderFilter(null);}else await library.linkLutFolder(id);}catch(e){if(alive.current)onError(browserError(e));}finally{folderWork.current=false;if(alive.current){setScanning(false);await refresh();}}
  }
  const focusRefresh=useRef(()=>{});focusRefresh.current=()=>{if(open&&!busy&&!disabled)void refresh();};
  useEffect(()=>{if(open)void refresh();},[library,open]);
  useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const focus=()=>{clearTimeout(timer);timer=setTimeout(()=>focusRefresh.current(),750);};window.addEventListener('focus',focus);return()=>{clearTimeout(timer);window.removeEventListener('focus',focus);};},[]);
  function updated(next:LutAsset){freshness.current++;validateLutAsset(next);if(alive.current)setAssets(rows=>rows.some(a=>a.id===next.id)?rows.map(a=>a.id===next.id?next:a):[...rows,next]);}
  async function importFiles(files:FileList|File[]|null){
    if(!files)return;const picked=[...files].filter(f=>/\.cube$/i.test(f.name));
    if(picked.length>LUT_IMPORT_LIMIT){onError(bt('每批最多导入 5000 个样式，请分批选择。','Choose at most 5000 styles per batch.'));return;}
    const result={added:0,existing:0,restored:0,failed:0,ignored:files.length-picked.length,errors:[] as string[]};setImportReport(result);setBusy(true);onError('');
    try{for(const file of picked){try{const outcome=await library.importLutDetailed(file);updated(outcome.asset);result[outcome.kind]++;}catch(e){result.failed++;const error=(file.webkitRelativePath||file.name)+': '+browserError(e);if(result.errors.length<100)result.errors.push(error);if(alive.current)onError(error);}if(!alive.current)return;setImportReport({...result,errors:[...result.errors]});await new Promise(resolve=>setTimeout(resolve,0));}if(!picked.length)onError(bt('请选择 .cube 调色文件。','Choose .cube color lookup files.'));}
    finally{if(alive.current){setBusy(false);setImportReport({...result,errors:[...result.errors]});}if(input.current)input.current.value='';if(folder.current)folder.current.value='';}
  }
  function fileDrag(e:DragEvent){return [...e.dataTransfer.types].includes('Files');}
  async function drop(e:DragEvent<HTMLDetailsElement>){
    if(!fileDrag(e))return;e.preventDefault();e.stopPropagation();setDragging(false);dragDepth.current=0;
    if(disabled||busy||collecting)return;const selection=lutDropSelection(e.dataTransfer);setCollecting(true);e.currentTarget.open=true;
    try{const files=await collectLutDrop(selection,()=>alive.current);if(alive.current)await importFiles(files);}catch(error){if(alive.current)onError(browserError(error));}finally{if(alive.current)setCollecting(false);}
  }
  function select(asset:LutAsset){finishBrowse();onChange(selected?.asset_hash===asset.id?undefined:{version:1,asset_hash:asset.id,input:'srgb',strength:selected?.strength??view.strength});noteUsed(asset.id);}
  async function patch(asset:LutAsset,value:{favorite?:boolean;hidden?:boolean}){setBusy(true);try{updated(await library.updateLut(asset.id,value));}catch(e){if(alive.current)onError(browserError(e));}finally{if(alive.current)setBusy(false);}}
  async function bulk(hidden:boolean){
    finishBrowse();if(hidden&&!window.confirm(bt('将当前图库全部已复制样式移出列表？旧工程和样式字节会保留，可随时恢复。','Remove all copied styles from this library list? Saved edits and style bytes are kept and can be restored.')))return;
    setBusy(true);setBulkReport('');try{const result=await library.setLutLibraryHidden(hidden);result.assets.forEach(validateLutAsset);if(alive.current){freshness.current++;const changed=new Map(result.assets.map(a=>[a.id,a]));setAssets(rows=>{const all=new Map(rows.map(a=>[a.id,a]));for(const [id,a] of changed)all.set(id,a);return [...all.values()];});setBulkReport((hidden?bt('已移出 ','Removed '):bt('已恢复 ','Restored '))+result.changed+bt(' 个已复制样式。原片和旧工程保持。',' copied styles. Originals and saved edits are unchanged.'));}}
    catch(e){if(alive.current)onError(browserError(e));}finally{if(alive.current)setBusy(false);}
  }
  async function sourceAction(asset:LutAsset,reveal=false){setBusy(true);try{if(reveal)await library.revealLutSource!(asset.id);else{const file=await library.lutSource(asset.id);if(alive.current)await downloadBlob(file,asset.name);}}catch(e){if(alive.current)onError(browserError(e));}finally{if(alive.current)setBusy(false);}}
  function openMenu(asset:LutAsset,anchor:HTMLElement,x?:number,y?:number){if(disabled||busy||collecting)return;finishBrowse();const rect=anchor.getBoundingClientRect();setMenu({asset,anchor,x:x||rect.left,y:y||rect.bottom});}
  function closeMenu(focus=false){setMenu(null);if(focus&&menu){const anchor=menu.anchor;requestAnimationFrame(()=>{if(anchor.isConnected)anchor.focus();else (list.current?.querySelector<HTMLElement>('.lut-choice')||list.current?.closest('details')?.querySelector<HTMLElement>('summary'))?.focus();});}}
  function menuActions(asset:LutAsset):LutMenuAction[]{return [
    {id:'apply',label:selected?.asset_hash===asset.id?bt('移除当前 LUT','Clear current LUT'):bt('应用此样式','Apply this style'),run:()=>select(asset)},
    {id:'favorite',label:asset.favorite?bt('取消收藏','Unfavorite'):bt('收藏此样式','Favorite this style'),run:()=>patch(asset,{favorite:!asset.favorite})},
    {id:'save',label:bt('取出 CUBE 文件','Save CUBE file'),run:()=>sourceAction(asset)},
    ...(library.revealLutSource&&contexts(asset).length?[{id:'reveal',label:bt('定位关联源文件','Reveal linked source'),run:()=>sourceAction(asset,true)}]:[]),
    ...(['auto','log','normal'] as const).map(mark=>({id:mark,label:mark==='auto'?bt('输入：自动提示','Input: auto hint'):mark==='log'?bt('输入：Log','Input: Log'):bt('输入：普通照片','Input: normal photo'),checked:(view[`mark:${asset.id}`]||'auto')===mark,run:()=>{const patch:Partial<LutView>={};patch[`mark:${asset.id}`]=mark;saveView(patch);}})),
    {id:'hidden',label:asset.hidden?bt('恢复此样式','Restore this style'):bt('移出此样式','Remove this style'),run:()=>patch(asset,{hidden:!asset.hidden})}
  ];}
  const contextIndex=useMemo(()=>{const map=new Map<string,{folder:LutFolder;entry:LutFolder['entries'][number]}[]>();for(const folder of folders)for(const entry of folder.entries)if(entry.asset){const old=map.get(entry.asset.id)||[];old.push({folder,entry});map.set(entry.asset.id,old);}return map;},[folders]);
  function contexts(asset:LutAsset){return contextIndex.get(asset.id)||[];}
  function isLog(asset:LutAsset){const mark=view[`mark:${asset.id}`];return mark==='log'||mark!=='normal'&&(!!guessLogInput({name:asset.name,title:asset.title,folders:asset.context?.groups,comments:asset.context?.comments})||contexts(asset).some(({folder,entry})=>!!guessLogInput({name:entry.asset!.name,title:entry.asset!.title,folders:[folder.name,...entry.path.split('/').slice(0,-1)],comments:entry.comments})));}
  const copied=useMemo(()=>copiedLuts(assets,folders),[assets,folders]);
  const sourceIds=folderFilter?new Set(folderFilter.id==='library'?copied.filter(a=>inLutGroup(a,folderFilter.path)).map(a=>a.id):folders.find(f=>f.id===folderFilter.id)?.entries.filter(e=>!folderFilter.path||e.path.startsWith(folderFilter.path+'/')).map(e=>e.asset?.id)):null;

  const filtered=assets.filter(a=>(!sourceIds||sourceIds.has(a.id))&&(filter==='hidden'?a.hidden:!a.hidden)&&(filter!=='favorite'||a.favorite)&&(filter!=='recent'||a.used_at)&&(!view.hideLog||!isLog(a))&&`${a.name} ${a.title} ${a.context?.groups.join('/')||''} ${contexts(a).map(c=>c.folder.name+'/'+c.entry.path).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const ordered=orderLuts(filtered,filter,recent.current);
  const {rows,groups,sections}=lutVisiblePage(ordered,view,page,pageSize);
  function collapseGroup(group:string,collapsed:boolean){finishBrowse();const patch:Partial<LutView>={};patch[`collapse:${group}`]=collapsed;saveView(patch);setPage(0);}
  function collapseAll(collapsed:boolean){finishBrowse();const patch:Partial<LutView>={};for(const group of ['favorite','recent','other','hidden'])patch[`collapse:${group}`]=collapsed;saveView(patch);setPage(0);}
  useEffect(()=>{if(page>0&&page*pageSize>=rows.length)setPage(Math.max(0,Math.ceil(rows.length/pageSize)-1));},[rows.length,page,pageSize]);
  function browseKey(e:KeyboardEvent<HTMLUListElement>){
    if(disabled||busy||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key==='Escape'&&browse.current){e.preventDefault();e.stopPropagation();finishBrowse(false);return;}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||!(e.target instanceof Element)||!e.target.closest('.lut-choice'))return;
    const id=e.target.closest<HTMLElement>('[data-lut]')?.dataset.lut,at=rows.findIndex(a=>a.id===id),next=lutGroupedStep(at,groups,view.columns,e.key,pageSize);
    e.preventDefault();e.stopPropagation();if(next<0||next===at)return;const asset=rows[next];
    if(browse.current)clearTimeout(browse.current.timer);else onBegin();
    onChange({version:1,asset_hash:asset.id,input:'srgb',strength:selected?.strength??view.strength});
    browse.current={asset,timer:setTimeout(()=>finishBrowse(),700)};setPage(Math.floor(next/pageSize));
    requestAnimationFrame(()=>list.current?.querySelector<HTMLButtonElement>(`[data-lut="${asset.id}"] .lut-choice`)?.focus());
  }
  const current=assets.find(a=>a.id===selected?.asset_hash);
  const menuLabel=(name:string)=>bt('更多样式操作 ','More style actions ')+name;
  const groupLabel=(group:string)=>group==='favorite'?bt('收藏','Favorites'):group==='recent'?bt('最近使用','Recent'):group==='hidden'?bt('已移出','Removed'):bt('其他样式','Other styles');
  return <details className={"lut-panel"+(dragging?" lut-drop-active":"")} onDragEnter={e=>{if(fileDrag(e)){e.preventDefault();e.stopPropagation();dragDepth.current++;if(!disabled&&!busy&&!collecting)setDragging(true);}}} onDragLeave={e=>{if(fileDrag(e)){e.preventDefault();e.stopPropagation();if(--dragDepth.current<=0){dragDepth.current=0;setDragging(false);}}}} onDragOver={e=>{if(fileDrag(e)){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect=disabled||busy||collecting?"none":"copy";}}} onDrop={e=>void drop(e)} onToggle={e=>{setOpen(e.currentTarget.open);if(!e.currentTarget.open){finishBrowse();onCompare(false);}}}><summary>{bt('LUT 样式库','LUT styles')}</summary><fieldset disabled={disabled||busy||collecting}>
    <div className="text-layer-actions"><button onClick={()=>input.current?.click()}>{bt('导入 LUT','Import LUT')}</button><button onClick={()=>folder.current?.click()}>{bt('导入文件夹','Import folder')}</button><button onClick={()=>void refresh().catch(e=>onError(browserError(e)))}>{bt('刷新样式','Refresh styles')}</button></div>
    <input ref={input} hidden type="file" accept=".cube" multiple onChange={e=>void importFiles(e.target.files)}/><input ref={folder} hidden type="file" multiple {...{'webkitdirectory':''}} onChange={e=>void importFiles(e.target.files)}/>
    <p className="lut-drop-hint" role={dragging||collecting?'status':undefined}>{collecting?bt('正在读取拖入的目录…','Reading dropped folders…'):dragging?bt('松开以复制导入样式','Drop to import copies of these styles'):bt('可将 CUBE 文件或文件夹拖到此面板。','Drop CUBE files or folders onto this panel.')}</p>
    {importReport&&<div className="lut-import-report" role="status"><p>{busy?bt('正在导入…','Importing…'):bt('导入已结束','Import finished')} · {bt('新增','Added')} {importReport.added} · {bt('已存在','Existing')} {importReport.existing} · {bt('已恢复','Restored')} {importReport.restored} · {bt('失败','Failed')} {importReport.failed} · {bt('非 CUBE 文件','Non-CUBE files')} {importReport.ignored}</p>{!!importReport.errors.length&&<ul>{importReport.errors.map((error,i)=><li key={i}>{error}</li>)}</ul>}{importReport.failed>importReport.errors.length&&<small>{bt('仅显示前 100 项错误。','Only the first 100 errors are shown.')}</small>}</div>}
    <p className="muted">{bt('复制调色文件到当前图库。移出样式列表仍保留旧工程使用的副本。','Color lookup files are copied into this library. Removing a style keeps the copy used by saved edits.')}</p>
    <div className="text-layer-actions"><button onClick={()=>void bulk(true)}>{bt('移出全部已复制样式','Remove all copied styles')}</button><button onClick={()=>void bulk(false)}>{bt('恢复全部已复制样式','Restore all copied styles')}</button></div>{bulkReport&&<p className="muted" role="status">{bulkReport}</p>}
    {current&&<LutSourceInfo key={current.id} asset={current} library={library} linked={contexts(current).map(c=>c.folder.name+'/'+c.entry.path)} onError={onError}/>}
    {selected&&<><p>{current?.title||current?.name||bt('已保存的 LUT','Saved LUT')}{current?.hidden?bt('（已从列表移出）',' (removed from list)'):''}</p><label>{bt('LUT 强度','LUT strength')}<input type="range" aria-label={bt('LUT 强度','LUT strength')} min="0" max="1" step=".01" value={selected.strength} onPointerDown={onBegin} onPointerUp={()=>finishStrength(true)} onPointerCancel={()=>finishStrength(false)} onBlur={()=>finishStrength(true)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key))onBegin();}} onKeyUp={()=>finishStrength(true)} onChange={e=>{const strength=Number(e.target.value);strengthDraft.current=strength;onChange({...selected,strength});}}/><output>{Math.round(selected.strength*100)}%</output></label><button onClick={()=>onChange(undefined)}>{bt('移除当前 LUT','Clear current LUT')}</button><LutCompareButton onCompare={onCompare}/>{current&&isLog(current)&&<p role="note" className="muted">{bt('此样式可能需要 Log 输入；当前照片使用 sRGB，效果可能与样例不同。','This style may expect Log input. This photo uses sRGB, so results may differ from its sample.')}</p>}</>}
    <label>{bt('搜索样式','Search styles')}<input type="search" aria-label={bt('搜索样式','Search styles')} value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
    <label>{bt('样式分组','Style group')}<select aria-label={bt('样式分组','Style group')} value={filter} onChange={e=>{saveView({filter:e.target.value as LutView['filter']});setPage(0);if(e.target.value==='recent')recent.current=assets.filter(a=>a.used_at).sort((a,b)=>b.used_at!.localeCompare(a.used_at!)).map(a=>a.id);}}><option value="all">{bt('全部','All')}</option><option value="favorite">{bt('收藏','Favorites')}</option><option value="recent">{bt('最近使用','Recent')}</option><option value="hidden">{bt('已移出','Removed')}</option></select></label>
    <p className="muted">{bt('缩略图以原图展示 100% 强度；仅处理当前照片的 sRGB 颜色，不自动转换 Log。','Thumbnails show the original at 100% strength. LUTs process the photo’s sRGB colors; Log input is not converted automatically.')}</p>
    <label><input type="checkbox" checked={view.hideLog} onChange={e=>{saveView({hideLog:e.target.checked});setPage(0);}}/>{bt('隐藏 Log 样式','Hide Log styles')}</label>
    <label>{bt('缩略图列数','Thumbnail columns')}<select aria-label={bt('缩略图列数','Thumbnail columns')} value={view.columns} onChange={e=>{saveView({columns:Number(e.target.value) as 1|2|3});setPage(0);}}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
    <p className="muted">{bt('聚焦样式后可用方向键浏览，连续切换合并为一次撤销；Esc 取消本次切换。Log 根据名称、标题、目录和输入注释推测，可手动修正。','Focus a style and use arrow keys to browse; a sequence is one undo step. Esc cancels the sequence. Log is inferred from names, titles, folders and input comments and can be corrected.')}</p>
    <LutFoldersPanel folders={folders} copied={copied} scanning={scanning} view={view} onView={saveView} filter={folderFilter} onFilter={filter=>{finishBrowse();setFolderFilter(filter);setPage(0);}} onLink={id=>void folderAction(id)} onRemove={id=>void folderAction(id,true)} onRefresh={()=>void refresh()}/>
    {!!ordered.rows.length&&<div className="text-layer-actions"><button onClick={()=>collapseAll(false)}>{bt('展开全部分组','Expand all groups')}</button><button onClick={()=>collapseAll(true)}>{bt('收起全部分组','Collapse all groups')}</button></div>}
    <ul ref={list} className="lut-list" data-columns={view.columns} style={{'--lut-columns':view.columns} as CSSProperties} onKeyDown={browseKey} onPointerDownCapture={()=>finishBrowse()} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget))finishBrowse();}}>{sections.map(({group,collapsed,count,assets:pageAssets})=><Fragment key={group}><li className="lut-group-heading" data-lut-group={group}><button aria-expanded={!collapsed} onClick={()=>collapseGroup(group,!collapsed)}><span aria-hidden="true">{collapsed?'▸':'▾'}</span> {groupLabel(group)} <small>{count}</small></button></li>{pageAssets.map(asset=><li key={asset.id} data-lut={asset.id} onContextMenu={e=>{e.preventDefault();e.stopPropagation();openMenu(asset,e.currentTarget.querySelector<HTMLElement>('.lut-choice')!,e.clientX,e.clientY);}}><LutThumbnail asset={asset} queue={thumbnails}>{image=><button className="lut-choice" aria-pressed={selected?.asset_hash===asset.id} onClick={()=>select(asset)} aria-label={bt('应用 LUT ','Apply LUT ')+asset.name}>{image}<span>{asset.title||asset.name}<small>{asset.name} · {asset.size}³{isLog(asset)?' · Log':''}</small></span></button>}</LutThumbnail><div><button className="lut-more" aria-haspopup="menu" aria-label={menuLabel(asset.name)} onClick={e=>openMenu(asset,e.currentTarget)}>⋯</button><button aria-label={bt('收藏 LUT ','Favorite LUT ')+asset.name} aria-pressed={asset.favorite} onClick={()=>void patch(asset,{favorite:!asset.favorite})}>{asset.favorite?'★':'☆'}</button><button aria-label={(asset.hidden?bt('恢复 LUT ','Restore LUT '):bt('移出 LUT ','Remove LUT '))+asset.name} onClick={()=>void patch(asset,{hidden:!asset.hidden})}>{asset.hidden?bt('恢复','Restore'):bt('移出','Remove')}</button></div><label>{bt('输入类型','Input type')}<select aria-label={bt('LUT 输入类型 ','LUT input type ')+asset.name} value={view[`mark:${asset.id}`]??'auto'} onChange={e=>{const patch:Partial<LutView>={};patch[`mark:${asset.id}`]=e.target.value as LogMark;saveView(patch);}}><option value="auto">{bt('自动提示','Auto hint')}</option><option value="log">Log</option><option value="normal">{bt('普通照片','Normal photo')}</option></select></label></li>)}</Fragment>)}</ul>
    {page>0&&<button onClick={()=>setPage(n=>Math.max(0,n-1))}>{bt('上一页样式','Previous styles')}</button>}
    {rows.length>limit&&<button onClick={()=>setPage(n=>n+1)}>{bt('更多样式','More styles')}</button>}
    {!ordered.rows.length&&<p className="muted">{bt('暂无匹配样式。','No matching styles.')}</p>}
  </fieldset>{menu&&!disabled&&!busy&&!collecting&&open&&<LutContextMenu label={bt('样式操作：','Style actions: ')+menu.asset.name} anchor={menu.anchor} x={menu.x} y={menu.y} actions={menuActions(menu.asset)} onClose={closeMenu}/>}</details>;
}

function LutCompareButton({onCompare}:{onCompare:(value:boolean)=>void}){
  const latest=useRef(onCompare);latest.current=onCompare;const held=useRef(false);
  function stop(){if(held.current){held.current=false;latest.current(false);}}
  useEffect(()=>{const hide=()=>{if(document.hidden)stop();};window.addEventListener('blur',stop);document.addEventListener('visibilitychange',hide);return()=>{stop();window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',hide);};},[]);
  return <button className="lut-compare" onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);held.current=true;onCompare(true);}} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onBlur={stop} onKeyDown={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();held.current=true;onCompare(true);}else if(e.key==='Escape')stop();}} onKeyUp={e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();stop();}}}>{bt('按住对比 LUT','Hold to compare LUT')}</button>;
}
