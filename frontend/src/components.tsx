import {useEffect,useRef,useState} from 'react';
import type {ReactNode,MouseEvent} from 'react';
import {ImageOff, Heart, Check, X, ChevronLeft, ChevronRight, Star} from 'lucide-react';
import {BarChart,Bar,XAxis,YAxis,Tooltip,ResponsiveContainer,CartesianGrid} from 'recharts';
import type {Photo,Bin,Summary} from './types';
import {PhotoBadge} from './RatingColorLabel';

export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}) {
  return <div className="scrim" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><section role="dialog" aria-modal="true" aria-label={title} className={'modal '+(wide?'wide':'')}><header><h2>{title}</h2><button className="icon" aria-label="关闭" onClick={onClose}><X size={20}/></button></header>{children}</section></div>;
}
export function Empty({title,children,action}:{title:string;children?:ReactNode;action?:ReactNode}) {return <div className="empty"><div className="empty-icon"><ImageOff size={32}/></div><h2>{title}</h2><p>{children}</p>{action}</div>}
export function Parameters({photo}:{photo:Photo}) {return <span className="params">{[photo.focal_length?`${photo.focal_length} mm`:null,photo.f_number?`f/${photo.f_number}`:null,photo.exposure_time?`${photo.exposure_time} s`:null,photo.iso?`ISO ${photo.iso}`:null].filter(Boolean).join(' · ')||'未记录拍摄参数'}</span>}
export function HoverPreview({photo,pos}:{photo:Photo;pos:{x:number;y:number}}) {
  const w=360,h=380,m=16;
  const left=pos.x+m+w>window.innerWidth?pos.x-w-m:pos.x+m;
  const top=Math.max(8,Math.min(pos.y-40,window.innerHeight-h-8));
  return <div className="hover-preview" style={{left,top}}>
    <img src={photo.preview_url} alt={photo.file_name}/>
    <div className="hp-name">{photo.file_name}</div>
    <div className="hp-exif">{[photo.camera_model,photo.focal_length&&`${photo.focal_length}mm`,photo.f_number&&`f/${photo.f_number}`,photo.exposure_time&&`${photo.exposure_time}s`,photo.iso&&`ISO ${photo.iso}`].filter(Boolean).join(' · ')}</div>
    {photo.date_taken&&<div className="hp-exif">{photo.date_taken.slice(0,16).replace('T',' ')}</div>}
  </div>;
}
export function PhotoCard({photo,selected,onToggle,onOpen,onFavorite}:{photo:Photo;selected:boolean;onToggle:()=>void;onOpen:()=>void;onFavorite?:(photo:Photo)=>void}) {
  const [failed,setFailed]=useState(false);
  const [hoverPos,setHoverPos]=useState<{x:number;y:number}|null>(null);
  const hoverTimer=useRef<number|undefined>(undefined);
  useEffect(()=>()=>clearTimeout(hoverTimer.current),[]);
  function enter(e:MouseEvent){const{x,y}={x:e.clientX,y:e.clientY};clearTimeout(hoverTimer.current);hoverTimer.current=window.setTimeout(()=>setHoverPos({x,y}),500)}
  function move(e:MouseEvent){if(hoverPos)setHoverPos({x:e.clientX,y:e.clientY})}
  function leave(){clearTimeout(hoverTimer.current);setHoverPos(null)}
  const paired=photo.files.some(f=>f.is_raw)&&photo.files.some(f=>!f.is_raw);
  return <article className={'photo-card '+(selected?'selected':'')} onMouseEnter={enter} onMouseMove={move} onMouseLeave={leave}>
    <button className="photo-image" onClick={onOpen} aria-label={'查看 '+photo.file_name}>
      {photo.thumbnail_path&&!failed?<img loading="lazy" src={photo.thumbnail_url} alt={photo.file_name} onError={()=>setFailed(true)}/>:<div className="image-fallback"><ImageOff/><span>预览不可用</span></div>}
      {(paired||photo.is_raw)&&<span className="format-badge">{paired?'RAW + JPG':'RAW'}</span>}
      {photo.similarity_score!==undefined&&<span className="score">{photo.similarity_score.toFixed(3)}</span>}
      <PhotoBadge rating={photo.rating??null} colorLabel={photo.color_label??null}/>
    </button>
    <button className={'select-box '+(selected?'checked':'')} onClick={onToggle} aria-label={'选择 '+photo.file_name} aria-pressed={selected}>{selected&&<Check size={13}/>}</button>
    {onFavorite&&<button className={'favorite '+(photo.favorite?'on':'')} aria-label={'收藏 '+photo.file_name} onClick={()=>onFavorite(photo)}><Heart size={16} fill={photo.favorite?'currentColor':'none'}/></button>}
    <div className="photo-caption"><span title={photo.file_name}>{photo.file_name}</span><small>{photo.camera_model||photo.file_format}</small></div>
    {hoverPos&&<HoverPreview photo={photo} pos={hoverPos}/>}
  </article>;
}
export function Pager({page,total,size=80,onChange}:{page:number;total:number;size?:number;onChange:(value:number)=>void}) {const pages=Math.max(1,Math.ceil(total/size));return <div className="pager"><span>共 {total.toLocaleString()} 次拍摄</span><button disabled={page<=1} onClick={()=>onChange(page-1)}><ChevronLeft size={16}/>上一页</button><span>{page} / {pages}</span><button disabled={page>=pages} onClick={()=>onChange(page+1)}>下一页<ChevronRight size={16}/></button></div>}
export function Histogram({title,items,onSelect}:{title:string;items:Bin[];onSelect:(bin:Bin)=>void}) {
  return <section className="chart-panel"><header><h3>{title}</h3><small>点击筛选照片</small></header><div className="chart"><ResponsiveContainer width="100%" height={210}><BarChart data={items} margin={{left:-20,right:8,top:15,bottom:10}}><CartesianGrid vertical={false} stroke="#2c3032"/><XAxis dataKey="label" tick={{fill:'#929999',fontSize:10}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#929999',fontSize:10}} axisLine={false} tickLine={false} allowDecimals={false}/><Tooltip cursor={{fill:'#ffffff08'}} contentStyle={{background:'#25292b',border:'1px solid #3b4143',borderRadius:8}}/><Bar isAnimationActive={false} dataKey="count" name="拍摄数量" fill="#c6b08a" radius={[4,4,0,0]} onClick={(_data,index)=>{if(items[index])onSelect(items[index])}} style={{cursor:'pointer'}}/></BarChart></ResponsiveContainer></div><div className="chart-legend">{items.filter(i=>i.count>0).slice(0,20).map(item=><button key={item.label} onClick={()=>onSelect(item)}>{item.label}<b>{item.count}</b>{item.percent!==undefined&&<small>{item.percent}%</small>}</button>)}</div></section>
}
export function SummaryCards({summary,report=false}:{summary:Summary;report?:boolean}) {
  const metrics=report?[['拍摄次数',summary.captures??summary.total],['原始文件',summary.files??summary.total],['拍摄天数',summary.shooting_days],['使用镜头',summary.lenses]]:[['照片 / 拍摄',summary.total],['相机',summary.cameras],['镜头',summary.lenses],['最常用焦段',summary.common_focal?`${summary.common_focal} mm`:'—']];
  return <div className="metrics">{metrics.map(([label,value])=><div key={label}><span>{label}</span><strong>{typeof value==='number'?value.toLocaleString():value}</strong></div>)}</div>;
}

