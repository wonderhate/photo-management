import {PhotoSimilarityContext} from './workspace/PhotoSimilarityContext';
import {useCameraName} from './workspace/CameraNames';
import MediaImage from './media/MediaImage';
import {t} from './i18n';
import {useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {ReactNode,MouseEvent,KeyboardEvent,CSSProperties} from 'react';
import {FixedSizeGrid,VariableSizeList} from 'react-window';
import type {GridChildComponentProps,ListChildComponentProps} from 'react-window';
import {galleryRows,photoAspect} from './gallery-layout';
import type {GalleryRow,GalleryLayout} from './gallery-layout';
import WaterfallGallery from './gallery/WaterfallGallery';
import GalleryContent from './gallery/GalleryContent';
import {ImageOff, Heart, Check, X, ChevronLeft, ChevronRight, Star, Search, Camera, Focus, Tag as TagIcon, FileText} from 'lucide-react';
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from 'recharts';
import type {Photo,Bin,Summary} from './types';
import {PhotoBadge} from './RatingColorLabel';
import {PhotoHoverContext} from './workspace/usePhotoInspector';
import {IS_BROWSER} from './runtime';
import {bt} from './browser/text';
import {api,query} from './api';
import type {Filters} from './types';
import type {TagPage} from './core/tag-index';

export function Modal({title,onClose,children,wide=false,className=''}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean;className?:string}) {
  const ref=useRef<HTMLElement|null>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key=(event:globalThis.KeyboardEvent)=>{
      if([...document.querySelectorAll('[aria-modal=true]')].at(-1)!==ref.current)return;
      if(event.target instanceof Element&&event.target.closest('[data-command-menu]'))return;
      if(event.key==='Escape'){event.stopPropagation();close.current();return}
      if(event.key!=='Tab')return;
      const controls=[...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    };
    document.addEventListener('keydown',key,true);
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus()};
  },[]);
  const fullscreen=document.fullscreenElement,host=fullscreen&&fullscreen!==ref.current&&!ref.current?.contains(fullscreen)?fullscreen:document.body;
  return createPortal(<div className={'scrim '+className} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section ref={ref} role="dialog" aria-modal="true" aria-label={title} className={'modal '+(wide?'wide':'')}><header><h2>{title}</h2><button className="icon" aria-label={t("关闭")} onClick={onClose}><X size={20}/></button></header>{children}</section></div>,host);
}
type Suggestion={kind:'camera_model'|'lens_model'|'tag'|'search'|'text';value:string;label:string};
export type SearchMode='natural'|'text'|'filename'|'semantic';
export function Marked({text,term}:{text:string;term?:string}) {
  if(!term)return <>{text}</>;
  const index=text.toLowerCase().indexOf(term.toLowerCase());
  if(index<0)return <>{text}</>;
  return <>{text.slice(0,index)}<mark>{text.slice(index,index+term.length)}</mark>{text.slice(index+term.length)}</>;
}
export function SearchBox({value,options,onFilter,onSemantic,onSearch,literalField,tagScope,revision=0}:{value:string;options:Record<string,(string|number)[]>;onFilter:(key:string,value:string)=>void;onSemantic?:(text:string)=>void;onSearch?:(mode:SearchMode,text:string)=>void;literalField?:'text'|'filename';tagScope?:Filters;revision?:number}){
  const [draft,setDraft]=useState(value);
  const [mode,setMode]=useState<SearchMode>(literalField||(IS_BROWSER?'text':'natural'));
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(-1);
  const boxRef=useRef<HTMLLabelElement|null>(null);
  useEffect(()=>setDraft(value),[value]);
  useEffect(()=>{if(literalField)setMode(literalField)},[literalField]);
  useEffect(()=>{function away(e:globalThis.MouseEvent){if(boxRef.current&&!boxRef.current.contains(e.target as Node))setOpen(false)}document.addEventListener('mousedown',away);return()=>document.removeEventListener('mousedown',away)},[]);
  const q=draft.trim().toLowerCase();
  const scopeKey=JSON.stringify(tagScope),tagKey=JSON.stringify([scopeKey,q,revision]);
  const [tagResult,setTagResult]=useState<{key:string;values:string[];error:boolean}|null>(null),[tagLoading,setTagLoading]=useState(false);
  useEffect(()=>{
    if(tagScope===undefined||!open||!q){setTagLoading(false);return;}const controller=new AbortController();setTagLoading(true);
    const timer=setTimeout(()=>void api<TagPage>('/tags?'+query({...tagScope,q,page_size:'7',order:'manual'}),'GET',undefined,controller.signal).then(result=>{if(!controller.signal.aborted){setTagResult({key:tagKey,values:result.values.map(v=>v.value),error:false});setActive(-1);}}).catch(()=>{if(!controller.signal.aborted)setTagResult({key:tagKey,values:[],error:true});}).finally(()=>{if(!controller.signal.aborted)setTagLoading(false);}),180);
    return()=>{controller.abort();clearTimeout(timer);};
  },[scopeKey,q,revision,open]);
  const tagValues=tagScope===undefined?options.tags||[]:tagResult?.key===tagKey?tagResult.values:[];
  const suggestions:Suggestion[]=[];
  if(q){
    for(const cam of options.camera_model||[])if(String(cam).toLowerCase().includes(q))suggestions.push({kind:'camera_model',value:String(cam),label:String(cam)});
    for(const lens of options.lens_model||[])if(String(lens).toLowerCase().includes(q))suggestions.push({kind:'lens_model',value:String(lens),label:String(lens)});
    for(const tag of tagValues)if(String(tag).toLowerCase().includes(q))suggestions.push({kind:'tag',value:String(tag),label:String(tag)});
    suggestions.splice(7);
    suggestions.push({kind:'text',value:draft.trim(),label:bt('搜索全部文字「','Search text “')+draft.trim()+(bt('」','”'))});
    suggestions.push({kind:'search',value:draft.trim(),label:t("搜索文件名「{0}」",{0:draft.trim()})});
  }
  const shown=suggestions.slice(0,9);
  function submit(kind:SearchMode,text:string){if(onSearch)onSearch(kind,text);else if(kind==='natural'||kind==='semantic')onSemantic?.(text);else onFilter(kind==='text'?'text':'search',text);setOpen(false);setActive(-1)}
  function pick(item:Suggestion){if(item.kind==='search'||item.kind==='text'){const next=item.kind==='text'?'text':'filename';setMode(next);submit(next,item.value)}else{if(onSearch)onSearch(mode,'');else onFilter('search','');onFilter(item.kind,item.value);setDraft('')}setOpen(false);setActive(-1)}
  function key(e:KeyboardEvent<HTMLInputElement>){
    if(e.nativeEvent.isComposing)return;
    if(e.key==='ArrowDown'){e.preventDefault();setActive(a=>Math.min(a+1,shown.length-1))}
    else if(e.key==='ArrowUp'){e.preventDefault();setActive(a=>Math.max(a-1,-1))}
    else if(e.key==='Enter'){if(active>=0&&shown[active])pick(shown[active]);else submit(mode,draft.trim())}
    else if(e.key==='Escape')setOpen(false);
  }
  const icons={camera_model:<Camera size={13}/>,lens_model:<Focus size={13}/>,tag:<TagIcon size={13}/>,search:<FileText size={13}/>,text:<FileText size={13}/>};
  const kindNames={camera_model:t("相机"),lens_model:t("镜头"),tag:t("标签"),search:t("文件名"),text:bt('文字','Text')};
  return <div className="photo-search-controls"><select className="search-mode" aria-label={bt('搜索方式','Search mode')} value={mode} onChange={e=>{setMode(e.target.value as SearchMode);setOpen(false);setActive(-1)}}><option value="natural" disabled={IS_BROWSER}>{bt('自然语言','Natural language')}</option><option value="text">{bt('全部文字','All text')}</option><option value="filename">{bt('文件名','File name')}</option><option value="semantic" disabled={IS_BROWSER}>{bt('画面语义','Visual meaning')}</option></select><label className="search search-autocomplete" ref={boxRef}><Search size={16}/>
    <input aria-label={bt('搜索照片','Search photos')} maxLength={256} placeholder={t("试试：上个月用 50mm 拍的照片")} value={draft} onChange={e=>{setDraft(e.target.value);setOpen(true);setActive(-1);if(!e.target.value)submit(mode,'')}} onFocus={()=>setOpen(true)} onKeyDown={key}/>
    {open&&shown.length>0&&<div className="autocomplete-panel">{shown.map((item,i)=><button key={item.kind+item.value} className={i===active?'active':''} onMouseDown={e=>{e.preventDefault();pick(item)}} onMouseEnter={()=>setActive(i)}>{icons[item.kind]}<span className="ac-label">{item.label}</span><small>{kindNames[item.kind]}</small></button>)}{tagLoading?<small role="status">{bt('正在搜索标签…','Searching tags…')}</small>:tagResult?.key===tagKey&&tagResult.error?<small role="status">{bt('标签建议暂不可用，可继续文字搜索。','Tag suggestions are unavailable. Text search is still available.')}</small>:null}</div>}
  </label></div>;
}
export function Empty({title,children,action}:{title:string;children?:ReactNode;action?:ReactNode}) {return <div className="empty"><div className="empty-icon"><ImageOff size={32}/></div><h2>{title}</h2><p>{children}</p>{action}</div>}
export function Parameters({photo}:{photo:Photo}) {return <span className="params">{[photo.focal_length?`${photo.focal_length} mm`:null,photo.f_number?`f/${photo.f_number}`:null,photo.exposure_time?`${photo.exposure_time} s`:null,photo.iso?`ISO ${photo.iso}`:null].filter(Boolean).join(' · ')||t("未记录拍摄参数")}</span>}
export function HoverPreview({photo,pos}:{photo:Photo;pos:{x:number;y:number}}) {
  const displayCamera=useCameraName(photo.camera_make,photo.camera_model);
  const w=360,h=380,m=16;
  const left=pos.x+m+w>window.innerWidth?pos.x-w-m:pos.x+m;
  const top=Math.max(8,Math.min(pos.y-40,window.innerHeight-h-8));
  return <div className="hover-preview" style={{left,top}}>
    <MediaImage src={photo.preview_url} alt={photo.file_name}/>
    <div className="hp-name">{photo.file_name}</div>
    <div className="hp-exif">{[displayCamera,photo.focal_length&&`${photo.focal_length}mm`,photo.f_number&&`f/${photo.f_number}`,photo.exposure_time&&`${photo.exposure_time}s`,photo.iso&&`ISO ${photo.iso}`].filter(Boolean).join(' · ')}</div>
    {photo.date_taken&&<div className="hp-exif">{photo.date_taken.slice(0,16).replace('T',' ')}</div>}
  </div>;
}
export function PhotoCard({photo,selected,onToggle,onOpen,onFavorite,dragHandle,highlight,interaction='browse'}:{photo:Photo;selected:boolean;onToggle:()=>void;onOpen:()=>void;onFavorite?:(photo:Photo)=>void;dragHandle?:{onStart:()=>void;onDrop:()=>void};highlight?:string;interaction?:'browse'|'pick'}) {
  const displayCamera=useCameraName(photo.camera_make,photo.camera_model);
  const [failed,setFailed]=useState(false);
  const [loaded,setLoaded]=useState(false);
  useLayoutEffect(()=>{setFailed(false);setLoaded(false);},[photo.id,photo.thumbnail_url]);
  const similarity=useContext(PhotoSimilarityContext);
  const hover=useContext(PhotoHoverContext),pointer=useRef('mouse'),clickedSelection=useRef(false);
  useEffect(()=>()=>hover?.leave(photo.id),[photo.id,hover]);
  const paired=photo.files.some(f=>f.is_raw)&&photo.files.some(f=>!f.is_raw);
  function contextMenu(event:MouseEvent<HTMLElement>|KeyboardEvent<HTMLElement>){
    if(interaction!=='browse'||!similarity)return;
    event.preventDefault();event.stopPropagation();hover?.leave(photo.id);
    const anchor=event.currentTarget.querySelector<HTMLElement>('.photo-image')||event.currentTarget,rect=anchor.getBoundingClientRect();
    const pointer='clientX' in event&&event.clientX!==0||'clientY' in event&&event.clientY!==0;
    similarity.menu(photo,anchor,pointer&&(event as MouseEvent).clientX||(rect.left+12),pointer&&(event as MouseEvent).clientY||(rect.top+12));
  }
  return <article onContextMenu={contextMenu} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')contextMenu(event);}} data-photo-id={photo.id} className={'photo-card '+(selected?'selected':'')+(dragHandle?' sortable':'')} draggable={!!dragHandle} onDragStart={dragHandle?()=>{hover?.leave(photo.id);dragHandle.onStart()}:undefined} onDragOver={dragHandle?e=>e.preventDefault():undefined} onDrop={dragHandle?e=>{e.preventDefault();e.stopPropagation();dragHandle.onDrop()}:undefined} onPointerEnter={event=>{if(event.pointerType!=='touch'&&interaction==='browse')hover?.enter(photo)}} onPointerMove={event=>{if(event.pointerType!=='touch'&&interaction==='browse')hover?.enter(photo)}} onPointerLeave={()=>hover?.leave(photo.id)}>
    <button className="photo-image" onPointerDown={event=>{pointer.current=event.pointerType}} onClick={event=>{if(interaction==='pick'||pointer.current==='touch'||event.detail===0){clickedSelection.current=false;onOpen();}else if(event.detail===1){clickedSelection.current=true;onToggle();}}} onDoubleClick={interaction==='browse'?()=>{if(clickedSelection.current){clickedSelection.current=false;onToggle();}onOpen();}:undefined} onKeyDown={event=>{if(interaction==='browse'&&event.key==='Enter'){event.preventDefault();onOpen()}}} aria-label={t("查看 ")+photo.file_name}>
      {photo.thumbnail_path&&photo.preview_status!=='pending'&&!failed?<MediaImage className={loaded?'loaded':'loading-image'} loading="lazy" src={photo.thumbnail_url} alt={photo.file_name} onLoad={()=>setLoaded(true)} onError={()=>setFailed(true)}/>:<div className="image-fallback" aria-busy={photo.preview_status==='pending'}><ImageOff/><span>{t(photo.preview_status==='pending'?'预览正在生成':'预览不可用')}</span></div>}
      {(paired||photo.is_raw)&&<span className="format-badge">{paired?'RAW + JPG':'RAW'}</span>}
      {photo.similarity_score!==undefined&&<span className="score">{photo.similarity_score.toFixed(3)}</span>}
      <PhotoBadge rating={photo.rating??null} colorLabel={photo.color_label??null} flag={photo.flag}/>
    </button>
    <button className={'select-box '+(selected?'checked':'')} onClick={onToggle} aria-label={t("选择 ")+photo.file_name} aria-pressed={selected}>{selected&&<Check size={13}/>}</button>
    {onFavorite&&<button className={'favorite '+(photo.favorite?'on':'')} aria-label={t("收藏 ")+photo.file_name} onClick={()=>onFavorite(photo)}><Heart size={16} fill={photo.favorite?'currentColor':'none'}/></button>}
    <div className="photo-caption"><span title={photo.file_name}><Marked text={photo.file_name} term={highlight}/></span><small title={photo.camera_model||undefined}>{displayCamera||photo.file_format}</small></div>
  </article>;
}
export function Pager({page,total,size=80,onChange}:{page:number;total:number;size?:number;onChange:(value:number)=>void}) {const pages=Math.max(1,Math.ceil(total/size));return <div className="pager"><span>{t("共 ")}{total.toLocaleString()}{t(" 次拍摄")}</span><button disabled={page<=1} onClick={()=>onChange(page-1)}><ChevronLeft size={16}/>{t("上一页")}</button><span>{page} / {pages}</span><button disabled={page>=pages} onClick={()=>onChange(page+1)}>{t("下一页")}<ChevronRight size={16}/></button></div>}
type GridData={ids:string[];cache:Record<string,Photo>;cols:number;gap:number;renderCard:(photo:Photo|undefined,id:string)=>ReactNode};
function GalleryCell({columnIndex,rowIndex,style,data}:{columnIndex:number;rowIndex:number;style:CSSProperties;data:GridData}) {const index=rowIndex*data.cols+columnIndex;const id=data.ids[index];if(!id)return null;return <div style={{...style,padding:`0 ${data.gap/2}px ${data.gap}px`}}>{data.renderCard(data.cache[id],id)}</div>}
type RowData={rows:GalleryRow[];cache:Record<string,Photo>;gap:number;renderCard:(photo:Photo|undefined,id:string)=>ReactNode};
function JustifiedRow({index,style,data}:{index:number;style:CSSProperties;data:RowData}){
  const row=data.rows[index];return <div className="justified-row" style={{...style,gap:data.gap,['--photo-height' as string]:row.height+'px'}}>{row.ids.map((id,i)=><div key={id} style={{width:row.ratios[i]*row.height,minWidth:0}}>{data.renderCard(data.cache[id],id)}</div>)}</div>;
}
export function VirtualGallery({ids,cache,grid,gap,dense,layout='grid',reveal,onNeed,onRange,onVisible,renderCard}:{ids:string[];cache:Record<string,Photo>;grid:number;gap:number;dense?:boolean;layout?:GalleryLayout;reveal?:{id:string;token:number};onNeed:(start:number,end:number)=>void;onRange?:(start:number,end:number)=>void;onVisible?:(ids:string[])=>void;renderCard:(photo:Photo|undefined,id:string)=>ReactNode}) {
  const wrapRef=useRef<HTMLDivElement|null>(null);
  const [size,setSize]=useState({width:0,height:600});
  const listRef=useRef<VariableSizeList|null>(null);
  const gridRef=useRef<FixedSizeGrid|null>(null),revealed=useRef(0);
  const geometryMemory=useRef<{ids:string[];members:Set<string>;aspects:Map<string,number>}>({ids:[],members:new Set(),aspects:new Map()});
  const dimensions=useMemo(()=>{
    const previous=geometryMemory.current;let changed=previous.ids!==ids;
    const aspects=changed?new Map(ids.filter(id=>previous.aspects.has(id)).map(id=>[id,previous.aspects.get(id)!])):previous.aspects;
    const members=changed?new Set(ids):previous.members;
    for(const photo of Object.values(cache))if(members.has(photo.id)&&photo.width&&photo.height){const ratio=photoAspect(photo);if((aspects.get(photo.id)??1.5)!==ratio){aspects.set(photo.id,ratio);changed=true;}}
    if(changed)geometryMemory.current={ids,members,aspects};return geometryMemory.current;
  },[ids,cache]);
  useEffect(()=>{const el=wrapRef.current;if(!el)return;const measure=()=>setSize({width:el.clientWidth,height:el.clientHeight});measure();const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect()},[]);
  const mobile=size.width<=760;
  const cellGap=layout==='tiles'?2:gap;
  const cols=mobile?2:Math.max(1,Math.floor((size.width+cellGap)/(grid+cellGap)));
  const colWidth=size.width/cols;
  const rows=Math.ceil(ids.length/cols);
  const rowHeight=layout==='tiles'?(colWidth-cellGap)/.75+cellGap:mobile?colWidth+(dense?10:34):215+(dense?6:34)+gap;
  const justified=useMemo(()=>layout==='justified'?galleryRows(ids,{},size.width,Math.min(grid,size.width*.66),gap,dimensions.aspects):[],[ids,dimensions,size.width,grid,gap,layout]);
  useEffect(()=>{listRef.current?.resetAfterIndex(0)},[dimensions,size.width,grid,gap,dense]);
  useEffect(()=>{
    if(!reveal||revealed.current===reveal.token||size.width<=0||layout==='waterfall')return;
    const index=ids.indexOf(reveal.id);if(index<0)return;
    if(layout==='justified'){const row=justified.findIndex(r=>r.start<=index&&r.end>=index);if(row<0||!listRef.current)return;listRef.current.scrollToItem(row,'smart');}
    else{if(!gridRef.current)return;gridRef.current.scrollToItem({rowIndex:Math.floor(index/cols),columnIndex:index%cols,align:'smart'});}
    revealed.current=reveal.token;
  },[reveal,ids,layout,size.width,cols,justified]);
  if(layout==='justified')return <div className="virtual-gallery justified-gallery" ref={wrapRef}>{size.width>0&&<VariableSizeList innerElementType={GalleryContent} ref={listRef} height={size.height} width={size.width} itemCount={justified.length} itemSize={i=>justified[i].height+(dense?0:38)+gap} itemData={{rows:justified,cache,gap,renderCard}} overscanCount={2} onItemsRendered={({overscanStartIndex,overscanStopIndex,visibleStartIndex,visibleStopIndex})=>{if(!justified.length)return;onNeed(justified[overscanStartIndex].start,justified[overscanStopIndex].end);onRange?.(justified[visibleStartIndex].start,justified[visibleStopIndex].end);onVisible?.(ids.slice(justified[visibleStartIndex].start,justified[visibleStopIndex].end+1));}}>{JustifiedRow as (props:ListChildComponentProps<RowData>)=>ReactNode}</VariableSizeList>}</div>;
  if(layout==='waterfall')return <div className="virtual-gallery waterfall-gallery" ref={wrapRef}>{size.width>0&&<WaterfallGallery ids={ids} cache={cache} reveal={reveal} dimensions={dimensions} height={size.height} grid={grid} gap={gap} dense={dense} mobile={mobile} onNeed={onNeed} onRange={onRange} onVisible={onVisible} renderCard={renderCard}/>}</div>;
  return <div className={'virtual-gallery'+(layout==='tiles'?' tile-gallery':'')} ref={wrapRef}>{size.width>0&&<FixedSizeGrid innerElementType={GalleryContent} ref={gridRef} itemData={{ids,cache,cols,gap:cellGap,renderCard}} columnCount={cols} columnWidth={colWidth} height={size.height} rowCount={rows} rowHeight={rowHeight} width={size.width} overscanRowCount={2} onItemsRendered={({overscanRowStartIndex,overscanRowStopIndex,visibleRowStartIndex,visibleRowStopIndex})=>{onNeed(overscanRowStartIndex*cols,(overscanRowStopIndex+1)*cols-1);onRange?.(visibleRowStartIndex*cols,(visibleRowStopIndex+1)*cols-1);onVisible?.(ids.slice(visibleRowStartIndex*cols,(visibleRowStopIndex+1)*cols));}}>{GalleryCell as (props:GridChildComponentProps<GridData>)=>ReactNode}</FixedSizeGrid>}</div>;
}
export function Histogram({title,items,onSelect}:{title:string;items:Bin[];onSelect:(bin:Bin)=>void}) {
  return <section className="chart-panel"><header><h3>{title}</h3><small>{t("点击筛选照片")}</small></header><div className="chart"><ResponsiveContainer width="100%" height={210}><BarChart data={items.map(bin=>({...bin,label:t(bin.label)}))} margin={{left:-20,right:8,top:15,bottom:10}}><CartesianGrid vertical={false} stroke="var(--line)"/><XAxis dataKey="label" tick={{fill:'var(--muted)',fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'var(--muted)',fontSize:10}} axisLine={false} tickLine={false} allowDecimals={false}/><Tooltip cursor={{fill:'var(--line)',fillOpacity:.35}} contentStyle={{background:'var(--panel)',border:'1px solid var(--line)',color:'inherit',borderRadius:8}}/><Bar isAnimationActive={false} dataKey="count" name={t("拍摄数量")} fill="#c6b08a" radius={[4,4,0,0]} onClick={(_data,index)=>{if(items[index])onSelect(items[index])}} style={{cursor:'pointer'}}/></BarChart></ResponsiveContainer></div><div className="chart-legend">{items.filter(i=>i.count>0).slice(0,20).map(item=><button key={item.label} onClick={()=>onSelect(item)}>{t(item.label)}<b>{item.count}</b>{item.percent!==undefined&&<small>{item.percent}%</small>}</button>)}</div></section>
}
export function SummaryCards({summary,report=false}:{summary:Summary;report?:boolean}) {
  const metrics=report?[[t("拍摄次数"),summary.captures??summary.total],[t("原始文件"),summary.files??summary.total],[t("拍摄天数"),summary.shooting_days],[t("使用镜头"),summary.lenses]]:[[t("照片 / 拍摄"),summary.total],[t("相机"),summary.cameras],[t("镜头"),summary.lenses],[t("最常用焦段"),summary.common_focal?`${summary.common_focal} mm`:'—']];
  return <div className="metrics">{metrics.map(([label,value])=><div key={label}><span>{label}</span><strong>{typeof value==='number'?value.toLocaleString():value}</strong></div>)}</div>;
}

